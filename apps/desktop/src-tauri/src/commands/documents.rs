use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use tauri::{Manager, Runtime};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_dialog::DialogExt;

use crate::preview::formats::{
    format_for_extension, resolve_renderer, structure_path_extension,
    supported_structure_extensions,
};
use crate::preview::grid_store::GridParseOptions;
use crate::preview::runtime::{
    open_docking_document as open_docking_document_runtime, open_document_for_window,
    open_document_with_grid_options, DockingDocumentRequest, OpenDocumentsResult, ViewerDocument,
    ViewerPreferences, ViewerReloadOptions, XyzrenderControls,
};
use crate::preview::runtime_grid::create_grid_runtime_with_options;
use crate::preview::runtime_viewer::create_combined_sdf_pose_runtime;
use crate::preview::text_xyz::xyz_data_from_text;
use crate::preview::xyzrender::{
    create_xyzrender_artifact, create_xyzrender_smiles_batch_artifacts, XyzrenderSmilesBatchRequest,
};

const XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;
const KETCHER_IMPORT_MAX_STRUCTURE_FILE_SIZE: u64 = 10 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderRequest {
    path: String,
    preset: Option<String>,
    controls: Option<XyzrenderControls>,
    input_data_base64: Option<String>,
    input_extension: Option<String>,
    cache_scope: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderResult {
    svg: String,
    preset: String,
    elapsed_ms: u128,
    log: String,
    cache_hit: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderBatchRequest {
    items: Vec<XyzrenderSheetRenderBatchItemRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderBatchItemRequest {
    id: String,
    #[serde(flatten)]
    request: XyzrenderSheetRenderRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderBatchResult {
    items: Vec<XyzrenderSheetRenderBatchItemResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderSheetRenderBatchItemResult {
    id: String,
    svg: Option<String>,
    preset: Option<String>,
    elapsed_ms: Option<u128>,
    log: String,
    cache_hit: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergedCollectionRequest {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendCollectionRequest {
    target_path: String,
    extension: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCollectionRequest {
    output_path: String,
    extension: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextStructureRequest {
    title: String,
    extension: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClassifiedOpenPaths {
    files: Vec<String>,
    directories: Vec<String>,
    errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStructureFile {
    path: String,
    title: String,
    extension: String,
    renderer: String,
    byte_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelimitedGridOpenRequest {
    path: String,
    smiles_column: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpenDocumentsMode {
    Individual,
    CombinePoses,
    CombineGrid,
}

#[tauri::command]
pub(crate) fn pick_open_targets<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        pick_open_targets_macos(&app)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let files = app
            .dialog()
            .file()
            .set_title("Open Structures")
            .blocking_pick_files()
            .unwrap_or_default();
        Ok(files
            .into_iter()
            .filter_map(|path| path.into_path())
            .map(|path| path.to_string_lossy().to_string())
            .collect())
    }
}

#[tauri::command]
pub(crate) fn classify_open_paths(paths: Vec<String>) -> ClassifiedOpenPaths {
    let mut files = BTreeSet::new();
    let mut directories = BTreeSet::new();
    let mut errors = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let input_path = PathBuf::from(trimmed);
        match input_path.canonicalize() {
            Ok(canonical) => match fs::metadata(&canonical) {
                Ok(metadata) if metadata.is_file() => {
                    files.insert(canonical.to_string_lossy().to_string());
                }
                Ok(metadata) if metadata.is_dir() => {
                    directories.insert(canonical.to_string_lossy().to_string());
                }
                Ok(_) => errors.push(format!(
                    "{} is neither a file nor a directory",
                    canonical.display()
                )),
                Err(error) => errors.push(format!("{}: {error}", canonical.display())),
            },
            Err(error) => errors.push(format!("{trimmed}: {error}")),
        }
    }
    ClassifiedOpenPaths {
        files: files.into_iter().collect(),
        directories: directories.into_iter().collect(),
        errors,
    }
}

#[tauri::command]
pub(crate) fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
    mode: Option<OpenDocumentsMode>,
) -> Result<OpenDocumentsResult, String> {
    open_documents_for_window_label(
        &app,
        window.label(),
        paths,
        preferences,
        reload_options,
        mode,
    )
}

pub(crate) fn open_documents_for_window_label<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    paths: Vec<String>,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
    mode: Option<OpenDocumentsMode>,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let (document_paths, mut errors) = expand_open_document_paths(paths);
    if mode == Some(OpenDocumentsMode::CombinePoses) {
        match open_combined_pose_document(app, document_paths, &preferences, &mut errors) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
        if documents.is_empty() && !errors.is_empty() {
            return Err(errors.join("; "));
        }
        return Ok(OpenDocumentsResult { documents, errors });
    }
    if mode == Some(OpenDocumentsMode::CombineGrid) {
        match open_combined_grid_document(
            app,
            window_label,
            document_paths,
            &preferences,
            &mut errors,
        ) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
        if documents.is_empty() && !errors.is_empty() {
            return Err(errors.join("; "));
        }
        return Ok(OpenDocumentsResult { documents, errors });
    }
    for path in document_paths {
        match open_document_for_window(
            app,
            window_label,
            path,
            &preferences,
            reload_options.as_ref(),
        ) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}

fn open_combined_pose_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    document_paths: Vec<PathBuf>,
    preferences: &ViewerPreferences,
    errors: &mut Vec<String>,
) -> Result<ViewerDocument, String> {
    let sdf_paths = sdf_paths_from_documents(&document_paths);
    if sdf_paths.is_empty() {
        return Err("No SDF docking poses found to combine".to_string());
    }
    push_skipped_sdf_warning(
        document_paths.len(),
        sdf_paths.len(),
        "combining poses",
        errors,
    );

    let label_path = common_sdf_label_path(&sdf_paths);
    let combined = combined_sdf_data(&sdf_paths)?;
    let title = combined_sdf_title(&label_path, "docking poses", "Combined docking poses");
    let runtime =
        create_combined_sdf_pose_runtime(app, &label_path, &title, &combined.data, preferences)?;
    let path = format!("{}#combined-sdf-poses", label_path.to_string_lossy());
    Ok(ViewerDocument::virtual_structure(
        path,
        title,
        "sdf".to_string(),
        runtime.renderer,
        runtime.path.to_string_lossy().to_string(),
        combined.byte_count,
    ))
}

fn open_combined_grid_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    document_paths: Vec<PathBuf>,
    preferences: &ViewerPreferences,
    errors: &mut Vec<String>,
) -> Result<ViewerDocument, String> {
    let sdf_paths = sdf_paths_from_documents(&document_paths);
    if sdf_paths.is_empty() {
        return Err("No SDF files found to combine as a grid".to_string());
    }
    push_skipped_sdf_warning(
        document_paths.len(),
        sdf_paths.len(),
        "building grid",
        errors,
    );

    let label_path = common_sdf_label_path(&sdf_paths);
    let combined = combined_sdf_data(&sdf_paths)?;
    let path = format!("{}#combined-sdf-grid", label_path.to_string_lossy());
    let title = combined_sdf_title(&label_path, "SDF grid", "Combined SDF grid");
    let document_id = crate::windows::runtime_document_id(
        window_label,
        &crate::preview::runtime_utils::stable_id(Path::new(&path)),
    );
    let runtime_path = create_grid_runtime_with_options(
        app,
        &document_id,
        &label_path,
        "sdf",
        &combined.data,
        preferences,
        &GridParseOptions {
            include_single_sdf: true,
            ..GridParseOptions::default()
        },
    )?
    .ok_or_else(|| "No SDF records found to combine as a grid".to_string())?;
    Ok(ViewerDocument::virtual_structure(
        path,
        title,
        "sdf".to_string(),
        "grid2d".to_string(),
        runtime_path.to_string_lossy().to_string(),
        combined.byte_count,
    ))
}

fn push_skipped_sdf_warning(
    total: usize,
    sdf_count: usize,
    action: &str,
    errors: &mut Vec<String>,
) {
    let skipped = total.saturating_sub(sdf_count);
    if skipped > 0 {
        errors.push(format!(
            "Skipped {skipped} non-SDF structure file(s) while {action}"
        ));
    }
}

fn sdf_paths_from_documents(document_paths: &[PathBuf]) -> Vec<PathBuf> {
    document_paths
        .iter()
        .filter(|path| is_sdf_path(path))
        .cloned()
        .collect()
}

fn is_sdf_path(path: &Path) -> bool {
    matches!(structure_path_extension(path).as_str(), "sd" | "sdf")
}

struct CombinedSdfData {
    data: Vec<u8>,
    byte_count: u64,
}

fn combined_sdf_data(sdf_paths: &[PathBuf]) -> Result<CombinedSdfData, String> {
    let mut data = Vec::new();
    let mut byte_count = 0_u64;
    for path in sdf_paths {
        let metadata = fs::metadata(path).map_err(|err| format!("{}: {err}", path.display()))?;
        if metadata.len() > crate::preview::runtime::MAX_STRUCTURE_FILE_SIZE {
            return Err(format!(
                "{} is larger than the 75 MB preview limit",
                path.display()
            ));
        }
        let bytes = fs::read(path).map_err(|err| format!("{}: {err}", path.display()))?;
        if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }
        byte_count = byte_count.saturating_add(bytes.len() as u64);
        if !data.is_empty() && !data.ends_with(b"\n") {
            data.push(b'\n');
        }
        data.extend_from_slice(bytes.trim_ascii_end());
        if !data.ends_with(b"$$$$") {
            data.extend_from_slice(b"\n$$$$");
        }
        data.push(b'\n');
    }
    if data.is_empty() {
        return Err("No SDF docking poses found to combine".to_string());
    }
    Ok(CombinedSdfData { data, byte_count })
}

fn common_sdf_label_path(sdf_paths: &[PathBuf]) -> PathBuf {
    common_parent(sdf_paths).unwrap_or_else(|| {
        sdf_paths
            .first()
            .and_then(|path| path.parent())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("Combined SDF"))
    })
}

fn common_parent(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut components = paths.first()?.parent()?.components().collect::<Vec<_>>();
    for path in paths.iter().skip(1) {
        let parent_components = path.parent()?.components().collect::<Vec<_>>();
        let shared = components
            .iter()
            .zip(parent_components.iter())
            .take_while(|(left, right)| left == right)
            .count();
        components.truncate(shared);
    }
    if components.is_empty() {
        return None;
    }
    Some(components.iter().collect())
}

fn combined_sdf_title(label_path: &Path, suffix: &str, fallback: &str) -> String {
    label_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!("{value} {suffix}"))
        .unwrap_or_else(|| fallback.to_string())
}

fn expand_open_document_paths(paths: Vec<String>) -> (Vec<PathBuf>, Vec<String>) {
    let mut expanded_paths = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut errors = Vec::new();

    for path in paths {
        match expand_open_targets(PathBuf::from(&path)) {
            Ok(expanded) if expanded.is_empty() => {
                errors.push(format!("{path} does not contain supported structure files"));
            }
            Ok(expanded) => {
                for expanded_path in expanded {
                    if seen_paths.insert(expanded_path.clone()) {
                        expanded_paths.push(expanded_path);
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }

    (expanded_paths, errors)
}

#[tauri::command]
pub(crate) fn list_project_structure_files(
    paths: Vec<String>,
) -> Result<Vec<ProjectStructureFile>, String> {
    let mut files = BTreeSet::new();
    let mut errors = Vec::new();
    for path in paths {
        match expand_open_targets(PathBuf::from(&path)) {
            Ok(expanded) => {
                files.extend(expanded);
            }
            Err(error) => errors.push(error),
        }
    }
    if files.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }

    let mut entries = Vec::new();
    for path in files {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => continue,
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        let extension = structure_path_extension(&path);
        let format = match format_for_extension(&extension) {
            Ok(format) => format,
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        entries.push(ProjectStructureFile {
            path: path.to_string_lossy().to_string(),
            title: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("structure")
                .to_string(),
            extension,
            renderer: resolve_renderer(&format, "auto"),
            byte_count: metadata.len(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub(crate) fn open_delimited_grid_document<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: DelimitedGridOpenRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    open_document_with_grid_options(
        &app,
        window.label(),
        PathBuf::from(request.path),
        &preferences,
        None,
        &GridParseOptions {
            smiles_column: Some(request.smiles_column),
            ..GridParseOptions::default()
        },
    )
}

#[tauri::command]
pub(crate) fn read_structure_text(path: String) -> Result<String, String> {
    let input_path = PathBuf::from(&path);
    let extension = structure_path_extension(&input_path);
    let supported = supported_structure_extensions()?;
    if !supported.contains(&extension) {
        return Err(format!("Unsupported structure extension: {extension}"));
    }
    let metadata =
        fs::metadata(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", input_path.display()));
    }
    if metadata.len() > KETCHER_IMPORT_MAX_STRUCTURE_FILE_SIZE {
        return Err(format!(
            "{} is too large for Ketcher import",
            input_path.display()
        ));
    }
    fs::read_to_string(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))
}

#[tauri::command]
pub(crate) fn open_text_structure<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: TextStructureRequest,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
) -> Result<ViewerDocument, String> {
    open_text_structure_for_window_label(&app, window.label(), request, preferences, reload_options)
}

fn open_text_structure_for_window_label<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    request: TextStructureRequest,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
) -> Result<ViewerDocument, String> {
    let extension = request
        .extension
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    if extension.is_empty() {
        return Err("Missing structure extension".to_string());
    }
    let supported = supported_structure_extensions()?;
    if !supported.contains(&extension) {
        return Err(format!("Unsupported structure extension: {extension}"));
    }
    if request.text.trim().is_empty() {
        return Err("Structure text is empty".to_string());
    }
    let byte_count = request.text.len() as u64;
    if byte_count > KETCHER_IMPORT_MAX_STRUCTURE_FILE_SIZE {
        return Err("Structure text is too large".to_string());
    }

    let output_directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer")
        .join("ketcher")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&output_directory).map_err(|err| err.to_string())?;
    let output_path =
        output_directory.join(safe_text_structure_file_name(&request.title, &extension));
    fs::write(&output_path, request.text)
        .map_err(|err| format!("{}: {err}", output_path.display()))?;
    open_document_for_window(
        app,
        window_label,
        output_path,
        &preferences,
        reload_options.as_ref(),
    )
    .map(|document| document.into_virtual())
}

#[tauri::command]
pub(crate) fn open_docking_document<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DockingDocumentRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    open_docking_document_runtime(&app, request, &preferences)
}

#[tauri::command]
pub(crate) fn open_merged_collection<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: MergedCollectionRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let (extension, text) = merge_collection_files(&request.paths)?;
    let output_directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer")
        .join("merged")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&output_directory).map_err(|err| err.to_string())?;
    let output_path = output_directory.join(format!("merged-collection.{extension}"));
    fs::write(&output_path, text).map_err(|err| format!("{}: {err}", output_path.display()))?;
    open_document_for_window(&app, window.label(), output_path, &preferences, None)
        .map(|document| document.into_virtual())
}

#[tauri::command]
pub(crate) fn append_to_molecule_collection<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: AppendCollectionRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let target_path = PathBuf::from(&request.target_path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", request.target_path))?;
    let metadata =
        fs::metadata(&target_path).map_err(|err| format!("{}: {err}", target_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", target_path.display()));
    }

    let target_extension = structure_path_extension(&target_path);
    let target_family = collection_family(&target_extension).ok_or_else(|| {
        format!(
            "{} is not a supported molecule collection",
            target_path.display()
        )
    })?;
    let append_extension = request
        .extension
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    let append_family = collection_family(&append_extension)
        .ok_or_else(|| format!("Unsupported structure extension: {append_extension}"))?;
    if target_family != append_family {
        return Err(
            "Collection append supports one format family at a time: SDF, SMILES, CSV, or TSV"
                .to_string(),
        );
    }
    if target_family != CollectionFamily::Sdf {
        return Err("Ketcher sketches can only be added to SDF collections".to_string());
    }
    if request.text.trim().is_empty() {
        return Err("Structure text is empty".to_string());
    }

    let existing = fs::read_to_string(&target_path)
        .map_err(|err| format!("{}: {err}", target_path.display()))?;
    let merged = merge_collection_text(target_family, &[existing.as_str(), request.text.as_str()]);
    if merged.trim().is_empty() {
        return Err("Merged collection is empty".to_string());
    }
    write_text_atomically(&target_path, &merged)?;
    open_document_for_window(&app, window.label(), target_path, &preferences, None)
}

#[tauri::command]
pub(crate) fn create_molecule_collection<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: CreateCollectionRequest,
    preferences: ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let output_path = PathBuf::from(&request.output_path);
    if output_path.as_os_str().is_empty() {
        return Err("Missing collection output path".to_string());
    }
    let extension = structure_path_extension(&output_path);
    let output_family = collection_family(&extension).ok_or_else(|| {
        format!(
            "{} is not a supported molecule collection",
            output_path.display()
        )
    })?;
    let request_extension = request
        .extension
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    let request_family = collection_family(&request_extension)
        .ok_or_else(|| format!("Unsupported structure extension: {request_extension}"))?;
    if output_family != request_family {
        return Err(
            "New collection extension must match the exported structure family".to_string(),
        );
    }
    if output_family != CollectionFamily::Sdf {
        return Err("Ketcher sketches can only create SDF collections".to_string());
    }
    if request.text.trim().is_empty() {
        return Err("Structure text is empty".to_string());
    }
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    let merged = merge_collection_text(output_family, &[request.text.as_str()]);
    write_text_atomically(&output_path, &merged)?;
    open_document_for_window(&app, window.label(), output_path, &preferences, None)
}

#[tauri::command]
pub(crate) fn save_molecule_collection_as(
    path: String,
    output_path: String,
) -> Result<String, String> {
    let input_path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|err| format!("{path}: {err}"))?;
    let extension = structure_path_extension(&input_path);
    if collection_family(&extension).is_none() {
        return Err(format!(
            "{} is not a supported molecule collection",
            input_path.display()
        ));
    }
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    fs::copy(&input_path, &output)
        .map_err(|err| format!("{} -> {}: {err}", input_path.display(), output.display()))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn save_text_as(text: String, output_path: String) -> Result<String, String> {
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    fs::write(&output, text).map_err(|err| format!("{}: {err}", output.display()))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) async fn render_xyzrender_sheet_item<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: XyzrenderSheetRenderRequest,
) -> Result<XyzrenderSheetRenderResult, String> {
    let viewer_cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer");
    let output_directory = viewer_cache_directory
        .join("sheet")
        .join(uuid::Uuid::new_v4().to_string());
    let cache_directory = match request.cache_scope.as_deref() {
        Some("grid-card") => Some(viewer_cache_directory.join("grid-xyzrender-card-cache")),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(move || {
        render_xyzrender_sheet_item_blocking(output_directory, cache_directory, request)
    })
    .await
    .map_err(|err| format!("xyzrender sheet render task failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn render_xyzrender_sheet_items<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: XyzrenderSheetRenderBatchRequest,
) -> Result<XyzrenderSheetRenderBatchResult, String> {
    let viewer_cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer");
    tauri::async_runtime::spawn_blocking(move || {
        render_xyzrender_sheet_items_blocking(viewer_cache_directory, request)
    })
    .await
    .map_err(|err| format!("xyzrender sheet batch render task failed: {err}"))?
}

fn render_xyzrender_sheet_items_blocking(
    viewer_cache_directory: PathBuf,
    request: XyzrenderSheetRenderBatchRequest,
) -> Result<XyzrenderSheetRenderBatchResult, String> {
    let mut results = Vec::new();
    let mut batch_requests = Vec::new();
    for item in request.items {
        let output_directory = viewer_cache_directory
            .join("sheet")
            .join(uuid::Uuid::new_v4().to_string());
        let cache_directory = match item.request.cache_scope.as_deref() {
            Some("grid-card") => Some(viewer_cache_directory.join("grid-xyzrender-card-cache")),
            _ => None,
        };
        if let Some(batch_request) = prepare_xyzrender_smiles_batch_request(
            &item,
            &output_directory,
            cache_directory.clone(),
        ) {
            match batch_request {
                Ok(value) => {
                    batch_requests.push(value);
                    continue;
                }
                Err(error) => {
                    results.push(XyzrenderSheetRenderBatchItemResult {
                        id: item.id,
                        svg: None,
                        preset: Some("default".to_string()),
                        elapsed_ms: Some(0),
                        log: String::new(),
                        cache_hit: false,
                        error: Some(error),
                    });
                    continue;
                }
            }
        }
        match render_xyzrender_sheet_item_blocking(output_directory, cache_directory, item.request)
        {
            Ok(result) => results.push(XyzrenderSheetRenderBatchItemResult {
                id: item.id,
                svg: Some(result.svg),
                preset: Some(result.preset),
                elapsed_ms: Some(result.elapsed_ms),
                log: result.log,
                cache_hit: result.cache_hit,
                error: None,
            }),
            Err(error) => results.push(XyzrenderSheetRenderBatchItemResult {
                id: item.id,
                svg: None,
                preset: Some("default".to_string()),
                elapsed_ms: Some(0),
                log: String::new(),
                cache_hit: false,
                error: Some(error),
            }),
        }
    }
    results.extend(
        create_xyzrender_smiles_batch_artifacts(batch_requests)
            .into_iter()
            .map(|result| XyzrenderSheetRenderBatchItemResult {
                id: result.id,
                svg: result.svg,
                preset: Some(result.preset),
                elapsed_ms: Some(result.elapsed_ms),
                log: result.log,
                cache_hit: result.cache_hit,
                error: result.error,
            }),
    );
    Ok(XyzrenderSheetRenderBatchResult { items: results })
}

fn prepare_xyzrender_smiles_batch_request(
    item: &XyzrenderSheetRenderBatchItemRequest,
    output_directory: &Path,
    cache_directory: Option<PathBuf>,
) -> Option<Result<XyzrenderSmilesBatchRequest, String>> {
    let request = &item.request;
    if request.controls.is_some() {
        return None;
    }
    if !matches!(request.preset.as_deref(), None | Some("default")) {
        return None;
    }
    let input_data_base64 = request
        .input_data_base64
        .as_deref()
        .filter(|value| !value.is_empty())?;
    let extension = match normalize_inline_structure_extension(
        request.input_extension.as_deref(),
        Path::new(&request.path),
    ) {
        Ok(value) => value,
        Err(error) => return Some(Err(error)),
    };
    if !matches!(extension.as_str(), "smi" | "smiles") {
        return None;
    }
    let data = match base64::engine::general_purpose::STANDARD.decode(input_data_base64) {
        Ok(value) => value,
        Err(error) => {
            return Some(Err(format!(
                "Could not decode inline xyzrender sheet input: {error}"
            )))
        }
    };
    if data.len() as u64 > XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE {
        return Some(Err(
            "Inline structure is too large for an xyzrender sheet item".into(),
        ));
    }
    if let Err(error) = fs::create_dir_all(output_directory) {
        return Some(Err(error.to_string()));
    }
    let input_path = output_directory.join("sheet-input.smi");
    if let Err(error) = fs::write(&input_path, &data) {
        return Some(Err(format!("{}: {error}", input_path.display())));
    }
    let direct_smiles = match smiles_from_sheet_data(&data) {
        Ok(value) => value,
        Err(error) => return Some(Err(error)),
    };
    Some(Ok(XyzrenderSmilesBatchRequest {
        id: item.id.clone(),
        input_path,
        output_directory: output_directory.to_path_buf(),
        cache_directory,
        preset: request.preset.clone(),
        controls: request.controls.clone(),
        direct_smiles,
    }))
}

fn render_xyzrender_sheet_item_blocking(
    output_directory: PathBuf,
    cache_directory: Option<PathBuf>,
    request: XyzrenderSheetRenderRequest,
) -> Result<XyzrenderSheetRenderResult, String> {
    fs::create_dir_all(&output_directory).map_err(|err| err.to_string())?;

    let inline_data = match request
        .input_data_base64
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|err| format!("Could not decode inline xyzrender sheet input: {err}"))?,
        ),
        None => None,
    };

    let (input_path, extension, data, label) = if let Some(data) = inline_data {
        if data.len() as u64 > XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE {
            return Err("Inline structure is too large for an xyzrender sheet item".into());
        }
        let extension = normalize_inline_structure_extension(
            request.input_extension.as_deref(),
            Path::new(&request.path),
        )?;
        let input_path = output_directory.join(format!("sheet-input.{extension}"));
        fs::write(&input_path, &data).map_err(|err| format!("{}: {err}", input_path.display()))?;
        let label = Path::new(&request.path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("structure")
            .to_string();
        (input_path, extension, data, label)
    } else {
        let input_path = PathBuf::from(&request.path)
            .canonicalize()
            .map_err(|err| format!("{}: {err}", request.path))?;
        let metadata =
            fs::metadata(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a file", input_path.display()));
        }
        if metadata.len() > XYZRENDER_SHEET_MAX_STRUCTURE_FILE_SIZE {
            return Err(format!(
                "{} is too large for an xyzrender sheet item",
                input_path.display()
            ));
        }
        let extension = structure_path_extension(&input_path);
        let data =
            fs::read(&input_path).map_err(|err| format!("{}: {err}", input_path.display()))?;
        let label = input_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("structure")
            .to_string();
        (input_path, extension, data, label)
    };
    let direct_smiles = if matches!(extension.as_str(), "smi" | "smiles") {
        Some(smiles_from_sheet_data(&data)?)
    } else {
        let format = format_for_extension(&extension)?;
        if format.is_binary {
            return Err(format!(
                "{} is a binary format and cannot be added to an xyzrender sheet",
                input_path.display()
            ));
        }
        None
    };

    let converted_xyz = if direct_smiles.is_some() || matches!(extension.as_str(), "cub" | "cube") {
        None
    } else {
        xyz_data_from_text(&data, &extension, &label)
    };
    let artifact = create_xyzrender_artifact(
        &input_path,
        &output_directory,
        cache_directory.as_deref(),
        request.preset.as_deref(),
        None,
        request.controls.as_ref(),
        direct_smiles.as_deref(),
        converted_xyz.as_deref(),
    )?;
    let svg_path = output_directory.join(artifact.relative_path);
    let svg =
        fs::read_to_string(&svg_path).map_err(|err| format!("{}: {err}", svg_path.display()))?;
    Ok(XyzrenderSheetRenderResult {
        svg,
        preset: artifact.preset.to_string(),
        elapsed_ms: artifact.elapsed_ms,
        log: artifact.log,
        cache_hit: artifact.cache_hit,
    })
}

fn normalize_inline_structure_extension(
    input_extension: Option<&str>,
    path: &Path,
) -> Result<String, String> {
    let extension = input_extension
        .map(|value| value.trim().trim_start_matches('.').to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| structure_path_extension(path));
    if matches!(extension.as_str(), "smi" | "smiles") {
        return Ok("smi".to_string());
    }
    format_for_extension(&extension)?;
    Ok(extension)
}

fn smiles_from_sheet_data(data: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(data);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let candidate = trimmed
            .split(|ch: char| ch.is_whitespace() || ch == ',')
            .find(|value| !value.trim().is_empty())
            .unwrap_or_default()
            .trim();
        if candidate.eq_ignore_ascii_case("smiles") || candidate.eq_ignore_ascii_case("smile") {
            continue;
        }
        if !candidate.is_empty() {
            return Ok(candidate.to_string());
        }
    }
    Err("SMILES sheet input is empty".to_string())
}

fn safe_text_structure_file_name(title: &str, extension: &str) -> String {
    let raw_stem = Path::new(title)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("ketcher-sketch");
    let stem: String = raw_stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '_', '.'])
        .to_string();
    let stem = if stem.is_empty() {
        "ketcher-sketch".to_string()
    } else {
        stem
    };
    format!("{stem}.{extension}")
}

#[tauri::command]
pub(crate) fn sync_viewer_preferences(preferences: ViewerPreferences) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        sync_viewer_preferences_macos(&preferences)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = preferences;
        Ok(())
    }
}

