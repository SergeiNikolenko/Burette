use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Runtime;

use super::formats::{format_for_extension, resolve_renderer};
use super::runtime_grid::{create_grid_runtime, grid_requires_preview};
use super::runtime_utils::{file_title, stable_id};
use super::runtime_viewer::create_runtime;

const MAX_STRUCTURE_FILE_SIZE: u64 = 75 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerPreferences {
    pub(crate) theme: String,
    pub(crate) canvas_background: String,
    pub(crate) renderer_mode: String,
    pub(crate) xyz_fast_style: String,
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
}

pub(crate) fn open_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: PathBuf,
    preferences: &ViewerPreferences,
) -> Result<ViewerDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path.display()))?;
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

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if let Some(runtime_path) =
        create_grid_runtime(app, &canonical, &extension, &data, preferences)?
    {
        return Ok(ViewerDocument {
            id: stable_id(&canonical),
            path: canonical.to_string_lossy().to_string(),
            title: file_title(&canonical),
            extension,
            renderer: "grid2d".to_string(),
            runtime_path: runtime_path.to_string_lossy().to_string(),
            byte_count: metadata.len(),
        });
    }
    if grid_requires_preview(&extension) {
        return Err(format!(
            "{} does not contain supported molecule grid records",
            canonical.display()
        ));
    }

    let format = format_for_extension(&extension)?;
    let renderer = resolve_renderer(&format, &preferences.renderer_mode);
    let runtime_path = create_runtime(
        app,
        &canonical,
        &extension,
        &format,
        &renderer,
        &data,
        preferences,
    )?;
    Ok(ViewerDocument {
        id: stable_id(&canonical),
        path: canonical.to_string_lossy().to_string(),
        title: file_title(&canonical),
        extension,
        renderer,
        runtime_path: runtime_path.to_string_lossy().to_string(),
        byte_count: metadata.len(),
    })
}
