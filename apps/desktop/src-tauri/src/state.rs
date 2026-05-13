use notify::RecommendedWatcher;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use crate::open_target::PendingOpenPayload;

pub struct WorkspaceState {
    pub workspace_root: RwLock<Option<PathBuf>>,
    pub watcher_handle: RwLock<Option<RecommendedWatcher>>,
    pub workspace_epoch: AtomicU64,
    pending_open: Mutex<VecDeque<PendingOpenPayload>>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            workspace_root: RwLock::new(None),
            watcher_handle: RwLock::new(None),
            workspace_epoch: AtomicU64::new(0),
            pending_open: Mutex::new(VecDeque::new()),
        }
    }
}

impl WorkspaceState {
    pub fn next_epoch(&self) -> u64 {
        self.workspace_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn push_pending_open(&self, payload: PendingOpenPayload) {
        let mut pending = self.pending_open.lock().expect("pending open lock poisoned");
        if pending.back() == Some(&payload) {
            return;
        }
        pending.push_back(payload);
    }

    pub fn pop_pending_open(&self) -> Option<PendingOpenPayload> {
        self.pending_open
            .lock()
            .expect("pending open lock poisoned")
            .pop_front()
    }

    pub fn has_pending_workspace(&self, path: &std::path::Path) -> bool {
        self.pending_open
            .lock()
            .expect("pending open lock poisoned")
            .iter()
            .any(|payload| std::path::Path::new(&payload.workspace) == path)
    }
}

pub struct AppState {
    windows: RwLock<HashMap<String, Arc<WorkspaceState>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            windows: RwLock::new(HashMap::new()),
        }
    }

    pub fn get_or_create(&self, label: &str) -> Arc<WorkspaceState> {
        {
            let windows = self.windows.read().expect("workspace state lock poisoned");
            if let Some(state) = windows.get(label) {
                return Arc::clone(state);
            }
        }
        let mut windows = self.windows.write().expect("workspace state lock poisoned");
        Arc::clone(
            windows
                .entry(label.to_string())
                .or_insert_with(|| Arc::new(WorkspaceState::default())),
        )
    }

    pub fn get(&self, label: &str) -> Option<Arc<WorkspaceState>> {
        self.windows
            .read()
            .expect("workspace state lock poisoned")
            .get(label)
            .cloned()
    }

    pub fn remove(&self, label: &str) -> Option<Arc<WorkspaceState>> {
        self.windows
            .write()
            .expect("workspace state lock poisoned")
            .remove(label)
    }

    pub fn find_by_workspace(&self, path: &std::path::Path) -> Option<String> {
        let windows = self.windows.read().expect("workspace state lock poisoned");
        for (label, state) in windows.iter() {
            let root = state
                .workspace_root
                .read()
                .expect("workspace root lock poisoned");
            if root.as_deref() == Some(path) {
                return Some(label.clone());
            }
            drop(root);

            if state.has_pending_workspace(path) {
                return Some(label.clone());
            }
        }
        None
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_increments_monotonically() {
        let state = WorkspaceState::default();
        assert_eq!(state.next_epoch(), 1);
        assert_eq!(state.next_epoch(), 2);
        assert_eq!(state.workspace_epoch.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn pending_open_queue_dedupes_adjacent_payloads() {
        let state = WorkspaceState::default();
        let payload = PendingOpenPayload {
            workspace: "/tmp/workspace".to_string(),
            file: None,
        };

        state.push_pending_open(payload.clone());
        state.push_pending_open(payload.clone());

        assert_eq!(state.pop_pending_open(), Some(payload));
        assert_eq!(state.pop_pending_open(), None);
    }

    #[test]
    fn find_by_workspace_matches_pending_open_payloads() {
        let app_state = AppState::new();
        let state = app_state.get_or_create("pending-window");
        state.push_pending_open(PendingOpenPayload {
            workspace: "/tmp/burrete-workspace".to_string(),
            file: None,
        });

        assert_eq!(
            app_state.find_by_workspace(std::path::Path::new("/tmp/burrete-workspace")),
            Some("pending-window".to_string())
        );
    }
}
