use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

use crate::preview::trace::PREVIEW_TRACE_FILE;
use crate::windows;

const APP_LOG_NAME: &str = "BuretteApp.log";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticPerformanceMark {
    name: String,
    start_time_ms: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticRecentError {
    message: String,
    details: Vec<String>,
    timestamp_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteTextFileRequest {
    output_path: String,
    contents: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteBase64FileRequest {
    output_path: String,
    contents_base64: String,
}

#[tauri::command]
pub(crate) fn open_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    append_app_log(
        &dir,
        "info",
        "desktop",
        "none",
        "open_logs_folder",
        0,
        "Opening local logs folder",
    )?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|err| format!("{path}: {err}"))?;
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn existing_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| PathBuf::from(path).exists())
        .collect()
}

#[tauri::command]
pub(crate) fn open_new_workspace_window<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    windows::open_new_workspace_window(&app)
}

#[tauri::command]
pub(crate) fn read_external_preview_svg(runtime_path: String) -> Result<String, String> {
    let index_path = PathBuf::from(&runtime_path)
        .canonicalize()
        .map_err(|err| format!("{runtime_path}: {err}"))?;
    let runtime_directory = index_path
        .parent()
        .ok_or_else(|| "Preview runtime directory is unavailable".to_string())?;
    let config_path = runtime_directory.join("preview-config.js");
    let config = fs::read_to_string(&config_path)
        .map_err(|err| format!("{}: {err}", config_path.display()))?;
    let json_text = config
        .trim()
        .strip_prefix("window.BuretteConfig = ")
        .and_then(|value| value.strip_suffix(';'))
        .ok_or_else(|| "Preview config is not in the expected format".to_string())?;
    let payload: Value = serde_json::from_str(json_text).map_err(|err| err.to_string())?;
    let artifact = payload
        .get("externalArtifact")
        .and_then(Value::as_object)
        .ok_or_else(|| "The active preview does not expose an external SVG artifact".to_string())?;
    if artifact.get("type").and_then(Value::as_str) != Some("svg") {
        return Err("The active preview artifact is not SVG".into());
    }
    if let Some(inline_svg) = artifact.get("inlineSvg").and_then(Value::as_str) {
        if !inline_svg.trim().is_empty() {
            return Ok(inline_svg.to_string());
        }
    }
    let relative_path = artifact
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "The active preview SVG path is unavailable".to_string())?;
    let svg_path = runtime_directory.join(relative_path);
    fs::read_to_string(&svg_path).map_err(|err| format!("{}: {err}", svg_path.display()))
}

#[tauri::command]
pub(crate) fn read_viewer_runtime_file_base64(
    runtime_path: String,
    relative_path: String,
) -> Result<String, String> {
    let index_path = PathBuf::from(&runtime_path)
        .canonicalize()
        .map_err(|err| format!("{runtime_path}: {err}"))?;
    let runtime_directory = index_path
        .parent()
        .ok_or_else(|| "Preview runtime directory is unavailable".to_string())?;
    let normalized = normalize_runtime_relative_path(&relative_path)?;
    let file_path = runtime_directory.join(normalized);
    let file_path = file_path
        .canonicalize()
        .map_err(|err| format!("{}: {err}", file_path.display()))?;
    if !file_path.starts_with(runtime_directory) {
        return Err("Runtime file path is outside the preview runtime directory".into());
    }
    let bytes = fs::read(&file_path).map_err(|err| format!("{}: {err}", file_path.display()))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn normalize_runtime_relative_path(path: &str) -> Result<PathBuf, String> {
    let normalized = PathBuf::from(path.replace('\\', "/"));
    if normalized.as_os_str().is_empty()
        || normalized.is_absolute()
        || normalized
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Invalid runtime file path".into());
    }
    Ok(normalized)
}