fn expand_open_targets(path: PathBuf) -> Result<Vec<PathBuf>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata =
        fs::metadata(&canonical).map_err(|err| format!("{}: {err}", canonical.display()))?;
    if metadata.is_file() {
        return Ok(vec![canonical]);
    }
    if !metadata.is_dir() {
        return Err(format!(
            "{} is neither a file nor a directory",
            canonical.display()
        ));
    }

    let supported_extensions = supported_structure_extensions()?;
    let mut collected = BTreeSet::new();
    let mut visited_directories = HashSet::new();
    collect_supported_files(
        &canonical,
        &mut visited_directories,
        &supported_extensions,
        &mut collected,
    )?;
    Ok(collected.into_iter().collect())
}

fn merge_collection_files(paths: &[String]) -> Result<(String, String), String> {
    let mut seen = HashSet::new();
    let mut sources: Vec<(CollectionFamily, String)> = Vec::new();
    for path in paths {
        let canonical = PathBuf::from(path)
            .canonicalize()
            .map_err(|err| format!("{path}: {err}"))?;
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let metadata =
            fs::metadata(&canonical).map_err(|err| format!("{}: {err}", canonical.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a file", canonical.display()));
        }
        let extension = structure_path_extension(&canonical);
        let family = collection_family(&extension).ok_or_else(|| {
            format!(
                "{} is not a supported molecule collection",
                canonical.display()
            )
        })?;
        let text = fs::read_to_string(&canonical)
            .map_err(|err| format!("{}: {err}", canonical.display()))?;
        sources.push((family, text));
    }
    if sources.len() < 2 {
        return Err("Drop at least two molecule collections to merge them".to_string());
    }
    let family = sources[0].0;
    if sources
        .iter()
        .any(|(next_family, _)| *next_family != family)
    {
        return Err(
            "Collection merge supports one format family at a time: SDF, SMILES, CSV, or TSV"
                .to_string(),
        );
    }
    let texts: Vec<&str> = sources.iter().map(|(_, text)| text.as_str()).collect();
    let text = merge_collection_text(family, &texts);
    if text.trim().is_empty() {
        return Err("Merged collection is empty".to_string());
    }
    Ok((family.default_extension().to_string(), text))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CollectionFamily {
    Sdf,
    Smiles,
    Csv,
    Tsv,
}

impl CollectionFamily {
    fn default_extension(self) -> &'static str {
        match self {
            Self::Sdf => "sdf",
            Self::Smiles => "smi",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }
}

fn collection_family(extension: &str) -> Option<CollectionFamily> {
    match extension {
        "sd" | "sdf" => Some(CollectionFamily::Sdf),
        "smi" | "smiles" => Some(CollectionFamily::Smiles),
        "csv" => Some(CollectionFamily::Csv),
        "tsv" => Some(CollectionFamily::Tsv),
        _ => None,
    }
}

fn merge_collection_text(family: CollectionFamily, texts: &[&str]) -> String {
    match family {
        CollectionFamily::Sdf => {
            let records: Vec<String> = texts
                .iter()
                .flat_map(|text| {
                    text.split("$$$$")
                        .map(str::trim)
                        .filter(|record| !record.is_empty())
                })
                .map(|record| format!("{record}\n$$$$"))
                .collect();
            format!("{}\n", records.join("\n"))
        }
        CollectionFamily::Smiles => {
            let lines: Vec<&str> = texts
                .iter()
                .flat_map(|text| text.lines().map(str::trim).filter(|line| !line.is_empty()))
                .collect();
            format!("{}\n", lines.join("\n"))
        }
        CollectionFamily::Csv | CollectionFamily::Tsv => {
            let mut lines = Vec::new();
            for (index, text) in texts.iter().enumerate() {
                let mut file_lines = text.lines().filter(|line| !line.trim().is_empty());
                if index == 0 {
                    lines.extend(file_lines);
                } else {
                    let _ = file_lines.next();
                    lines.extend(file_lines);
                }
            }
            format!("{}\n", lines.join("\n"))
        }
    }
}

fn write_text_atomically(path: &Path, text: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("collection");
    let temporary_path = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temporary_path, text)
        .map_err(|err| format!("{}: {err}", temporary_path.display()))?;
    if let Err(error) = fs::rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("{}: {error}", path.display()));
    }
    Ok(())
}

