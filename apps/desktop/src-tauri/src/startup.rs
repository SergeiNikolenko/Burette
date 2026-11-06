use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime};
use url::Url;

#[derive(Default)]
pub(crate) struct PendingOpenDocuments {
    paths_by_window: Mutex<HashMap<String, Vec<String>>>,
    external: Mutex<ExternalOpenQueue>,
    sessions_by_window: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct ExternalOpenQueue {
    restoration_complete: bool,
    paths: Vec<String>,
}

impl PendingOpenDocuments {
    fn take_external(&self, owners_ready: bool) -> Vec<String> {
        let mut external = self.external.lock().unwrap();
        if !external.restoration_complete || !owners_ready {
            return Vec::new();
        }
        std::mem::take(&mut external.paths)
    }

    pub(crate) fn take_session(&self, window_label: &str) -> Option<String> {
        self.sessions_by_window.lock().unwrap().remove(window_label)
    }

    pub(crate) fn push_for_window(&self, window_label: &str, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        let mut pending = self.paths_by_window.lock().unwrap();
        pending
            .entry(window_label.to_string())
            .or_default()
            .extend(paths);
    }

    pub(crate) fn drain_for_window(&self, window_label: &str) -> Vec<String> {
        let mut pending = self.paths_by_window.lock().unwrap();
        pending.remove(window_label).unwrap_or_default()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LaunchMode {
    Normal,
    Register,
}

impl LaunchMode {
    pub(crate) fn current(argv: &[String]) -> Self {
        launch_mode_from_argv(argv)
            .or_else(|| {
                launch_mode_from_value(std::env::var("BURETTE_LAUNCH_MODE").ok().as_deref())
            })
            .unwrap_or(Self::Normal)
    }

    pub(crate) fn is_register(self) -> bool {
        self == Self::Register
    }
}

pub(crate) fn file_args_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    let mut args = argv.into_iter().skip(1);
    let mut paths = Vec::new();
    while let Some(arg) = args.next() {
        if arg == "--burette-launch-mode" {
            let _ = args.next();
            continue;
        }
        if arg.starts_with("--burette-launch-mode=") {
            continue;
        }
        if arg == "--burette-agent-session" {
            let _ = args.next();
            continue;
        }
        if arg.starts_with("--burette-agent-session=") {
            continue;
        }
        if let Some(path) = file_arg_to_path(&arg, cwd.as_ref())
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
        {
            paths.push(path);
        }
    }
    paths
}

pub(crate) fn agent_session_from_argv(argv: Vec<String>, cwd: Option<PathBuf>) -> Option<String> {
    let mut args = argv.into_iter().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--burette-agent-session=") {
            return agent_session_arg_to_path(value, cwd.as_ref());
        }
        if arg == "--burette-agent-session" {
            return agent_session_arg_to_path(&args.next()?, cwd.as_ref());
        }
    }
    None
}

fn agent_session_arg_to_path(arg: &str, cwd: Option<&PathBuf>) -> Option<String> {
    let path = file_arg_to_path(arg, cwd)?;
    if !path.is_dir() {
        return None;
    }
    Some(path.to_string_lossy().to_string())
}

fn file_arg_to_path(arg: &str, cwd: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(url) = Url::parse(arg) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
    }

    let candidate = PathBuf::from(arg);
    Some(if candidate.is_absolute() {
        candidate
    } else {
        cwd?.join(candidate)
    })
}

fn launch_mode_from_argv(argv: &[String]) -> Option<LaunchMode> {
    let mut args = argv.iter().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--burette-launch-mode=") {
            if let Some(mode) = launch_mode_from_value(Some(value)) {
                return Some(mode);
            }
            continue;
        }
        if arg == "--burette-launch-mode" {
            if let Some(mode) = launch_mode_from_value(args.next().map(String::as_str)) {
                return Some(mode);
            }
        }
    }
    None
}

fn launch_mode_from_value(value: Option<&str>) -> Option<LaunchMode> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "normal" => Some(LaunchMode::Normal),
        "register" => Some(LaunchMode::Register),
        _ => None,
    }
}

