use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Runtime;

use crate::preview::formats::format_for_extension;
use crate::preview::runtime::{
    open_document, OpenDocumentsResult, ViewerDocument, ViewerPreferences,
};
use crate::preview::runtime_grid::{create_combined_sdf_grid_runtime, grid_requires_preview};
use crate::preview::runtime_utils::stable_id;
use crate::preview::runtime_viewer::create_combined_sdf_pose_runtime;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpenDocumentsMode {
    Individual,
    CombinePoses,
    CombineGrid,
}

#[tauri::command]
pub(crate) fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
    mode: Option<OpenDocumentsMode>,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let (document_paths, mut errors) = expand_open_paths(paths);
    if mode == Some(OpenDocumentsMode::CombinePoses) {
        match open_combined_pose_document(&app, document_paths, &preferences, &mut errors) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
        if documents.is_empty() && !errors.is_empty() {
            return Err(errors.join("; "));
        }
        return Ok(OpenDocumentsResult { documents, errors });
    }
    if mode == Some(OpenDocumentsMode::CombineGrid) {
        match open_combined_grid_document(&app, document_paths, &preferences, &mut errors) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
        if documents.is_empty() && !errors.is_empty() {
            return Err(errors.join("; "));
        }
        return Ok(OpenDocumentsResult { documents, errors });
    }

    for path in document_paths {
        match open_document(&app, path, &preferences) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}

fn open_combined_grid_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    document_paths: Vec<PathBuf>,
    preferences: &ViewerPreferences,
    errors: &mut Vec<String>,
) -> Result<ViewerDocument, String> {
    let sdf_paths = sdf_paths_from_documents(&document_paths);
    if sdf_paths.is_empty() {
        return Err("No SDF files found to combine as a grid".to_string());
    }

    let skipped = document_paths.len().saturating_sub(sdf_paths.len());
    if skipped > 0 {
        errors.push(format!(
            "Skipped {skipped} non-SDF structure file(s) while building grid"
        ));
    }

    let label_path = common_sdf_label_path(&sdf_paths);
    let runtime = create_combined_sdf_grid_runtime(app, &label_path, &sdf_paths, preferences)?;
    let title = label_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!("{value} SDF grid"))
        .unwrap_or_else(|| "Combined SDF grid".to_string());
    let path = format!("{}#combined-sdf-grid", label_path.to_string_lossy());
    Ok(ViewerDocument {
        id: stable_id(Path::new(&path)),
        path,
        title,
        extension: "sdf".to_string(),
        renderer: "grid2d".to_string(),
        runtime_path: runtime.runtime_path.to_string_lossy().to_string(),
        byte_count: runtime.byte_count,
        ephemeral: true,
    })
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

    let skipped = document_paths.len().saturating_sub(sdf_paths.len());
    if skipped > 0 {
        errors.push(format!(
            "Skipped {skipped} non-SDF structure file(s) while combining poses"
        ));
    }

    let label_path = common_sdf_label_path(&sdf_paths);
    let combined = combined_sdf_data(&sdf_paths)?;
    let title = label_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!("{value} docking poses"))
        .unwrap_or_else(|| "Combined docking poses".to_string());
    let runtime_path =
        create_combined_sdf_pose_runtime(app, &label_path, &title, &combined.data, preferences)?;
    let path = format!("{}#combined-sdf-poses", label_path.to_string_lossy());
    Ok(ViewerDocument {
        id: stable_id(Path::new(&path)),
        path,
        title,
        extension: "sdf".to_string(),
        renderer: "molstar".to_string(),
        runtime_path: runtime_path.to_string_lossy().to_string(),
        byte_count: combined.byte_count,
        ephemeral: true,
    })
}

fn sdf_paths_from_documents(document_paths: &[PathBuf]) -> Vec<PathBuf> {
    document_paths
        .iter()
        .filter(|path| is_sdf_path(path))
        .cloned()
        .collect()
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

fn expand_open_paths(paths: Vec<String>) -> (Vec<PathBuf>, Vec<String>) {
    let mut candidates = Vec::new();
    let mut errors = Vec::new();
    let mut seen = HashSet::new();

    for path in paths {
        let path = PathBuf::from(path);
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };

        if metadata.is_file() {
            push_unique(&mut candidates, &mut seen, path);
            continue;
        }

        if metadata.is_dir() {
            let mut seen_directories = HashSet::new();
            let found_supported = collect_supported_files(
                &path,
                &mut candidates,
                &mut seen,
                &mut seen_directories,
                &mut errors,
            );
            if !found_supported {
                errors.push(format!(
                    "{} does not contain supported structure files",
                    path.display()
                ));
            }
            continue;
        }

        errors.push(format!("{} is not a file or directory", path.display()));
    }

    (candidates, errors)
}

