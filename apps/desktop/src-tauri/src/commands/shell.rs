use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

const APP_LOG_NAME: &str = "BurreteApp.log";

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
        .strip_prefix("window.BurreteConfig = ")
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
    if app_log_path.exists() {
        fs::copy(&app_log_path, output_dir.join("app-log.txt")).map_err(|err| err.to_string())?;
    } else {
        fs::write(output_dir.join("app-log.txt"), "").map_err(|err| err.to_string())?;
    }

    let copied_quicklook_logs = copy_quicklook_logs(&output_dir)?;
    write_environment_info(&app, &output_dir)?;
    write_size_report(&output_dir)?;
    write_manifest(
        &app,
        &output_dir,
        performance_marks,
        recent_errors,
        copied_quicklook_logs,
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
    let releases_url = "https://github.com/SergeiNikolenko/Burrete/releases";
    if url != releases_url && !url.starts_with(&(String::from(releases_url) + "/")) {
        return Err("Only Burrete release URLs can be opened from Settings".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|err| err.to_string())
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
                "message": error.message,
                "details": error.details,
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
            "quickLookLogs": quicklook_logs,
            "environment": "environment.txt",
            "sizeReport": "size-report.txt"
        },
        "performanceMarks": performance_marks,
        "recentErrors": recent_errors,
        "privacy": {
            "externalTelemetry": false,
            "rawMoleculeContentIncluded": false
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
            if copy_if_exists(&source, &quicklook_dir.join(name))? {
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
            .join("com.local.BurreteV10.Preview")
            .join("Data")
            .join("Library");
        for directory in ["Caches/Burrete", "Application Support/Burrete"] {
            for file_name in ["BurreteV10.log", "Burrete.log"] {
                candidates.push(root.join(directory).join(file_name));
            }
        }
    }
    candidates
}

fn copy_if_exists(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }
    fs::copy(source, destination).map_err(|err| err.to_string())?;
    Ok(true)
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
        read_external_preview_svg, write_base64_file, write_text_file, WriteBase64FileRequest,
        WriteTextFileRequest,
    };
    use base64::Engine;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "burrete-shell-command-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn reads_inline_external_preview_svg_from_runtime_config() {
        let runtime = temp_dir("inline-svg");
        fs::create_dir_all(&runtime).expect("runtime dir should be created");
        let index = runtime.join("index.html");
        fs::write(&index, "<!doctype html>").expect("index should be writable");
        fs::write(
            runtime.join("preview-config.js"),
            r#"window.BurreteConfig = {"externalArtifact":{"type":"svg","inlineSvg":"<svg id=\"molecule\"></svg>"}};"#,
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
            r#"window.BurreteConfig = {"externalArtifact":{"type":"svg","path":"preview.svg"}};"#,
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
}
