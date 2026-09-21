use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{Runtime, State};

const MAXIMUM_SOURCE_BYTE_COUNT: usize = 3_000_000;
const LIVE_PREVIEW_BYTE_COUNT: usize = 1_000_000;
const EDITABLE_EXTENSIONS: &[&str] = &[
    "pdb", "ent", "pdbqt", "pqr", "xpdb", "cif", "mmcif", "mcif", "mol", "mol2", "sdf", "sd",
    "xyz", "gro",
];

#[derive(Debug, Clone)]
struct OpenedSource {
    owner_window_label: String,
    canonical_path: PathBuf,
    source_kind: String,
}

#[derive(Default)]
pub(crate) struct OpenedSourceRegistry {
    entries: Mutex<HashMap<(String, String), OpenedSource>>,
}

impl OpenedSourceRegistry {
    pub(crate) fn register(
        &self,
        document_id: String,
        owner_window_label: String,
        canonical_path: PathBuf,
        source_kind: &str,
    ) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| {
            source_error("source_read_failed", "The source registry is unavailable.")
        })?;
        entries.insert(
            (owner_window_label.clone(), document_id),
            OpenedSource {
                owner_window_label,
                canonical_path,
                source_kind: source_kind.to_string(),
            },
        );
        Ok(())
    }

    pub(crate) fn unregister_window(&self, window_label: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| {
            source_error("source_read_failed", "The source registry is unavailable.")
        })?;
        entries.retain(|(owner, _), _| owner != window_label);
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct PendingCommit {
    intended_content_hash: String,
    pending_stage: &'static str,
}

#[derive(Debug, Clone)]
struct EditSession {
    owner_window_label: String,
    canonical_path: PathBuf,
    document_id: String,
    session_id: String,
    base_revision: FileRevision,
    last_conflict_revision: Option<FileRevision>,
    pending_commit: Option<PendingCommit>,
}

#[derive(Default)]
pub(crate) struct SourceEditRegistry {
    entries: Mutex<HashMap<String, EditSession>>,
}

