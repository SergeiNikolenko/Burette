//! Navigation-only URL protocol. Agent sessions must first be registered locally by the CLI.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::File, io::Read, path::Path, sync::Mutex};
use tauri::{Emitter, Manager, Runtime};
use url::Url;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Target {
    Pdb {
        id: String,
    },
    File {
        path: String,
    },
    Project {
        path: String,
    },
    Session {
        session_dir: String,
        paths: Vec<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Default)]
pub(crate) struct PendingLinks {
    targets: Mutex<HashMap<String, Vec<Target>>>,
    owners: Mutex<HashMap<String, String>>,
}

#[tauri::command]
pub(crate) fn drain_deep_links<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    pending: tauri::State<'_, PendingLinks>,
) -> Vec<Target> {
    pending
        .targets
        .lock()
        .unwrap()
        .remove(window.label())
        .unwrap_or_default()
}

pub(crate) fn scheme(identifier: &str) -> String {
    identifier.split_once(".Dev.").map_or_else(
        || "burette".into(),
        |(_, flavor)| format!("burette-{flavor}"),
    )
}

fn bounded_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = File::open(path)
        .map_err(|_| "Link target is missing. Create a new link from the Burette plugin.")?;
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read link target.")?;
    if bytes.len() > 65536 {
        return Err("Link target is too large.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid link target.".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registration {
    session_dir: String,
    token: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    api_version: String,
    mode: String,
    token: String,
    initial_paths: Vec<String>,
}

fn local_path(value: &str, directory: bool) -> Result<String, String> {
    let path = Path::new(value);
    if value.len() > 4096 || value.chars().any(char::is_control) || !path.is_absolute() {
        return Err("Expected an absolute local path.".into());
    }
    if (directory && !path.is_dir()) || (!directory && !path.is_file()) {
        return Err("The linked file or folder no longer exists.".into());
    }
    Ok(value.into())
}

pub(crate) fn parse(raw: &str, expected_scheme: &str, registry: &Path) -> Result<Target, String> {
    if raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err("Invalid or oversized Burette link.".into());
    }
    let url = Url::parse(raw).map_err(|_| "Invalid Burette link.")?;
    if url.scheme() != expected_scheme
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return Err("Unsupported Burette link.".into());
    }
    match url.host_str() {
        Some("pdb") if url.query().is_none() => {
            let id = url.path().strip_prefix('/').unwrap_or_default();
            if id.len() != 4
                || !id.bytes().all(|b| b.is_ascii_alphanumeric())
                || !id.as_bytes()[0].is_ascii_digit()
            {
                return Err("Expected a four-character PDB ID, for example 1HTB.".into());
            }
            Ok(Target::Pdb {
                id: id.to_ascii_uppercase(),
            })
        }
        Some(kind @ ("open" | "project")) if matches!(url.path(), "" | "/") => {
            let pairs: Vec<_> = url.query_pairs().collect();
            if pairs.len() != 1 || pairs[0].0 != "path" {
                return Err("Expected exactly one path parameter.".into());
            }
            let path = local_path(&pairs[0].1, kind == "project")?;
            Ok(if kind == "project" {
                Target::Project { path }
            } else {
                Target::File { path }
            })
        }
        Some("session") if url.query().is_none() => {
            let id = url.path().strip_prefix('/').unwrap_or_default();
            let uuid = uuid::Uuid::parse_str(id).map_err(|_| "Invalid session link ID.")?;
            if uuid.to_string() != id {
                return Err("Invalid session link ID.".into());
            }
            let registration: Registration = bounded_json(&registry.join(format!("{id}.json")))?;
            let session_dir = local_path(&registration.session_dir, true)?;
            let session: Session = bounded_json(&Path::new(&session_dir).join("session.json"))?;
            if session.api_version != "burette-agent-cli/v1"
                || session.mode != "desktop-app"
                || registration.token.is_empty()
                || session.token != registration.token
            {
                return Err("Session link has expired. Create a new link from the plugin.".into());
            }
            if session.initial_paths.is_empty() || session.initial_paths.len() > 32 {
                return Err("Invalid session file list.".into());
            }
            let paths = session
                .initial_paths
                .iter()
                .map(|p| local_path(p, Path::new(p).is_dir()))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Target::Session { session_dir, paths })
        }
        _ => {
            Err("Unknown Burette link route. Supported routes: pdb, open, project, session.".into())
        }
    }
}