pub(crate) fn signal_open_documents_for_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    paths: Vec<String>,
) {
    if !paths.is_empty() {
        app.state::<PendingOpenDocuments>()
            .push_for_window(window_label, paths);
        if let Some(window) = app.get_webview_window(window_label) {
            let _ = app.emit_to(window.label(), "open-documents", ());
        }
    }
}

pub(crate) fn route_external_open_documents<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: Vec<String>,
) {
    if paths.is_empty() || crate::menu::exit_transition_is_active(app) {
        return;
    }
    {
        let pending = app.state::<PendingOpenDocuments>();
        let mut external = pending.external.lock().unwrap();
        for path in paths {
            if !external.paths.contains(&path) {
                external.paths.push(path);
            }
        }
    }
    flush_external_open_documents(app);
}

pub(crate) fn finish_workspace_restoration<R: Runtime>(app: &tauri::AppHandle<R>) {
    app.state::<PendingOpenDocuments>()
        .external
        .lock()
        .unwrap()
        .restoration_complete = true;
    flush_external_open_documents(app);
}

pub(crate) fn flush_external_open_documents<R: Runtime>(app: &tauri::AppHandle<R>) {
    use crate::{menu, windows};
    if menu::exit_transition_is_active(app) {
        return;
    }
    let pending = app.state::<PendingOpenDocuments>();
    {
        let external = pending.external.lock().unwrap();
        if !external.restoration_complete || external.paths.is_empty() {
            return;
        }
    }
    let default_label = match windows::focused_window_label(app) {
        Some(label) => label,
        None => match windows::focus_or_create_workspace_window(app, None) {
            Ok(window) => window.label().to_string(),
            Err(_) => return,
        },
    };
    let candidates: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| windows::is_workspace_window_label(label))
        .cloned()
        .collect();
    let registry = app.try_state::<menu::OpenDocumentRegistry>();
    // Each restored shell publishes its hydrated tabs, including lazy viewers.
    // Until then an absent owner means "unknown", not "open in the main window".
    let paths = pending.take_external(
        registry
            .as_ref()
            .is_some_and(|registry| registry.has_snapshots(&candidates)),
    );
    if paths.is_empty() {
        return;
    }
    let mut batches = std::collections::BTreeMap::<String, Vec<String>>::new();
    let mut focus_label = None;
    for path in paths {
        let path = std::fs::canonicalize(&path)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or(path);
        let owner = registry
            .as_ref()
            .and_then(|registry| {
                registry.owner_for_path(
                    std::path::Path::new(&path),
                    &candidates,
                    Some(&default_label),
                )
            })
            .unwrap_or_else(|| default_label.clone());
        focus_label.get_or_insert_with(|| owner.clone());
        batches.entry(owner).or_default().push(path);
    }
    for (label, paths) in batches {
        signal_open_documents_for_window(app, &label, paths);
    }
    let _ = windows::focus_or_create_workspace_window(app, focus_label.as_deref());
}

pub(crate) fn emit_agent_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window_label: &str,
    session_dir: Option<String>,
) {
    if let Some(session_dir) = session_dir {
        app.state::<PendingOpenDocuments>()
            .sessions_by_window
            .lock()
            .unwrap()
            .insert(window_label.to_string(), session_dir);
        let _ = app.emit_to(window_label, "agent-session", ());
    }
}

#[cfg(test)]
mod tests {
    use super::{agent_session_from_argv, file_args_from_argv, LaunchMode};
    use std::fs;

    #[test]
    fn cold_external_queue_retains_requests_until_restoration_and_ownership_are_ready() {
        let pending = super::PendingOpenDocuments::default();
        let paths = vec!["/tmp/owned.xyz".to_string(), "/tmp/new.pdb".to_string()];
        pending.external.lock().unwrap().paths = paths.clone();
        assert!(pending.take_external(true).is_empty());
        pending.external.lock().unwrap().restoration_complete = true;
        assert!(pending.take_external(false).is_empty());
        assert_eq!(pending.take_external(true), paths);
        assert!(pending.take_external(true).is_empty());
        pending
            .external
            .lock()
            .unwrap()
            .paths
            .push("/tmp/later.pdb".into());
        assert_eq!(pending.take_external(true), vec!["/tmp/later.pdb"]);
    }

