use burrete_core::{
    preview_error_code_for_message, preview_runtime_manifest, preview_trace_payload,
    PreviewLifecycleState, PreviewRuntimeManifest, PreviewSubsystem, PreviewTracePayload,
};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

pub(crate) use burrete_core::PREVIEW_TRACE_FILE;

#[derive(Debug)]
pub(crate) struct PreviewTraceEvent<'a> {
    pub(crate) document_id: &'a str,
    pub(crate) state: PreviewLifecycleState,
    pub(crate) subsystem: PreviewSubsystem,
    pub(crate) source_extension: Option<&'a str>,
    pub(crate) renderer: Option<&'a str>,
    pub(crate) runtime_path: Option<&'a Path>,
    pub(crate) elapsed_ms: Option<u128>,
    pub(crate) error_code: Option<&'a str>,
    pub(crate) message: Option<&'a str>,
}

pub(crate) fn append_preview_trace<R: Runtime>(
    app: &tauri::AppHandle<R>,
    event: PreviewTraceEvent<'_>,
) -> Result<(), String> {
    let cache_dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    append_preview_trace_to_dir(&cache_dir, event)
}

pub(crate) fn append_preview_trace_to_dir(
    cache_dir: &Path,
    event: PreviewTraceEvent<'_>,
) -> Result<(), String> {
    fs::create_dir_all(cache_dir).map_err(|err| err.to_string())?;
    let payload = trace_payload(event);
    let line = serde_json::to_string(&payload).map_err(|err| err.to_string())? + "\n";
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(cache_dir.join(PREVIEW_TRACE_FILE))
        .map_err(|err| err.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|err| err.to_string())
}

pub(crate) fn runtime_manifest(
    renderer: &str,
    source_extension: &str,
    document_id: &str,
    byte_count: usize,
    preview_byte_count: usize,
    asset_profile: &str,
) -> Value {
    preview_runtime_manifest(PreviewRuntimeManifest {
        created_at_ms: unix_timestamp_ms(),
        complete: true,
        document_id,
        source_extension,
        renderer,
        byte_count,
        preview_byte_count,
        asset_profile: Some(asset_profile),
        host: None,
    })
}

pub(crate) fn write_json_atomic(path: &Path, payload: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(payload).map_err(|err| err.to_string())? + "\n";
    write_bytes_atomic(path, text.as_bytes())
}

pub(crate) fn write_bytes_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("runtime-file");
    let temporary_path: PathBuf = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary_path, contents).map_err(|err| err.to_string())?;
    fs::rename(&temporary_path, path).map_err(|err| {
        let _ = fs::remove_file(&temporary_path);
        err.to_string()
    })
}

pub(crate) fn preview_error_code(message: &str) -> &'static str {
    preview_error_code_for_message(message)
}

fn trace_payload(event: PreviewTraceEvent<'_>) -> Value {
    let runtime_path = event
        .runtime_path
        .map(|path| path.to_string_lossy().to_string());
    preview_trace_payload(PreviewTracePayload {
        timestamp_ms: unix_timestamp_ms(),
        document_id: event.document_id,
        state: event.state,
        subsystem: event.subsystem,
        source_extension: event.source_extension,
        renderer: event.renderer,
        runtime_path: runtime_path.as_deref(),
        elapsed_ms: event.elapsed_ms,
        error_code: event.error_code,
        message: event.message,
    })
}

pub(crate) fn elapsed_ms(started: SystemTime) -> u128 {
    started
        .elapsed()
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

pub(crate) fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        append_preview_trace_to_dir, preview_error_code, write_json_atomic, PreviewTraceEvent,
        PREVIEW_TRACE_FILE,
    };
    use burrete_core::{PreviewLifecycleState, PreviewSubsystem, PREVIEW_CONTRACT_SCHEMA_VERSION};
    use serde_json::json;
    use std::fs;

    #[test]
    fn appends_jsonl_preview_trace_without_raw_payloads() {
        let dir =
            std::env::temp_dir().join(format!("burrete-preview-trace-{}", uuid::Uuid::new_v4()));
        append_preview_trace_to_dir(
            &dir,
            PreviewTraceEvent {
                document_id: "doc-1",
                state: PreviewLifecycleState::Completed,
                subsystem: PreviewSubsystem::Desktop,
                source_extension: Some("pdb"),
                renderer: Some("molstar"),
                runtime_path: None,
                elapsed_ms: Some(42),
                error_code: None,
                message: Some("ready"),
            },
        )
        .expect("trace event should be appended");

        let trace = fs::read_to_string(dir.join(PREVIEW_TRACE_FILE)).expect("trace should exist");
        assert!(trace.contains(&format!(
            r#""schemaVersion":{PREVIEW_CONTRACT_SCHEMA_VERSION}"#
        )));
        assert!(trace.contains(r#""documentId":"doc-1""#));
        assert!(trace.contains(r#""state":"completed""#));
        assert!(!trace.contains("preview-data"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn writes_json_atomically() {
        let dir =
            std::env::temp_dir().join(format!("burrete-runtime-manifest-{}", uuid::Uuid::new_v4()));
        let path = dir.join("manifest.json");
        write_json_atomic(&path, &json!({"complete": true})).expect("manifest should be written");
        let manifest = fs::read_to_string(&path).expect("manifest should exist");
        assert!(manifest.contains(r#""complete": true"#));
        let leftovers = fs::read_dir(&dir)
            .expect("dir should exist")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn maps_preview_errors_to_stable_codes() {
        assert_eq!(
            preview_error_code("sample.pdb is larger than the 75 MB preview limit"),
            "BRT-PREVIEW-FILE-TOO-LARGE"
        );
        assert_eq!(
            preview_error_code("sample.smi does not contain supported molecule grid records"),
            "BRT-PREVIEW-GRID-NO-RECORDS"
        );
        assert_eq!(
            preview_error_code("External xyzrender executable was not found"),
            "BRT-PREVIEW-XYZRENDER"
        );
    }
}