#[tauri::command]
pub(crate) fn claim_agent_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    session_dir: String,
    pending: tauri::State<'_, PendingLinks>,
) -> Result<bool, String> {
    let path = std::fs::canonicalize(session_dir).map_err(|_| "Session directory is missing.")?;
    let key = path.to_string_lossy().to_string();
    let mut owners = pending.owners.lock().unwrap();
    owners.retain(|_, label| window.app_handle().get_webview_window(label).is_some());
    if owners
        .get(&key)
        .is_some_and(|label| label != window.label())
    {
        return Ok(false);
    }
    // Keep earlier sessions leased to this window until it closes: late observe
    // writes must never race with a second window using the old session.
    owners.insert(key, window.label().into());
    Ok(true)
}

pub(crate) fn receive<R: Runtime>(app: &tauri::AppHandle<R>, urls: Vec<String>) {
    if urls.is_empty() || crate::menu::exit_transition_is_active(app) {
        return;
    }
    let scheme = scheme(&app.config().identifier);
    let registry = app.path().app_data_dir().map(|p| p.join("deep-links"));
    for url in urls.into_iter().take(32) {
        let target = registry
            .as_ref()
            .map_err(|_| "Link registry is unavailable.".into())
            .and_then(|root| parse(&url, &scheme, root))
            .unwrap_or_else(|message| Target::Error { message });
        let pending = app.state::<PendingLinks>();
        let owner = if let Target::Session { session_dir, .. } = &target {
            let key = std::fs::canonicalize(session_dir)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            let owners = pending.owners.lock().unwrap();
            key.and_then(|key| owners.get(&key).cloned())
                .filter(|label| app.get_webview_window(label).is_some())
        } else {
            None
        };
        let label = owner.or_else(|| crate::windows::focused_window_label(app));
        let Ok(window) = crate::windows::focus_or_create_workspace_window(app, label.as_deref())
        else {
            continue;
        };
        let mut queues = pending.targets.lock().unwrap();
        let queue = queues.entry(window.label().into()).or_default();
        if queue.len() < 32 && !queue.contains(&target) {
            queue.push(target);
        }
        drop(queues);
        let _ = window.emit("deep-links", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_navigation_and_rejects_commands() {
        let root = std::env::temp_dir();
        assert_eq!(
            parse("burette://pdb/1htb", "burette", &root),
            Ok(Target::Pdb { id: "1HTB".into() })
        );
        for raw in [
            "burette://pdb/1HTB?execute=x",
            "burette://pdb/1HTB#x",
            "burette://user@pdb/1HTB",
            "burette://pdb/abcd",
            "burette://session/../../x",
            "burette://run?cmd=ls",
            "burette://open?path=relative",
            "burette://open?path=/tmp&path=/tmp",
            "https://pdb/1HTB",
        ] {
            assert!(parse(raw, "burette", &root).is_err(), "{raw}");
        }
        assert_eq!(scheme("com.local.BuretteV10.Dev.links"), "burette-links");
        assert!(parse("burette://pdb/1HTB", "burette-links", &root).is_err());
    }
    #[test]
    fn session_claim_is_exclusive_across_windows() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .manage(PendingLinks::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let first = tauri::WebviewWindowBuilder::new(&app, "first", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let second = tauri::WebviewWindowBuilder::new(&app, "second", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let directory = std::env::temp_dir().to_string_lossy().to_string();
        assert!(claim_agent_session(first.clone(), directory.clone(), app.state()).unwrap());
        assert!(!claim_agent_session(second, directory.clone(), app.state()).unwrap());
        assert!(claim_agent_session(first, directory, app.state()).unwrap());
    }

    #[test]
    fn registered_session_and_encoded_files() {
        let root = std::env::temp_dir().join(format!("burette-links-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("молекула & #.pdb");
        std::fs::write(&file, "HEADER TEST").unwrap();
        let mut link = Url::parse("burette://open").unwrap();
        link.query_pairs_mut()
            .append_pair("path", file.to_str().unwrap());
        assert_eq!(
            parse(link.as_str(), "burette", &root),
            Ok(Target::File {
                path: file.to_string_lossy().into()
            })
        );
        let id = uuid::Uuid::new_v4();
        std::fs::write(
            root.join(format!("{id}.json")),
            serde_json::json!({"sessionDir": root, "token":"test-token"}).to_string(),
        )
        .unwrap();
        let manifest = root.join("session.json");
        std::fs::write(&manifest, serde_json::json!({"apiVersion":"burette-agent-cli/v1", "mode":"desktop-app", "token":"test-token", "initialPaths":[file]}).to_string()).unwrap();
        let link = format!("burette://session/{id}");
        assert!(matches!(
            parse(&link, "burette", &root),
            Ok(Target::Session { .. })
        ));
        std::fs::write(&manifest, "{} ").unwrap();
        assert!(parse(&link, "burette", &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
