use crate::commands::fs_actions::DirectoryEntry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

const MAX_RECENT_WORKSPACES: usize = 10;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    root: String,
    name: String,
    file_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    paths: Vec<String>,
    active_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreWorkspaceResponse {
    workspace: WorkspaceInfo,
    entries: Vec<DirectoryEntry>,
    recent_workspaces: Vec<String>,
    session: Option<WorkspaceSession>,
}

fn app_data_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    file_name: &str,
) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(file_name))
}

fn canonicalize_workspace_root(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", path))?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    Ok(root)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().trim_end_matches('/').to_string()
}

fn workspace_key(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string()
}

fn workspace_info(root: &Path) -> WorkspaceInfo {
    let root_path = path_key(root);
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| root_path.clone());
    WorkspaceInfo {
        root: root_path,
        name,
        file_count: 0,
    }
}

fn add_recent_workspace(mut recents: Vec<String>, workspace_path: String) -> Vec<String> {
    recents.retain(|candidate| candidate != &workspace_path);
    recents.insert(0, workspace_path);
    recents.truncate(MAX_RECENT_WORKSPACES);
    recents
}

fn recent_workspaces_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app_data_file(app, "recent_workspaces.json")
}

fn load_recent_workspaces_list<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let path = recent_workspaces_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

fn save_recent_workspaces_list<R: Runtime>(
    app: &tauri::AppHandle<R>,
    recents: &[String],
) -> Result<(), String> {
    let path = recent_workspaces_path(app)?;
    let data = serde_json::to_string_pretty(recents).map_err(|err| err.to_string())?;
    fs::write(path, data).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_recent_workspaces<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    load_recent_workspaces_list(&app)
}

#[tauri::command]
pub fn open_workspace(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<WorkspaceInfo, String> {
    let workspace_root = canonicalize_workspace_root(&path)?;
    let key = path_key(&workspace_root);
    let recents = add_recent_workspace(load_recent_workspaces_list(&app).unwrap_or_default(), key);
    save_recent_workspaces_list(&app, &recents)?;
    crate::watcher::install_workspace_watcher(&app, webview.label(), workspace_root.clone())?;
    Ok(workspace_info(&workspace_root))
}

#[tauri::command]
pub fn restore_workspace(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<RestoreWorkspaceResponse, String> {
    let workspace = open_workspace(app.clone(), webview, path)?;
    let entries = crate::commands::fs_actions::read_directory(workspace.root.clone())?;
    let recent_workspaces = load_recent_workspaces_list(&app).unwrap_or_default();
    let session = load_session(app, workspace.root.clone())?;
    Ok(RestoreWorkspaceResponse {
        workspace,
        entries,
        recent_workspaces,
        session,
    })
}

#[tauri::command]
pub fn take_pending_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Option<crate::open_target::PendingOpenPayload> {
    let app_state = app.state::<crate::state::AppState>();
    let state = (*app_state).get_or_create(webview.label());
    state.pop_pending_open()
}

#[tauri::command]
pub fn resolve_open_payload(path: String) -> Option<crate::open_target::PendingOpenPayload> {
    crate::open_target::resolve_open_payload(Path::new(&path))
}

#[tauri::command]
pub fn open_workspace_in_new_window(
    app: tauri::AppHandle,
    path: String,
    file: Option<String>,
) -> Result<(), String> {
    crate::open_new_workspace_window(&app, path, file)
}

#[tauri::command]
pub fn remember_workspace(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<Vec<String>, String> {
    let workspace_root = canonicalize_workspace_root(&path)?;
    let key = path_key(&workspace_root);
    let recents = add_recent_workspace(load_recent_workspaces_list(&app).unwrap_or_default(), key);
    save_recent_workspaces_list(&app, &recents)?;
    crate::watcher::install_workspace_watcher(&app, webview.label(), workspace_root)?;
    Ok(recents)
}

#[tauri::command]
pub fn remove_recent_workspace<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Vec<String>, String> {
    let key = workspace_key(&path);
    let mut recents = load_recent_workspaces_list(&app).unwrap_or_default();
    recents.retain(|candidate| candidate != &key);
    save_recent_workspaces_list(&app, &recents)?;
    Ok(recents)
}

fn sessions_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app_data_file(app, "sessions.json")
}

fn load_all_sessions<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<HashMap<String, WorkspaceSession>, String> {
    let path = sessions_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

fn save_all_sessions<R: Runtime>(
    app: &tauri::AppHandle<R>,
    sessions: &HashMap<String, WorkspaceSession>,
) -> Result<(), String> {
    let path = sessions_path(app)?;
    let data = serde_json::to_string_pretty(sessions).map_err(|err| err.to_string())?;
    fs::write(path, data).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_session<R: Runtime>(
    app: tauri::AppHandle<R>,
    workspace_root: String,
    paths: Vec<String>,
    active_path: Option<String>,
) -> Result<(), String> {
    let key = workspace_key(&workspace_root);
    let mut sessions = load_all_sessions(&app).unwrap_or_default();
    if paths.is_empty() {
        sessions.remove(&key);
    } else {
        sessions.insert(key, WorkspaceSession { paths, active_path });
    }
    save_all_sessions(&app, &sessions)
}

#[tauri::command]
pub fn load_session<R: Runtime>(
    app: tauri::AppHandle<R>,
    workspace_root: String,
) -> Result<Option<WorkspaceSession>, String> {
    let key = workspace_key(&workspace_root);
    let sessions = load_all_sessions(&app)?;
    Ok(sessions.get(&key).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("burrete-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn canonicalize_workspace_root_rejects_missing_paths() {
        let err = canonicalize_workspace_root("/this/path/does/not/exist/ever")
            .expect_err("missing path should fail");

        assert!(err.contains("No such file") || err.contains("os error"));
    }

    #[test]
    fn canonicalize_workspace_root_rejects_files() {
        let root = temp_workspace("workspace-file");
        let file = root.join("mini.pdb");
        fs::write(&file, b"HEADER\n").expect("write file");

        let err = canonicalize_workspace_root(file.to_str().unwrap())
            .expect_err("file path should fail");

        assert!(err.contains("is not a folder"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn canonicalize_workspace_root_returns_absolute_directory() {
        let root = temp_workspace("workspace-root");

        let canonical = canonicalize_workspace_root(root.to_str().unwrap()).expect("canonical root");

        assert!(canonical.is_absolute());
        assert_eq!(canonical, root.canonicalize().expect("canonicalize temp root"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn add_recent_workspace_dedupes_and_truncates() {
        let recents = (0..12).map(|index| format!("/tmp/ws-{index}")).collect();

        let updated = add_recent_workspace(recents, "/tmp/ws-5".to_string());

        assert_eq!(updated.first().map(String::as_str), Some("/tmp/ws-5"));
        assert_eq!(updated.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(
            updated.iter().filter(|path| path.as_str() == "/tmp/ws-5").count(),
            1
        );
    }
}
