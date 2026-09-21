pub(crate) mod formats;
#[allow(
    dead_code,
    reason = "the typed analysis apply boundary is staged for compute result publication"
)]
pub(crate) mod grid_analysis;
pub(crate) mod grid_database;
pub(crate) mod grid_identity;
pub(crate) mod grid_predicate;
#[allow(
    dead_code,
    reason = "the frozen Grid snapshot boundary is staged for compute submission wiring"
)]
pub(crate) mod grid_snapshot;
pub(crate) mod grid_store;
pub(crate) mod runtime;
pub(crate) mod runtime_grid;
pub(crate) mod runtime_utils;
pub(crate) mod runtime_viewer;
#[allow(
    dead_code,
    reason = "snapshot filesystem capabilities are owned by the staged Grid snapshot boundary"
)]
mod snapshot_fs;
pub(crate) mod synthetic_topology;
pub(crate) mod text_xyz;
pub(crate) mod trace;
pub(crate) mod xyz;
pub(crate) mod xyzrender;
mod xyzrender_pool;

#[cfg(all(test, unix))]
mod grid_snapshot_tests;

/// Serializes the tests that swap process-wide `PATH`/`HOME` so a parallel test
/// never resolves the fake xyzrender another test injected.
#[cfg(test)]
pub(crate) fn env_lock() -> &'static std::sync::Mutex<()> {
    static ENV_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    ENV_LOCK.get_or_init(|| std::sync::Mutex::new(()))
}