#[tauri::command]
pub(crate) fn write_text_file(request: WriteTextFileRequest) -> Result<String, String> {
    let output_path = PathBuf::from(request.output_path);
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    fs::write(&output_path, request.contents)
        .map_err(|err| format!("{}: {err}", output_path.display()))?;
    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn write_base64_file(request: WriteBase64FileRequest) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.contents_base64)
        .map_err(|err| format!("Could not decode file contents: {err}"))?;
    let output_path = PathBuf::from(request.output_path);
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    fs::write(&output_path, bytes).map_err(|err| format!("{}: {err}", output_path.display()))?;
    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn export_diagnostics_bundle<R: Runtime>(
    app: tauri::AppHandle<R>,
    output_path: String,
    performance_marks: Vec<DiagnosticPerformanceMark>,
    recent_errors: Vec<DiagnosticRecentError>,
) -> Result<String, String> {
    let started = SystemTime::now();
    let cache_dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;

    let output_dir = PathBuf::from(output_path);
    if output_dir.exists() {
        return Err("Diagnostics bundle path already exists".into());
    }
    fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;

    let app_log_path = cache_dir.join(APP_LOG_NAME);
    copy_redacted_or_create_empty(&app_log_path, &output_dir.join("app-log.txt"))?;
    let preview_trace_copied = copy_redacted_or_create_empty(
        &cache_dir.join(PREVIEW_TRACE_FILE),
        &output_dir.join(PREVIEW_TRACE_FILE),
    )?;

    let copied_quicklook_logs = copy_quicklook_logs(&output_dir)?;
    write_environment_info(&app, &output_dir)?;
    write_size_report(&output_dir)?;
    write_manifest(
        &app,
        &output_dir,
        performance_marks,
        recent_errors,
        copied_quicklook_logs,
        preview_trace_copied,
    )?;

    append_app_log(
        &cache_dir,
        "info",
        "desktop",
        "none",
        "export_diagnostics_bundle",
        elapsed_ms(started),
        "Exported local diagnostics bundle",
    )?;
    Ok(output_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("Only approved Burette project URLs can be opened".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| err.to_string())
}

fn is_allowed_external_url(url: &str) -> bool {
    const PROJECT_URL: &str = "https://github.com/SergeiNikolenko/Burette";
    const RELEASES_URL: &str = "https://github.com/SergeiNikolenko/Burette/releases";
    const NEW_ISSUE_URL: &str = "https://github.com/SergeiNikolenko/Burette/issues/new";

    url == PROJECT_URL
        || url == NEW_ISSUE_URL
        || url == RELEASES_URL
        || url.starts_with(&(String::from(RELEASES_URL) + "/"))
}

fn append_app_log(
    cache_dir: &Path,
    level: &str,
    subsystem: &str,
    document_id: &str,
    event: &str,
    elapsed_ms: u128,
    message: &str,
) -> Result<(), String> {
    fs::create_dir_all(cache_dir).map_err(|err| err.to_string())?;
    let sanitized_message = message.replace(['\n', '\r'], " ");
    let line = format!(
        "{} {} {} {} {} {} {}\n",
        unix_timestamp_ms(),
        level,
        subsystem,
        document_id,
        event,
        elapsed_ms,
        sanitized_message
    );
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(cache_dir.join(APP_LOG_NAME))
        .map_err(|err| err.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|err| err.to_string())
}

fn write_manifest<R: Runtime>(
    app: &tauri::AppHandle<R>,
    output_dir: &Path,
    performance_marks: Vec<DiagnosticPerformanceMark>,
    recent_errors: Vec<DiagnosticRecentError>,
    quicklook_logs: Vec<String>,
    preview_trace_copied: bool,
) -> Result<(), String> {
    let performance_marks: Vec<_> = performance_marks
        .into_iter()
        .map(|mark| {
            json!({
                "name": mark.name,
                "startTimeMs": mark.start_time_ms,
            })
        })
        .collect();
    let recent_errors: Vec<_> = recent_errors
        .into_iter()
        .map(|error| {
            json!({
                "message": redact_diagnostic_text(&error.message),
                "details": error.details
                    .into_iter()
                    .map(|detail| redact_diagnostic_text(&detail))
                    .collect::<Vec<_>>(),
                "timestampMs": error.timestamp_ms,
            })
        })
        .collect();
    let manifest = json!({
        "schemaVersion": 1,
        "generatedAtMs": unix_timestamp_ms(),
        "appVersion": app.package_info().version.to_string(),
        "logFormat": "timestamp level subsystem documentId event elapsedMs message",
        "files": {
            "appLog": "app-log.txt",
            "previewTrace": PREVIEW_TRACE_FILE,
            "previewTraceCopied": preview_trace_copied,
            "quickLookLogs": quicklook_logs,
            "environment": "environment.txt",
            "sizeReport": "size-report.txt"
        },
        "performanceMarks": performance_marks,
        "recentErrors": recent_errors,
        "privacy": {
            "externalTelemetry": false,
            "rawMoleculeContentIncluded": false,
            "localPathsRedacted": true,
            "copiedLogsRedacted": true
        }
    });
    let payload = serde_json::to_string_pretty(&manifest).map_err(|err| err.to_string())?;
    fs::write(output_dir.join("manifest.json"), payload).map_err(|err| err.to_string())
}

fn write_environment_info<R: Runtime>(
    app: &tauri::AppHandle<R>,
    output_dir: &Path,
) -> Result<(), String> {
    let lines = [
        format!("generatedAtMs={}", unix_timestamp_ms()),
        format!("appVersion={}", app.package_info().version),
        format!("os={}", std::env::consts::OS),
        format!("arch={}", std::env::consts::ARCH),
        format!("family={}", std::env::consts::FAMILY),
    ];
    fs::write(output_dir.join("environment.txt"), lines.join("\n") + "\n")
        .map_err(|err| err.to_string())
}

fn write_size_report(output_dir: &Path) -> Result<(), String> {
    let mut lines = Vec::new();
    if let Some(app_bundle) = current_app_bundle() {
        lines.push(format!("appBundle={}", app_bundle.display()));
        lines.push(format!("appBundleBytes={}", directory_size(&app_bundle)));
    } else {
        lines.push("appBundle=unavailable".to_string());
        lines.push("appBundleBytes=unavailable".to_string());
    }
    fs::write(output_dir.join("size-report.txt"), lines.join("\n") + "\n")
        .map_err(|err| err.to_string())
}

fn current_app_bundle() -> Option<PathBuf> {
    let mut current = std::env::current_exe().ok()?;
    while current.pop() {
        if current.extension().is_some_and(|ext| ext == "app") {
            return Some(current);
        }
    }
    None
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                return 0;
            };
            if metadata.is_dir() {
                directory_size(&path)
            } else {
                metadata.len()
            }
        })
        .sum()
}