impl SourceEditRegistry {
    pub(crate) fn unregister_window(&self, window_label: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| {
            source_error(
                "source_handle_invalid",
                "The source edit registry is unavailable.",
            )
        })?;
        entries.retain(|_, session| session.owner_window_label != window_label);
        Ok(())
    }

    fn unregister_document(&self, window_label: &str, document_id: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| {
            source_error(
                "source_handle_invalid",
                "The source edit registry is unavailable.",
            )
        })?;
        entries.retain(|_, session| {
            session.owner_window_label != window_label || session.document_id != document_id
        });
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileRevision {
    modified_at: u64,
    byte_count: u64,
    content_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenSourceEditSessionRequest {
    document_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HandleRequest {
    handle_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReloadSourceEditSessionRequest {
    handle_id: String,
    inspected_revision: FileRevision,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSourceDocumentRequest {
    handle_id: String,
    content: String,
    expected_revision: FileRevision,
    overwrite_confirmed_revision: Option<FileRevision>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseOpenedSourceDocumentRequest {
    document_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceEditSessionResponse {
    handle_id: String,
    session_id: String,
    document_id: String,
    path: String,
    title: String,
    extension: String,
    language: String,
    encoding: &'static str,
    decode_lossy: bool,
    content: String,
    revision: FileRevision,
    preview_mode: &'static str,
    maximum_byte_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectSourceEditSessionResponse {
    status: &'static str,
    revision: FileRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSourceDocumentResponse {
    handle_id: String,
    path: String,
    revision: FileRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconcileSourceCommitResponse {
    status: &'static str,
    handle_id: String,
    revision: FileRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseSourceEditSessionResponse {
    handle_id: String,
    released: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseOpenedSourceDocumentResponse {
    document_id: String,
    released: bool,
}

#[tauri::command]
pub(crate) fn open_source_edit_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    opened_sources: State<'_, OpenedSourceRegistry>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: OpenSourceEditSessionRequest,
) -> Result<SourceEditSessionResponse, String> {
    let source = {
        let entries = opened_sources.entries.lock().map_err(|_| {
            source_error("source_read_failed", "The source registry is unavailable.")
        })?;
        entries
            .get(&(window.label().to_string(), request.document_id.clone()))
            .cloned()
    }
    .filter(|source| source.owner_window_label == window.label())
    .ok_or_else(|| {
        source_error(
            "source_document_not_open",
            "The source document is not open in this window.",
        )
    })?;
    if source.source_kind != "structure" {
        return Err(source_error_with_details(
            "source_not_editable",
            "This source is not a directly opened structure file.",
            json!({ "reason": "virtual_source" }),
        ));
    }

    let snapshot = read_editable_snapshot(&source.canonical_path)?;
    let handle_id = uuid::Uuid::new_v4().simple().to_string();
    let response = session_response(
        &handle_id,
        &request.session_id,
        &request.document_id,
        &source.canonical_path,
        snapshot.clone(),
    )?;
    let session = EditSession {
        owner_window_label: window.label().to_string(),
        canonical_path: source.canonical_path,
        document_id: request.document_id,
        session_id: request.session_id,
        base_revision: snapshot.revision,
        last_conflict_revision: None,
        pending_commit: None,
    };
    edit_sessions
        .entries
        .lock()
        .map_err(|_| {
            source_error(
                "source_handle_invalid",
                "The source edit registry is unavailable.",
            )
        })?
        .insert(handle_id, session);
    Ok(response)
}

#[tauri::command]
pub(crate) fn inspect_source_edit_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: HandleRequest,
) -> Result<InspectSourceEditSessionResponse, String> {
    let mut entries = edit_sessions.entries.lock().map_err(|_| {
        source_error(
            "source_handle_invalid",
            "The source edit registry is unavailable.",
        )
    })?;
    let session = session_for_window(&mut entries, &request.handle_id, window.label())?;
    let revision = file_revision(&session.canonical_path)?;
    let status = if revision == session.base_revision {
        "unchanged"
    } else {
        session.last_conflict_revision = Some(revision.clone());
        "changed"
    };
    Ok(InspectSourceEditSessionResponse { status, revision })
}

#[tauri::command]
pub(crate) fn reload_source_edit_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: ReloadSourceEditSessionRequest,
) -> Result<SourceEditSessionResponse, String> {
    let mut entries = edit_sessions.entries.lock().map_err(|_| {
        source_error(
            "source_handle_invalid",
            "The source edit registry is unavailable.",
        )
    })?;
    let session = session_for_window(&mut entries, &request.handle_id, window.label())?;
    let snapshot = read_editable_snapshot(&session.canonical_path)?;
    if snapshot.revision != request.inspected_revision {
        session.last_conflict_revision = Some(snapshot.revision.clone());
        return Err(conflict_error(&snapshot.revision));
    }
    session.base_revision = snapshot.revision.clone();
    session.last_conflict_revision = None;
    session_response(
        &request.handle_id,
        &session.session_id,
        &session.document_id,
        &session.canonical_path,
        snapshot,
    )
}

#[tauri::command]
pub(crate) fn save_source_document<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: SaveSourceDocumentRequest,
) -> Result<SaveSourceDocumentResponse, String> {
    if request.content.len() > MAXIMUM_SOURCE_BYTE_COUNT {
        return Err(source_error_with_details(
            "source_too_large",
            "The source draft is too large to save.",
            json!({
                "actualByteCount": request.content.len(),
                "maximumByteCount": MAXIMUM_SOURCE_BYTE_COUNT,
            }),
        ));
    }
    let mut entries = edit_sessions.entries.lock().map_err(|_| {
        source_error(
            "source_handle_invalid",
            "The source edit registry is unavailable.",
        )
    })?;
    let session = session_for_window(&mut entries, &request.handle_id, window.label())?;
    if let Some(pending) = &session.pending_commit {
        return Err(commit_uncertain_error(pending));
    }
    if request.expected_revision != session.base_revision {
        let actual_revision = file_revision(&session.canonical_path)?;
        session.last_conflict_revision = Some(actual_revision.clone());
        return Err(conflict_error(&actual_revision));
    }
    validate_source_text(&session.canonical_path, &request.content)?;
    let current_revision = file_revision(&session.canonical_path)?;
    let allowed = match &request.overwrite_confirmed_revision {
        None => current_revision == request.expected_revision,
        Some(confirmed) => {
            session.last_conflict_revision.as_ref() == Some(confirmed)
                && &current_revision == confirmed
        }
    };
    if !allowed {
        session.last_conflict_revision = Some(current_revision.clone());
        return Err(conflict_error(&current_revision));
    }

    let intended_content_hash = content_hash(request.content.as_bytes());
    match replace_source_atomically(
        &session.canonical_path,
        request.content.as_bytes(),
        &current_revision,
    ) {
        Ok(()) => {}
        Err(AtomicWriteError::BeforeCommit { stage, message }) => {
            return Err(source_error_with_details(
                "source_write_failed",
                &message,
                json!({ "stage": stage }),
            ));
        }
        Err(AtomicWriteError::AfterCommit { stage }) => {
            let pending = PendingCommit {
                intended_content_hash,
                pending_stage: stage,
            };
            let error = commit_uncertain_error(&pending);
            session.pending_commit = Some(pending);
            return Err(error);
        }
        Err(AtomicWriteError::Conflict(revision)) => {
            session.last_conflict_revision = Some(revision.clone());
            return Err(conflict_error(&revision));
        }
    }
    let revision = match file_revision(&session.canonical_path) {
        Ok(revision) => revision,
        Err(_) => {
            let pending = PendingCommit {
                intended_content_hash,
                pending_stage: "final_revision",
            };
            let error = commit_uncertain_error(&pending);
            session.pending_commit = Some(pending);
            return Err(error);
        }
    };
    session.base_revision = revision.clone();
    session.last_conflict_revision = None;
    Ok(SaveSourceDocumentResponse {
        handle_id: request.handle_id,
        path: session.canonical_path.to_string_lossy().to_string(),
        revision,
    })
}

#[tauri::command]
pub(crate) fn reconcile_source_commit<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: HandleRequest,
) -> Result<ReconcileSourceCommitResponse, String> {
    let mut entries = edit_sessions.entries.lock().map_err(|_| {
        source_error(
            "source_handle_invalid",
            "The source edit registry is unavailable.",
        )
    })?;
    let session = session_for_window(&mut entries, &request.handle_id, window.label())?;
    let pending = session.pending_commit.clone().ok_or_else(|| {
        source_error(
            "source_handle_invalid",
            "The source edit session has no pending commit.",
        )
    })?;
    if pending.pending_stage == "parent_flush" {
        sync_parent_directory(&session.canonical_path)
            .map_err(|_| commit_uncertain_error(&pending))?;
    }
    let revision =
        file_revision(&session.canonical_path).map_err(|_| commit_uncertain_error(&pending))?;
    if revision.content_hash != pending.intended_content_hash {
        session.pending_commit = None;
        session.last_conflict_revision = Some(revision.clone());
        return Err(conflict_error(&revision));
    }
    session.pending_commit = None;
    session.last_conflict_revision = None;
    session.base_revision = revision.clone();
    Ok(ReconcileSourceCommitResponse {
        status: "committed",
        handle_id: request.handle_id,
        revision,
    })
}

#[tauri::command]
pub(crate) fn close_source_edit_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: HandleRequest,
) -> Result<CloseSourceEditSessionResponse, String> {
    let mut entries = edit_sessions.entries.lock().map_err(|_| {
        source_error(
            "source_handle_invalid",
            "The source edit registry is unavailable.",
        )
    })?;
    let session = entries
        .get(&request.handle_id)
        .ok_or_else(invalid_handle_error)?;
    if session.owner_window_label != window.label() {
        return Err(invalid_handle_error());
    }
    if let Some(pending) = &session.pending_commit {
        return Err(commit_uncertain_error(pending));
    }
    entries.remove(&request.handle_id);
    Ok(CloseSourceEditSessionResponse {
        handle_id: request.handle_id,
        released: true,
    })
}

#[tauri::command]
pub(crate) fn close_opened_source_document<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    opened_sources: State<'_, OpenedSourceRegistry>,
    edit_sessions: State<'_, SourceEditRegistry>,
    request: CloseOpenedSourceDocumentRequest,
) -> Result<CloseOpenedSourceDocumentResponse, String> {
    {
        let mut entries = opened_sources.entries.lock().map_err(|_| {
            source_error("source_read_failed", "The source registry is unavailable.")
        })?;
        let key = (window.label().to_string(), request.document_id.clone());
        let is_owned = entries.contains_key(&key);
        if !is_owned {
            return Err(source_error(
                "source_document_not_open",
                "The source document is not open in this window.",
            ));
        }
        entries.remove(&key);
    }
    edit_sessions.unregister_document(window.label(), &request.document_id)?;
    Ok(CloseOpenedSourceDocumentResponse {
        document_id: request.document_id,
        released: true,
    })
}

fn session_for_window<'a>(
    entries: &'a mut HashMap<String, EditSession>,
    handle_id: &str,
    window_label: &str,
) -> Result<&'a mut EditSession, String> {
    let session = entries
        .get_mut(handle_id)
        .ok_or_else(invalid_handle_error)?;
    if session.owner_window_label != window_label {
        return Err(invalid_handle_error());
    }
    Ok(session)
}

fn invalid_handle_error() -> String {
    source_error(
        "source_handle_invalid",
        "The source edit handle is invalid or expired.",
    )
}

#[derive(Clone)]
struct SourceSnapshot {
    content: String,
    revision: FileRevision,
}

fn read_editable_snapshot(path: &Path) -> Result<SourceSnapshot, String> {
    let metadata = fs::metadata(path).map_err(map_read_error)?;
    if !metadata.is_file() {
        return Err(source_error(
            "source_missing",
            "The source file is missing.",
        ));
    }
    if metadata.len() > MAXIMUM_SOURCE_BYTE_COUNT as u64 {
        return Err(source_error_with_details(
            "source_not_editable",
            "The source file is too large to edit.",
            json!({ "reason": "too_large" }),
        ));
    }
    let bytes = fs::read(path).map_err(map_read_error)?;
    let content = String::from_utf8(bytes).map_err(|_| {
        source_error_with_details(
            "source_not_editable",
            "The source file is not lossless UTF-8.",
            json!({ "reason": "lossy_encoding" }),
        )
    })?;
    validate_source_text(path, &content)?;
    let revision = revision_for_bytes(path, content.as_bytes())?;
    Ok(SourceSnapshot { content, revision })
}

fn validate_source_text(path: &Path, content: &str) -> Result<(), String> {
    let extension = source_extension(path);
    if !EDITABLE_EXTENSIONS.contains(&extension.as_str()) {
        let reason = if matches!(extension.as_str(), "gz" | "maegz") {
            "compressed_source"
        } else {
            "unsupported_format"
        };
        return Err(source_error_with_details(
            "source_not_editable",
            "This source format is not editable.",
            json!({ "reason": reason }),
        ));
    }
    let unsupported_shape = match extension.as_str() {
        "pdb" | "ent" | "pdbqt" | "pqr" | "xpdb" => {
            content
                .lines()
                .filter(|line| line.trim_start().starts_with("MODEL"))
                .take(2)
                .count()
                > 1
        }
        "sdf" | "sd" => {
            content
                .split("$$$$")
                .filter(|record| !record.trim().is_empty())
                .take(2)
                .count()
                > 1
        }
        "cif" | "mmcif" | "mcif" => {
            content
                .lines()
                .filter(|line| line.trim_start().starts_with("data_"))
                .take(2)
                .count()
                > 1
        }
        "xyz" => xyz_has_multiple_frames(content),
        "gro" => gro_has_multiple_frames(content),
        _ => false,
    };
    if unsupported_shape {
        return Err(source_error_with_details(
            "source_not_editable",
            "This source contains multiple structures or frames.",
            json!({ "reason": "unsupported_shape" }),
        ));
    }
    Ok(())
}

fn xyz_has_multiple_frames(content: &str) -> bool {
    let mut lines = content.lines();
    let Some(atom_count) = lines
        .next()
        .and_then(|line| line.trim().parse::<usize>().ok())
    else {
        return false;
    };
    let _ = lines.next();
    for _ in 0..atom_count {
        if lines.next().is_none() {
            return false;
        }
    }
    lines.any(|line| !line.trim().is_empty())
}

fn gro_has_multiple_frames(content: &str) -> bool {
    let mut lines = content.lines();
    let _ = lines.next();
    let Some(atom_count) = lines
        .next()
        .and_then(|line| line.trim().parse::<usize>().ok())
    else {
        return false;
    };
    for _ in 0..=atom_count {
        if lines.next().is_none() {
            return false;
        }
    }
    lines.any(|line| !line.trim().is_empty())
}

fn session_response(
    handle_id: &str,
    session_id: &str,
    document_id: &str,
    path: &Path,
    snapshot: SourceSnapshot,
) -> Result<SourceEditSessionResponse, String> {
    let extension = source_extension(path);
    let title = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure")
        .to_string();
    let preview_mode = if snapshot.content.len() <= LIVE_PREVIEW_BYTE_COUNT {
        "live"
    } else {
        "manual"
    };
    Ok(SourceEditSessionResponse {
        handle_id: handle_id.to_string(),
        session_id: session_id.to_string(),
        document_id: document_id.to_string(),
        path: path.to_string_lossy().to_string(),
        title,
        language: extension.clone(),
        extension,
        encoding: "utf-8",
        decode_lossy: false,
        content: snapshot.content,
        revision: snapshot.revision,
        preview_mode,
        maximum_byte_count: MAXIMUM_SOURCE_BYTE_COUNT,
    })
}

fn source_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn file_revision(path: &Path) -> Result<FileRevision, String> {
    let bytes = fs::read(path).map_err(map_read_error)?;
    revision_for_bytes(path, &bytes)
}

fn revision_for_bytes(path: &Path, bytes: &[u8]) -> Result<FileRevision, String> {
    let metadata = fs::metadata(path).map_err(map_read_error)?;
    if metadata.len() != bytes.len() as u64 {
        return Err(source_error(
            "source_read_failed",
            "The source changed while it was being read.",
        ));
    }
    let modified_at = metadata
        .modified()
        .map_err(map_read_error)?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            source_error(
                "source_read_failed",
                "The source modification time is invalid.",
            )
        })?
        .as_millis() as u64;
    Ok(FileRevision {
        modified_at,
        byte_count: bytes.len() as u64,
        content_hash: content_hash(bytes),
    })
}

fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(7 + digest.len() * 2);
    encoded.push_str("sha256:");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    encoded
}

#[derive(Debug)]
enum AtomicWriteError {
    BeforeCommit {
        stage: &'static str,
        message: String,
    },
    AfterCommit {
        stage: &'static str,
    },
    Conflict(FileRevision),
}

fn replace_source_atomically(
    path: &Path,
    bytes: &[u8],
    expected_revision: &FileRevision,
) -> Result<(), AtomicWriteError> {
    let parent = path
        .parent()
        .ok_or_else(|| AtomicWriteError::BeforeCommit {
            stage: "temporary_write",
            message: "The source has no writable parent directory.".to_string(),
        })?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let temporary_path = parent.join(format!(".{file_name}.burette-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut temporary = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|_| AtomicWriteError::BeforeCommit {
                stage: "temporary_write",
                message: "Could not create a temporary source file.".to_string(),
            })?;
        let permissions = fs::metadata(path)
            .map_err(|_| AtomicWriteError::BeforeCommit {
                stage: "metadata",
                message: "Could not read source metadata.".to_string(),
            })?
            .permissions();
        temporary
            .write_all(bytes)
            .map_err(|_| AtomicWriteError::BeforeCommit {
                stage: "temporary_write",
                message: "Could not write the temporary source file.".to_string(),
            })?;
        temporary
            .sync_all()
            .map_err(|_| AtomicWriteError::BeforeCommit {
                stage: "flush",
                message: "Could not flush the temporary source file.".to_string(),
            })?;
        fs::set_permissions(&temporary_path, permissions).map_err(|_| {
            AtomicWriteError::BeforeCommit {
                stage: "metadata",
                message: "Could not preserve source permissions.".to_string(),
            }
        })?;
        preserve_macos_metadata(path, &temporary_path, bytes)?;
        let current_revision = file_revision(path).map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "replace",
            message: "Could not verify the source before replacement.".to_string(),
        })?;
        if &current_revision != expected_revision {
            return Err(AtomicWriteError::Conflict(current_revision));
        }
        fs::rename(&temporary_path, path).map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "replace",
            message: "Could not replace the source file.".to_string(),
        })?;
        sync_parent_directory(path).map_err(|_| AtomicWriteError::AfterCommit {
            stage: "parent_flush",
        })?;
        Ok(())
    })();
    if result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(target_os = "macos")]
