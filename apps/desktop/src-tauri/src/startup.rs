use std::path::PathBuf;
use tauri::{Emitter, Runtime};

pub(crate) fn file_args_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .filter_map(|arg| {
            let candidate = PathBuf::from(arg);
            let path = if candidate.is_absolute() {
                candidate
            } else {
                cwd.as_ref()?.join(candidate)
            };
            path.is_file().then(|| path.to_string_lossy().to_string())
        })
        .collect()
}

pub(crate) fn emit_open_documents<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if !paths.is_empty() {
        let _ = app.emit("open-documents", paths);
    }
}