fn copy_quicklook_logs(output_dir: &Path) -> Result<Vec<String>, String> {
    let quicklook_dir = output_dir.join("quicklook-logs");
    fs::create_dir_all(&quicklook_dir).map_err(|err| err.to_string())?;
    let mut copied = Vec::new();
    for source in quicklook_log_candidates() {
        if let Some(name) = source.file_name().and_then(|name| name.to_str()) {
            if copy_redacted_if_exists(&source, &quicklook_dir.join(name))? {
                copied.push(format!("quicklook-logs/{name}"));
            }
        }
    }
    Ok(copied)
}

fn quicklook_log_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let root = home
            .join("Library")
            .join("Containers")
            .join("com.local.BuretteV10.Preview")
            .join("Data")
            .join("Library");
        for directory in ["Caches/Burette", "Application Support/Burette"] {
            for file_name in ["BuretteV10.log", "Burette.log", PREVIEW_TRACE_FILE] {
                candidates.push(root.join(directory).join(file_name));
            }
        }
    }
    candidates
}

fn copy_redacted_or_create_empty(source: &Path, destination: &Path) -> Result<bool, String> {
    if source.exists() {
        copy_redacted_text_file(source, destination)?;
        Ok(true)
    } else {
        fs::write(destination, "").map_err(|err| err.to_string())?;
        Ok(false)
    }
}

fn copy_redacted_if_exists(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }
    copy_redacted_text_file(source, destination)?;
    Ok(true)
}

fn copy_redacted_text_file(source: &Path, destination: &Path) -> Result<(), String> {
    let bytes = fs::read(source).map_err(|err| err.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    fs::write(destination, redact_diagnostic_text(&text)).map_err(|err| err.to_string())
}

fn redact_diagnostic_text(value: &str) -> String {
    let mut redacted = String::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if starts_with_sensitive_path(rest) {
            redacted.push_str("[redacted-local-path]");
            index += sensitive_path_len(rest);
            continue;
        }
        let Some(ch) = rest.chars().next() else {
            break;
        };
        redacted.push(ch);
        index += ch.len_utf8();
    }
    redacted
}

fn starts_with_sensitive_path(value: &str) -> bool {
    value.starts_with("file:///")
        || value.starts_with("~/")
        || value.starts_with("/Users/")
        || value.starts_with("/home/")
        || value.starts_with("/private/")
        || value.starts_with("/tmp/")
        || value.starts_with("/var/folders/")
        || value.starts_with("/Volumes/")
        || starts_with_windows_path(value)
}

fn starts_with_windows_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

fn sensitive_path_len(value: &str) -> usize {
    let is_file_url = value.starts_with("file:///");
    let is_windows_path = starts_with_windows_path(value);
    for (index, ch) in value.char_indices().skip(1) {
        if ch.is_whitespace()
            || matches!(
                ch,
                '"' | '\'' | '`' | '<' | '>' | ')' | ']' | '}' | ',' | ';'
            )
        {
            return index;
        }
        if ch == ':' && index > 2 && !is_file_url && !is_windows_path {
            return index;
        }
    }
    value.len()
}

