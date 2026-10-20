use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};

type UpdateResult = Result<RecentDocumentsSnapshot, String>;
struct UpdateJob {
    run: Box<dyn FnOnce() -> UpdateResult + Send>,
    response: tauri::async_runtime::Sender<UpdateResult>,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all_fields = "camelCase")]
enum RecentUpdate {
    #[serde(rename = "initialize_recent_documents")]
    Initialize {
        documents: Vec<RecentDocument>,
        revision: u64,
    },
    #[serde(rename = "merge_recent_documents")]
    Merge { documents: Vec<RecentDocument> },
    #[serde(rename = "prune_recent_documents")]
    Prune {
        checked_documents: Vec<RecentDocumentCheck>,
        existing_paths: Vec<String>,
    },
    #[serde(rename = "clear_recent_documents")]
    Clear,
}

impl RecentUpdate {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Initialize { documents, .. } | Self::Merge { documents } => {
                validate_documents(documents)
            }
            Self::Prune {
                checked_documents,
                existing_paths,
            } => {
                validate_document_checks(checked_documents)?;
                validate_paths("existingPaths", existing_paths)
            }
            Self::Clear => Ok(()),
        }
    }

    fn apply(self, registry: &RecentDocumentsRegistry, path: &Path) -> UpdateResult {
        match self {
            Self::Initialize {
                documents,
                revision,
            } => registry.initialize(documents, revision, Some(path)),
            Self::Merge { documents } => registry.merge(documents, Some(path)),
            Self::Prune {
                checked_documents,
                existing_paths,
            } => registry.prune(checked_documents, existing_paths, Some(path)),
            Self::Clear => registry.clear(Some(path)),
        }
    }
}

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
    updates: OnceLock<tauri::async_runtime::Sender<UpdateJob>>,
    sealed: Arc<Mutex<bool>>,
}

pub(crate) struct RecentUpdatesPause {
    sealed: Arc<Mutex<bool>>,
    keep_paused: bool,
}

impl RecentUpdatesPause {
    pub(crate) fn keep_paused(mut self) {
        self.keep_paused = true;
    }
}

impl Drop for RecentUpdatesPause {
    fn drop(&mut self) {
        if !self.keep_paused {
            if let Ok(mut sealed) = self.sealed.lock() {
                *sealed = false;
            }
        }
    }
}

impl RecentDocumentsRegistry {
    fn enqueue(
        &self,
        run: impl FnOnce() -> UpdateResult + Send + 'static,
    ) -> Result<tauri::async_runtime::Receiver<UpdateResult>, String> {
        // This short coordination lock never covers disk work or queue waits.
        // Sealing and admission must be atomic relative to the quit barrier.
        let sealed = self.sealed.lock().map_err(|error| error.to_string())?;
        if *sealed {
            return Err("Recent documents are paused while the app is closing".into());
        }
        let updates = self.updates.get_or_init(|| {
            let (sender, mut receiver) = tauri::async_runtime::channel::<UpdateJob>(64);
            tauri::async_runtime::spawn(async move {
                while let Some(job) = receiver.recv().await {
                    let result = tauri::async_runtime::spawn_blocking(job.run)
                        .await
                        .map_err(|error| format!("Recent documents worker failed: {error}"))
                        .and_then(|result| result);
                    // Sending one result never waits for its future to be polled.
                    // Canceling that future must not cancel an accepted mutation.
                    let _ = job.response.send(result).await;
                }
            });
            sender
        });
        let (response, receiver) = tauri::async_runtime::channel(1);
        updates
            .try_send(UpdateJob {
                run: Box::new(run),
                response,
            })
            .map_err(|_| "Recent documents update queue is full or unavailable".to_string())?;
        Ok(receiver)
    }

