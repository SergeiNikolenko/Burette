use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, Runtime};

use super::formats::{
    format_for_extension, normalize_renderer_mode, resolve_renderer, structure_path_extension,
};
use super::grid_store::GridParseOptions;
use super::runtime_grid::{create_grid_runtime_with_options, grid_requires_preview};
use super::runtime_utils::{file_title, stable_id};
use super::runtime_viewer::{create_docking_runtime, create_runtime, DockingRuntimeSource};
use super::text_xyz::converted_data_from_text;

const MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;
const MAESTRO_PREVIEW_READ_LIMIT: u64 = 64 * 1024 * 1024;
const DESMOND_PREVIEW_TARGET_MB: &str = "24";
const SCHRODINGER_RUN: &str = "/opt/schrodinger/suites2026-1/run";

#[derive(Debug, Clone, PartialEq, Eq)]
enum StructureAttachmentRole {
    Topology,
    Trajectory,
    TrajectoryPointer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StructureAttachment {
    role: StructureAttachmentRole,
    path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum StructureBundleKind {
    Desmond,
    Md,
    Single,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StructureFileBundle {
    kind: StructureBundleKind,
    primary_path: PathBuf,
    input_path: PathBuf,
    attachments: Vec<StructureAttachment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerPreferences {
    pub(crate) theme: String,
    pub(crate) canvas_background: String,
    pub(crate) renderer_mode: String,
    pub(crate) molstar_style: String,
    #[serde(default = "default_light_accent")]
    pub(crate) theme_light_accent: String,
    #[serde(default = "default_light_background")]
    pub(crate) theme_light_background: String,
    #[serde(default = "default_light_foreground")]
    pub(crate) theme_light_foreground: String,
    #[serde(default = "default_system_font")]
    pub(crate) theme_light_ui_font: String,
    #[serde(default = "default_system_font")]
    pub(crate) theme_light_editor_font: String,
    #[serde(default = "default_light_translucent")]
    pub(crate) theme_light_translucent: f64,
    #[serde(default = "default_light_contrast")]
    pub(crate) theme_light_contrast: f64,
    #[serde(default = "default_dark_accent")]
    pub(crate) theme_dark_accent: String,
    #[serde(default = "default_dark_background")]
    pub(crate) theme_dark_background: String,
    #[serde(default = "default_dark_foreground")]
    pub(crate) theme_dark_foreground: String,
    #[serde(default = "default_system_font")]
    pub(crate) theme_dark_ui_font: String,
    #[serde(default = "default_system_font")]
    pub(crate) theme_dark_editor_font: String,
    #[serde(default = "default_dark_translucent")]
    pub(crate) theme_dark_translucent: f64,
    #[serde(default = "default_dark_contrast")]
    pub(crate) theme_dark_contrast: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerReloadOptions {
    pub(crate) xyzrender_orientation_ref: Option<String>,
    pub(crate) xyzrender_preset: Option<String>,
    pub(crate) xyzrender_controls: Option<XyzrenderControls>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderControls {
    pub(crate) transparent_background: Option<bool>,
    pub(crate) canvas_size: Option<f64>,
    pub(crate) atom_scale: Option<f64>,
    pub(crate) bond_width: Option<f64>,
    pub(crate) atom_stroke_width: Option<f64>,
    pub(crate) mol_color: Option<String>,
    pub(crate) gradients: Option<bool>,
    pub(crate) fog: Option<bool>,
    pub(crate) fog_strength: Option<f64>,
    pub(crate) show_vdw: Option<bool>,
    pub(crate) vdw_opacity: Option<f64>,
    pub(crate) vdw_scale: Option<f64>,
    pub(crate) hide_bonds: Option<bool>,
    pub(crate) show_cell: Option<bool>,
    pub(crate) show_ghosts: Option<bool>,
    pub(crate) show_axes: Option<bool>,
    pub(crate) cell_width: Option<f64>,
    pub(crate) supercell: Option<[i32; 3]>,
    pub(crate) field_mode: Option<String>,
    pub(crate) field_iso: Option<f64>,
    pub(crate) field_opacity: Option<f64>,
    pub(crate) field_surface_style: Option<String>,
    pub(crate) field_mo_positive_color: Option<String>,
    pub(crate) field_mo_negative_color: Option<String>,
    pub(crate) field_density_color: Option<String>,
    pub(crate) field_cmap_palette: Option<String>,
    pub(crate) field_cmap_min: Option<f64>,
    pub(crate) field_cmap_max: Option<f64>,
    pub(crate) custom_config_path: Option<String>,
    pub(crate) extra_arguments: Option<String>,
}

impl ViewerPreferences {
    pub(crate) fn theme_for_runtime(&self) -> &str {
        match self.theme.as_str() {
            "dark" | "light" | "auto" => self.theme.as_str(),
            _ => "auto",
        }
    }

    pub(crate) fn resolved_molstar_style(&self) -> &str {
        if self.molstar_style == "default" {
            "default"
        } else {
            "illustrative"
        }
    }

    pub(crate) fn canvas_background_for_runtime(&self) -> &str {
        match self.canvas_background.as_str() {
            "auto" | "black" | "graphite" | "white" | "transparent" => {
                self.canvas_background.as_str()
            }
            _ => "auto",
        }
    }

    pub(crate) fn resolved_transparent_background(&self) -> bool {
        self.canvas_background_for_runtime() == "transparent"
    }

    pub(crate) fn theme_tokens(&self) -> Value {
        json!({
            "light": {
                "accent": self.theme_light_accent,
                "background": self.theme_light_background,
                "foreground": self.theme_light_foreground,
                "uiFont": self.theme_light_ui_font,
                "editorFont": self.theme_light_editor_font,
                "translucent": self.theme_light_translucent,
                "contrast": self.theme_light_contrast,
            },
            "dark": {
                "accent": self.theme_dark_accent,
                "background": self.theme_dark_background,
                "foreground": self.theme_dark_foreground,
                "uiFont": self.theme_dark_ui_font,
                "editorFont": self.theme_dark_editor_font,
                "translucent": self.theme_dark_translucent,
                "contrast": self.theme_dark_contrast,
            }
        })
    }
}

fn default_system_font() -> String {
    "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"".to_string()
}

fn default_light_accent() -> String {
    "#AF52DE".to_string()
}

fn default_light_background() -> String {
    "#FFFFFF".to_string()
}

fn default_light_foreground() -> String {
    "#0D0D0D".to_string()
}

fn default_light_translucent() -> f64 {
    30.0
}

fn default_light_contrast() -> f64 {
    20.0
}

fn default_dark_accent() -> String {
    "#AF52DE".to_string()
}

fn default_dark_background() -> String {
    "#111111".to_string()
}

fn default_dark_foreground() -> String {
    "#FCFCFC".to_string()
}

fn default_dark_translucent() -> f64 {
    20.0
}

fn default_dark_contrast() -> f64 {
    16.0
}

#[cfg(test)]
mod viewer_preferences_tests {
    use super::{
        default_dark_accent, default_dark_background, default_dark_contrast,
        default_dark_foreground, default_dark_translucent, default_light_accent,
        default_light_background, default_light_contrast, default_light_foreground,
        default_light_translucent, default_system_font, ViewerPreferences,
    };

    fn preferences(theme: &str, canvas_background: &str) -> ViewerPreferences {
        ViewerPreferences {
            theme: theme.to_string(),
            canvas_background: canvas_background.to_string(),
            renderer_mode: "auto".to_string(),
            molstar_style: "illustrative".to_string(),
            theme_light_accent: default_light_accent(),
            theme_light_background: default_light_background(),
            theme_light_foreground: default_light_foreground(),
            theme_light_ui_font: default_system_font(),
            theme_light_editor_font: default_system_font(),
            theme_light_translucent: default_light_translucent(),
            theme_light_contrast: default_light_contrast(),
            theme_dark_accent: default_dark_accent(),
            theme_dark_background: default_dark_background(),
            theme_dark_foreground: default_dark_foreground(),
            theme_dark_ui_font: default_system_font(),
            theme_dark_editor_font: default_system_font(),
            theme_dark_translucent: default_dark_translucent(),
            theme_dark_contrast: default_dark_contrast(),
        }
    }

    #[test]
    fn preserves_auto_theme_for_runtime() {
        assert_eq!(preferences("auto", "auto").theme_for_runtime(), "auto");
        assert_eq!(preferences("light", "auto").theme_for_runtime(), "light");
        assert_eq!(preferences("weird", "auto").theme_for_runtime(), "auto");
    }

    #[test]
    fn preserves_auto_canvas_background_for_runtime() {
        assert_eq!(
            preferences("auto", "auto").canvas_background_for_runtime(),
            "auto"
        );
        assert_eq!(
            preferences("auto", "white").canvas_background_for_runtime(),
            "white"
        );
        assert_eq!(
            preferences("auto", "broken").canvas_background_for_runtime(),
            "auto"
        );
    }

    #[test]
    fn transparent_background_only_when_explicit() {
        assert!(preferences("auto", "transparent").resolved_transparent_background());
        assert!(!preferences("auto", "auto").resolved_transparent_background());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDocumentsResult {
    pub(crate) documents: Vec<ViewerDocument>,
    pub(crate) errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerDocument {
    id: String,
    path: String,
    title: String,
    extension: String,
    renderer: String,
    runtime_path: String,
    byte_count: u64,
    #[serde(rename = "virtual", skip_serializing_if = "is_false")]
    is_virtual: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    docking_request: Option<DockingDocumentRequest>,
}

impl ViewerDocument {
    pub(crate) fn into_virtual(mut self) -> Self {
        self.is_virtual = true;
        self
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub(crate) fn open_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: PathBuf,
    preferences: &ViewerPreferences,
    reload_options: Option<&ViewerReloadOptions>,
) -> Result<ViewerDocument, String> {
    open_document_with_grid_options(
        app,
        path,
        preferences,
        reload_options,
        &GridParseOptions::default(),
    )
}

pub(crate) fn open_document_with_grid_options<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: PathBuf,
    preferences: &ViewerPreferences,
    reload_options: Option<&ViewerReloadOptions>,
    grid_options: &GridParseOptions,
) -> Result<ViewerDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata = fs::metadata(&canonical).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    let extension = structure_path_extension(&canonical);
    if let Some(desmond_preview) = create_desmond_trajectory_preview(app, &canonical, &extension)? {
        let format = format_for_extension("pdb")?;
        let runtime = create_runtime(
            app,
            &canonical,
            "pdb",
            &format,
            "molstar",
            &desmond_preview,
            preferences,
            reload_options,
        )?;
        return Ok(ViewerDocument {
            id: stable_id(&canonical),
            path: canonical.to_string_lossy().to_string(),
            title: file_title(&canonical),
            extension,
            renderer: runtime.renderer,
            runtime_path: runtime.path.to_string_lossy().to_string(),
            byte_count: metadata.len(),
            is_virtual: false,
            docking_request: None,
        });
    }
    let uses_bounded_maestro_preview =
        is_maestro_preview_extension(&extension) && metadata.len() > MAX_STRUCTURE_FILE_SIZE;
    if metadata.len() > MAX_STRUCTURE_FILE_SIZE && !uses_bounded_maestro_preview {
        return Err(format!(
            "{} is larger than the 75 MB preview limit",
            canonical.display()
        ));
    }
    let data = if uses_bounded_maestro_preview {
        read_file_prefix(&canonical, MAESTRO_PREVIEW_READ_LIMIT)?
    } else {
        fs::read(&canonical).map_err(|err| err.to_string())?
    };
    if data.is_empty() {
        return Err(format!("{} is empty", canonical.display()));
    }

    let document_id = stable_id(&canonical);
    let title = file_title(&canonical);
    let maestro_preview_data = if is_maestro_preview_extension(&extension) {
        converted_data_from_text(&data, &extension, &title)
    } else {
        None
    };
    if uses_bounded_maestro_preview && maestro_preview_data.is_none() {
        return Err(format!(
            "{} is larger than the normal preview limit and no Maestro atom table could be extracted from the first 64 MB",
            canonical.display()
        ));
    }
    let requested_renderer = normalize_renderer_mode(&preferences.renderer_mode);
    let should_use_viewer_for_sdf = matches!(extension.as_str(), "sd" | "sdf")
        && reload_options.is_some()
        && (requested_renderer == "molstar" || requested_renderer == "xyzrender-external");
    if !should_use_viewer_for_sdf {
        if let Some(runtime_path) = create_grid_runtime_with_options(
            app,
            &document_id,
            &canonical,
            &extension,
            &data,
            preferences,
            grid_options,
        )? {
            return Ok(ViewerDocument {
                id: document_id.clone(),
                path: canonical.to_string_lossy().to_string(),
                title: file_title(&canonical),
                extension,
                renderer: "grid2d".to_string(),
                runtime_path: runtime_path.to_string_lossy().to_string(),
                byte_count: metadata.len(),
                is_virtual: false,
                docking_request: None,
            });
        }
    }
    if grid_requires_preview(&extension) {
        return Err(format!(
            "{} does not contain supported molecule grid records",
            canonical.display()
        ));
    }

    let runtime_extension = maestro_preview_data
        .as_ref()
        .map(|preview| preview.extension)
        .unwrap_or(extension.as_str());
    let runtime_data = maestro_preview_data
        .as_ref()
        .map(|preview| preview.data.as_slice())
        .unwrap_or(&data);
    let format = format_for_extension(runtime_extension)?;
    let requested_renderer_for_document = if maestro_preview_data.is_some() {
        "molstar"
    } else {
        default_renderer_mode_for_document(&extension, requested_renderer, reload_options)
    };
    let renderer = resolve_renderer(&format, requested_renderer_for_document);
    let runtime = create_runtime(
        app,
        &canonical,
        runtime_extension,
        &format,
        &renderer,
        runtime_data,
        preferences,
        reload_options,
    )?;
    Ok(ViewerDocument {
        id: document_id,
        path: canonical.to_string_lossy().to_string(),
        title,
        extension,
        renderer: runtime.renderer,
        runtime_path: runtime.path.to_string_lossy().to_string(),
        byte_count: metadata.len(),
        is_virtual: false,
        docking_request: None,
    })
}

fn is_maestro_preview_extension(extension: &str) -> bool {
    matches!(extension, "cms" | "mae" | "maegz")
}

fn create_desmond_trajectory_preview<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
    extension: &str,
) -> Result<Option<Vec<u8>>, String> {
    let bundle = resolve_structure_file_bundle(path, extension);
    if bundle.kind != StructureBundleKind::Desmond || !is_desmond_preview_candidate(path, extension)
    {
        return Ok(None);
    }
    let extractor = desmond_preview_extractor_path(app)?;
    if !Path::new(SCHRODINGER_RUN).exists() {
        return Err("Schrodinger Desmond preview extractor is unavailable.".to_string());
    }
    let temp_dir =
        std::env::temp_dir().join(format!("burrete-desmond-preview-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|err| err.to_string())?;
    let output_path = temp_dir.join("desmond-preview.pdb");
    let output = Command::new(SCHRODINGER_RUN)
        .arg("python3")
        .arg(&extractor)
        .arg(&bundle.input_path)
        .arg("--frames")
        .arg("0")
        .arg("--atoms")
        .arg("0")
        .arg("--target-mb")
        .arg(DESMOND_PREVIEW_TARGET_MB)
        .arg("--output")
        .arg(&output_path)
        .output()
        .map_err(|err| format!("Could not start Schrodinger Desmond preview extractor: {err}"));
    let result = match output {
        Ok(output) if output.status.success() => fs::read(&output_path)
            .map_err(|err| format!("Could not read Desmond trajectory preview: {err}"))
            .and_then(|data| {
                if data.is_empty() {
                    Err("Desmond preview extractor produced an empty PDB file.".to_string())
                } else {
                    Ok(data)
                }
            }),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let details = if stderr.is_empty() { stdout } else { stderr };
            Err(format!(
                "Desmond preview extractor failed with exit status {}. {}",
                output.status, details
            ))
        }
        Err(error) => Err(error),
    };
    let _ = fs::remove_dir_all(&temp_dir);
    result.map(Some)
}

fn desmond_preview_extractor_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    if let Ok(resource) = app.path().resolve(
        "desmond_preview_extract.py",
        tauri::path::BaseDirectory::Resource,
    ) {
        if resource.exists() {
            return Ok(resource);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or(&manifest_dir);
    let source = repo_root.join("scripts").join("desmond_preview_extract.py");
    if source.exists() {
        return Ok(source);
    }
    Err("Schrodinger Desmond preview extractor is unavailable.".to_string())
}

fn is_desmond_preview_candidate(path: &Path, extension: &str) -> bool {
    resolve_desmond_file_bundle(path, extension).is_some()
}

fn resolve_structure_file_bundle(path: &Path, extension: &str) -> StructureFileBundle {
    resolve_desmond_file_bundle(path, extension)
        .or_else(|| resolve_md_file_bundle(path, extension))
        .unwrap_or_else(|| StructureFileBundle {
            kind: StructureBundleKind::Single,
            primary_path: path.to_path_buf(),
            input_path: path.to_path_buf(),
            attachments: Vec::new(),
        })
}

fn resolve_desmond_file_bundle(path: &Path, extension: &str) -> Option<StructureFileBundle> {
    match extension {
        "cms" => {
            let parent = path.parent()?;
            for base in candidate_desmond_bases(path) {
                let mut candidates = vec![parent.join(format!("{base}_trj"))];
                candidates.extend(casebook_trj_candidates(path, &base));
                let Some(trj_dir) = candidates.into_iter().find(|candidate| candidate.is_dir())
                else {
                    continue;
                };
                let clickme = trj_dir.join("clickme.dtr");
                let mut attachments = vec![
                    StructureAttachment {
                        role: StructureAttachmentRole::Topology,
                        path: path.to_path_buf(),
                    },
                    StructureAttachment {
                        role: StructureAttachmentRole::Trajectory,
                        path: trj_dir,
                    },
                ];
                if clickme.is_file() {
                    attachments.push(StructureAttachment {
                        role: StructureAttachmentRole::TrajectoryPointer,
                        path: clickme,
                    });
                }
                return Some(StructureFileBundle {
                    kind: StructureBundleKind::Desmond,
                    primary_path: path.to_path_buf(),
                    input_path: path.to_path_buf(),
                    attachments,
                });
            }
            None
        }
        "dtr" => {
            let trj_dir = path.parent()?;
            let base = trj_dir
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.strip_suffix("_trj").unwrap_or(value).to_string())?;
            if !trj_dir.is_dir() {
                return None;
            }
            let mut candidates = trj_dir
                .parent()
                .map(|parent| {
                    vec![
                        parent.join(format!("{base}-out.cms")),
                        parent.join(format!("{base}.cms")),
                    ]
                })
                .unwrap_or_default();
            candidates.extend(casebook_cms_candidates(trj_dir, &base));
            let cms_path = candidates
                .into_iter()
                .find(|candidate| candidate.is_file())?;
            Some(StructureFileBundle {
                kind: StructureBundleKind::Desmond,
                primary_path: cms_path.clone(),
                input_path: path.to_path_buf(),
                attachments: vec![
                    StructureAttachment {
                        role: StructureAttachmentRole::Topology,
                        path: cms_path,
                    },
                    StructureAttachment {
                        role: StructureAttachmentRole::Trajectory,
                        path: trj_dir.to_path_buf(),
                    },
                    StructureAttachment {
                        role: StructureAttachmentRole::TrajectoryPointer,
                        path: path.to_path_buf(),
                    },
                ],
            })
        }
        _ => None,
    }
}

fn resolve_md_file_bundle(path: &Path, extension: &str) -> Option<StructureFileBundle> {
    let base = path.with_extension("");
    if matches!(extension, "xtc" | "trr" | "dcd" | "nctraj") {
        let topology = ["pdb", "gro", "cif", "mmcif", "bcif", "psf", "prmtop", "top"]
            .into_iter()
            .map(|candidate| base.with_extension(candidate))
            .find(|candidate| candidate.is_file())?;
        return Some(StructureFileBundle {
            kind: StructureBundleKind::Md,
            primary_path: topology.clone(),
            input_path: path.to_path_buf(),
            attachments: vec![
                StructureAttachment {
                    role: StructureAttachmentRole::Topology,
                    path: topology,
                },
                StructureAttachment {
                    role: StructureAttachmentRole::Trajectory,
                    path: path.to_path_buf(),
                },
            ],
        });
    }
    if matches!(
        extension,
        "pdb" | "gro" | "cif" | "mmcif" | "bcif" | "psf" | "prmtop" | "top"
    ) {
        let trajectory = ["xtc", "trr", "dcd", "nctraj"]
            .into_iter()
            .map(|candidate| base.with_extension(candidate))
            .find(|candidate| candidate.is_file())?;
        return Some(StructureFileBundle {
            kind: StructureBundleKind::Md,
            primary_path: path.to_path_buf(),
            input_path: path.to_path_buf(),
            attachments: vec![
                StructureAttachment {
                    role: StructureAttachmentRole::Topology,
                    path: path.to_path_buf(),
                },
                StructureAttachment {
                    role: StructureAttachmentRole::Trajectory,
                    path: trajectory,
                },
            ],
        });
    }
    None
}

fn candidate_desmond_bases(path: &Path) -> Vec<String> {
    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let mut bases = vec![stem.to_string()];
    for suffix in ["-out", "_out"] {
        if let Some(base) = stem.strip_suffix(suffix) {
            if !base.is_empty() && !bases.iter().any(|value| value == base) {
                bases.push(base.to_string());
            }
        }
    }
    bases
}

fn casebook_source_files_parts(path: &Path) -> Option<(PathBuf, Vec<String>)> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let marker = "/source_files/";
    let index = normalized.find(marker)?;
    let root = PathBuf::from(&normalized[..index + marker.len() - 1]);
    let rest = normalized[index + marker.len()..]
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    Some((root, rest))
}

fn casebook_trj_candidates(cms_path: &Path, base: &str) -> Vec<PathBuf> {
    let Some((root, rest)) = casebook_source_files_parts(cms_path) else {
        return Vec::new();
    };
    let Some(first) = rest.first() else {
        return Vec::new();
    };
    if !first.starts_with("mnt__") {
        return Vec::new();
    }
    let mut path = root;
    for part in first.split("__") {
        path.push(part);
    }
    for part in rest.iter().skip(1).take(rest.len().saturating_sub(2)) {
        path.push(part);
    }
    path.push(format!("{base}_trj"));
    vec![path]
}

fn casebook_cms_candidates(trj_dir: &Path, base: &str) -> Vec<PathBuf> {
    let Some((root, rest)) = casebook_source_files_parts(trj_dir) else {
        return Vec::new();
    };
    if rest.len() < 4 || rest[0] != "mnt" || rest[1] != "ligandpro" || rest[2] != "crim3s" {
        return Vec::new();
    }
    let mapped_dir = root.join(rest[0..4].join("__"));
    vec![
        mapped_dir.join(format!("{base}-out.cms")),
        mapped_dir.join(format!("{base}.cms")),
    ]
}

fn read_file_prefix(path: &PathBuf, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|err| err.to_string())?;
    let mut data = Vec::with_capacity(max_bytes.min(usize::MAX as u64) as usize);
    file.by_ref()
        .take(max_bytes)
        .read_to_end(&mut data)
        .map_err(|err| err.to_string())?;
    Ok(data)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockingDocumentRequest {
    receptor_path: String,
    ligand_paths: Vec<String>,
    active_pose: Option<usize>,
}

pub(crate) fn open_docking_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: DockingDocumentRequest,
    preferences: &ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let receptor = read_docking_source(&request.receptor_path)?;
    let ligands = request
        .ligand_paths
        .iter()
        .map(|path| read_docking_source(path))
        .collect::<Result<Vec<_>, _>>()?;
    if ligands.is_empty() {
        return Err("Choose at least one ligand or pose file for docking view".to_string());
    }
    let source_id = format!(
        "docking:{}:{}",
        receptor.path,
        ligands
            .iter()
            .map(|ligand| ligand.path.as_str())
            .collect::<Vec<_>>()
            .join("|")
    );
    let document_id = stable_id(PathBuf::from(&source_id).as_path());
    let title = format!(
        "Docking: {} + {} ligand{}",
        receptor.label,
        ligands.len(),
        if ligands.len() == 1 { "" } else { "s" }
    );
    let byte_count = receptor.byte_count as u64
        + ligands
            .iter()
            .map(|ligand| ligand.byte_count as u64)
            .sum::<u64>();
    let docking_request = DockingDocumentRequest {
        receptor_path: receptor.path.clone(),
        ligand_paths: ligands.iter().map(|ligand| ligand.path.clone()).collect(),
        active_pose: request.active_pose,
    };
    let runtime = create_docking_runtime(
        app,
        &document_id,
        &title,
        receptor,
        ligands,
        request.active_pose,
        preferences,
    )?;
    Ok(ViewerDocument {
        id: document_id.clone(),
        path: format!("burrete-docking://{document_id}"),
        title,
        extension: "docking".to_string(),
        renderer: runtime.renderer,
        runtime_path: runtime.path.to_string_lossy().to_string(),
        byte_count,
        is_virtual: true,
        docking_request: Some(docking_request),
    })
}

fn read_docking_source(path: &str) -> Result<DockingRuntimeSource, String> {
    let canonical = PathBuf::from(path)
        .canonicalize()
        .map_err(|err| format!("{path}: {err}"))?;
    let metadata = fs::metadata(&canonical).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    if metadata.len() > MAX_STRUCTURE_FILE_SIZE {
        return Err(format!(
            "{} is larger than the 75 MB preview limit",
            canonical.display()
        ));
    }
    let data = fs::read(&canonical).map_err(|err| err.to_string())?;
    if data.is_empty() {
        return Err(format!("{} is empty", canonical.display()));
    }
    let extension = structure_path_extension(&canonical);
    let format = format_for_extension(&extension)?;
    let label = file_title(&canonical);
    if format.external_only {
        let converted = converted_data_from_text(&data, &extension, &label).ok_or_else(|| {
            format!(
                "{} cannot be added to Mol* docking view because it needs xyzrender conversion",
                canonical.display()
            )
        })?;
        return Ok(DockingRuntimeSource {
            path: canonical.to_string_lossy().to_string(),
            label,
            extension,
            format: converted.extension.to_string(),
            binary: false,
            data: converted.data,
            byte_count: metadata.len() as usize,
        });
    }
    Ok(DockingRuntimeSource {
        path: canonical.to_string_lossy().to_string(),
        label,
        extension,
        format: format.molstar_format,
        binary: format.is_binary,
        data,
        byte_count: metadata.len() as usize,
    })
}

fn default_renderer_mode_for_document<'a>(
    extension: &str,
    requested_renderer: &'a str,
    reload_options: Option<&ViewerReloadOptions>,
) -> &'a str {
    if matches!(extension, "sd" | "sdf")
        && requested_renderer == "xyzrender-external"
        && reload_options.is_none()
    {
        return "molstar";
    }
    requested_renderer
}

#[cfg(test)]
mod document_open_tests {
    use super::{
        default_dark_accent, default_dark_background, default_dark_contrast,
        default_dark_foreground, default_dark_translucent, default_light_accent,
        default_light_background, default_light_contrast, default_light_foreground,
        default_light_translucent, default_system_font, open_document, ViewerPreferences,
    };
    use crate::commands::documents::open_documents;
    use crate::preview::grid_store::GridRuntimeRegistry;
    use std::collections::BTreeMap;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use tauri::Manager;

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn viewer_preferences() -> ViewerPreferences {
        ViewerPreferences {
            theme: "auto".to_string(),
            canvas_background: "auto".to_string(),
            renderer_mode: "auto".to_string(),
            molstar_style: "illustrative".to_string(),
            theme_light_accent: default_light_accent(),
            theme_light_background: default_light_background(),
            theme_light_foreground: default_light_foreground(),
            theme_light_ui_font: default_system_font(),
            theme_light_editor_font: default_system_font(),
            theme_light_translucent: default_light_translucent(),
            theme_light_contrast: default_light_contrast(),
            theme_dark_accent: default_dark_accent(),
            theme_dark_background: default_dark_background(),
            theme_dark_foreground: default_dark_foreground(),
            theme_dark_ui_font: default_system_font(),
            theme_dark_editor_font: default_system_font(),
            theme_dark_translucent: default_dark_translucent(),
            theme_dark_contrast: default_dark_contrast(),
        }
    }

    fn mock_app_with_grid_registry() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(GridRuntimeRegistry::default());
        app
    }

    fn repo_root() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .unwrap_or(&manifest_dir)
            .to_path_buf()
    }

    fn fixture_path(relative: &str) -> PathBuf {
        repo_root()
            .join("tests")
            .join("fixtures")
            .join("BurettePreviewSamples")
            .join(relative)
    }

    fn prepend_fake_xyzrender_environment(script: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("burrete-open-document-{}", uuid::Uuid::new_v4()));
        let bin_dir = root.join(".local").join("bin");
        fs::create_dir_all(&bin_dir).expect("fake xyzrender bin dir should be created");
        let executable = bin_dir.join("xyzrender");
        fs::write(&executable, script).expect("fake xyzrender should be written");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&executable)
                .expect("fake xyzrender metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions)
                .expect("fake xyzrender should be executable");
        }
        root
    }

