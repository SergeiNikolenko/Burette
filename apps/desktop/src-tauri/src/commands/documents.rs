use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Runtime;

use crate::{is_supported_structure_path, open_document, ViewerDocument, ViewerPreferences};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentsResult {
    documents: Vec<ViewerDocument>,
    errors: Vec<String>,
}

#[tauri::command]
pub fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match expand_document_path(PathBuf::from(&path)) {
            Ok(expanded_paths) => {
                for expanded_path in expanded_paths {
                    match open_document(&app, expanded_path, &preferences) {
                        Ok(document) => documents.push(document),
                        Err(error) => errors.push(error),
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}

fn expand_document_path(path: PathBuf) -> Result<Vec<PathBuf>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let metadata = fs::metadata(&canonical).map_err(|err| err.to_string())?;

    if metadata.is_file() {
        return Ok(vec![canonical]);
    }
    if !metadata.is_dir() {
        return Err(format!("{} is not a file or folder", canonical.display()));
    }

    let mut discovered = Vec::new();
    collect_supported_documents(&canonical, &mut discovered)?;
    discovered.sort();
    if discovered.is_empty() {
        return Err(format!(
            "{} contains no supported structure files",
            canonical.display()
        ));
    }
    Ok(discovered)
}

fn collect_supported_documents(dir: &Path, discovered: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("{}: {err}", dir.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            collect_supported_documents(&path, discovered)?;
        } else if metadata.is_file() && is_supported_structure_path(&path) {
            discovered.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("burrete-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn expand_document_path_returns_single_file() {
        let root = temp_workspace("single-file");
        let file = root.join("mini.pdb");
        fs::write(&file, b"HEADER\n").expect("write pdb");

        let expanded = expand_document_path(file.clone()).expect("expand file");

        assert_eq!(expanded, vec![file.canonicalize().expect("canonical file")]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn expand_document_path_discovers_supported_files_recursively() {
        let root = temp_workspace("folder");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::write(root.join("a.pdb"), b"HEADER\n").expect("write pdb");
        fs::write(nested.join("b.sdf"), b"mol\n").expect("write sdf");
        fs::write(root.join("notes.txt"), b"ignore").expect("write txt");

        let expanded = expand_document_path(root.clone()).expect("expand folder");
        let names: Vec<String> = expanded
            .iter()
            .map(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap()
                    .to_string()
            })
            .collect();

        assert_eq!(names, vec!["a.pdb", "b.sdf"]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn expand_document_path_rejects_folders_without_supported_files() {
        let root = temp_workspace("empty-folder");
        fs::write(root.join("notes.txt"), b"ignore").expect("write txt");

        let error = expand_document_path(root.clone()).expect_err("empty folder should fail");

        assert!(error.contains("contains no supported structure files"));
        fs::remove_dir_all(root).ok();
    }
}
