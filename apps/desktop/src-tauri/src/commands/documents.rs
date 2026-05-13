use std::path::PathBuf;
use tauri::Runtime;

use crate::preview::runtime::{open_document, OpenDocumentsResult, ViewerPreferences};

#[tauri::command]
pub(crate) fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match open_document(&app, PathBuf::from(&path), &preferences) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}