fn preserve_macos_metadata(
    source: &Path,
    target: &Path,
    draft_bytes: &[u8],
) -> Result<(), AtomicWriteError> {
    let status = std::process::Command::new("/bin/cp")
        .arg("-p")
        .arg(source)
        .arg(target)
        .status()
        .map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "metadata",
            message: "Could not invoke the macOS metadata copy operation.".to_string(),
        })?;
    if !status.success() {
        return Err(AtomicWriteError::BeforeCommit {
            stage: "metadata",
            message: "Could not preserve macOS source metadata.".to_string(),
        });
    }
    let mut temporary = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(target)
        .map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "metadata",
            message: "Could not reopen the metadata-preserving temporary file.".to_string(),
        })?;
    // `cp -p` replaces the temporary contents with the original while copying its
    // metadata. Restore the draft afterwards without replacing the temp inode.
    temporary
        .write_all(draft_bytes)
        .map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "metadata",
            message: "Could not restore the temporary source contents.".to_string(),
        })?;
    temporary
        .sync_all()
        .map_err(|_| AtomicWriteError::BeforeCommit {
            stage: "flush",
            message: "Could not flush the metadata-preserving temporary file.".to_string(),
        })?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn preserve_macos_metadata(
    _source: &Path,
    _target: &Path,
    _draft_bytes: &[u8],
) -> Result<(), AtomicWriteError> {
    Ok(())
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The source has no parent directory.".to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "Could not flush the source directory.".to_string())
}

