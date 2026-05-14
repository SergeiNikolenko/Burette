use std::path::PathBuf;
use tauri::Runtime;

use crate::preview::runtime::{
    open_document, OpenDocumentsResult, ViewerPreferences, ViewerReloadOptions,
};

#[tauri::command]
pub(crate) fn open_documents<R: Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    preferences: ViewerPreferences,
    reload_options: Option<ViewerReloadOptions>,
) -> Result<OpenDocumentsResult, String> {
    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        match open_document(&app, PathBuf::from(&path), &preferences, reload_options.as_ref()) {
            Ok(document) => documents.push(document),
            Err(error) => errors.push(error),
        }
    }
    if documents.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(OpenDocumentsResult { documents, errors })
}