fn elapsed_ms(started: SystemTime) -> u128 {
    started
        .elapsed()
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        copy_redacted_text_file, is_allowed_external_url, read_external_preview_svg,
        redact_diagnostic_text, write_base64_file, write_text_file, WriteBase64FileRequest,
        WriteTextFileRequest,
    };
    use base64::Engine;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burette-shell-command-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn external_url_allowlist_is_limited_to_project_help_destinations() {
        for url in [
            "https://github.com/SergeiNikolenko/Burette",
            "https://github.com/SergeiNikolenko/Burette/releases",
            "https://github.com/SergeiNikolenko/Burette/releases/tag/v1.0.0",
            "https://github.com/SergeiNikolenko/Burette/issues/new",
        ] {
            assert!(is_allowed_external_url(url), "expected {url} to be allowed");
        }

        for url in [
            "http://github.com/SergeiNikolenko/Burette",
            "https://github.com/SergeiNikolenko/Burette/issues",
            "https://github.com/SergeiNikolenko/Burette/issues/new/extra",
            "https://github.com/SergeiNikolenko/Burette/releases.evil.example",
            "https://github.com.evil.example/SergeiNikolenko/Burette/releases",
        ] {
            assert!(
                !is_allowed_external_url(url),
                "expected {url} to be rejected"
            );
        }
    }

    #[test]
    fn reads_inline_external_preview_svg_from_runtime_config() {
        let runtime = temp_dir("inline-svg");
        fs::create_dir_all(&runtime).expect("runtime dir should be created");
        let index = runtime.join("index.html");
        fs::write(&index, "<!doctype html>").expect("index should be writable");
        fs::write(
            runtime.join("preview-config.js"),
            r#"window.BuretteConfig = {"externalArtifact":{"type":"svg","inlineSvg":"<svg id=\"molecule\"></svg>"}};"#,
        )
        .expect("config should be writable");

        let svg = read_external_preview_svg(index.to_string_lossy().to_string())
            .expect("inline SVG should be returned");

        assert_eq!(svg, r#"<svg id="molecule"></svg>"#);
        let _ = fs::remove_dir_all(runtime);
    }

    #[test]
    fn reads_external_preview_svg_from_relative_artifact_path() {
        let runtime = temp_dir("path-svg");
        fs::create_dir_all(&runtime).expect("runtime dir should be created");
        let index = runtime.join("index.html");
        fs::write(&index, "<!doctype html>").expect("index should be writable");
        fs::write(runtime.join("preview.svg"), "<svg></svg>").expect("svg should be writable");
        fs::write(
            runtime.join("preview-config.js"),
            r#"window.BuretteConfig = {"externalArtifact":{"type":"svg","path":"preview.svg"}};"#,
        )
        .expect("config should be writable");

        let svg = read_external_preview_svg(index.to_string_lossy().to_string())
            .expect("relative SVG should be returned");

        assert_eq!(svg, "<svg></svg>");
        let _ = fs::remove_dir_all(runtime);
    }

    #[test]
    fn write_file_commands_create_parent_directories() {
        let root = temp_dir("write-files");
        let text_path = root.join("nested").join("note.txt");
        let binary_path = root.join("binary").join("payload.bin");

        let written_text = write_text_file(WriteTextFileRequest {
            output_path: text_path.to_string_lossy().to_string(),
            contents: "hello\n".to_string(),
        })
        .expect("text file should be written");
        let written_binary = write_base64_file(WriteBase64FileRequest {
            output_path: binary_path.to_string_lossy().to_string(),
            contents_base64: base64::engine::general_purpose::STANDARD.encode([0, 1, 2, 255]),
        })
        .expect("base64 file should be written");

        assert_eq!(written_text, text_path.to_string_lossy());
        assert_eq!(written_binary, binary_path.to_string_lossy());
        assert_eq!(fs::read_to_string(&text_path).unwrap(), "hello\n");
        assert_eq!(fs::read(&binary_path).unwrap(), [0, 1, 2, 255]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn redacts_local_paths_from_diagnostic_text() {
        let redacted = redact_diagnostic_text(
            "Could not read /Users/alice/Research/ligand.pdb: see file:///private/tmp/Burette/run.log, C:\\Users\\alice\\secret.sdf and /__burette/read-file",
        );

        assert!(!redacted.contains("/Users/alice"));
        assert!(!redacted.contains("file:///private/tmp"));
        assert!(!redacted.contains("C:\\Users\\alice"));
        assert!(redacted.contains("/__burette/read-file"));
        assert_eq!(redacted.matches("[redacted-local-path]").count(), 3);
    }

    #[test]
    fn copies_diagnostic_text_with_local_paths_redacted() {
        let root = temp_dir("diagnostic-redaction");
        fs::create_dir_all(&root).expect("root dir should be created");
        let source = root.join("app.log");
        let destination = root.join("bundle.log");
        fs::write(
            &source,
            "open /Users/alice/Documents/private.pdb\ntrace /private/var/folders/run.log\n",
        )
        .expect("source log should be writable");

        copy_redacted_text_file(&source, &destination).expect("redacted copy should succeed");
        let copied = fs::read_to_string(&destination).expect("destination should be readable");

        assert!(!copied.contains("/Users/alice"));
        assert!(!copied.contains("/private/var"));
        assert_eq!(copied.matches("[redacted-local-path]").count(), 2);
        let _ = fs::remove_dir_all(root);
    }
}
