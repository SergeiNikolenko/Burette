use crate::preview::xyzrender::editor::{self, EditorRequest, EditorResult};
use std::sync::Mutex;
use tauri::{Manager, Runtime};

// Bound expensive interactive renders independently of grid thumbnail workers.
static RENDERS: Mutex<usize> = Mutex::new(0);
struct RenderSlot;
impl Drop for RenderSlot {
    fn drop(&mut self) {
        if let Ok(mut active) = RENDERS.lock() {
            *active -= 1;
        }
    }
}

#[tauri::command]
pub(crate) async fn render_xyzrender_editor<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: EditorRequest,
) -> Result<EditorResult, String> {
    let slot = {
        let mut active = RENDERS.lock().map_err(|e| e.to_string())?;
        if *active >= 2 {
            return Err("Two xyzrender previews are already rendering. Try again shortly.".into());
        }
        *active += 1;
        RenderSlot
    };
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("xyzrender-editor")
        .join(uuid::Uuid::new_v4().to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let _slot = slot;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let result = editor::render(request, &directory);
        let _ = std::fs::remove_dir_all(&directory);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
