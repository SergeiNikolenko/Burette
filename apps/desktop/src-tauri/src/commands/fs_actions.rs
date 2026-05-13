use crate::{is_hidden_path, is_supported_structure_path, modified_seconds};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub(crate) name: String,
    path: String,
    pub(crate) is_directory: bool,
    pub(crate) is_structure_file: bool,
    pub(crate) byte_count: Option<u64>,
    modified_at: u64,
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let root = PathBuf::from(&path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path))?;
    let metadata = fs::metadata(&root).map_err(|err| err.to_string())?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&root).map_err(|err| format!("{}: {err}", root.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let child = entry.path();
        if is_hidden_path(&child) {
            continue;
        }
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        let is_directory = file_type.is_dir();
        let is_structure_file = file_type.is_file() && is_supported_structure_path(&child);
        if !is_directory && !is_structure_file {
            continue;
        }
        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: child.to_string_lossy().to_string(),
            is_directory,
            is_structure_file,
            byte_count: file_type.is_file().then_some(metadata.len()),
            modified_at: modified_seconds(&metadata),
        });
    }

    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
pub fn create_empty_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&path, b"").map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    fs::create_dir_all(&path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn rename_entry(from_path: String, to_path: String) -> Result<(), String> {
    let from = PathBuf::from(&from_path);
    let to = PathBuf::from(&to_path);
    if !from.exists() {
        return Err(format!("{} does not exist", from.display()));
    }
    if to.exists() {
        return Err(format!("{} already exists", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::rename(&from, &to).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn duplicate_entry(from_path: String, to_path: String) -> Result<(), String> {
    let from = PathBuf::from(&from_path);
    let to = PathBuf::from(&to_path);
    let metadata = fs::metadata(&from).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err("Only files can be duplicated".into());
    }
    if to.exists() {
        return Err(format!("{} already exists", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::copy(&from, &to).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(&path).map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub fn clear_preview_cache<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
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

#[tauri::command]
pub fn open_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path))?;
    tauri_plugin_opener::reveal_item_in_dir(canonical).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let releases_url = "https://github.com/SergeiNikolenko/Burrete/releases";
    if url != releases_url && !url.starts_with(&(String::from(releases_url) + "/")) {
        return Err("Only Burrete release URLs can be opened from Settings".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| err.to_string())
}
