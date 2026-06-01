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
    pub(crate) inline_svg: String,
    pub(crate) output_type: &'static str,
    pub(crate) preset: &'static str,
    pub(crate) config_argument: String,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
}

pub(crate) struct XyzrenderDocumentDefaults {
    pub(crate) controls: XyzrenderControls,
    pub(crate) input_path: Option<PathBuf>,
}

pub(crate) fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
    preset: Option<&str>,
    orientation_ref_text: Option<&str>,
    controls: Option<&XyzrenderControls>,
    converted_input: Option<&[u8]>,
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let converted_input_path = output_directory.join("xyzrender-input.xyz");
    let orientation_ref_path = output_directory.join("orientation-ref.xyz");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let _ = fs::remove_file(&converted_input_path);
    let _ = fs::remove_file(&orientation_ref_path);
    let started = Instant::now();
    let resolved_preset = normalize_preset(preset);
    let resolved_config_argument = resolve_config_argument(resolved_preset, controls).to_string();
    let effective_preset = if resolved_preset == "custom" && resolved_config_argument == "default" {
        "default"
    } else {
        resolved_preset
    };
    let effective_input_path = if let Some(data) = converted_input.filter(|data| !data.is_empty()) {
        fs::write(&converted_input_path, data)
            .map_err(|err| format!("Could not write converted xyzrender input: {err}"))?;
        converted_input_path.as_path()
    } else {
        input_path
    };
    let (status, log) = run_xyzrender_command(
        &resolve_xyzrender_executable()?,
        build_xyzrender_args(
            effective_input_path,
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
    let inline_svg = fs::read_to_string(&output_path)
        .map_err(|err| format!("Could not read external xyzrender SVG output: {err}"))?;
    Ok(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        inline_svg,
        output_type: "svg",
        preset: effective_preset,
        config_argument: resolved_config_argument,
        elapsed_ms: started.elapsed().as_millis(),
        log,
    })
}

pub(crate) fn default_xyzrender_document_defaults(
    extension: &str,
    input_path: &Path,
    data: &[u8],
) -> Option<XyzrenderDocumentDefaults> {
    if !matches!(extension, "cub" | "cube") {
        return None;
    }
    let text = String::from_utf8_lossy(data);
    let descriptor = cube_descriptor(&text, input_path);
    let paired_density = paired_density_cube_path(input_path, &descriptor);
    Some(XyzrenderDocumentDefaults {
        controls: XyzrenderControls {
            extra_arguments: Some(
                default_cube_surface_arguments(&text, input_path, paired_density.is_some())
                    .join(" "),
            ),
            ..XyzrenderControls::default()
        },
        input_path: paired_density,
    })
}

fn default_cube_surface_arguments(
    text: &str,
    input_path: &Path,
    has_paired_density_cube: bool,
) -> Vec<String> {
    let descriptor = cube_descriptor(text, input_path);
    match descriptor.as_str() {
        value if value.contains("electrostatic potential") || value.contains("_esp") => Vec::new(),
        value
            if value.contains("molecular orbital")
                || value.contains("_homo")
                || value.contains("_lumo") =>
        {
            vec![
                "--mo".to_string(),
                "--opacity".to_string(),
                "0.62".to_string(),
                "--surface-style".to_string(),
                "solid".to_string(),
            ]
        }
        value
            if value.contains("reduced density gradient")
                || value.contains("rdg")
                || value.contains("_grad")
                || value.contains("-grad") =>
        {
            if has_paired_density_cube {
                vec![
                    "--nci-surf".to_string(),
                    quote_command_token(&input_path.display().to_string()),
                    "--iso".to_string(),
                    "0.3".to_string(),
                    "--opacity".to_string(),
                    "0.45".to_string(),
                    "--surface-style".to_string(),
                    "solid".to_string(),
                ]
            } else {
                vec![
                    "--dens".to_string(),
                    "--iso".to_string(),
                    "0.3".to_string(),
                    "--opacity".to_string(),
                    "0.45".to_string(),
                    "--surface-style".to_string(),
                    "solid".to_string(),
                ]
            }
        }
        _ => vec![
            "--dens".to_string(),
            "--opacity".to_string(),
            "0.45".to_string(),
            "--surface-style".to_string(),
            "solid".to_string(),
        ],
    }
}

