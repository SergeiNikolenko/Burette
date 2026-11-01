//! Avogadro plugins for Settings > Extensions on the desktop.
//!
//! The index is fetched from one fixed address. Links and install sources are
//! resolved here from the last fetched index (or the reviewed snapshot shipped
//! with Burette), so the webview never names a URL or a hash. Installing only
//! downloads, verifies and unpacks a package; nothing in it runs.

mod archive;
mod index;
mod runner;
mod store;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Manager, Runtime};

use crate::commands::database::http::{fetch, fetch_cancellable, DatabaseRequest, FETCH_CANCELLED};
pub(crate) use index::PluginLink;
use index::{entry, plugin_link, IndexEntry, SAVED_INDEX};
pub(crate) use store::InstalledPlugin;

const INDEX_URL: &str = "https://avogadro.cc/plugins2.json";
const MAX_INDEX_BYTES: u64 = 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const CANCELLED: &str = "Cancelled";

/// The last index text the webview received, kept for link and source lookup.
static LIVE_INDEX: Mutex<Option<String>> = Mutex::new(None);
/// Cancellation flags of running plugin jobs, by job id.
static JOBS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn live_index() -> Option<String> {
    LIVE_INDEX.lock().ok().and_then(|live| live.clone())
}

fn plugins_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("extensions")
        .join("avogadro"))
}

/// Registers a cancellation flag for the lifetime of the returned guard.
pub(crate) struct JobGuard {
    id: String,
    pub(crate) cancel: Arc<AtomicBool>,
}

impl JobGuard {
    pub(crate) fn register(id: &str) -> Result<Self, String> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Invalid job id".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let mut jobs = JOBS
            .lock()
            .map_err(|_| "The job registry is unavailable".to_string())?;
        let jobs = jobs.get_or_insert_with(HashMap::new);
        if jobs.contains_key(id) {
            return Err("This job is already running".into());
        }
        jobs.insert(id.to_string(), cancel.clone());
        Ok(Self {
            id: id.to_string(),
            cancel,
        })
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = JOBS.lock() {
            if let Some(jobs) = jobs.as_mut() {
                jobs.remove(&self.id);
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn fetch_avogadro_plugin_index() -> Result<String, String> {
    let text = tauri::async_runtime::spawn_blocking(|| {
        let body = fetch(
            &DatabaseRequest::get(INDEX_URL)
                .with_header("Accept: application/json")
                .with_timeout(20)
                .with_max_bytes(MAX_INDEX_BYTES),
        )?;
        String::from_utf8(body).map_err(|_| "The plugin index is not UTF-8 text".to_string())
    })
    .await
    .map_err(|error| format!("The plugin index task failed: {error}"))??;
    if let Ok(mut live) = LIVE_INDEX.lock() {
        *live = Some(text.clone());
    }
    Ok(text)
}

#[tauri::command]
pub(crate) fn open_avogadro_plugin_link(name: String, link: PluginLink) -> Result<(), String> {
    let url = live_index()
        .as_deref()
        .and_then(|text| plugin_link(text, &name, link))
        .or_else(|| plugin_link(SAVED_INDEX, &name, link))
        .ok_or_else(|| "This plugin link is not in the Avogadro plugin index".to_string())?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn avogadro_plugins_installed<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<InstalledPlugin>, String> {
    Ok(store::installed(&plugins_root(&app)?))
}

/// The source to install: the live index wins over the saved one, and it must
/// still describe the revision the user chose.
fn install_source(name: &str, commit: &str) -> Result<IndexEntry, String> {
    let found = live_index()
        .as_deref()
        .and_then(|text| entry(text, name))
        .or_else(|| entry(SAVED_INDEX, name))
        .ok_or_else(|| "This plugin cannot be installed".to_string())?;
    if found.commit != commit {
        return Err("The Avogadro plugin index changed. Refresh and try again.".into());
    }
    Ok(found)
}

#[tauri::command]
pub(crate) async fn avogadro_plugin_install<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
    name: String,
    commit: String,
) -> Result<InstalledPlugin, String> {
    let root = plugins_root(&app)?;
    let source = install_source(&name, &commit)?;
    let job = JobGuard::register(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = fetch_cancellable(
            &DatabaseRequest::get(&source.archive_url)
                .with_timeout(120)
                .with_max_bytes(MAX_ARCHIVE_BYTES),
            &job.cancel,
        )
        .map_err(|error| {
            if error == FETCH_CANCELLED {
                CANCELLED.to_string()
            } else {
                error
            }
        })?;
        store::install(&root, &source, &archive, &job.cancel)
    })
    .await
    .map_err(|error| format!("The plugin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn avogadro_plugin_remove<R: Runtime>(
    app: tauri::AppHandle<R>,
    name: String,
) -> Result<(), String> {
    if !index::valid_name(&name) {
        return Err("Invalid plugin name".into());
    }
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::remove(&root, &name))
        .await
        .map_err(|error| format!("The plugin task failed: {error}"))?
}

/// Creates the package's environment with `pixi install`. This runs code from
/// the package and downloads its dependencies; the shell asks first.
#[tauri::command]
pub(crate) async fn avogadro_plugin_prepare<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
    name: String,
) -> Result<InstalledPlugin, String> {
    let root = plugins_root(&app)?;
    let job = JobGuard::register(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let pixi = crate::commands::conformer::resolve_executable("pixi");
        runner::prepare(&root, &name, pixi, &job.cancel)
    })
    .await
    .map_err(|error| format!("The plugin task failed: {error}"))?
}

/// Runs one declared command of a prepared package and returns its JSON text.
#[tauri::command]
pub(crate) async fn avogadro_plugin_run<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
    name: String,
    script: String,
    identifier: String,
    input: String,
) -> Result<String, String> {
    let root = plugins_root(&app)?;
    let job = JobGuard::register(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        runner::run(&root, &name, &script, &identifier, &input, &job.cancel)
    })
    .await
    .map_err(|error| format!("The plugin task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn avogadro_plugin_options<R: Runtime>(
    app: tauri::AppHandle<R>,
    name: String,
    path: String,
) -> Result<String, String> {
    runner::read_options(&plugins_root(&app)?, &name, &path)
}

#[tauri::command]
pub(crate) fn avogadro_plugin_cancel(job_id: String) {
    if let Ok(jobs) = JOBS.lock() {
        if let Some(cancel) = jobs.as_ref().and_then(|jobs| jobs.get(&job_id)) {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_source_requires_the_revision_the_user_saw() {
        let rdkit =
            install_source("avogadro-rdkit", "82498e3a3cedc2d465ccdcd93cabec1b2505dc5a").unwrap();
        assert_eq!(rdkit.version, "0.3.0");
        assert!(install_source("avogadro-rdkit", &"0".repeat(40))
            .unwrap_err()
            .contains("changed"));
        assert!(install_source("../etc", &"0".repeat(40)).is_err());
    }

    #[test]
    fn job_ids_are_unique_while_running_and_cancellable_by_id() {
        let id = uuid::Uuid::new_v4().to_string();
        let job = JobGuard::register(&id).unwrap();
        assert!(JobGuard::register(&id).is_err());
        avogadro_plugin_cancel(id.clone());
        assert!(job.cancel.load(Ordering::Relaxed));
        drop(job);
        assert!(JobGuard::register(&id).is_ok());
        assert!(JobGuard::register("not/allowed").is_err());
    }
}