fn collect_supported_files(
    directory: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    supported_extensions: &BTreeSet<String>,
    collected: &mut BTreeSet<PathBuf>,
) -> Result<(), String> {
    let canonical_directory = directory
        .canonicalize()
        .map_err(|err| format!("{}: {err}", directory.display()))?;
    if !visited_directories.insert(canonical_directory.clone()) {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|err| format!("{}: {err}", directory.display()))? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            let Ok(target_metadata) = fs::metadata(&path) else {
                continue;
            };
            if target_metadata.is_dir() {
                let _ = collect_supported_files(
                    &path,
                    visited_directories,
                    supported_extensions,
                    collected,
                );
                continue;
            }
            if target_metadata.is_file()
                && looks_like_supported_structure_file(&path, supported_extensions)
            {
                collected.insert(path);
            }
            continue;
        }
        if metadata.is_dir() {
            let _ = collect_supported_files(
                &path,
                visited_directories,
                supported_extensions,
                collected,
            );
            continue;
        }
        if metadata.is_file() && looks_like_supported_structure_file(&path, supported_extensions) {
            collected.insert(path);
        }
    }
    Ok(())
}

fn looks_like_supported_structure_file(
    path: &std::path::Path,
    supported_extensions: &BTreeSet<String>,
) -> bool {
    let extension = structure_path_extension(path);
    supported_extensions.contains(&extension)
}

