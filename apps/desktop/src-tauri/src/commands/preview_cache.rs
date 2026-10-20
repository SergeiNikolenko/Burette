use std::fs;
use std::path::Path;
use tauri::{Manager, Runtime};

const VIEWER_CACHE_DIR: &str = "viewer";
const PRESERVED_VIEWER_CACHE_ENTRY: &str = "assets";

#[tauri::command]
pub(crate) fn clear_preview_cache<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join(VIEWER_CACHE_DIR);
    clear_preview_cache_dir(&base)
}

/// Bytes that `clear_preview_cache` would free.
#[tauri::command]
pub(crate) fn preview_cache_size<R: Runtime>(app: tauri::AppHandle<R>) -> Result<u64, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join(VIEWER_CACHE_DIR);
    Ok(preview_cache_dir_size(&base))
}

fn preview_cache_dir_size(base: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(base) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name() != PRESERVED_VIEWER_CACHE_ENTRY)
        .map(|entry| path_size(&entry.path()))
        .sum()
}

fn path_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !metadata.is_dir() {
        return metadata.len();
    }
    fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| path_size(&entry.path()))
                .sum()
        })
        .unwrap_or(0)
}

fn clear_preview_cache_dir(base: &Path) -> Result<(), String> {
    if !base.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(base).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_name() != PRESERVED_VIEWER_CACHE_ENTRY {
            let _ = fs::remove_dir_all(entry.path());
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{clear_preview_cache_dir, PRESERVED_VIEWER_CACHE_ENTRY};
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burette-preview-cache-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn clear_preview_cache_preserves_viewer_assets_only() {
        let root = temp_dir("clear");
        let assets = root.join(PRESERVED_VIEWER_CACHE_ENTRY);
        let sheet = root.join("sheet").join("render-1");
        let grid_cache = root.join("grid-xyzrender-card-cache").join("key-1");
        fs::create_dir_all(&assets).expect("assets dir should be created");
        fs::create_dir_all(&sheet).expect("sheet dir should be created");
        fs::create_dir_all(&grid_cache).expect("grid cache dir should be created");
        fs::write(assets.join("viewer.js"), "asset").expect("asset should be writable");
        fs::write(sheet.join("index.html"), "preview").expect("sheet preview should be writable");
        fs::write(grid_cache.join("xyzrender.svg"), "<svg/>")
            .expect("grid cache artifact should be writable");
        fs::write(root.join("loose.tmp"), "temporary").expect("loose file should be writable");

        clear_preview_cache_dir(&root).expect("preview cache clear should succeed");

        assert!(assets.join("viewer.js").exists());
        assert!(!root.join("sheet").exists());
        assert!(!root.join("grid-xyzrender-card-cache").exists());
        assert!(!root.join("loose.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clear_preview_cache_accepts_missing_directory() {
        let root = temp_dir("missing");

        clear_preview_cache_dir(&root).expect("missing cache dir should be accepted");

        assert!(!root.exists());
    }
}
