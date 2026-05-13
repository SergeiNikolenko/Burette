use std::fs;
use tauri::{Manager, Runtime};

#[tauri::command]
pub(crate) fn clear_preview_cache<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("viewer");
    if !base.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&base).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_name() != "assets" {
            let _ = fs::remove_dir_all(entry.path());
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}