#[cfg(target_os = "macos")]
fn sync_viewer_preferences_macos(preferences: &ViewerPreferences) -> Result<(), String> {
    use cocoa::base::{id, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let defaults: id = msg_send![class!(NSUserDefaults), standardUserDefaults];
        set_defaults_string(defaults, "viewerTheme", &preferences.theme)?;
        set_defaults_string(
            defaults,
            "viewerCanvasBackground",
            &preferences.canvas_background,
        )?;
        set_defaults_string(
            defaults,
            "structureRendererMode",
            &preferences.renderer_mode,
        )?;
        set_defaults_string(defaults, "molstarStyle", &preferences.molstar_style)?;
        set_defaults_string(
            defaults,
            "themeLightAccent",
            &preferences.theme_light_accent,
        )?;
        set_defaults_string(
            defaults,
            "themeLightBackground",
            &preferences.theme_light_background,
        )?;
        set_defaults_string(
            defaults,
            "themeLightForeground",
            &preferences.theme_light_foreground,
        )?;
        set_defaults_string(
            defaults,
            "themeLightUiFont",
            &preferences.theme_light_ui_font,
        )?;
        set_defaults_string(
            defaults,
            "themeLightEditorFont",
            &preferences.theme_light_editor_font,
        )?;
        set_defaults_double(
            defaults,
            "themeLightTranslucent",
            preferences.theme_light_translucent,
        )?;
        set_defaults_double(
            defaults,
            "themeLightContrast",
            preferences.theme_light_contrast,
        )?;
        set_defaults_string(defaults, "themeDarkAccent", &preferences.theme_dark_accent)?;
        set_defaults_string(
            defaults,
            "themeDarkBackground",
            &preferences.theme_dark_background,
        )?;
        set_defaults_string(
            defaults,
            "themeDarkForeground",
            &preferences.theme_dark_foreground,
        )?;
        set_defaults_string(defaults, "themeDarkUiFont", &preferences.theme_dark_ui_font)?;
        set_defaults_string(
            defaults,
            "themeDarkEditorFont",
            &preferences.theme_dark_editor_font,
        )?;
        set_defaults_double(
            defaults,
            "themeDarkTranslucent",
            preferences.theme_dark_translucent,
        )?;
        set_defaults_double(
            defaults,
            "themeDarkContrast",
            preferences.theme_dark_contrast,
        )?;

        let transparent_key = autoreleased_nsstring("useTransparentPreviewBackground")?;
        let transparent_value = if preferences.resolved_transparent_background() {
            YES
        } else {
            NO
        };
        let _: () = msg_send![defaults, setBool: transparent_value forKey: transparent_key];
        let _: () = msg_send![defaults, synchronize];
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_defaults_double(defaults: cocoa::base::id, key: &str, value: f64) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let key = autoreleased_nsstring(key)?;
        let _: () = msg_send![defaults, setDouble: value forKey: key];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_defaults_string(defaults: cocoa::base::id, key: &str, value: &str) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let key = autoreleased_nsstring(key)?;
        let value = autoreleased_nsstring(value)?;
        let _: () = msg_send![defaults, setObject: value forKey: key];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn autoreleased_nsstring(value: &str) -> Result<cocoa::base::id, String> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};

    let c_value = CString::new(value).map_err(|_| format!("invalid NSString value: {value}"))?;
    unsafe {
        let string: id = msg_send![class!(NSString), alloc];
        let string: id = msg_send![string, initWithUTF8String: c_value.as_ptr()];
        if string.is_null() {
            return Err("failed to allocate NSString".into());
        }
        let string: id = msg_send![string, autorelease];
        Ok(string)
    }
}

