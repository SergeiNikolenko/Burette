use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const MAX_RECENT_DOCUMENTS: usize = 100;
const MAX_PATH_CHARS: usize = 4_096;
const MAX_TITLE_CHARS: usize = 512;
const MAX_EXTENSION_CHARS: usize = 64;
const MAX_RENDERER_CHARS: usize = 128;
const MAX_PERSISTED_BYTES: u64 = 2_000_000;
const RECENT_DOCUMENTS_FILE: &str = "recent-documents-v1.json";
const RECENT_DOCUMENTS_CHANGED_EVENT: &str = "recent-documents:changed";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecentDocument {
    path: String,
    title: String,
    extension: String,
    renderer: String,
    byte_count: u64,
    opened_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecentDocumentCheck {
    path: String,
    opened_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecentDocumentsSnapshot {
    revision: u64,
    documents: Vec<RecentDocument>,
}

struct RecentDocumentsState {
    revision: u64,
    accepts_startup_snapshots: bool,
    loaded_from_disk: bool,
    documents: Vec<RecentDocument>,
}

impl Default for RecentDocumentsState {
    fn default() -> Self {
        Self {
            revision: 0,
            accepts_startup_snapshots: true,
            loaded_from_disk: false,
            documents: Vec::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct RecentDocumentsRegistry {
    state: Mutex<RecentDocumentsState>,
}

impl RecentDocumentsRegistry {
    fn initialize(
        &self,
        documents: Vec<RecentDocument>,
        revision: u64,
        storage_path: Option<&Path>,
    ) -> Result<RecentDocumentsSnapshot, String> {
        validate_documents(&documents)?;
        let mut state = self.lock()?;
        load_persisted_state(&mut state, storage_path)?;
        if state.accepts_startup_snapshots {
            state.revision = state.revision.max(revision);
            state.documents = merge_documents(&state.documents, documents);
            advance_revision(&mut state);
        }
        persist_state(&state, storage_path)
    }

    fn merge(
        &self,
        documents: Vec<RecentDocument>,
        storage_path: Option<&Path>,
    ) -> Result<RecentDocumentsSnapshot, String> {
        validate_documents(&documents)?;
        let mut state = self.lock()?;
        load_persisted_state(&mut state, storage_path)?;
        state.accepts_startup_snapshots = false;
        state.documents = merge_documents(&state.documents, documents);
        advance_revision(&mut state);
        persist_state(&state, storage_path)
    }

    fn prune(
        &self,
        checked_documents: Vec<RecentDocumentCheck>,
        existing_paths: Vec<String>,
        storage_path: Option<&Path>,
    ) -> Result<RecentDocumentsSnapshot, String> {
        validate_document_checks(&checked_documents)?;
        validate_paths("existingPaths", &existing_paths)?;
        let checked: HashMap<_, _> = checked_documents
            .into_iter()
            .map(|document| (document.path, document.opened_at))
            .collect();
        let existing: HashSet<_> = existing_paths.into_iter().collect();

        let mut state = self.lock()?;
        load_persisted_state(&mut state, storage_path)?;
        state.accepts_startup_snapshots = false;
        state
            .documents
            .retain(|document| match checked.get(&document.path) {
                Some(checked_opened_at) => {
                    document.opened_at > *checked_opened_at || existing.contains(&document.path)
                }
                None => true,
            });
        advance_revision(&mut state);
        persist_state(&state, storage_path)
    }

    fn clear(&self, storage_path: Option<&Path>) -> Result<RecentDocumentsSnapshot, String> {
        let mut state = self.lock()?;
        load_persisted_state(&mut state, storage_path)?;
        state.accepts_startup_snapshots = false;
        state.documents.clear();
        advance_revision(&mut state);
        persist_state(&state, storage_path)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RecentDocumentsState>, String> {
        self.state
            .lock()
            .map_err(|_| "recent documents registry lock is poisoned".to_string())
    }
}

#[tauri::command]
pub(crate) fn initialize_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, RecentDocumentsRegistry>,
    documents: Vec<RecentDocument>,
    revision: u64,
) -> Result<RecentDocumentsSnapshot, String> {
    let storage_path = recent_documents_path(&app)?;
    let snapshot = registry.initialize(documents, revision, Some(&storage_path))?;
    publish_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn merge_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, RecentDocumentsRegistry>,
    documents: Vec<RecentDocument>,
) -> Result<RecentDocumentsSnapshot, String> {
    let storage_path = recent_documents_path(&app)?;
    let snapshot = registry.merge(documents, Some(&storage_path))?;
    publish_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn prune_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, RecentDocumentsRegistry>,
    checked_documents: Vec<RecentDocumentCheck>,
    existing_paths: Vec<String>,
) -> Result<RecentDocumentsSnapshot, String> {
    let storage_path = recent_documents_path(&app)?;
    let snapshot = registry.prune(checked_documents, existing_paths, Some(&storage_path))?;
    publish_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn clear_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, RecentDocumentsRegistry>,
) -> Result<RecentDocumentsSnapshot, String> {
    let storage_path = recent_documents_path(&app)?;
    let snapshot = registry.clear(Some(&storage_path))?;
    publish_snapshot(&app, &snapshot);
    Ok(snapshot)
}

fn recent_documents_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(RECENT_DOCUMENTS_FILE))
        .map_err(|error| error.to_string())
}

fn publish_snapshot<R: Runtime>(app: &AppHandle<R>, snapshot: &RecentDocumentsSnapshot) {
    let _ = app.emit(RECENT_DOCUMENTS_CHANGED_EVENT, snapshot);
}

fn validate_documents(documents: &[RecentDocument]) -> Result<(), String> {
    if documents.len() > MAX_RECENT_DOCUMENTS {
        return Err(format!(
            "documents cannot contain more than {MAX_RECENT_DOCUMENTS} entries"
        ));
    }
    for document in documents {
        validate_path("document path", &document.path)?;
        validate_nonempty_bounded("document title", &document.title, MAX_TITLE_CHARS)?;
        validate_nonempty_bounded(
            "document extension",
            &document.extension,
            MAX_EXTENSION_CHARS,
        )?;
        validate_nonempty_bounded("document renderer", &document.renderer, MAX_RENDERER_CHARS)?;
    }
    Ok(())
}

fn validate_paths(label: &str, paths: &[String]) -> Result<(), String> {
    if paths.len() > MAX_RECENT_DOCUMENTS {
        return Err(format!(
            "{label} cannot contain more than {MAX_RECENT_DOCUMENTS} entries"
        ));
    }
    for path in paths {
        validate_path(label, path)?;
    }
    Ok(())
}

fn validate_document_checks(documents: &[RecentDocumentCheck]) -> Result<(), String> {
    if documents.len() > MAX_RECENT_DOCUMENTS {
        return Err(format!(
            "checkedDocuments cannot contain more than {MAX_RECENT_DOCUMENTS} entries"
        ));
    }
    for document in documents {
        validate_path("checked document path", &document.path)?;
    }
    Ok(())
}

fn validate_path(label: &str, value: &str) -> Result<(), String> {
    if value.chars().count() > MAX_PATH_CHARS {
        return Err(format!("{label} cannot exceed {MAX_PATH_CHARS} characters"));
    }
    if value.contains('\0') || !Path::new(value).is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    Ok(())
}

fn validate_nonempty_bounded(label: &str, value: &str, max_chars: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} cannot exceed {max_chars} characters"));
    }
    Ok(())
}

fn merge_documents(
    current: &[RecentDocument],
    incoming: Vec<RecentDocument>,
) -> Vec<RecentDocument> {
    let mut by_path: HashMap<String, RecentDocument> = current
        .iter()
        .cloned()
        .map(|document| (document.path.clone(), document))
        .collect();
    for document in incoming {
        let should_replace = by_path
            .get(&document.path)
            .map(|existing| existing.opened_at <= document.opened_at)
            .unwrap_or(true);
        if should_replace {
            by_path.insert(document.path.clone(), document);
        }
    }

    let mut documents: Vec<_> = by_path.into_values().collect();
    documents.sort_by(|left, right| {
        right
            .opened_at
            .cmp(&left.opened_at)
            .then_with(|| left.path.cmp(&right.path))
    });
    documents.truncate(MAX_RECENT_DOCUMENTS);
    documents
}

fn advance_revision(state: &mut RecentDocumentsState) {
    state.revision = state.revision.saturating_add(1);
}

fn snapshot(state: &RecentDocumentsState) -> RecentDocumentsSnapshot {
    RecentDocumentsSnapshot {
        revision: state.revision,
        documents: state.documents.clone(),
    }
}

fn load_persisted_state(
    state: &mut RecentDocumentsState,
    storage_path: Option<&Path>,
) -> Result<(), String> {
    if state.loaded_from_disk {
        return Ok(());
    }
    let Some(path) = storage_path else {
        state.loaded_from_disk = true;
        return Ok(());
    };
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_PERSISTED_BYTES => metadata,
        Ok(_) => {
            state.loaded_from_disk = true;
            return Ok(());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            state.loaded_from_disk = true;
            return Ok(());
        }
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_PERSISTED_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    if bytes.len() as u64 > MAX_PERSISTED_BYTES {
        state.loaded_from_disk = true;
        return Ok(());
    }
    let Ok(persisted) = serde_json::from_slice::<RecentDocumentsSnapshot>(&bytes) else {
        state.loaded_from_disk = true;
        return Ok(());
    };
    if validate_documents(&persisted.documents).is_err() {
        state.loaded_from_disk = true;
        return Ok(());
    }
    state.revision = state.revision.max(persisted.revision);
    state.documents = merge_documents(&state.documents, persisted.documents);
    state.accepts_startup_snapshots = false;
    state.loaded_from_disk = true;
    Ok(())
}

fn persist_state(
    state: &RecentDocumentsState,
    storage_path: Option<&Path>,
) -> Result<RecentDocumentsSnapshot, String> {
    let current = snapshot(state);
    if let Some(path) = storage_path {
        persist_snapshot(path, &current)?;
    }
    Ok(current)
}

fn persist_snapshot(path: &Path, snapshot: &RecentDocumentsSnapshot) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("{}: {error}", parent.display()))?;
    let serialized = serde_json::to_vec(snapshot).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(
        ".{RECENT_DOCUMENTS_FILE}.{}.{}.tmp",
        std::process::id(),
        nonce
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("{}: {error}", temporary_path.display()))?;
        file.write_all(&serialized)
            .map_err(|error| format!("{}: {error}", temporary_path.display()))?;
        file.sync_all()
            .map_err(|error| format!("{}: {error}", temporary_path.display()))?;
        fs::rename(&temporary_path, path).map_err(|error| format!("{}: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn document(path: &str, opened_at: u64) -> RecentDocument {
        RecentDocument {
            path: path.to_string(),
            title: path.rsplit('/').next().unwrap_or(path).to_string(),
            extension: "sdf".to_string(),
            renderer: "grid2d".to_string(),
            byte_count: 42,
            opened_at,
        }
    }

    fn checked(path: &str, opened_at: u64) -> RecentDocumentCheck {
        RecentDocumentCheck {
            path: path.to_string(),
            opened_at,
        }
    }

    fn paths(snapshot: &RecentDocumentsSnapshot) -> Vec<&str> {
        snapshot
            .documents
            .iter()
            .map(|document| document.path.as_str())
            .collect()
    }

    #[test]
    fn startup_snapshots_merge_until_the_first_mutation() {
        let registry = RecentDocumentsRegistry::default();
        let first = registry
            .initialize(vec![document("/tmp/window-a.sdf", 10)], 40, None)
            .expect("first startup snapshot should initialize");
        let second = registry
            .initialize(vec![document("/tmp/window-b.sdf", 20)], 40, None)
            .expect("second startup snapshot should merge");

        assert!(second.revision > first.revision);
        assert_eq!(
            paths(&second),
            vec!["/tmp/window-b.sdf", "/tmp/window-a.sdf"]
        );

        let cleared = registry.clear(None).expect("clear should succeed");
        let stale = registry
            .initialize(vec![document("/tmp/window-a.sdf", 10)], 40, None)
            .expect("late startup snapshot should be ignored");
        assert_eq!(stale, cleared);
    }

    #[test]
    fn interleaved_window_merges_preserve_both_documents() {
        let registry = Arc::new(RecentDocumentsRegistry::default());
        registry
            .initialize(Vec::new(), 0, None)
            .expect("registry should initialize");
        let barrier = Arc::new(Barrier::new(3));

        let merge_from = |path: &'static str,
                          opened_at,
                          registry: Arc<RecentDocumentsRegistry>,
                          barrier: Arc<Barrier>| {
            thread::spawn(move || {
                barrier.wait();
                registry
                    .merge(vec![document(path, opened_at)], None)
                    .expect("window merge should succeed")
            })
        };
        let window_a = merge_from(
            "/tmp/window-a.sdf",
            10,
            Arc::clone(&registry),
            Arc::clone(&barrier),
        );
        let window_b = merge_from(
            "/tmp/window-b.sdf",
            20,
            Arc::clone(&registry),
            Arc::clone(&barrier),
        );
        barrier.wait();

        let result_a = window_a.join().expect("window A thread should finish");
        let result_b = window_b.join().expect("window B thread should finish");
        assert_ne!(result_a.revision, result_b.revision);

        let current = snapshot(&registry.lock().expect("registry should remain readable"));
        assert_eq!(
            paths(&current),
            vec!["/tmp/window-b.sdf", "/tmp/window-a.sdf"]
        );
    }

    #[test]
    fn stale_prune_preserves_a_later_unchecked_document() {
        let registry = RecentDocumentsRegistry::default();
        registry
            .initialize(vec![document("/tmp/old.sdf", 10)], 0, None)
            .expect("registry should initialize");

        registry
            .merge(vec![document("/tmp/later.sdf", 20)], None)
            .expect("later window merge should succeed");
        let pruned = registry
            .prune(vec![checked("/tmp/old.sdf", 10)], Vec::new(), None)
            .expect("stale prune should succeed");

        assert_eq!(paths(&pruned), vec!["/tmp/later.sdf"]);
    }

    #[test]
    fn stale_prune_preserves_a_reopened_checked_path() {
        let registry = RecentDocumentsRegistry::default();
        registry
            .initialize(vec![document("/tmp/reopened.sdf", 10)], 0, None)
            .expect("registry should initialize");

        registry
            .merge(vec![document("/tmp/reopened.sdf", 20)], None)
            .expect("path should be reopened");
        let pruned = registry
            .prune(vec![checked("/tmp/reopened.sdf", 10)], Vec::new(), None)
            .expect("stale prune should succeed");

        assert_eq!(paths(&pruned), vec!["/tmp/reopened.sdf"]);
        assert_eq!(pruned.documents[0].opened_at, 20);
    }

    #[test]
    fn persisted_snapshot_restores_after_registry_restart() {
        let runtime_dir = std::env::temp_dir().join(format!(
            "burrete-recent-documents-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let storage_path = runtime_dir.join(RECENT_DOCUMENTS_FILE);
        let registry = RecentDocumentsRegistry::default();
        let persisted = registry
            .merge(
                vec![document("/tmp/persisted.sdf", 30)],
                Some(&storage_path),
            )
            .expect("recent document should persist");

        let restored = RecentDocumentsRegistry::default()
            .initialize(Vec::new(), 0, Some(&storage_path))
            .expect("persisted snapshot should restore");

        assert_eq!(restored.revision, persisted.revision);
        assert_eq!(paths(&restored), vec!["/tmp/persisted.sdf"]);
        let _ = fs::remove_dir_all(runtime_dir);
    }

    #[test]
    fn persisted_clear_rejects_a_stale_startup_snapshot() {
        let runtime_dir = std::env::temp_dir().join(format!(
            "burrete-recent-clear-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let storage_path = runtime_dir.join(RECENT_DOCUMENTS_FILE);
        let stale_document = document("/tmp/stale-after-clear.sdf", 10);
        let registry = RecentDocumentsRegistry::default();
        registry
            .merge(vec![stale_document.clone()], Some(&storage_path))
            .expect("recent document should persist");
        let cleared = registry
            .clear(Some(&storage_path))
            .expect("cleared state should persist");

        let restored = RecentDocumentsRegistry::default()
            .initialize(
                vec![stale_document],
                cleared.revision - 1,
                Some(&storage_path),
            )
            .expect("stale browser snapshot should be ignored");

        assert_eq!(restored, cleared);
        let _ = fs::remove_dir_all(runtime_dir);
    }

    #[test]
    fn validation_rejects_relative_paths_and_unbounded_payloads() {
        let registry = RecentDocumentsRegistry::default();
        assert!(registry
            .merge(vec![document("relative.sdf", 10)], None)
            .expect_err("relative path should fail")
            .contains("absolute path"));

        let too_many = (0..=MAX_RECENT_DOCUMENTS)
            .map(|index| document(&format!("/tmp/{index}.sdf"), index as u64))
            .collect();
        assert!(registry
            .merge(too_many, None)
            .expect_err("unbounded input should fail")
            .contains("more than 100"));
    }
}