fn paired_density_cube_path(input_path: &Path, descriptor: &str) -> Option<PathBuf> {
    let is_gradient = descriptor.contains("reduced density gradient")
        || descriptor.contains("rdg")
        || descriptor.contains("_grad")
        || descriptor.contains("-grad");
    if !is_gradient {
        return None;
    }
    paired_density_cube_candidates(input_path)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn paired_density_cube_candidates(input_path: &Path) -> Vec<PathBuf> {
    let Some(name) = input_path.file_name().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let Some(parent) = input_path.parent() else {
        return Vec::new();
    };
    let replacements = [
        ("_esp.cube", "_dens.cube"),
        ("_esp.cube", "_density.cube"),
        ("-esp.cube", "-dens.cube"),
        ("-esp.cube", "-density.cube"),
        ("_esp.cub", "_dens.cub"),
        ("_esp.cub", "_density.cub"),
        ("-esp.cub", "-dens.cub"),
        ("-esp.cub", "-density.cub"),
        ("_grad.cube", "_dens.cube"),
        ("_grad.cube", "_density.cube"),
        ("-grad.cube", "-dens.cube"),
        ("-grad.cube", "-density.cube"),
        ("_grad.cub", "_dens.cub"),
        ("_grad.cub", "_density.cub"),
        ("-grad.cub", "-dens.cub"),
        ("-grad.cub", "-density.cub"),
    ];
    let lower = name.to_ascii_lowercase();
    let mut candidates = Vec::new();
    for (from, to) in replacements {
        if !lower.ends_with(from) {
            continue;
        }
        let prefix_len = name.len().saturating_sub(from.len());
        let candidate = parent.join(format!("{}{}", &name[..prefix_len], to));
        if candidate != input_path && !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn cube_descriptor(text: &str, input_path: &Path) -> String {
    let mut descriptor = input_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    for line in text.lines().take(2) {
        descriptor.push('\n');
        descriptor.push_str(&line.to_ascii_lowercase());
    }
    descriptor
}

fn quote_command_token(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "/._-+=:".contains(character))
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
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
    let normalized = text?.replace("\r\n", "\n").replace('\r', "\n");
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
    match value
        .unwrap_or("default")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
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
        if let Some(values) = controls
            .supercell
            .filter(|row| row.iter().all(|value| *value > 0))
        {
            args.push("--supercell".to_string());
            args.extend(values.iter().map(ToString::to_string));
        }
        args.extend(sanitized_extra_arguments(
            controls.extra_arguments.as_deref(),
            controls.field_mode.is_some(),
        ));
        if let Some(mode) = normalized_field_mode(controls.field_mode.as_deref()) {
            match mode {
                "density" => args.push("--dens".to_string()),
                "mo" => args.push("--mo".to_string()),
                "esp" => {
                    args.push("--esp".to_string());
                    args.push(input_path.display().to_string());
                }
                "nci" => {
                    args.push("--nci-surf".to_string());
                    args.push(input_path.display().to_string());
                }
                _ => {}
            }
        }
        if let Some(value) = finite_positive(controls.field_iso) {
            args.push("--iso".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = finite_non_negative(controls.field_opacity) {
            args.push("--opacity".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = normalized_surface_style(controls.field_surface_style.as_deref()) {
            args.push("--surface-style".to_string());
            args.push(value.to_string());
        }
        if let (Some(positive), Some(negative)) = (
            non_empty_text(controls.field_mo_positive_color.as_deref()),
            non_empty_text(controls.field_mo_negative_color.as_deref()),
        ) {
            args.push("--mo-colors".to_string());
            args.push(positive.to_string());
            args.push(negative.to_string());
        }
        if let Some(value) = non_empty_text(controls.field_density_color.as_deref()) {
            args.push("--dens-color".to_string());
            args.push(value.to_string());
        }
        if let Some(value) = non_empty_text(controls.field_cmap_palette.as_deref()) {
            args.push("--cmap-palette".to_string());
            args.push(value.to_string());
        }
        if let (Some(min), Some(max)) = (
            finite_number(controls.field_cmap_min),
            finite_number(controls.field_cmap_max),
        ) {
            args.push("--cmap-range".to_string());
            args.push(min.to_string());
            args.push(max.to_string());
        }
    }
    args
}

fn normalized_field_mode(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("density") => Some("density"),
        Some("mo") => Some("mo"),
        Some("esp") => Some("esp"),
        Some("nci") => Some("nci"),
        Some("auto") | Some("off") | None => None,
        _ => None,
    }
}

fn normalized_surface_style(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("solid") => Some("solid"),
        Some("mesh") => Some("mesh"),
        Some("contour") => Some("contour"),
        Some("dot") => Some("dot"),
        _ => None,
    }
}

fn resolve_config_argument<'a>(
    preset: &'static str,
    controls: Option<&'a XyzrenderControls>,
) -> &'a str {
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

fn finite_non_negative(value: Option<f64>) -> Option<f64> {
    let number = value?;
    (number.is_finite() && number >= 0.0).then_some(number)
}

fn finite_number(value: Option<f64>) -> Option<f64> {
    let number = value?;
    number.is_finite().then_some(number)
}

fn non_empty_text(value: Option<&str>) -> Option<&str> {
    let text = value?.trim();
    (!text.is_empty()).then_some(text)
}

fn sanitized_extra_arguments(value: Option<&str>, strip_field_arguments: bool) -> Vec<String> {
    let mut blocked_value_flags =
        vec!["-o", "--output", "-go", "--gif-output", "--config", "--ref"];
    let mut blocked_value_count_flags = Vec::new();
    let mut blocked = blocked_value_flags.clone();
    if strip_field_arguments {
        blocked_value_flags.extend([
            "--esp",
            "--nci-surf",
            "--iso",
            "--opacity",
            "--surface-style",
            "--dens-color",
            "--cmap-palette",
        ]);
        blocked_value_count_flags.extend([("--mo-colors", 2usize), ("--cmap-range", 2usize)]);
        blocked.extend([
            "--esp",
            "--nci-surf",
            "--iso",
            "--opacity",
            "--surface-style",
            "--dens-color",
            "--cmap-palette",
            "--mo-colors",
            "--cmap-range",
            "--mo",
            "--dens",
        ]);
    }
    let mut result = Vec::new();
    let mut skip_next = 0usize;
    for token in split_command_line(value.unwrap_or_default()) {
        if skip_next > 0 {
            skip_next -= 1;
            continue;
        }
        if blocked.contains(&token.as_str()) {
            skip_next = blocked_value_count_flags
                .iter()
                .find_map(|(flag, count)| (*flag == token).then_some(*count))
                .unwrap_or_else(|| usize::from(blocked_value_flags.contains(&token.as_str())));
            continue;
        }
        if blocked
            .iter()
            .any(|flag| token.starts_with(&format!("{flag}=")))
        {
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
    if let Ok(executable) = std::env::current_exe() {
        candidates.extend(bundled_xyzrender_candidates_from_executable(&executable));
    }
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

fn bundled_xyzrender_candidates_from_executable(executable: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for ancestor in executable.ancestors() {
        candidates.push(
            ancestor
                .join("Resources")
                .join("xyzrender-runtime")
                .join("bin")
                .join("xyzrender"),
        );
        candidates.push(
            ancestor
                .join("Contents")
                .join("Resources")
                .join("xyzrender-runtime")
                .join("bin")
                .join("xyzrender"),
        );
    }
    candidates
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
    fn finds_bundled_xyzrender_runtime_from_app_and_appex_executables() {
        let app_executable = Path::new("/Applications/Burrete.app/Contents/MacOS/burrete");
        let appex_executable = Path::new(
            "/Applications/Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/MacOS/BurretePreview",
        );
        let bundled = PathBuf::from(
            "/Applications/Burrete.app/Contents/Resources/xyzrender-runtime/bin/xyzrender",
        );

        assert!(bundled_xyzrender_candidates_from_executable(app_executable).contains(&bundled));
        assert!(bundled_xyzrender_candidates_from_executable(appex_executable).contains(&bundled));
    }

    #[test]
    fn builds_structured_xyzrender_args() {
        let input = PathBuf::from("/tmp/in.xyz");
        let output = PathBuf::from("/tmp/out.svg");
        let mut controls = XyzrenderControls {
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
            field_mode: Some("mo".into()),
            field_iso: Some(0.35),
            field_opacity: Some(0.55),
            field_surface_style: Some("mesh".into()),
            field_mo_positive_color: Some("cyan".into()),
            field_mo_negative_color: Some("purple".into()),
            field_density_color: Some("green".into()),
            field_cmap_palette: Some("coolwarm".into()),
            field_cmap_min: Some(-0.2),
            field_cmap_max: Some(0.4),
            custom_config_path: Some("/tmp/custom.json".into()),
            extra_arguments: Some("--output hacked.svg --axis 111 --measure d --opacity 0.9 --mo-colors red blue --cmap-range -1 1".into()),
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
        assert!(joined.contains("--mo"));
        assert!(joined.contains("--iso 0.35"));
        assert!(joined.contains("--opacity 0.55"));
        assert!(joined.contains("--surface-style mesh"));
        assert!(joined.contains("--mo-colors cyan purple"));
        assert!(joined.contains("--dens-color green"));
        assert!(joined.contains("--cmap-palette coolwarm"));
        assert!(joined.contains("--cmap-range -0.2 0.4"));
        assert!(joined.contains("--axis 111"));
        assert!(joined.contains("--measure d"));
        assert!(!joined.contains("--opacity 0.9"));
        assert!(!joined.contains("--mo-colors red blue"));
        assert!(!joined.contains("--cmap-range -1 1"));
        assert!(!joined.contains("hacked.svg"));

        controls.field_iso = Some(0.0);
        let zero_iso_args = build_xyzrender_args(&input, &output, "default", None, Some(&controls));
        assert!(!zero_iso_args.join(" ").contains("--iso 0"));
    }

    #[test]
    fn chooses_cube_surface_arguments_from_header() {
        let path = Path::new("/tmp/caffeine_homo.cube");
        let defaults = default_xyzrender_document_defaults(
            "cube",
            path,
            b"Cube data generated by ORCA\nMolecular orbital 50 of operator 0\n",
        )
        .expect("cube should get default controls");
        assert!(defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .contains("--mo --opacity 0.62"));

        let defaults = default_xyzrender_document_defaults(
            "cube",
            Path::new("/tmp/caffeine_esp.cube"),
            b"Cube data generated by ORCA\nElectrostatic Potential\n",
        )
        .expect("cube should get default controls");
        assert!(defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .is_empty());

        let defaults = default_xyzrender_document_defaults(
            "cube",
            Path::new("/tmp/caffeine_dens.cube"),
            b"Cube data generated by ORCA\nTotal electron density\n",
        )
        .expect("cube should get default controls");
        assert!(defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .contains("--dens --opacity 0.45"));
    }

    #[test]
    fn keeps_esp_light_and_pairs_gradient_with_sibling_density_cube() {
        let directory =
            std::env::temp_dir().join(format!("burrete-cube-pair-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let dens_path = directory.join("caffeine_dens.cube");
        let esp_path = directory.join("caffeine_esp.cube");
        fs::write(&dens_path, b"density").expect("density cube fixture should be written");
        fs::write(&esp_path, b"esp").expect("esp cube fixture should be written");

        let defaults = default_xyzrender_document_defaults(
            "cube",
            &esp_path,
            b"Cube data generated by ORCA\nElectrostatic Potential\n",
        )
        .expect("esp cube should get defaults");
        assert_eq!(defaults.input_path.as_deref(), None);
        assert!(defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .is_empty());
        assert!(!defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .contains("--esp"));

        let base_pair_dens = directory.join("base-pair-dens.cube");
        let base_pair_grad = directory.join("base-pair-grad.cube");
        fs::write(&base_pair_dens, b"density").expect("density cube fixture should be written");
        fs::write(&base_pair_grad, b"gradient").expect("gradient cube fixture should be written");

        let defaults = default_xyzrender_document_defaults(
            "cube",
            &base_pair_grad,
            b"Cube data generated by ORCA\nReduced density gradient\n",
        )
        .expect("gradient cube should get defaults");
        assert_eq!(
            defaults.input_path.as_deref(),
            Some(base_pair_dens.as_path())
        );
        assert!(defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default()
            .contains("--nci-surf"));

        let _ = fs::remove_dir_all(directory);
    }
}
