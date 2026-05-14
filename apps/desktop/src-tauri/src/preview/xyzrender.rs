use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub(crate) struct XyzrenderArtifact {
    pub(crate) relative_path: &'static str,
    pub(crate) output_type: &'static str,
    pub(crate) preset: &'static str,
    pub(crate) config_argument: &'static str,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
}

pub(crate) fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
    preset: Option<&str>,
    orientation_ref_text: Option<&str>,
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let orientation_ref_path = output_directory.join("orientation-ref.xyz");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let _ = fs::remove_file(&orientation_ref_path);
    let started = Instant::now();
    let resolved_preset = normalize_preset(preset);
    let mut command = Command::new(resolve_xyzrender_executable()?);
    command
        .arg(input_path)
        .arg("-o")
        .arg(&output_path)
        .arg("--config")
        .arg(resolved_preset);
    if let Some(path) = write_orientation_ref(orientation_ref_text, &orientation_ref_path)? {
        command.arg("--ref").arg(path);
    }
    let output = command
        .output()
        .map_err(|err| format!("External xyzrender could not be started: {err}"))?;
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    let _ = fs::write(&log_path, &log);
    if !output.status.success() {
        return Err(format!(
            "External xyzrender failed with exit status {}. {}",
            output.status.code().unwrap_or(-1),
            truncate_text(&log, 320)
        ));
    }
    let metadata = fs::metadata(&output_path).map_err(|_| {
        "External xyzrender finished but did not produce an SVG output file".to_string()
    })?;
    if metadata.len() == 0 {
        return Err("External xyzrender produced an empty SVG output file".into());
    }
    Ok(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        output_type: "svg",
        preset: resolved_preset,
        config_argument: resolved_preset,
        elapsed_ms: started.elapsed().as_millis(),
        log,
    })
}

fn write_orientation_ref<'a>(
    text: Option<&str>,
    output_path: &'a Path,
) -> Result<Option<&'a Path>, String> {
    let Some(normalized) = normalize_orientation_ref(text) else {
        return Ok(None);
    };
    fs::write(output_path, normalized)
        .map_err(|err| format!("Could not write xyzrender orientation reference: {err}"))?;
    Ok(Some(output_path))
}

fn normalize_orientation_ref(text: Option<&str>) -> Option<String> {
    let normalized = text?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if normalized.len() > 4 * 1024 * 1024 {
        return None;
    }
    let lines: Vec<&str> = normalized.split('\n').collect();
    let first = lines.first()?.trim();
    let atom_count = first.parse::<usize>().ok()?;
    if atom_count == 0 || lines.len() < atom_count + 2 {
        return None;
    }
    Some(if normalized.ends_with('\n') {
        normalized
    } else {
        normalized + "\n"
    })
}

fn normalize_preset(value: Option<&str>) -> &'static str {
    match value.unwrap_or("default").trim().to_ascii_lowercase().as_str() {
        "default" => "default",
        "flat" => "flat",
        "paton" => "paton",
        "pmol" => "pmol",
        "skeletal" => "skeletal",
        "bubble" => "bubble",
        "tube" => "tube",
        "btube" => "btube",
        "mtube" => "mtube",
        "wire" => "wire",
        "graph" => "graph",
        "custom" => "custom",
        _ => "default",
    }
}

fn resolve_xyzrender_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/xyzrender"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("xyzrender")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/xyzrender"),
        PathBuf::from("/usr/local/bin/xyzrender"),
    ]);
    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("External xyzrender executable was not found. Install xyzrender in ~/.local/bin or make it available on PATH.".into())
}

pub(crate) fn xyzrender_preset_options() -> serde_json::Value {
    json!([
        { "value": "default", "label": "Default" },
        { "value": "flat", "label": "Flat" },
        { "value": "paton", "label": "Paton" },
        { "value": "pmol", "label": "PMol" },
        { "value": "skeletal", "label": "Skeletal" },
        { "value": "bubble", "label": "Bubble" },
        { "value": "tube", "label": "Tube" },
        { "value": "btube", "label": "BTube" },
        { "value": "mtube", "label": "MTube" },
        { "value": "wire", "label": "Wire" },
        { "value": "graph", "label": "Graph" },
        { "value": "custom", "label": "Custom JSON" }
    ])
}

fn truncate_text(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        + "..."
}