fn map_read_error(error: std::io::Error) -> String {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "source_missing",
        std::io::ErrorKind::PermissionDenied => "source_permission_denied",
        _ => "source_read_failed",
    };
    source_error(code, "Could not read the source file.")
}

fn conflict_error(revision: &FileRevision) -> String {
    source_error_with_details(
        "source_conflict",
        "The source file changed on disk.",
        json!({ "actualRevision": revision }),
    )
}

fn commit_uncertain_error(pending: &PendingCommit) -> String {
    source_error_with_details(
        "source_commit_uncertain",
        "The replacement committed but save verification is incomplete.",
        json!({
            "stage": pending.pending_stage,
            "intendedContentHash": pending.intended_content_hash,
        }),
    )
}

fn source_error(code: &str, message: &str) -> String {
    serde_json::to_string(&json!({ "code": code, "message": message }))
        .unwrap_or_else(|_| message.to_string())
}

fn source_error_with_details(code: &str, message: &str, details: Value) -> String {
    serde_json::to_string(&json!({ "code": code, "message": message, "details": details }))
        .unwrap_or_else(|_| message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    fn temp_path(extension: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "burette-source-editing-test-{}.{}",
            uuid::Uuid::new_v4(),
            extension
        ))
    }

    #[test]
    fn revision_hash_detects_same_size_content_change() {
        let path = temp_path("pdb");
        fs::write(&path, b"ATOM A\n").unwrap();
        let first = file_revision(&path).unwrap();
        fs::write(&path, b"ATOM B\n").unwrap();
        let second = file_revision(&path).unwrap();
        assert_eq!(first.byte_count, second.byte_count);
        assert_ne!(first.content_hash, second.content_hash);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_multi_record_sdf() {
        let path = temp_path("sdf");
        let error = validate_source_text(&path, "one\n$$$$\ntwo\n$$$$\n").unwrap_err();
        assert!(error.contains("unsupported_shape"));
    }

    #[test]
    fn atomic_replace_updates_bytes_and_preserves_mode() {
        let path = temp_path("pdb");
        fs::write(&path, b"before\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        }
        #[cfg(target_os = "macos")]
        let xattr_set = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.burette.source-editing-test", "retained"])
            .arg(&path)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        let expected = file_revision(&path).unwrap();
        replace_source_atomically(&path, b"after\n", &expected).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"after\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o640
            );
        }
        #[cfg(target_os = "macos")]
        if xattr_set {
            let output = std::process::Command::new("/usr/bin/xattr")
                .args(["-p", "com.burette.source-editing-test"])
                .arg(&path)
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "retained");
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn failed_precommit_does_not_change_original() {
        let path = temp_path("pdb");
        fs::write(&path, b"original\n").unwrap();
        let missing = path.join("missing").join("source.pdb");
        let expected = file_revision(&path).unwrap();
        assert!(replace_source_atomically(&missing, b"draft\n", &expected).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original\n");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn editable_snapshot_is_lossless_and_bounded() {
        let path = temp_path("pdb");
        fs::write(&path, b"ATOM\n").unwrap();
        let snapshot = read_editable_snapshot(&path).unwrap();
        assert_eq!(snapshot.content, "ATOM\n");
        assert_eq!(snapshot.revision.byte_count, 5);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn revision_changes_after_atomic_replace() {
        let path = temp_path("pdb");
        fs::write(&path, b"before\n").unwrap();
        let before = file_revision(&path).unwrap();
        sleep(Duration::from_millis(2));
        replace_source_atomically(&path, b"after!\n", &before).unwrap();
        let after = file_revision(&path).unwrap();
        assert_ne!(before, after);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn stale_revision_aborts_before_replace() {
        let path = temp_path("pdb");
        fs::write(&path, b"first\n").unwrap();
        let stale = file_revision(&path).unwrap();
        fs::write(&path, b"other\n").unwrap();
        let error = replace_source_atomically(&path, b"draft\n", &stale).unwrap_err();
        assert!(matches!(error, AtomicWriteError::Conflict(_)));
        assert_eq!(fs::read(&path).unwrap(), b"other\n");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn opened_source_identity_is_scoped_to_window() {
        let registry = OpenedSourceRegistry::default();
        let path = temp_path("pdb");
        registry
            .register("doc".into(), "main".into(), path.clone(), "structure")
            .unwrap();
        registry
            .register("doc".into(), "workspace".into(), path, "structure")
            .unwrap();
        assert_eq!(registry.entries.lock().unwrap().len(), 2);
        registry.unregister_window("main").unwrap();
        let entries = registry.entries.lock().unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries.contains_key(&("workspace".into(), "doc".into())));
    }
}
