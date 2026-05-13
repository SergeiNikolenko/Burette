use std::path::PathBuf;
use tauri::{Emitter, Runtime};

#[tauri::command]
pub fn startup_documents() -> Vec<String> {
    file_args_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}

#[tauri::command]
pub fn startup_open_payload() -> Option<crate::open_target::PendingOpenPayload> {
    let cwd = std::env::current_dir().ok();
    let paths = std::env::args().skip(1).filter_map(|arg| {
        let candidate = PathBuf::from(arg);
        if candidate.is_absolute() {
            Some(candidate)
        } else {
            cwd.as_ref().map(|cwd| cwd.join(candidate))
        }
    });
    crate::open_target::open_payloads_from_paths(paths)
        .into_iter()
        .next()
}

pub fn file_args_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .flat_map(|arg| {
            let candidate = PathBuf::from(arg);
            let path = if candidate.is_absolute() {
                candidate
            } else {
                match cwd.as_ref() {
                    Some(cwd) => cwd.join(candidate),
                    None => return Vec::new(),
                }
            };
            crate::open_target::resolve_open_targets(&path)
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

pub fn emit_open_documents<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if !paths.is_empty() {
        let _ = app.emit("open-documents", paths);
    }
}
