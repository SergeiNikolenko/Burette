use crate::state::AppState;
use crate::{is_hidden_path, is_supported_structure_path};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 250;

#[derive(Debug, Clone, Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
}

fn should_ignore(path: &Path, workspace_root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(workspace_root) else {
        return false;
    };
    relative.components().any(|component| {
        let name = component.as_os_str();
        name == ".git"
            || name == "node_modules"
            || name == ".DS_Store"
            || is_hidden_path(Path::new(name))
    })
}

fn event_kind_str(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("deleted"),
        _ => None,
    }
}

fn path_should_emit(path: &Path, is_dir: bool) -> bool {
    is_dir || is_supported_structure_path(path)
}

fn event_is_dir(path: &Path, kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(notify::event::CreateKind::Folder)
            | EventKind::Remove(notify::event::RemoveKind::Folder)
    ) || path.is_dir()
}

fn parent_directory_payload(path: &Path) -> Option<FileChangeEvent> {
    path.parent().map(|parent| FileChangeEvent {
        path: parent.to_string_lossy().to_string(),
        kind: "modified".to_string(),
    })
}

pub fn start_watcher(
    app_handle: AppHandle,
    window_label: String,
    root: &Path,
    epoch: u64,
) -> Result<RecommendedWatcher, notify::Error> {
    let root_path = root.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = tx.send(result);
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(DEBOUNCE_MS)),
    )?;
    watcher.watch(&root_path, RecursiveMode::Recursive)?;

    std::thread::spawn(move || {
        let mut pending = Vec::new();
        let mut last_emit = Instant::now();

        loop {
            match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                Ok(Ok(event)) => pending.push(event),
                Ok(Err(_)) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if pending.is_empty() || last_emit.elapsed() < Duration::from_millis(DEBOUNCE_MS) {
                continue;
            }

            let app_state = app_handle.state::<AppState>();
            let Some(state) = (*app_state).get(&window_label) else {
                break;
            };
            if state.workspace_epoch.load(Ordering::SeqCst) != epoch {
                pending.clear();
                last_emit = Instant::now();
                continue;
            }

            let workspace_root = state
                .workspace_root
                .read()
                .expect("workspace root lock poisoned")
                .clone()
                .unwrap_or_else(|| root_path.clone());

            for event in pending.drain(..) {
                let Some(kind) = event_kind_str(&event.kind) else {
                    continue;
                };

                for path in event.paths {
                    if should_ignore(&path, &workspace_root) {
                        continue;
                    }

                    let is_dir = event_is_dir(&path, &event.kind);
                    if !path_should_emit(&path, is_dir) {
                        continue;
                    }

                    let payload = FileChangeEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: kind.to_string(),
                    };

                    if is_dir {
                        let _ = app_handle.emit_to(
                            window_label.clone(),
                            "fs:directory-changed",
                            &payload,
                        );
                    } else {
                        let _ =
                            app_handle.emit_to(window_label.clone(), "fs:file-changed", &payload);
                        if let Some(parent_payload) = parent_directory_payload(&path) {
                            let _ = app_handle.emit_to(
                                window_label.clone(),
                                "fs:directory-changed",
                                &parent_payload,
                            );
                        }
                    }
                }
            }

            last_emit = Instant::now();
        }
    });

    Ok(watcher)
}

pub fn drop_watcher_off_thread(watcher: Option<RecommendedWatcher>) {
    let Some(watcher) = watcher else {
        return;
    };
    std::thread::spawn(move || drop(watcher));
}

pub fn install_workspace_watcher(
    app: &AppHandle,
    window_label: &str,
    workspace_root: PathBuf,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let state = (*app_state).get_or_create(window_label);
    let epoch = state.next_epoch();
    *state.workspace_root.write().expect("workspace root lock poisoned") =
        Some(workspace_root.clone());
    let old_watcher = state
        .watcher_handle
        .write()
        .expect("watcher lock poisoned")
        .take();
    drop_watcher_off_thread(old_watcher);

    let watcher = start_watcher(
        app.clone(),
        window_label.to_string(),
        &workspace_root,
        epoch,
    )
    .map_err(|error| error.to_string())?;
    *state
        .watcher_handle
        .write()
        .expect("watcher lock poisoned") = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_workspace_root_does_not_hide_children() {
        let root = Path::new("/Users/test/.molecules");
        assert!(!should_ignore(&root.join("1abc.pdb"), root));
        assert!(should_ignore(&root.join(".git/HEAD"), root));
    }

    #[test]
    fn supported_files_and_directories_emit() {
        assert!(path_should_emit(Path::new("/tmp/a.pdb"), false));
        assert!(path_should_emit(Path::new("/tmp/folder"), true));
        assert!(!path_should_emit(Path::new("/tmp/readme.txt"), false));
    }

    #[test]
    fn parent_payload_targets_parent_directory() {
        let payload = parent_directory_payload(Path::new("/tmp/ws/a.pdb")).unwrap();
        assert_eq!(payload.path, "/tmp/ws");
        assert_eq!(payload.kind, "modified");
    }
}