#[cfg(target_os = "macos")]
fn pick_open_targets_macos<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    use cocoa::appkit::{NSApp, NSModalResponse, NSOpenPanel, NSSavePanel};
    use cocoa::base::{id, nil, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || unsafe {
        let panel: id = NSOpenPanel::openPanel(nil);
        panel.setCanChooseFiles_(YES);
        panel.setCanChooseDirectories_(YES);
        panel.setAllowsMultipleSelection_(YES);
        panel.setCanCreateDirectories(NO);
        panel.setResolvesAliases_(YES);

        let title: id = msg_send![class!(NSString), alloc];
        let title: id = msg_send![title, initWithUTF8String: c"Open Structures".as_ptr()];
        let _: () = msg_send![panel, setTitle: title];

        let response: NSModalResponse = panel.runModal();
        if response != NSModalResponse::NSModalResponseOk {
            let _ = sender.send(Ok(Vec::new()));
            return;
        }

        let urls: id = panel.URLs();
        let count: usize = msg_send![urls, count];
        let mut paths = Vec::with_capacity(count);
        for index in 0..count {
            let url: id = msg_send![urls, objectAtIndex: index];
            let path_value: id = msg_send![url, path];
            let utf8: *const c_char = msg_send![path_value, UTF8String];
            if !utf8.is_null() {
                paths.push(CStr::from_ptr(utf8).to_string_lossy().into_owned());
            }
        }
        let _: id = msg_send![title, autorelease];
        let _: id = msg_send![NSApp(), activateIgnoringOtherApps: YES];
        let _ = sender.send(Ok(paths));
    })
    .map_err(|err| err.to_string())?;

    receiver.recv().map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        classify_open_paths, expand_open_document_paths, expand_open_targets,
        list_project_structure_files, looks_like_supported_structure_file,
        normalize_inline_structure_extension, open_text_structure_for_window_label,
        smiles_from_sheet_data, TextStructureRequest,
    };
    use crate::preview::formats::supported_structure_extensions;
    use crate::preview::grid_store::GridRuntimeRegistry;
    use crate::preview::runtime::ViewerPreferences;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use tauri::Manager;

    fn viewer_preferences() -> ViewerPreferences {
        ViewerPreferences {
            theme: "auto".to_string(),
            canvas_background: "auto".to_string(),
            renderer_mode: "auto".to_string(),
            molstar_style: "illustrative".to_string(),
            theme_light_accent: "#AF52DE".to_string(),
            theme_light_background: "#FFFFFF".to_string(),
            theme_light_foreground: "#0D0D0D".to_string(),
            theme_light_ui_font: "-apple-system-body".to_string(),
            theme_light_editor_font: "-apple-system-body".to_string(),
            theme_light_translucent: 10.0,
            theme_light_contrast: 20.0,
            theme_dark_accent: "#AF52DE".to_string(),
            theme_dark_background: "#111111".to_string(),
            theme_dark_foreground: "#FCFCFC".to_string(),
            theme_dark_ui_font: "-apple-system-body".to_string(),
            theme_dark_editor_font: "-apple-system-body".to_string(),
            theme_dark_translucent: 20.0,
            theme_dark_contrast: 16.0,
        }
    }

    fn mock_app_with_grid_registry() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(GridRuntimeRegistry::default());
        app
    }

    #[test]
    fn recognizes_supported_structure_files() {
        let supported_extensions =
            supported_structure_extensions().expect("supported extensions should load");
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.pdb"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.cif"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mini.sdf"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("caffeine.com"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("caffeine.psi4"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("ligand.mae.gz"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("system.cms"),
            &supported_extensions
        ));
        assert!(looks_like_supported_structure_file(
            std::path::Path::new("mn-h2.log"),
            &supported_extensions
        ));
        assert!(!looks_like_supported_structure_file(
            std::path::Path::new("notes.txt"),
            &supported_extensions
        ));
    }

    #[test]
    fn classifies_open_paths_without_expanding_directories() {
        let root = std::env::temp_dir().join(format!(
            "burrete-classify-open-paths-{}",
            std::process::id()
        ));
        let nested = root.join("nested");
        let pdb = root.join("mini.pdb");
        fs::create_dir_all(&nested).unwrap();
        fs::write(&pdb, "HEADER TEST\n").unwrap();

        let classified = classify_open_paths(vec![
            pdb.to_string_lossy().to_string(),
            nested.to_string_lossy().to_string(),
            root.join("missing.pdb").to_string_lossy().to_string(),
        ]);

        assert_eq!(
            classified.files,
            vec![pdb.canonicalize().unwrap().to_string_lossy().to_string()]
        );
        assert_eq!(
            classified.directories,
            vec![nested.canonicalize().unwrap().to_string_lossy().to_string()]
        );
        assert_eq!(classified.errors.len(), 1);
        assert!(classified.errors[0].contains("missing.pdb"));

        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn normalizes_inline_smiles_for_xyzrender_sheet_items() {
        assert_eq!(
            normalize_inline_structure_extension(
                Some("smiles"),
                std::path::Path::new("molecules.csv")
            )
            .unwrap(),
            "smi"
        );
        assert_eq!(
            normalize_inline_structure_extension(Some(".smi"), std::path::Path::new("row.csv"))
                .unwrap(),
            "smi"
        );
        assert_eq!(
            smiles_from_sheet_data(b"SMILES name\n\nc1ccccc1 benzene\n").unwrap(),
            "c1ccccc1"
        );
    }

    #[test]
    fn merges_csv_collections_without_duplicate_headers() {
        let merged = super::merge_collection_text(
            super::CollectionFamily::Csv,
            &[
                "smiles,name\nCCO,ethanol\n",
                "smiles,name\nc1ccccc1,benzene\n",
                "\nsmiles,name\nCCN,ethylamine\n",
            ],
        );

        assert_eq!(
            merged,
            "smiles,name\nCCO,ethanol\nc1ccccc1,benzene\nCCN,ethylamine\n"
        );
        assert_eq!(merged.matches("smiles,name").count(), 1);
    }

    #[test]
    fn opens_inline_single_sdf_as_grid_when_explicitly_requested() {
        let app = mock_app_with_grid_registry();
        let mut preferences = viewer_preferences();
        preferences.renderer_mode = "grid2d".to_string();

        let document = open_text_structure_for_window_label(
            app.handle(),
            crate::windows::MAIN_WINDOW_LABEL,
            TextStructureRequest {
                title: "ketcher-sketch.sdf".to_string(),
                extension: "sdf".to_string(),
                text: concat!(
                    "Ketcher sketch\n",
                    "\n",
                    "\n",
                    "  3  2  0  0  0  0  0  0  0  0999 V2000\n",
                    "   10.3881   -6.0500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n",
                    "   11.2541   -5.5500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n",
                    "    9.5221   -5.5500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n",
                    "  1  2  1  0     0  0\n",
                    "  1  3  1  0     0  0\n",
                    "M  END\n",
                    "$$$$\n",
                )
                .to_string(),
            },
            preferences,
            Some(super::ViewerReloadOptions {
                xyzrender_orientation_ref: None,
                xyzrender_preset: None,
                xyzrender_controls: None,
            }),
        )
        .expect("explicit grid Ketcher SDF should open");

        let value = serde_json::to_value(document).expect("document should serialize");
        assert_eq!(value["renderer"], "grid2d");
        assert!(
            Path::new(
                value["runtimePath"]
                    .as_str()
                    .expect("runtime path should be present")
            )
            .is_file(),
            "grid runtime HTML should be created"
        );
    }

    #[test]
    fn expands_directories_into_supported_files() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-{}", std::process::id()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let pdb = root.join("mini.pdb");
        let cif = nested.join("mini.cif");
        let input = nested.join("caffeine.com");
        let log = root.join("mn-h2.log");
        let txt = nested.join("notes.txt");
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        fs::write(&cif, "data_test\n").unwrap();
        fs::write(&input, "%chk=test\n").unwrap();
        fs::write(&log, "SCF DONE\n").unwrap();
        fs::write(&txt, "ignore\n").unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(
            expanded,
            vec![
                canonical_root.join("mini.pdb"),
                canonical_root.join("mn-h2.log"),
                canonical_root.join("nested").join("caffeine.com"),
                canonical_root.join("nested").join("mini.cif")
            ]
        );

        fs::remove_file(txt).unwrap();
        fs::remove_file(log).unwrap();
        fs::remove_file(cif).unwrap();
        fs::remove_file(input).unwrap();
        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn deduplicates_overlapping_open_document_inputs() {
        let root = std::env::temp_dir().join(format!(
            "burrete-open-targets-overlap-{}",
            std::process::id()
        ));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let pdb = nested.join("mini.pdb");
        fs::write(&pdb, "HEADER TEST\n").unwrap();

        let canonical_pdb = pdb.canonicalize().unwrap();
        let (expanded, errors) = expand_open_document_paths(vec![
            root.to_string_lossy().to_string(),
            nested.to_string_lossy().to_string(),
            pdb.to_string_lossy().to_string(),
        ]);
        assert_eq!(expanded, vec![canonical_pdb]);
        assert!(errors.is_empty());

        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn lists_project_structure_files_with_metadata() {
        let root =
            std::env::temp_dir().join(format!("burrete-project-files-{}", std::process::id()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let pdb = root.join("mini.pdb");
        let cif = nested.join("mini.cif");
        let txt = nested.join("notes.txt");
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        fs::write(&cif, "data_test\n").unwrap();
        fs::write(&txt, "ignore\n").unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let files = list_project_structure_files(vec![root.to_string_lossy().to_string()])
            .expect("project files should be listed");
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0].path,
            canonical_root.join("mini.pdb").to_string_lossy()
        );
        assert_eq!(files[0].title, "mini.pdb");
        assert_eq!(files[0].extension, "pdb");
        assert_eq!(files[0].renderer, "molstar");
        assert_eq!(files[0].byte_count, "HEADER TEST\n".len() as u64);
        assert_eq!(
            files[1].path,
            canonical_root
                .join("nested")
                .join("mini.cif")
                .to_string_lossy()
        );

        fs::remove_file(txt).unwrap();
        fs::remove_file(cif).unwrap();
        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn expands_directories_with_symlink_loops_once() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-loop-{}", std::process::id()));
        let nested = root.join("nested");
        let loop_link = nested.join("loop");
        let pdb = root.join("mini.pdb");
        fs::create_dir_all(&nested).unwrap();
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        symlink(&root, &loop_link).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(expanded, vec![canonical_root.join("mini.pdb")]);

        fs::remove_file(loop_link).unwrap();
        fs::remove_file(pdb).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn skips_broken_symlinks_inside_directories() {
        let root = std::env::temp_dir().join(format!(
            "burrete-open-targets-broken-link-{}",
            std::process::id()
        ));
        let pdb = root.join("mini.pdb");
        let broken_link = root.join("broken.pdb");
        fs::create_dir_all(&root).unwrap();
        fs::write(&pdb, "HEADER TEST\n").unwrap();
        symlink(root.join("missing.pdb"), &broken_link).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(expanded, vec![canonical_root.join("mini.pdb")]);

        fs::remove_file(pdb).unwrap();
        fs::remove_file(broken_link).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlink_alias_paths_for_nested_files() {
        let root =
            std::env::temp_dir().join(format!("burrete-open-targets-alias-{}", std::process::id()));
        let real = root.join("real.pdb");
        let alias = root.join("alias.pdb");
        fs::create_dir_all(&root).unwrap();
        fs::write(&real, "HEADER TEST\n").unwrap();
        symlink(&real, &alias).unwrap();

        let canonical_root = root.canonicalize().unwrap();
        let expanded = expand_open_targets(root.clone()).unwrap();
        assert_eq!(
            expanded,
            vec![
                canonical_root.join("alias.pdb"),
                canonical_root.join("real.pdb")
            ]
        );

        fs::remove_file(alias).unwrap();
        fs::remove_file(real).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