    #[test]
    fn routes_files_and_session_only_to_the_selected_restored_window() {
        use tauri::{
            test::{mock_builder, mock_context, noop_assets},
            Manager,
        };
        let app = mock_builder()
            .manage(super::PendingOpenDocuments::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        super::signal_open_documents_for_window(
            app.handle(),
            "workspace-restored",
            vec!["/tmp/test.pdb".into()],
        );
        super::emit_agent_session(
            app.handle(),
            "workspace-restored",
            Some("/tmp/session".into()),
        );
        let pending = app.state::<super::PendingOpenDocuments>();
        for label in ["main", "workspace-other", "workspace-preview-test"] {
            assert_eq!(
                (pending.drain_for_window(label), pending.take_session(label)),
                (vec![], None)
            );
        }
        assert_eq!(
            (
                pending.drain_for_window("workspace-restored"),
                pending.take_session("workspace-restored")
            ),
            (
                vec!["/tmp/test.pdb".to_string()],
                Some("/tmp/session".to_string())
            )
        );
        assert_eq!(pending.take_session("workspace-restored"), None);
    }

    #[test]
    fn accepts_file_url_arguments() {
        let file = std::env::temp_dir().join(format!("burette-startup-{}.pdb", std::process::id()));
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec![
            "burette".to_string(),
            url::Url::from_file_path(&file).unwrap().to_string(),
        ];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
    }

    #[test]
    fn accepts_relative_path_arguments() {
        let dir = std::env::temp_dir().join(format!("burette-startup-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mini.pdb");
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec!["burette".to_string(), "mini.pdb".to_string()];

        assert_eq!(
            file_args_from_argv(argv, Some(dir.clone())),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn accepts_directory_arguments() {
        let dir = std::env::temp_dir().join(format!("burette-startup-dir-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        let argv = vec!["burette".to_string(), dir.to_string_lossy().to_string()];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![dir.to_string_lossy().to_string()]
        );
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn ignores_launch_mode_arguments_when_collecting_files() {
        let dir = std::env::temp_dir().join(format!("burette-startup-mode-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mini.pdb");
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec![
            "burette".to_string(),
            "--burette-launch-mode=register".to_string(),
            file.to_string_lossy().to_string(),
            "--burette-launch-mode".to_string(),
            "normal".to_string(),
        ];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn ignores_agent_session_arguments_when_collecting_files() {
        let dir =
            std::env::temp_dir().join(format!("burette-agent-session-{}", std::process::id()));
        let session = dir.join("session");
        fs::create_dir_all(&session).unwrap();
        let file = dir.join("mini.pdb");
        fs::write(&file, "HEADER TEST\n").unwrap();

        let argv = vec![
            "burette".to_string(),
            "--burette-agent-session".to_string(),
            session.to_string_lossy().to_string(),
            file.to_string_lossy().to_string(),
        ];

        assert_eq!(
            file_args_from_argv(argv, None),
            vec![file.to_string_lossy().to_string()]
        );
        fs::remove_file(file).unwrap();
        fs::remove_dir(session).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn reads_agent_session_from_cli() {
        let dir =
            std::env::temp_dir().join(format!("burette-agent-session-read-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let argv = vec![
            "burette".to_string(),
            format!("--burette-agent-session={}", dir.to_string_lossy()),
        ];

        assert_eq!(
            agent_session_from_argv(argv, None),
            Some(dir.to_string_lossy().to_string())
        );
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn reads_launch_mode_from_cli() {
        let argv = vec![
            "burette".to_string(),
            "--burette-launch-mode=register".to_string(),
        ];

        assert_eq!(LaunchMode::current(&argv), LaunchMode::Register);
    }

    #[test]
    fn defaults_unknown_launch_mode_to_normal() {
        let argv = vec![
            "burette".to_string(),
            "--burette-launch-mode=unexpected".to_string(),
        ];

        assert_eq!(LaunchMode::current(&argv), LaunchMode::Normal);
    }
}