    fn with_fake_xyzrender<T>(run: impl FnOnce() -> T) -> T {
        with_fake_xyzrender_script(
            concat!(
                "#!/bin/sh\n",
                "out=\"\"\n",
                "while [ \"$#\" -gt 0 ]; do\n",
                "  if [ \"$1\" = \"-o\" ]; then\n",
                "    out=\"$2\"\n",
                "    shift 2\n",
                "    continue\n",
                "  fi\n",
                "  shift\n",
                "done\n",
                "printf '%s\\n' '<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>' > \"$out\"\n"
            ),
            run,
        )
    }

    fn with_failing_fake_xyzrender<T>(run: impl FnOnce() -> T) -> T {
        with_fake_xyzrender_script(
            concat!(
                "#!/bin/sh\n",
                "printf '%s\\n' 'fake xyzrender failure' >&2\n",
                "exit 1\n"
            ),
            run,
        )
    }

    fn with_fake_xyzrender_script<T>(script: &str, run: impl FnOnce() -> T) -> T {
        let _lock = ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env lock should not be poisoned");
        let fake_home = prepend_fake_xyzrender_environment(script);
        let old_home = std::env::var_os("HOME");
        let old_path = std::env::var_os("PATH");
        let mut joined_path = vec![fake_home.join(".local").join("bin")];
        if let Some(path) = &old_path {
            joined_path.extend(std::env::split_paths(path));
        }
        let joined_path =
            std::env::join_paths(joined_path).expect("fake xyzrender path should be valid");

        std::env::set_var("HOME", &fake_home);
        std::env::set_var("PATH", &joined_path);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));

        match old_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match old_path {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
        let _ = fs::remove_dir_all(fake_home);

        match result {
            Ok(value) => value,
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }

    fn create_temp_file(extension: &str, data: &[u8]) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("burrete-runtime-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temp test directory should be created");
        let path = directory.join(format!("probe.{extension}"));
        fs::write(&path, data).expect("temp test file should be written");
        path
    }

    fn remove_runtime_artifacts(runtime_path: &str) {
        if let Some(runtime_dir) = Path::new(runtime_path).parent() {
            let _ = fs::remove_dir_all(runtime_dir);
            if let Some(viewer_dir) = runtime_dir.parent() {
                let _ = fs::remove_dir_all(viewer_dir.join("assets").join("rdkit"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("molstar.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("molstar.css"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer-runtime.css"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer-shell.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("burette-agent.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("viewer.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("grid-viewer.js"));
                let _ = fs::remove_file(viewer_dir.join("assets").join("grid.css"));
            }
        }
    }

    fn expected_real_renderer(path: &Path) -> &'static str {
        match super::structure_path_extension(path).as_str() {
            "abi" | "com" | "cub" | "cube" | "fdf" | "in" | "inp" | "nw" | "out" | "psi4"
            | "qcin" | "vasp" => "xyzrender-external",
            "cms" | "mae" | "maegz" => "xyzrender-external",
            "cif" | "mol2" | "pdb" => "molstar",
            "sdf" => {
                if path.file_name().and_then(|value| value.to_str()) == Some("multi_mol.sdf") {
                    "grid2d"
                } else {
                    "molstar"
                }
            }
            "xyz" => "xyzrender-external",
            other => panic!("unexpected supported real example extension: {other}"),
        }
    }

    #[test]
    fn opens_supported_formats_with_expected_renderers() {
        with_fake_xyzrender(|| {
            let app = mock_app_with_grid_registry();
            let preferences = viewer_preferences();
            let mut opened = Vec::new();
            let mut created_files = Vec::new();

            let cube = create_temp_file("cube", b"dummy cube");
            let com = create_temp_file("com", b"dummy input");
            let mae_gz = create_temp_file("mae.gz", b"dummy schrodinger maestro");
            created_files.push(cube.clone());
            created_files.push(com.clone());
            created_files.push(mae_gz.clone());

            let cases = vec![
                (fixture_path("xyz/single.xyz"), "xyzrender-external"),
                (fixture_path("1HTB.pdb"), "molstar"),
                (fixture_path("sdf/single.sdf"), "molstar"),
                (fixture_path("sdf/multi.sdf"), "grid2d"),
                (fixture_path("md/minimal.xtc"), "molstar"),
                (fixture_path("md/minimal.trr"), "molstar"),
                (fixture_path("md/minimal.dcd"), "molstar"),
                (fixture_path("md/minimal.nctraj"), "molstar"),
                (fixture_path("md/minimal.lammpstrj"), "molstar"),
                (fixture_path("md/minimal.top"), "molstar"),
                (fixture_path("md/minimal.psf"), "molstar"),
                (fixture_path("md/minimal.prmtop"), "molstar"),
                (cube, "xyzrender-external"),
                (com, "xyzrender-external"),
                (mae_gz, "xyzrender-external"),
            ];

            for (path, expected_renderer) in cases {
                let document = open_document(app.handle(), path.clone(), &preferences, None)
                    .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
                assert_eq!(document.renderer, expected_renderer, "{}", path.display());
                assert!(
                    Path::new(&document.runtime_path).is_file(),
                    "{} should create a runtime HTML file",
                    path.display()
                );
                opened.push(document.runtime_path);
            }

            for runtime_path in opened {
                remove_runtime_artifacts(&runtime_path);
            }
            for path in created_files {
                if let Some(parent) = path.parent() {
                    let _ = fs::remove_dir_all(parent);
                }
            }
        });
    }

    #[test]
    fn opens_convertible_external_text_as_molstar_when_requested() {
        let app = mock_app_with_grid_registry();
        let mut preferences = viewer_preferences();
        preferences.renderer_mode = "molstar".to_string();
        let path = create_temp_file(
            "out",
            br#"
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
  O     -2.304659   -0.473599    0.509723
  C     -2.246527    0.624277   -0.047679
"#,
        );

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "molstar");
        let preview_data = fs::read_to_string(
            Path::new(&document.runtime_path)
                .parent()
                .expect("runtime html should have a parent")
                .join("preview-data.bin"),
        )
        .expect("converted preview data should be written");
        assert!(preview_data.starts_with("REMARK Converted from probe.out\nHETATM"));
        remove_runtime_artifacts(&document.runtime_path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn opens_non_coordinate_output_report_as_not_renderable_preview() {
        let app = mock_app_with_grid_registry();
        let preferences = viewer_preferences();
        let path = create_temp_file(
            "out",
            b"/home/example/ppm_report_source.pdb\nPPM report without embedded coordinates\n",
        );

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "not-renderable");
        let html = fs::read_to_string(&document.runtime_path)
            .expect("not-renderable runtime HTML should be written");
        assert!(html.contains("does not contain standalone molecular coordinates"));
        remove_runtime_artifacts(&document.runtime_path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn opens_multiframe_xyz_in_molstar_with_trajectory_controls_on_auto() {
        let app = mock_app_with_grid_registry();
        let preferences = viewer_preferences();
        let path = create_temp_file(
            "xyz",
            b"2\nfirst frame\nH 0 0 0\nO 0 0 1\n2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
        );

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "molstar");
        let runtime_dir = Path::new(&document.runtime_path)
            .parent()
            .expect("runtime html should have a parent");
        let config = fs::read_to_string(runtime_dir.join("preview-config.js"))
            .expect("preview config should be written");
        assert!(config.contains("\"trajectoryControls\":true"));
        assert!(config.contains("\"trajectoryFrameCount\":2"));

        remove_runtime_artifacts(&document.runtime_path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn treats_removed_fast_renderer_preference_as_auto_for_multiframe_xyz() {
        let app = mock_app_with_grid_registry();
        let mut preferences = viewer_preferences();
        preferences.renderer_mode = "xyz-fast".to_string();
        let path = create_temp_file(
            "xyz",
            b"2\nfirst frame\nH 0 0 0\nO 0 0 1\n2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
        );

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "molstar");
        let runtime_dir = Path::new(&document.runtime_path)
            .parent()
            .expect("runtime html should have a parent");
        let config = fs::read_to_string(runtime_dir.join("preview-config.js"))
            .expect("preview config should be written");
        assert!(config.contains("\"trajectoryControls\":true"));
        assert!(config.contains("\"trajectoryFrameCount\":2"));

        remove_runtime_artifacts(&document.runtime_path);
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn default_desktop_runtime_embeds_preview_data_script_for_tauri_asset_protocol() {
        let app = mock_app_with_grid_registry();
        let preferences = viewer_preferences();
        let path = fixture_path("1HTB.pdb");

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "molstar");
        let runtime_dir = Path::new(&document.runtime_path)
            .parent()
            .expect("runtime html should have a parent");
        let html = fs::read_to_string(runtime_dir.join("index.html"))
            .expect("runtime HTML should be written");
        assert!(runtime_dir.join("preview-data.bin").is_file());
        assert!(runtime_dir.join("preview-data.js").is_file());
        assert!(html.contains("window.BurreteDataURL = "));
        assert!(html.contains("preview-data.js\"></script>"));
        let data_script = fs::read_to_string(runtime_dir.join("preview-data.js"))
            .expect("preview data script should be written");
        assert!(data_script.contains("window.BurreteDataBase64 = "));
        assert!(data_script.contains("window.BurreteDataURL = null;"));

        remove_runtime_artifacts(&document.runtime_path);
    }

    #[test]
    fn grid_runtime_embeds_rdkit_wasm_binary_for_tauri_asset_protocol() {
        let app = mock_app_with_grid_registry();
        let preferences = viewer_preferences();
        let path = fixture_path("sdf/multi.sdf");

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "grid2d");
        let runtime_dir = Path::new(&document.runtime_path)
            .parent()
            .expect("runtime html should have a parent");
        let html = fs::read_to_string(runtime_dir.join("index.html"))
            .expect("runtime HTML should be written");
        let config = fs::read_to_string(runtime_dir.join("preview-config.js"))
            .expect("preview config should be written");
        assert!(config.contains(r#""rdkitWasmPath":"asset://localhost/"#));
        assert!(config.contains("RDKit_minimal.wasm"));
        assert!(runtime_dir.join("RDKit_minimal.wasm").exists());
        assert!(runtime_dir.join("preview-rdkit-wasm.js").exists());
        assert!(html.contains("preview-rdkit-wasm.js"));
        assert!(html.contains("RDKit_minimal.js"));

        remove_runtime_artifacts(&document.runtime_path);
    }

    #[test]
    fn applies_cube_surface_defaults_to_xyzrender_config() {
        with_fake_xyzrender(|| {
            let app = mock_app_with_grid_registry();
            let preferences = viewer_preferences();
            let path = create_temp_file(
                "cube",
                b"Cube data generated by ORCA\nMolecular orbital 50 of operator 0\n   -1 0 0 0\n",
            );

            let document = open_document(app.handle(), path.clone(), &preferences, None)
                .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
            assert_eq!(document.renderer, "xyzrender-external");
            let runtime_dir = Path::new(&document.runtime_path)
                .parent()
                .expect("runtime html should have a parent");
            let config = fs::read_to_string(runtime_dir.join("preview-config.js"))
                .expect("preview config should be written");
            assert!(config.contains("\"extraArguments\":\"--mo --opacity 0.62"));
            assert!(!config.contains("--vdw"));

            remove_runtime_artifacts(&document.runtime_path);
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        });
    }

    #[test]
    fn keeps_single_sdf_in_molstar_when_global_renderer_is_xyzrender() {
        let app = mock_app_with_grid_registry();
        let mut preferences = viewer_preferences();
        preferences.renderer_mode = "xyzrender-external".to_string();
        let path = fixture_path("sdf/single.sdf");

        let document = open_document(app.handle(), path.clone(), &preferences, None)
            .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
        assert_eq!(document.renderer, "molstar");
        remove_runtime_artifacts(&document.runtime_path);
    }

    #[test]
    fn falls_back_to_molstar_for_cif_when_xyzrender_fails() {
        with_failing_fake_xyzrender(|| {
            let app = mock_app_with_grid_registry();
            let mut preferences = viewer_preferences();
            preferences.renderer_mode = "xyzrender-external".to_string();
            let path = fixture_path("mini.cif");

            let document = open_document(app.handle(), path.clone(), &preferences, None)
                .unwrap_or_else(|error| panic!("{} should open: {error}", path.display()));
            assert_eq!(document.renderer, "molstar");
            let runtime_dir = Path::new(&document.runtime_path)
                .parent()
                .expect("runtime html should have a parent");
            let config = fs::read_to_string(runtime_dir.join("preview-config.js"))
                .expect("preview config should be written");
            assert!(config.contains("\"externalRendererStatus\""));
            assert!(config.contains("Using Mol* because external xyzrender failed"));
            remove_runtime_artifacts(&document.runtime_path);
        });
    }

    #[test]
    fn opens_real_example_corpus_when_configured() {
        let Some(root) = std::env::var_os("BURRETE_REAL_EXAMPLES_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let inputs = root.join("inputs");
        let structures = root.join("structures");
        assert!(inputs.is_dir(), "{} should exist", inputs.display());
        assert!(structures.is_dir(), "{} should exist", structures.display());

        with_fake_xyzrender(|| {
            let app = mock_app_with_grid_registry();
            let result = open_documents(
                app.handle().clone(),
                vec![
                    inputs.to_string_lossy().to_string(),
                    structures.to_string_lossy().to_string(),
                ],
                viewer_preferences(),
                None,
            )
            .expect("real example corpus should open");

            assert!(
                result.errors.is_empty(),
                "unexpected open errors: {}",
                result.errors.join("; ")
            );
            assert_eq!(result.documents.len(), 52);

            let documents_by_name: BTreeMap<String, (&str, &str)> = result
                .documents
                .iter()
                .map(|document| {
                    (
                        Path::new(&document.path)
                            .file_name()
                            .expect("real example file should have a name")
                            .to_string_lossy()
                            .to_string(),
                        (document.renderer.as_str(), document.runtime_path.as_str()),
                    )
                })
                .collect();

            for expected_absent in [
                "caffeine_charges.txt",
                "ethanol_dip.json",
                "ethanol_forces_efield.json",
                "mn-h2.log",
                "sn2.gif",
                "sn2_label.txt",
            ] {
                assert!(
                    !documents_by_name.contains_key(expected_absent),
                    "{expected_absent} should stay excluded from structure opening"
                );
            }

            for document in &result.documents {
                let path = Path::new(&document.path);
                assert_eq!(
                    document.renderer,
                    expected_real_renderer(path),
                    "{}",
                    path.display()
                );
                assert!(
                    Path::new(&document.runtime_path).is_file(),
                    "{} should create a runtime HTML file",
                    path.display()
                );
            }

            for document in &result.documents {
                remove_runtime_artifacts(&document.runtime_path);
            }
        });
    }
}