fn collect_supported_files(
    directory: &Path,
    candidates: &mut Vec<PathBuf>,
    seen: &mut HashSet<PathBuf>,
    seen_directories: &mut HashSet<PathBuf>,
    errors: &mut Vec<String>,
) -> bool {
    let directory_key = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    if !seen_directories.insert(directory_key) {
        return false;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            errors.push(format!("{}: {error}", directory.display()));
            return false;
        }
    };
    let mut paths = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));

    let mut found_supported = false;
    for path in paths {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        if metadata.is_dir() {
            if collect_supported_files(&path, candidates, seen, seen_directories, errors) {
                found_supported = true;
            }
        } else if metadata.is_file() && is_supported_structure_path(&path) {
            found_supported = true;
            push_unique(candidates, seen, path);
        }
    }
    found_supported
}

fn is_supported_structure_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    grid_requires_preview(&extension) || format_for_extension(&extension).is_ok()
}

fn is_sdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_lowercase().as_str(), "sdf" | "sd"))
        .unwrap_or(false)
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

fn push_unique(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    let key = path.canonicalize().unwrap_or_else(|_| path.clone());
    if seen.insert(key) {
        candidates.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("burrete-{name}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp tree");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn expands_directory_inputs_to_nested_supported_files() {
        let tree = TempTree::new("nested-open");
        fs::create_dir_all(tree.path().join("batch/deep")).expect("create nested folders");
        fs::write(tree.path().join("root.xyz"), "2\n\nH 0 0 0\nH 0 0 1\n").expect("write xyz");
        fs::write(tree.path().join("batch/ligand.pdb"), "HEADER\n").expect("write pdb");
        fs::write(
            tree.path().join("batch/deep/table.csv"),
            "smiles,name\nC,methane\n",
        )
        .expect("write csv");
        fs::write(tree.path().join("batch/notes.txt"), "ignore me").expect("write txt");

        let (paths, errors) = expand_open_paths(vec![tree.path().to_string_lossy().to_string()]);

        let relative = paths
            .iter()
            .map(|path| {
                path.strip_prefix(tree.path())
                    .expect("path is inside tree")
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            relative,
            vec!["batch/deep/table.csv", "batch/ligand.pdb", "root.xyz"]
        );
        assert!(errors.is_empty());
    }

    #[test]
    fn reports_directory_inputs_without_supported_files() {
        let tree = TempTree::new("empty-open");
        fs::write(tree.path().join("notes.txt"), "ignore me").expect("write txt");

        let (paths, errors) = expand_open_paths(vec![tree.path().to_string_lossy().to_string()]);

        assert!(paths.is_empty());
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("does not contain supported structure files"));
    }

    #[test]
    fn keeps_explicit_file_inputs_for_runtime_validation() {
        let tree = TempTree::new("explicit-file");
        let file = tree.path().join("notes.txt");
        fs::write(&file, "runtime should reject this extension").expect("write txt");

        let (paths, errors) = expand_open_paths(vec![file.to_string_lossy().to_string()]);

        assert_eq!(paths, vec![file]);
        assert!(errors.is_empty());
    }

    #[test]
    fn does_not_report_duplicate_nested_directory_as_empty() {
        let tree = TempTree::new("duplicate-directory");
        let nested = tree.path().join("nested");
        fs::create_dir_all(&nested).expect("create nested folder");
        fs::write(nested.join("ligand.sdf"), "$$$$\n").expect("write sdf");

        let (paths, errors) = expand_open_paths(vec![
            tree.path().to_string_lossy().to_string(),
            nested.to_string_lossy().to_string(),
        ]);

        assert_eq!(paths.len(), 1);
        assert!(errors.is_empty());
    }

    #[test]
    fn detects_common_parent_for_batch_document_title() {
        let paths = vec![
            PathBuf::from("/tmp/burrete/batch/a.sdf"),
            PathBuf::from("/tmp/burrete/batch/nested/b.sdf"),
        ];

        assert_eq!(
            common_parent(&paths),
            Some(PathBuf::from("/tmp/burrete/batch"))
        );
    }
}
