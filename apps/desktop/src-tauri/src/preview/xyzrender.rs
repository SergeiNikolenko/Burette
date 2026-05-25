use serde_json::json;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::runtime::XyzrenderControls;

const XYZRENDER_TIMEOUT: Duration = Duration::from_secs(20);
const XYZRENDER_LOG_CAPTURE_BYTES: usize = 64 * 1024;

pub(crate) struct XyzrenderArtifact {
    pub(crate) relative_path: &'static str,
    pub(crate) output_type: &'static str,
    pub(crate) preset: &'static str,
    pub(crate) config_argument: String,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
}

pub(crate) fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
    preset: Option<&str>,
    orientation_ref_text: Option<&str>,
    controls: Option<&XyzrenderControls>,
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let orientation_ref_path = output_directory.join("orientation-ref.xyz");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let _ = fs::remove_file(&orientation_ref_path);
    let started = Instant::now();
    let resolved_preset = normalize_preset(preset);
    let resolved_config_argument = resolve_config_argument(resolved_preset, controls).to_string();
    let effective_preset =
        if resolved_preset == "custom" && resolved_config_argument == "default" {
            "default"
        } else {
            resolved_preset
        };
    let (status, log) = run_xyzrender_command(
        &resolve_xyzrender_executable()?,
        build_xyzrender_args(
            input_path,
            &output_path,
            resolved_preset,
            write_orientation_ref(orientation_ref_text, &orientation_ref_path)?,
            controls,
        ),
        &log_path,
        XYZRENDER_TIMEOUT,
    )?;
    if !status.success() {
        return Err(format!(
            "External xyzrender failed with exit status {}. {}",
            status.code().unwrap_or(-1),
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
        preset: effective_preset,
        config_argument: resolved_config_argument,
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

fn build_xyzrender_args(
    input_path: &Path,
    output_path: &Path,
    preset: &'static str,
    orientation_ref_path: Option<&Path>,
    controls: Option<&XyzrenderControls>,
) -> Vec<String> {
    let mut args = vec![
        input_path.display().to_string(),
        "-o".to_string(),
        output_path.display().to_string(),
        "--config".to_string(),
        resolve_config_argument(preset, controls).to_string(),
    ];
    if let Some(path) = orientation_ref_path {
        args.push("--ref".to_string());
        args.push(path.display().to_string());
    }
    if let Some(controls) = controls {
        if controls.transparent_background == Some(true) {
            args.push("--transparent".to_string());
        }
        if let Some(value) = finite_positive(controls.canvas_size) {
            args.push("-S".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = finite_positive(controls.atom_scale) {
            args.push("-a".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = finite_positive(controls.bond_width) {
            args.push("-b".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = finite_positive(controls.atom_stroke_width) {
            args.push("-s".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = non_empty_text(controls.mol_color.as_deref()) {
            args.push("--mol-color".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = controls.gradients {
            args.push(if value { "--grad" } else { "--no-grad" }.to_string());
        }
        if let Some(value) = controls.fog {
            args.push(if value { "--fog" } else { "--no-fog" }.to_string());
        }
        if let Some(value) = finite_positive(controls.fog_strength) {
            args.push("-F".to_string());
            args.push(value.to_string());
        }
        if controls.show_vdw == Some(true) {
            args.push("--vdw".to_string());
        }
        if let Some(value) = finite_positive(controls.vdw_opacity) {
            args.push("--vdw-opacity".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = finite_positive(controls.vdw_scale) {
            args.push("--vdw-scale".to_string());
            args.push(value.to_string());
        }
        if controls.hide_bonds == Some(true) {
            args.push("--no-bonds".to_string());
        }
        if let Some(value) = controls.show_cell {
            args.push(if value { "--cell" } else { "--no-cell" }.to_string());
        }
        if let Some(value) = controls.show_ghosts {
            args.push(if value { "--ghosts" } else { "--no-ghosts" }.to_string());
        }
        if let Some(value) = controls.show_axes {
            args.push(if value { "--axes" } else { "--no-axes" }.to_string());
        }
        if let Some(value) = finite_positive(controls.cell_width) {
            args.push("--cell-width".to_string());
            args.push(value.to_string());
        }
        if let Some(values) = controls.supercell.filter(|row| row.iter().all(|value| *value > 0)) {
            args.push("--supercell".to_string());
            args.extend(values.iter().map(ToString::to_string));
        }
        args.extend(sanitized_extra_arguments(controls.extra_arguments.as_deref()));
    }
    args
}

fn resolve_config_argument<'a>(preset: &'static str, controls: Option<&'a XyzrenderControls>) -> &'a str {
    if preset != "custom" {
        return preset;
    }
    controls
        .and_then(|value| non_empty_text(value.custom_config_path.as_deref()))
        .unwrap_or("default")
}

fn finite_positive(value: Option<f64>) -> Option<f64> {
    let number = value?;
    (number.is_finite() && number > 0.0).then_some(number)
}

fn non_empty_text(value: Option<&str>) -> Option<&str> {
    let text = value?.trim();
    (!text.is_empty()).then_some(text)
}

fn sanitized_extra_arguments(value: Option<&str>) -> Vec<String> {
    let blocked = ["-o", "--output", "-go", "--gif-output", "--config", "--ref"];
    let mut result = Vec::new();
    let mut skip_next = false;
    for token in split_command_line(value.unwrap_or_default()) {
        if skip_next {
            skip_next = false;
            continue;
        }
        if blocked.contains(&token.as_str()) {
            skip_next = true;
            continue;
        }
        if blocked.iter().any(|flag| token.starts_with(&format!("{flag}="))) {
            continue;
        }
        result.push(token);
    }
    result
}

fn split_command_line(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
            continue;
        }
        if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(character);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn run_xyzrender_command(
    executable: &Path,
    args: Vec<String>,
    log_path: &Path,
    timeout: Duration,
) -> Result<(ExitStatus, String), String> {
    let mut command = Command::new(executable);
    command.args(&args);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("External xyzrender could not be started: {err}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture xyzrender stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture xyzrender stderr.".to_string())?;
    let stdout_reader = thread::spawn(move || read_capped_text(stdout));
    let stderr_reader = thread::spawn(move || read_capped_text(stderr));
    let started = Instant::now();

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("Could not wait for external xyzrender: {err}"))?
        {
            let log = collect_xyzrender_log(stdout_reader, stderr_reader, log_path);
            return Ok((status, log));
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let log = collect_xyzrender_log(stdout_reader, stderr_reader, log_path);
            return Err(format!(
                "External xyzrender timed out after {} seconds. {}",
                timeout.as_secs(),
                truncate_text(&log, 320)
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn read_capped_text(mut reader: impl Read) -> String {
    let mut stored = Vec::new();
    let mut discarded = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        let remaining = XYZRENDER_LOG_CAPTURE_BYTES.saturating_sub(stored.len());
        if remaining > 0 {
            let keep = remaining.min(read);
            stored.extend_from_slice(&buffer[..keep]);
            discarded |= keep < read;
        } else {
            discarded = true;
        }
    }
    let mut text = String::from_utf8_lossy(&stored).to_string();
    if discarded {
        text.push_str("\n... xyzrender log truncated ...");
    }
    text
}

fn collect_xyzrender_log(
    stdout_reader: thread::JoinHandle<String>,
    stderr_reader: thread::JoinHandle<String>,
    log_path: &Path,
) -> String {
    let mut log = String::new();
    if let Ok(stdout) = stdout_reader.join() {
        log.push_str(&stdout);
    }
    if let Ok(stderr) = stderr_reader.join() {
        log.push_str(&stderr);
    }
    let _ = fs::write(log_path, &log);
    log
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
        if path.is_file() && is_executable(&path) {
            return Ok(path);
        }
    }
    Err("External xyzrender executable was not found or is not executable. Install xyzrender in ~/.local/bin or make it available on PATH.".into())
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_out_hung_xyzrender_processes() {
        let directory =
            std::env::temp_dir().join(format!("burrete-xyzrender-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let executable = directory.join("xyzrender");
        fs::write(
            &executable,
            "#!/bin/sh\necho started\nsleep 5\necho finished\n",
        )
        .expect("fake xyzrender should be written");
        let mut permissions = fs::metadata(&executable)
            .expect("fake xyzrender metadata should be readable")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).expect("fake xyzrender should be executable");

        let result = run_xyzrender_command(
            &executable,
            vec![
                directory.join("input.xyz").display().to_string(),
                "-o".to_string(),
                directory.join("xyzrender.svg").display().to_string(),
                "--config".to_string(),
                "default".to_string(),
            ],
            &directory.join("xyzrender.log"),
            Duration::from_millis(100),
        );

        let error = result.expect_err("hung xyzrender should time out");
        assert!(error.contains("timed out"));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn caps_xyzrender_log_capture() {
        let input = vec![b'x'; XYZRENDER_LOG_CAPTURE_BYTES + 16];
        let text = read_capped_text(&input[..]);

        assert!(text.len() < XYZRENDER_LOG_CAPTURE_BYTES + 128);
        assert!(text.contains("log truncated"));
    }

    #[test]
    fn builds_structured_xyzrender_args() {
        let input = PathBuf::from("/tmp/in.xyz");
        let output = PathBuf::from("/tmp/out.svg");
        let controls = XyzrenderControls {
            transparent_background: Some(true),
            canvas_size: Some(1024.0),
            atom_scale: Some(1.2),
            bond_width: Some(4.0),
            atom_stroke_width: Some(0.8),
            mol_color: Some("#ff00aa".into()),
            gradients: Some(false),
            fog: Some(true),
            fog_strength: Some(0.5),
            show_vdw: Some(true),
            vdw_opacity: Some(0.4),
            vdw_scale: Some(1.1),
            hide_bonds: Some(true),
            show_cell: Some(true),
            show_ghosts: Some(false),
            show_axes: Some(true),
            cell_width: Some(2.0),
            supercell: Some([2, 3, 4]),
            custom_config_path: Some("/tmp/custom.json".into()),
            extra_arguments: Some("--output hacked.svg --axis 111 --measure d".into()),
        };

        let args = build_xyzrender_args(
            &input,
            &output,
            "custom",
            Some(Path::new("/tmp/ref.xyz")),
            Some(&controls),
        );

        let joined = args.join(" ");
        assert!(joined.contains("--config /tmp/custom.json"));
        assert!(joined.contains("--ref /tmp/ref.xyz"));
        assert!(joined.contains("--transparent"));
        assert!(joined.contains("--no-grad"));
        assert!(joined.contains("--fog"));
        assert!(joined.contains("--vdw"));
        assert!(joined.contains("--no-bonds"));
        assert!(joined.contains("--cell"));
        assert!(joined.contains("--no-ghosts"));
        assert!(joined.contains("--axes"));
        assert!(joined.contains("--supercell 2 3 4"));
        assert!(joined.contains("--axis 111"));
        assert!(joined.contains("--measure d"));
        assert!(!joined.contains("hacked.svg"));
    }
}
