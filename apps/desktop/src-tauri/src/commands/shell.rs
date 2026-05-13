use std::fs;
use tauri::{Manager, Runtime};

#[tauri::command]
pub(crate) fn open_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    let releases_url = "https://github.com/SergeiNikolenko/Burrete/releases";
    if url != releases_url && !url.starts_with(&(String::from(releases_url) + "/")) {
        return Err("Only Burrete release URLs can be opened from Settings".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| err.to_string())
}
