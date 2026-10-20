//! App-level preferences that native code reads outside of a viewer runtime:
//! the compute backend choice, tool path overrides and job history retention.
//! The web shell pushes them through `sync_app_preferences` on launch and on
//! every change; native resolvers read the latest snapshot from here.

use std::env;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use burette_compute_protocol::BackendPolicy;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};

use crate::compute::coordinator::ComputeCoordinator;

/// Which numeric backend compute workflows should use.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ComputeBackendPreference {
    /// Keep each workflow's own policy (Metal where available).
    #[default]
    Auto,
    /// Require the native Metal backend.
    Metal,
    /// Always use the CPU reference backend.
    Cpu,
}

impl ComputeBackendPreference {
    /// Applies the user's backend choice on top of a workflow's requested policy.
    pub(crate) fn apply(self, requested: BackendPolicy) -> BackendPolicy {
        match self {
            Self::Auto => requested,
            Self::Metal => BackendPolicy::GpuRequired,
            Self::Cpu => BackendPolicy::ReferenceCpu,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppPreferences {
    #[serde(default)]
    compute_backend: ComputeBackendPreference,
    #[serde(default)]
    python_path: String,
    #[serde(default)]
    uv_path: String,
    /// Zero keeps finished jobs forever.
    #[serde(default)]
    job_history_retention_days: u32,
}

fn store() -> &'static RwLock<AppPreferences> {
    static STORE: OnceLock<RwLock<AppPreferences>> = OnceLock::new();
    STORE.get_or_init(Default::default)
}

fn current() -> AppPreferences {
    store()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(crate) fn compute_backend() -> ComputeBackendPreference {
    current().compute_backend
}

/// The Python executable chosen in Settings, if any.
pub(crate) fn python_override() -> Option<PathBuf> {
    configured_path(&current().python_path)
}

/// The uv executable chosen in Settings, if any.
pub(crate) fn uv_override() -> Option<PathBuf> {
    configured_path(&current().uv_path)
}

fn configured_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = env::var_os("HOME") {
            return Some(PathBuf::from(home).join(rest));
        }
    }
    Some(PathBuf::from(value))
}

#[tauri::command]
pub(crate) fn sync_app_preferences<R: Runtime>(
    app: tauri::AppHandle<R>,
    preferences: AppPreferences,
) {
    let retention_days = preferences.job_history_retention_days;
    *store()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = preferences;
    if retention_days > 0 {
        if let Some(coordinator) = app.try_state::<ComputeCoordinator>() {
            let coordinator = coordinator.inner().clone();
            std::thread::spawn(move || prune_job_history(&coordinator, retention_days));
        }
    }
}

fn prune_job_history(coordinator: &ComputeCoordinator, retention_days: u32) {
    let retention = Duration::from_secs(u64::from(retention_days) * 24 * 60 * 60);
    let Some(cutoff) = SystemTime::now()
        .checked_sub(retention)
        .and_then(|cutoff| cutoff.duration_since(UNIX_EPOCH).ok())
    else {
        return;
    };
    if let Err(error) = coordinator.prune_finished_jobs(cutoff.as_millis() as u64) {
        eprintln!("failed to prune compute job history: {error}");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolPathDefaults {
    python: Option<String>,
    uv: Option<String>,
}

/// The executables Burette finds when no path is configured.
#[tauri::command]
pub(crate) fn tool_path_defaults() -> ToolPathDefaults {
    let home = env::var_os("HOME").map(PathBuf::from);
    let python = find_executable(
        &["python3"],
        &[
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ],
        None,
    );
    let uv_home: Vec<PathBuf> = home
        .iter()
        .flat_map(|home| [home.join(".local/bin/uv"), home.join(".cargo/bin/uv")])
        .collect();
    let uv = find_executable(
        &["uv"],
        &["/opt/homebrew/bin/uv", "/usr/local/bin/uv"],
        Some(&uv_home),
    );
    ToolPathDefaults {
        python: python.map(|path| path.display().to_string()),
        uv: uv.map(|path| path.display().to_string()),
    }
}

fn find_executable(
    names: &[&str],
    fallbacks: &[&str],
    extra: Option<&[PathBuf]>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.extend(names.iter().map(|name| directory.join(name)));
        }
    }
    candidates.extend(extra.unwrap_or_default().iter().cloned());
    candidates.extend(fallbacks.iter().map(PathBuf::from));
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_preference_overrides_requested_policy() {
        assert_eq!(
            ComputeBackendPreference::Auto.apply(BackendPolicy::GpuPreferred),
            BackendPolicy::GpuPreferred
        );
        assert_eq!(
            ComputeBackendPreference::Cpu.apply(BackendPolicy::GpuRequired),
            BackendPolicy::ReferenceCpu
        );
        assert_eq!(
            ComputeBackendPreference::Metal.apply(BackendPolicy::ReferenceCpu),
            BackendPolicy::GpuRequired
        );
    }

    #[test]
    fn blank_paths_mean_automatic() {
        assert_eq!(configured_path("  "), None);
        assert_eq!(
            configured_path(" /opt/bin/uv "),
            Some(PathBuf::from("/opt/bin/uv"))
        );
    }
}