    fn pause_updates(&self) -> Result<RecentUpdatesPause, String> {
        let mut sealed = self.sealed.lock().map_err(|error| error.to_string())?;
        if *sealed {
            return Err("Recent documents are already paused for exit".into());
        }
        *sealed = true;
        Ok(RecentUpdatesPause {
            sealed: Arc::clone(&self.sealed),
            keep_paused: false,
        })
    }

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
pub(crate) async fn initialize_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    documents: Vec<RecentDocument>,
    revision: u64,
) -> Result<RecentDocumentsSnapshot, String> {
    update_recent_documents(
        app,
        RecentUpdate::Initialize {
            documents,
            revision,
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn merge_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    documents: Vec<RecentDocument>,
) -> Result<RecentDocumentsSnapshot, String> {
    update_recent_documents(app, RecentUpdate::Merge { documents }).await
}

#[tauri::command]
pub(crate) async fn prune_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    checked_documents: Vec<RecentDocumentCheck>,
    existing_paths: Vec<String>,
) -> Result<RecentDocumentsSnapshot, String> {
    update_recent_documents(
        app,
        RecentUpdate::Prune {
            checked_documents,
            existing_paths,
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn clear_recent_documents<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RecentDocumentsSnapshot, String> {
    update_recent_documents(app, RecentUpdate::Clear).await
}

fn enqueue_recent_update<R: Runtime>(
    app: AppHandle<R>,
    update: RecentUpdate,
) -> Result<tauri::async_runtime::Receiver<UpdateResult>, String> {
    update.validate()?;
    let worker_app = app.clone();
    let registry = app.state::<RecentDocumentsRegistry>();
    registry.enqueue(move || {
        let storage_path = recent_documents_path(&worker_app)?;
        let snapshot = update.apply(
            &worker_app.state::<RecentDocumentsRegistry>(),
            &storage_path,
        )?;
        publish_snapshot(&worker_app, &snapshot);
        Ok(snapshot)
    })
}

async fn update_recent_documents<R: Runtime>(
    app: AppHandle<R>,
    update: RecentUpdate,
) -> UpdateResult {
    enqueue_recent_update(app, update)?
        .recv()
        .await
        .ok_or_else(|| "Recent documents worker stopped".to_string())?
}

/// Seal dispatch and flush every accepted mutation before authorizing exit.
/// Dropping the pause reopens admission when a quit/restart is canceled.
pub(crate) async fn pause_and_drain<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<RecentUpdatesPause, String> {
    let registry = app.state::<RecentDocumentsRegistry>();
    let pause = registry.pause_updates()?;
    let Some(updates) = registry.updates.get().cloned() else {
        return Ok(pause);
    };
    let worker_app = app.clone();
    let (response, mut receiver) = tauri::async_runtime::channel(1);
    // A full queue delays this barrier asynchronously, never the AppKit thread.
    updates
        .send(UpdateJob {
            run: Box::new(move || {
                let registry = worker_app.state::<RecentDocumentsRegistry>();
                let path = recent_documents_path(&worker_app)?;
                let mut state = registry.lock()?;
                load_persisted_state(&mut state, Some(&path))?;
                persist_state(&state, Some(&path))
            }),
            response,
        })
        .await
        .map_err(|_| "Recent documents worker stopped before exit".to_string())?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Recent documents worker stopped before exit".to_string())??;
    Ok(pause)
}

/// Tauri polls async command bodies on spawned tasks. Reserve mutation order at
/// synchronous IPC dispatch, before those tasks (or their response futures) run.
/// The Webview dispatcher has already checked ACL before invoking this wrapper.
pub(crate) fn ordered<R, F>(
    handler: F,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        let command = invoke.message.command();
        if !matches!(
            command,
            "initialize_recent_documents"
                | "merge_recent_documents"
                | "prune_recent_documents"
                | "clear_recent_documents"
        ) {
            return handler(invoke);
        }
        let response = (|| {
            let tauri::ipc::InvokeBody::Json(serde_json::Value::Object(payload)) =
                invoke.message.payload()
            else {
                return Err("Recent documents arguments must be a JSON object".to_string());
            };
            let mut payload = payload.clone();
            payload.insert("operation".into(), command.into());
            let update = serde_json::from_value(serde_json::Value::Object(payload))
                .map_err(|error| format!("Invalid recent documents arguments: {error}"))?;
            enqueue_recent_update(invoke.message.webview_ref().app_handle().clone(), update)
        })();
        match response {
            Ok(mut response) => invoke.resolver.respond_async(async move {
                response
                    .recv()
                    .await
                    .ok_or_else(|| {
                        tauri::ipc::InvokeError::from("Recent documents worker stopped")
                    })?
                    .map_err(tauri::ipc::InvokeError::from)
            }),
            Err(error) => invoke.resolver.reject(error),
        }
        true
    }
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

    fn mock_recent_app() -> tauri::App<tauri::test::MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = format!(
            "com.local.BuretteRecentQueueTest.{}",
            uuid::Uuid::new_v4().simple()
        );
        tauri::test::mock_builder()
            .manage(RecentDocumentsRegistry::default())
            .invoke_handler(ordered(|_| false))
            .build(context)
            .unwrap()
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
    fn concurrent_persisted_merges_keep_disk_at_the_latest_revision() {
        let directory = std::env::temp_dir().join(format!(
            "burette-recent-concurrent-{}",
            uuid::Uuid::new_v4()
        ));
        let storage_path = directory.join(RECENT_DOCUMENTS_FILE);
        let registry = Arc::new(RecentDocumentsRegistry::default());
        let barrier = Arc::new(Barrier::new(3));
        let workers: Vec<_> = ["/tmp/window-a.sdf", "/tmp/window-b.sdf"]
            .into_iter()
            .enumerate()
            .map(|(index, path)| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                let storage_path = storage_path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    registry
                        .merge(vec![document(path, index as u64)], Some(&storage_path))
                        .unwrap()
                })
            })
            .collect();
        barrier.wait();
        let revisions: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap().revision)
            .collect();
        assert_ne!(revisions[0], revisions[1]);
        let expected = snapshot(&registry.lock().unwrap());
        let restored = RecentDocumentsRegistry::default()
            .initialize(Vec::new(), 0, Some(&storage_path))
            .unwrap();
        assert_eq!(restored, expected);
        assert_eq!(paths(&restored), ["/tmp/window-b.sdf", "/tmp/window-a.sdf"]);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn dispatch_order_survives_reversed_response_polls_and_cancelled_merge_response() {
        use std::future::Future;
        use std::sync::mpsc;
        use std::task::{Context, Waker};
        use std::time::Duration;

        let directory =
            std::env::temp_dir().join(format!("burette-recent-queue-{}", uuid::Uuid::new_v4()));
        let storage_path = directory.join(RECENT_DOCUMENTS_FILE);
        let registry = Arc::new(RecentDocumentsRegistry::default());
        let (started, worker_started) = mpsc::channel();
        let (release, worker_release) = mpsc::channel();

        // These are synchronous dispatch admissions, not async command bodies.
        let merge_registry = Arc::clone(&registry);
        let merge_path = storage_path.clone();
        let merge_response = registry
            .enqueue(move || {
                started.send(()).unwrap();
                worker_release.recv_timeout(Duration::from_secs(5)).unwrap();
                merge_registry.merge(
                    vec![document("/tmp/older-merge.sdf", 10)],
                    Some(&merge_path),
                )
            })
            .unwrap();
        worker_started.recv_timeout(Duration::from_secs(5)).unwrap();
        let clear_registry = Arc::clone(&registry);
        let clear_path = storage_path.clone();
        let mut clear_response = registry
            .enqueue(move || clear_registry.clear(Some(&clear_path)))
            .unwrap();
        let initialize_registry = Arc::clone(&registry);
        let initialize_path = storage_path.clone();
        let mut initialize_response = registry
            .enqueue(move || {
                initialize_registry.initialize(
                    vec![document("/tmp/stale-startup.sdf", 1)],
                    90,
                    Some(&initialize_path),
                )
            })
            .unwrap();

        tauri::async_runtime::block_on(async {
            // Deliberately first-poll responses in reverse dispatch order.
            // None of these polls schedules or reorders its accepted mutation.
            let mut initialize = Box::pin(initialize_response.recv());
            let mut clear = Box::pin(clear_response.recv());
            let mut context = Context::from_waker(Waker::noop());
            assert!(initialize.as_mut().poll(&mut context).is_pending());
            assert!(clear.as_mut().poll(&mut context).is_pending());
            drop(merge_response);
            release.send(()).unwrap();
            let initialized = initialize.await.unwrap().unwrap();
            let cleared = clear.await.unwrap().unwrap();
            assert_eq!(initialized, cleared);
            assert_eq!((cleared.revision, &cleared.documents), (2, &Vec::new()));
            let restored = RecentDocumentsRegistry::default()
                .initialize(Vec::new(), 0, Some(&storage_path))
                .unwrap();
            assert_eq!(restored, cleared);
        });
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn ordered_ipc_wrapper_parses_camel_case_and_preserves_dispatch_order() {
        use std::sync::mpsc;
        use std::time::Duration;

        let app = mock_recent_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let webview: &tauri::Webview<tauri::test::MockRuntime> = window.as_ref();
        let storage_path = recent_documents_path(app.handle()).unwrap();
        let (release, blocked) = mpsc::channel();
        let blocker = app
            .state::<RecentDocumentsRegistry>()
            .enqueue(move || {
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(RecentDocumentsSnapshot {
                    revision: 0,
                    documents: Vec::new(),
                })
            })
            .unwrap();
        let (responses, received) = mpsc::channel();
        for (command, body) in [
            (
                "initialize_recent_documents",
                serde_json::json!({"documents": [], "revision": 20}),
            ),
            (
                "merge_recent_documents",
                serde_json::json!({"documents": [{
                    "path": "/tmp/queued-source.sdf", "title": "queued-source.sdf", "extension": "sdf",
                    "renderer": "grid2d", "byteCount": 42, "openedAt": 30
                }]}),
            ),
            (
                "prune_recent_documents",
                serde_json::json!({
                    "checkedDocuments": [{"path": "/tmp/queued-source.sdf", "openedAt": 30}],
                    "existingPaths": ["/tmp/queued-source.sdf"]
                }),
            ),
            ("clear_recent_documents", serde_json::json!({})),
        ] {
            let responses = responses.clone();
            webview.clone().on_message(
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: body.into(),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
                Box::new(move |_, _, response, _, _| {
                    responses.send((command, response)).unwrap();
                }),
            );
        }
        drop(blocker);
        release.send(()).unwrap();
        let mut snapshots = HashMap::new();
        for _ in 0..4 {
            let (command, response) = received.recv_timeout(Duration::from_secs(5)).unwrap();
            let tauri::ipc::InvokeResponse::Ok(response) = response else {
                panic!("Recent documents IPC failed")
            };
            snapshots.insert(
                command,
                response.deserialize::<RecentDocumentsSnapshot>().unwrap(),
            );
        }
        assert_eq!(snapshots["initialize_recent_documents"].revision, 21);
        assert_eq!(
            paths(&snapshots["merge_recent_documents"]),
            ["/tmp/queued-source.sdf"]
        );
        assert_eq!(
            paths(&snapshots["prune_recent_documents"]),
            ["/tmp/queued-source.sdf"]
        );
        let cleared = &snapshots["clear_recent_documents"];
        assert_eq!((cleared.revision, &cleared.documents), (24, &Vec::new()));
        assert_eq!(
            RecentDocumentsRegistry::default()
                .initialize(Vec::new(), 0, Some(&storage_path))
                .unwrap(),
            *cleared
        );
        let _ = fs::remove_dir_all(storage_path.parent().unwrap());
    }

    #[test]
    fn quit_drain_waits_for_accepted_updates_and_reopens_after_cancel() {
        use std::future::Future;
        use std::sync::mpsc;
        use std::task::{Context, Waker};
        use std::time::Duration;

        let app = mock_recent_app();
        let path = recent_documents_path(app.handle()).unwrap();
        let previous = RecentDocumentsSnapshot {
            revision: 7,
            documents: vec![document("/tmp/previous.sdf", 1)],
        };
        persist_snapshot(&path, &previous).unwrap();
        tauri::async_runtime::block_on(async {
            // Quitting before startup initialization must not overwrite history.
            drop(pause_and_drain(app.handle()).await.unwrap());
            assert_eq!(
                serde_json::from_slice::<RecentDocumentsSnapshot>(&fs::read(&path).unwrap())
                    .unwrap(),
                previous
            );
            let (release, blocked) = mpsc::channel();
            let worker_app = app.handle().clone();
            let worker_path = path.clone();
            let accepted = app
                .state::<RecentDocumentsRegistry>()
                .enqueue(move || {
                    blocked.recv_timeout(Duration::from_secs(5)).unwrap();
                    worker_app
                        .state::<RecentDocumentsRegistry>()
                        .merge(vec![document("/tmp/accepted.sdf", 2)], Some(&worker_path))
                })
                .unwrap();
            let mut drain = Box::pin(pause_and_drain(app.handle()));
            assert!(drain
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
                .is_pending());
            assert!(enqueue_recent_update(app.handle().clone(), RecentUpdate::Clear).is_err());
            release.send(()).unwrap();
            let pause = drain.await.unwrap();
            drop(accepted);
            let persisted: RecentDocumentsSnapshot =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(
                paths(&persisted),
                ["/tmp/accepted.sdf", "/tmp/previous.sdf"]
            );
            drop(pause);
            assert!(
                update_recent_documents(app.handle().clone(), RecentUpdate::Clear)
                    .await
                    .unwrap()
                    .documents
                    .is_empty()
            );
        });
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_full_queue_rejects_clear_explicitly_and_allows_retry_after_drain() {
        use std::sync::mpsc;
        use std::time::Duration;

        let app = mock_recent_app();
        let (started, worker_started) = mpsc::channel();
        let (release, blocked) = mpsc::channel();
        let worker_app = app.handle().clone();
        let accepted = app
            .state::<RecentDocumentsRegistry>()
            .enqueue(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
                let path = recent_documents_path(&worker_app)?;
                worker_app
                    .state::<RecentDocumentsRegistry>()
                    .merge(vec![document("/tmp/accepted.sdf", 2)], Some(&path))
            })
            .unwrap();
        worker_started.recv_timeout(Duration::from_secs(5)).unwrap();
        let mut last = None;
        for _ in 0..64 {
            last = Some(
                app.state::<RecentDocumentsRegistry>()
                    .enqueue(|| {
                        Ok(RecentDocumentsSnapshot {
                            revision: 0,
                            documents: Vec::new(),
                        })
                    })
                    .unwrap(),
            );
        }
        assert!(
            enqueue_recent_update(app.handle().clone(), RecentUpdate::Clear)
                .unwrap_err()
                .contains("queue is full")
        );
        release.send(()).unwrap();
        tauri::async_runtime::block_on(async {
            last.unwrap().recv().await.unwrap().unwrap();
            drop(accepted);
            assert!(
                update_recent_documents(app.handle().clone(), RecentUpdate::Clear)
                    .await
                    .unwrap()
                    .documents
                    .is_empty()
            );
        });
        let path = recent_documents_path(app.handle()).unwrap();
        assert!(
            serde_json::from_slice::<RecentDocumentsSnapshot>(&fs::read(&path).unwrap())
                .unwrap()
                .documents
                .is_empty()
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
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
            "burette-recent-documents-{}-{}",
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
            "burette-recent-clear-{}-{}",
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
