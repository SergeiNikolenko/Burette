use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use super::runtime::XyzrenderControls;

const XYZRENDER_TIMEOUT: Duration = Duration::from_secs(20);
const XYZRENDER_LOG_CAPTURE_BYTES: usize = 64 * 1024;
const XYZRENDER_CACHE_MAX_AGE: Duration = Duration::from_secs(14 * 24 * 60 * 60);
const XYZRENDER_CACHE_MAX_ENTRIES: usize = 96;
const XYZRENDER_CACHE_MAX_BYTES: u64 = 256 * 1024 * 1024;
const XYZRENDER_GRID_BATCH_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) struct XyzrenderSmilesBatchRequest {
    pub(crate) id: String,
    pub(crate) input_path: PathBuf,
    pub(crate) output_directory: PathBuf,
    pub(crate) cache_directory: Option<PathBuf>,
    pub(crate) preset: Option<String>,
    pub(crate) controls: Option<XyzrenderControls>,
    pub(crate) direct_smiles: String,
}

pub(crate) struct XyzrenderSmilesBatchResult {
    pub(crate) id: String,
    pub(crate) svg: Option<String>,
    pub(crate) preset: String,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
    pub(crate) cache_hit: bool,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct XyzrenderSmilesBatchHelperPayload<'a> {
    items: Vec<XyzrenderSmilesBatchHelperItem<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct XyzrenderSmilesBatchHelperItem<'a> {
    id: &'a str,
    smiles: &'a str,
    output_path: String,
    config: &'a str,
    canvas_size: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct XyzrenderSmilesBatchHelperResponse {
    results: Vec<XyzrenderSmilesBatchHelperResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct XyzrenderSmilesBatchHelperResult {
    id: String,
    log: Option<String>,
    error: Option<String>,
}

pub(crate) struct XyzrenderArtifact {
    pub(crate) relative_path: &'static str,
    pub(crate) inline_svg: String,
    pub(crate) output_type: &'static str,
    pub(crate) preset: &'static str,
    pub(crate) config_argument: String,
    pub(crate) surface_mode: Option<String>,
    pub(crate) elapsed_ms: u128,
    pub(crate) log: String,
    pub(crate) cache_key: String,
    pub(crate) cache_hit: bool,
}

pub(crate) struct XyzrenderDocumentDefaults {
    pub(crate) controls: XyzrenderControls,
    pub(crate) input_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XyzrenderRuntimeStatus {
    installed: bool,
    executable_path: Option<String>,
    source: Option<&'static str>,
    install_hint: &'static str,
    message: String,
}

pub(crate) fn create_xyzrender_artifact(
    input_path: &Path,
    output_directory: &Path,
    cache_directory: Option<&Path>,
    preset: Option<&str>,
    orientation_ref_text: Option<&str>,
    controls: Option<&XyzrenderControls>,
    direct_smiles: Option<&str>,
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
    let executable = resolve_xyzrender_executable()?;
    let resolved_preset = normalize_preset(preset);
    let resolved_config_argument = resolve_config_argument(resolved_preset, controls).to_string();
    let effective_preset = if resolved_preset == "custom" && resolved_config_argument == "default" {
        "default"
    } else {
        resolved_preset
    };
    let surface_mode = controls.and_then(surface_mode_from_controls);
    let cache_key = xyzrender_cache_key(
        input_path,
        converted_input,
        direct_smiles,
        orientation_ref_text,
        resolved_preset,
        &resolved_config_argument,
        controls,
        &executable,
    )?;
    let cache_entry = cache_directory.map(|directory| directory.join(&cache_key));
    if let Some(entry) = cache_entry.as_deref() {
        prune_xyzrender_cache(entry.parent().unwrap_or(entry));
        if let Some(artifact) = read_cached_xyzrender_artifact(
            entry,
            &output_path,
            &log_path,
            &cache_key,
            effective_preset,
            &resolved_config_argument,
            surface_mode.as_deref(),
        )? {
            return Ok(artifact);
        }
    }
    let effective_input_path = if let Some(data) = converted_input.filter(|data| !data.is_empty()) {
        fs::write(&converted_input_path, data)
            .map_err(|err| format!("Could not write converted xyzrender input: {err}"))?;
        converted_input_path.as_path()
    } else {
        input_path
    };
    let orientation_ref_path = write_orientation_ref(orientation_ref_text, &orientation_ref_path)?;
    let (mut status, mut log) = run_xyzrender_command(
        &executable,
        build_xyzrender_args(
            effective_input_path,
            &output_path,
            resolved_preset,
            orientation_ref_path,
            controls,
            direct_smiles,
        ),
        &log_path,
        XYZRENDER_TIMEOUT,
    )?;
    if orientation_ref_path.is_some()
        && !status.success()
        && xyzrender_ref_unsupported_for_periodic(&log)
    {
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&log_path);
        let (retry_status, retry_log) = run_xyzrender_command(
            &executable,
            build_xyzrender_args(
                effective_input_path,
                &output_path,
                resolved_preset,
                None,
                controls,
                direct_smiles,
            ),
            &log_path,
            XYZRENDER_TIMEOUT,
        )?;
        status = retry_status;
        log = format!(
            "{}\n[burette] Retried without --ref because xyzrender does not support --ref for periodic structures.\n{}",
            log, retry_log
        );
        let _ = fs::write(&log_path, &log);
    }
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
    if let Some(entry) = cache_entry.as_deref() {
        write_xyzrender_cache_entry(
            entry,
            &output_path,
            &log_path,
            &cache_key,
            &log,
            started.elapsed().as_millis(),
        )?;
    }
    Ok(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        inline_svg,
        output_type: "svg",
        preset: effective_preset,
        config_argument: resolved_config_argument,
        surface_mode,
        elapsed_ms: started.elapsed().as_millis(),
        log,
        cache_key,
        cache_hit: false,
    })
}

pub(crate) fn create_xyzrender_smiles_batch_artifacts(
    requests: Vec<XyzrenderSmilesBatchRequest>,
) -> Vec<XyzrenderSmilesBatchResult> {
    if requests.is_empty() {
        return Vec::new();
    }
    let executable = match resolve_xyzrender_executable() {
        Ok(value) => value,
        Err(error) => {
            return requests
                .into_iter()
                .map(|request| XyzrenderSmilesBatchResult {
                    id: request.id,
                    svg: None,
                    preset: "default".to_string(),
                    elapsed_ms: 0,
                    log: String::new(),
                    cache_hit: false,
                    error: Some(error.clone()),
                })
                .collect();
        }
    };
    let mut results = Vec::new();
    let mut misses = Vec::new();
    for request in requests {
        let output_path = request.output_directory.join("xyzrender.svg");
        let log_path = request.output_directory.join("xyzrender.log");
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&log_path);
        let started = Instant::now();
        let resolved_preset = normalize_preset(request.preset.as_deref());
        let resolved_config_argument =
            resolve_config_argument(resolved_preset, request.controls.as_ref()).to_string();
        let effective_preset =
            if resolved_preset == "custom" && resolved_config_argument == "default" {
                "default"
            } else {
                resolved_preset
            };
        let cache_key = match xyzrender_cache_key(
            &request.input_path,
            None,
            Some(&request.direct_smiles),
            None,
            resolved_preset,
            &resolved_config_argument,
            request.controls.as_ref(),
            &executable,
        ) {
            Ok(value) => value,
            Err(error) => {
                results.push(XyzrenderSmilesBatchResult {
                    id: request.id,
                    svg: None,
                    preset: effective_preset.to_string(),
                    elapsed_ms: started.elapsed().as_millis(),
                    log: String::new(),
                    cache_hit: false,
                    error: Some(error),
                });
                continue;
            }
        };
        let cache_entry = request
            .cache_directory
            .as_ref()
            .map(|directory| directory.join(&cache_key));
        if let Some(entry) = cache_entry.as_deref() {
            prune_xyzrender_cache(entry.parent().unwrap_or(entry));
            match read_cached_xyzrender_artifact(
                entry,
                &output_path,
                &log_path,
                &cache_key,
                effective_preset,
                &resolved_config_argument,
                None,
            ) {
                Ok(Some(artifact)) => {
                    results.push(XyzrenderSmilesBatchResult {
                        id: request.id,
                        svg: Some(artifact.inline_svg),
                        preset: artifact.preset.to_string(),
                        elapsed_ms: artifact.elapsed_ms,
                        log: artifact.log,
                        cache_hit: true,
                        error: None,
                    });
                    continue;
                }
                Ok(None) => {}
                Err(error) => {
                    results.push(XyzrenderSmilesBatchResult {
                        id: request.id,
                        svg: None,
                        preset: effective_preset.to_string(),
                        elapsed_ms: started.elapsed().as_millis(),
                        log: String::new(),
                        cache_hit: false,
                        error: Some(error),
                    });
                    continue;
                }
            }
        }
        misses.push(XyzrenderPreparedSmilesBatchMiss {
            request,
            output_path,
            log_path,
            cache_entry,
            cache_key,
            effective_preset,
            resolved_config_argument,
            started,
        });
    }
    if misses.is_empty() {
        return results;
    }
    match run_xyzrender_smiles_batch_helper(&executable, &misses) {
        Ok(helper_results) => {
            for miss in misses {
                let Some(helper_result) = helper_results
                    .iter()
                    .find(|result| result.id == miss.request.id)
                else {
                    results.push(batch_miss_error(
                        miss,
                        "xyzrender batch helper returned no result",
                    ));
                    continue;
                };
                if let Some(error) = helper_result
                    .error
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    results.push(batch_miss_error(miss, error));
                    continue;
                }
                let svg = match fs::read_to_string(&miss.output_path) {
                    Ok(value) => value,
                    Err(error) => {
                        results.push(batch_miss_error(
                            miss,
                            &format!("Could not read xyzrender batch SVG output: {error}"),
                        ));
                        continue;
                    }
                };
                let log = helper_result.log.clone().unwrap_or_default();
                if let Some(entry) = miss.cache_entry.as_deref() {
                    if let Err(error) = write_xyzrender_cache_entry(
                        entry,
                        &miss.output_path,
                        &miss.log_path,
                        &miss.cache_key,
                        &log,
                        miss.started.elapsed().as_millis(),
                    ) {
                        results.push(batch_miss_error(miss, &error));
                        continue;
                    }
                }
                results.push(XyzrenderSmilesBatchResult {
                    id: miss.request.id,
                    svg: Some(svg),
                    preset: miss.effective_preset.to_string(),
                    elapsed_ms: miss.started.elapsed().as_millis(),
                    log,
                    cache_hit: false,
                    error: None,
                });
            }
        }
        Err(error) => {
            for miss in misses {
                results.push(batch_miss_error(miss, &error));
            }
        }
    }
    results
}

struct XyzrenderPreparedSmilesBatchMiss {
    request: XyzrenderSmilesBatchRequest,
    output_path: PathBuf,
    log_path: PathBuf,
    cache_entry: Option<PathBuf>,
    cache_key: String,
    effective_preset: &'static str,
    resolved_config_argument: String,
    started: Instant,
}

fn batch_miss_error(
    miss: XyzrenderPreparedSmilesBatchMiss,
    error: &str,
) -> XyzrenderSmilesBatchResult {
    XyzrenderSmilesBatchResult {
        id: miss.request.id,
        svg: None,
        preset: miss.effective_preset.to_string(),
        elapsed_ms: miss.started.elapsed().as_millis(),
        log: String::new(),
        cache_hit: false,
        error: Some(error.to_string()),
    }
}

fn run_xyzrender_smiles_batch_helper(
    executable: &Path,
    misses: &[XyzrenderPreparedSmilesBatchMiss],
) -> Result<Vec<XyzrenderSmilesBatchHelperResult>, String> {
    let helper_launch = xyzrender_batch_helper_launch(executable).ok_or_else(|| {
        "Could not resolve Python interpreter for xyzrender batch helper.".to_string()
    })?;
    let helper_path = std::env::temp_dir().join("burrete-xyzrender-grid-batch-helper.py");
    fs::write(&helper_path, XYZRENDER_GRID_BATCH_HELPER)
        .map_err(|err| format!("Could not write xyzrender batch helper: {err}"))?;
    let payload = XyzrenderSmilesBatchHelperPayload {
        items: misses
            .iter()
            .map(|miss| XyzrenderSmilesBatchHelperItem {
                id: &miss.request.id,
                smiles: &miss.request.direct_smiles,
                output_path: miss.output_path.display().to_string(),
                config: &miss.resolved_config_argument,
                canvas_size: miss
                    .request
                    .controls
                    .as_ref()
                    .and_then(|controls| finite_positive(controls.canvas_size)),
            })
            .collect(),
    };
    let input = serde_json::to_vec(&payload)
        .map_err(|err| format!("Could not encode xyzrender batch payload: {err}"))?;
    let mut command = Command::new(&helper_launch.program);
    command.arg(helper_path);
    for (key, value) in helper_launch.envs {
        command.env(key, value);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not start xyzrender batch helper: {err}"))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Could not open xyzrender batch helper stdin.".to_string())?;
        stdin
            .write_all(&input)
            .map_err(|err| format!("Could not send xyzrender batch payload: {err}"))?;
    }
    drop(child.stdin.take());
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture xyzrender batch helper stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture xyzrender batch helper stderr.".to_string())?;
    let stdout_reader = thread::spawn(move || read_capped_bytes(stdout));
    let stderr_reader = thread::spawn(move || read_capped_text(stderr));
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("Could not wait for xyzrender batch helper: {err}"))?
        {
            let stdout = stdout_reader.join().unwrap_or_default();
            let stderr = stderr_reader.join().unwrap_or_default();
            if !status.success() {
                return Err(format!(
                    "xyzrender batch helper failed with exit status {}. {}",
                    status.code().unwrap_or(-1),
                    truncate_text(&stderr, 320)
                ));
            }
            let response: XyzrenderSmilesBatchHelperResponse = serde_json::from_slice(&stdout)
                .map_err(|err| {
                    format!(
                        "Could not decode xyzrender batch helper response: {err}. {}",
                        truncate_text(&stderr, 320)
                    )
                })?;
            return Ok(response.results);
        }
        if started.elapsed() >= XYZRENDER_GRID_BATCH_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let stderr = stderr_reader.join().unwrap_or_default();
            return Err(format!(
                "xyzrender batch helper timed out after {} seconds. {}",
                XYZRENDER_GRID_BATCH_TIMEOUT.as_secs(),
                truncate_text(&stderr, 320)
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

struct XyzrenderBatchHelperLaunch {
    program: PathBuf,
    envs: Vec<(&'static str, String)>,
}

fn xyzrender_batch_helper_launch(script: &Path) -> Option<XyzrenderBatchHelperLaunch> {
    bundled_xyzrender_python_launch(script).or_else(|| {
        python_interpreter_from_script(script).map(|program| XyzrenderBatchHelperLaunch {
            program,
            envs: Vec::new(),
        })
    })
}

fn bundled_xyzrender_python_launch(script: &Path) -> Option<XyzrenderBatchHelperLaunch> {
    let bin = script.parent()?;
    let runtime_root = bin.parent()?;
    let resources = runtime_root.parent()?;
    let python = resources
        .join("xyzrender-python")
        .join("bin")
        .join("python3");
    if !python.is_file() {
        return None;
    }
    let site_packages = find_site_packages(&runtime_root.join("lib"))?;
    Some(XyzrenderBatchHelperLaunch {
        program: python,
        envs: vec![
            ("PYTHONNOUSERSITE", "1".to_string()),
            ("PYTHONPATH", site_packages.display().to_string()),
        ],
    })
}

fn find_site_packages(root: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some("site-packages") && path.is_dir()
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(site_packages) = find_site_packages(&path) {
                return Some(site_packages);
            }
        }
    }
    None
}

fn python_interpreter_from_script(script: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(script).ok()?;
    let first_line = text.lines().next()?.trim();
    let shebang = first_line.strip_prefix("#!")?.trim();
    let first = shebang.split_whitespace().next()?;
    if first.is_empty() || first.ends_with("/sh") {
        None
    } else {
        Some(PathBuf::from(first))
    }
}

fn read_capped_bytes(mut reader: impl Read) -> Vec<u8> {
    let mut stored = Vec::new();
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
        }
    }
    stored
}

const XYZRENDER_GRID_BATCH_HELPER: &str = r#"
import json
import sys
from pathlib import Path

from xyzrender import load, render

payload = json.load(sys.stdin)
results = []
for item in payload.get("items", []):
    item_id = str(item.get("id", ""))
    try:
        mol = load(str(item.get("smiles", "")), smiles=True)
        kwargs = {"config": item.get("config") or "default"}
        canvas_size = item.get("canvasSize")
        if canvas_size:
            kwargs["canvas_size"] = canvas_size
        svg = render(mol, **kwargs)
        Path(item["outputPath"]).write_text(str(svg))
        results.append({"id": item_id, "log": ""})
    except Exception as exc:
        results.append({"id": item_id, "error": str(exc)})
print(json.dumps({"results": results}))
"#;

fn read_cached_xyzrender_artifact(
    entry: &Path,
    output_path: &Path,
    log_path: &Path,
    cache_key: &str,
    preset: &'static str,
    config_argument: &str,
    surface_mode: Option<&str>,
) -> Result<Option<XyzrenderArtifact>, String> {
    let cached_svg = entry.join("xyzrender.svg");
    let cached_log = entry.join("log.txt");
    let metadata = match fs::metadata(&cached_svg) {
        Ok(metadata) if metadata.len() > 0 => metadata,
        _ => return Ok(None),
    };
    if cache_entry_expired(&metadata) {
        let _ = fs::remove_dir_all(entry);
        return Ok(None);
    }
    fs::create_dir_all(output_path.parent().unwrap_or_else(|| Path::new(".")))
        .map_err(|err| format!("Could not prepare xyzrender cache hit output: {err}"))?;
    fs::copy(&cached_svg, output_path)
        .map_err(|err| format!("Could not copy cached xyzrender SVG: {err}"))?;
    if cached_log.is_file() {
        let _ = fs::copy(&cached_log, log_path);
    }
    let inline_svg = fs::read_to_string(output_path)
        .map_err(|err| format!("Could not read cached xyzrender SVG: {err}"))?;
    let log = fs::read_to_string(&cached_log).unwrap_or_default();
    Ok(Some(XyzrenderArtifact {
        relative_path: "xyzrender.svg",
        inline_svg,
        output_type: "svg",
        preset,
        config_argument: config_argument.to_string(),
        surface_mode: surface_mode.map(ToOwned::to_owned),
        elapsed_ms: 0,
        log,
        cache_key: cache_key.to_string(),
        cache_hit: true,
    }))
}

fn write_xyzrender_cache_entry(
    entry: &Path,
    output_path: &Path,
    log_path: &Path,
    cache_key: &str,
    log: &str,
    elapsed_ms: u128,
) -> Result<(), String> {
    fs::create_dir_all(entry).map_err(|err| format!("Could not create xyzrender cache: {err}"))?;
    fs::copy(output_path, entry.join("xyzrender.svg"))
        .map_err(|err| format!("Could not cache xyzrender SVG: {err}"))?;
    if log_path.is_file() {
        let _ = fs::copy(log_path, entry.join("log.txt"));
    } else {
        let _ = fs::write(entry.join("log.txt"), log);
    }
    let meta = json!({
        "cacheKey": cache_key,
        "elapsedMs": elapsed_ms,
        "cachedAtMs": system_time_millis(SystemTime::now()),
    });
    fs::write(
        entry.join("meta.json"),
        serde_json::to_vec_pretty(&meta).unwrap_or_default(),
    )
    .map_err(|err| format!("Could not write xyzrender cache metadata: {err}"))?;
    Ok(())
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
    let defaults = default_cube_surface_defaults(input_path, &descriptor);
    Some(XyzrenderDocumentDefaults {
        controls: defaults.controls,
        input_path: defaults.input_path,
    })
}

struct CubeSurfaceDefaults {
    controls: XyzrenderControls,
    input_path: Option<PathBuf>,
}

fn default_cube_surface_defaults(input_path: &Path, descriptor: &str) -> CubeSurfaceDefaults {
    match descriptor {
        value if value.contains("electrostatic potential") || value.contains("_esp") => {
            if let Some(density_path) = paired_density_cube_path(input_path) {
                return CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        extra_arguments: Some(
                            [
                                "--esp".to_string(),
                                quote_command_token(&input_path.display().to_string()),
                                "--cbar".to_string(),
                                "--opacity".to_string(),
                                "0.5".to_string(),
                                "--surface-style".to_string(),
                                "solid".to_string(),
                            ]
                            .join(" "),
                        ),
                        ..XyzrenderControls::default()
                    },
                    input_path: Some(density_path),
                };
            }
            CubeSurfaceDefaults {
                controls: XyzrenderControls {
                    field_mode: Some("esp".to_string()),
                    field_opacity: Some(0.5),
                    field_surface_style: Some("solid".to_string()),
                    ..XyzrenderControls::default()
                },
                input_path: None,
            }
        }
        value
            if value.contains("molecular orbital")
                || value.contains("_homo")
                || value.contains("_lumo") =>
        {
            CubeSurfaceDefaults {
                controls: XyzrenderControls {
                    field_mode: Some("mo".to_string()),
                    field_opacity: Some(0.62),
                    field_surface_style: Some("solid".to_string()),
                    ..XyzrenderControls::default()
                },
                input_path: None,
            }
        }
        value if is_nci_surface_descriptor(value) => {
            if let Some(field_path) = paired_nci_field_cube_path(input_path) {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        extra_arguments: Some(
                            [
                                "--nci-surf".to_string(),
                                quote_command_token(&input_path.display().to_string()),
                            ]
                            .into_iter()
                            .chain(nci_iso_arguments(input_path))
                            .chain([
                                "--opacity".to_string(),
                                "0.45".to_string(),
                                "--surface-style".to_string(),
                                "solid".to_string(),
                            ])
                            .collect::<Vec<_>>()
                            .join(" "),
                        ),
                        ..XyzrenderControls::default()
                    },
                    input_path: Some(field_path),
                }
            } else {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        field_mode: Some("density".to_string()),
                        field_iso: Some(0.3),
                        field_opacity: Some(0.45),
                        field_surface_style: Some("solid".to_string()),
                        ..XyzrenderControls::default()
                    },
                    input_path: None,
                }
            }
        }
        value if value.contains("sl2r") => {
            if let Some(surface_path) = paired_nci_surface_cube_path(input_path) {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        extra_arguments: Some(
                            [
                                "--nci-surf".to_string(),
                                quote_command_token(&surface_path.display().to_string()),
                            ]
                            .into_iter()
                            .chain(nci_iso_arguments(&surface_path))
                            .chain([
                                "--opacity".to_string(),
                                "0.45".to_string(),
                                "--surface-style".to_string(),
                                "solid".to_string(),
                            ])
                            .collect::<Vec<_>>()
                            .join(" "),
                        ),
                        ..XyzrenderControls::default()
                    },
                    input_path: None,
                }
            } else {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        field_mode: Some("density".to_string()),
                        field_opacity: Some(0.45),
                        field_surface_style: Some("solid".to_string()),
                        ..XyzrenderControls::default()
                    },
                    input_path: None,
                }
            }
        }
        _ => {
            if let Some(surface_path) = paired_nci_surface_cube_path(input_path) {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        extra_arguments: Some(
                            [
                                "--nci-surf".to_string(),
                                quote_command_token(&surface_path.display().to_string()),
                            ]
                            .into_iter()
                            .chain(nci_iso_arguments(&surface_path))
                            .chain([
                                "--opacity".to_string(),
                                "0.45".to_string(),
                                "--surface-style".to_string(),
                                "solid".to_string(),
                            ])
                            .collect::<Vec<_>>()
                            .join(" "),
                        ),
                        ..XyzrenderControls::default()
                    },
                    input_path: None,
                }
            } else {
                CubeSurfaceDefaults {
                    controls: XyzrenderControls {
                        field_mode: Some("density".to_string()),
                        field_opacity: Some(0.45),
                        field_surface_style: Some("solid".to_string()),
                        ..XyzrenderControls::default()
                    },
                    input_path: None,
                }
            }
        }
    }
}

fn is_nci_surface_descriptor(descriptor: &str) -> bool {
    descriptor.contains("reduced density gradient")
        || descriptor.contains("rdg")
        || descriptor.contains("_grad")
        || descriptor.contains("-grad")
        || descriptor.contains("_dg_")
        || descriptor.contains("-dg_")
        || descriptor.contains("_dg-")
        || descriptor.contains("-dg-")
}

fn paired_density_cube_path(input_path: &Path) -> Option<PathBuf> {
    paired_cube_candidates(
        input_path,
        &[
            ("_esp.cube", "_dens.cube"),
            ("_esp.cube", "_density.cube"),
            ("-esp.cube", "-dens.cube"),
            ("-esp.cube", "-density.cube"),
            ("_esp.cub", "_dens.cub"),
            ("_esp.cub", "_density.cub"),
            ("-esp.cub", "-dens.cub"),
            ("-esp.cub", "-density.cub"),
        ],
    )
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn paired_nci_field_cube_path(input_path: &Path) -> Option<PathBuf> {
    paired_cube_candidates(
        input_path,
        &[
            ("_grad.cube", "_dens.cube"),
            ("_grad.cube", "_density.cube"),
            ("-grad.cube", "-dens.cube"),
            ("-grad.cube", "-density.cube"),
            ("_grad.cub", "_dens.cub"),
            ("_grad.cub", "_density.cub"),
            ("-grad.cub", "-dens.cub"),
            ("-grad.cub", "-density.cub"),
            ("_dg_inter.cub", "_sl2r.cub"),
            ("_dg_intra.cub", "_sl2r.cub"),
            ("-dg_inter.cub", "-sl2r.cub"),
            ("-dg_intra.cub", "-sl2r.cub"),
            ("_dg_inter.cube", "_sl2r.cube"),
            ("_dg_intra.cube", "_sl2r.cube"),
            ("-dg_inter.cube", "-sl2r.cube"),
            ("-dg_intra.cube", "-sl2r.cube"),
        ],
    )
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn paired_nci_surface_cube_path(input_path: &Path) -> Option<PathBuf> {
    paired_cube_candidates(
        input_path,
        &[
            ("_dens.cube", "_grad.cube"),
            ("_density.cube", "_grad.cube"),
            ("-dens.cube", "-grad.cube"),
            ("-density.cube", "-grad.cube"),
            ("_dens.cub", "_grad.cub"),
            ("_density.cub", "_grad.cub"),
            ("-dens.cub", "-grad.cub"),
            ("-density.cub", "-grad.cub"),
            ("_sl2r.cub", "_dg_inter.cub"),
            ("_sl2r.cub", "_dg_intra.cub"),
            ("-sl2r.cub", "-dg_inter.cub"),
            ("-sl2r.cub", "-dg_intra.cub"),
            ("_sl2r.cube", "_dg_inter.cube"),
            ("_sl2r.cube", "_dg_intra.cube"),
            ("-sl2r.cube", "-dg_inter.cube"),
            ("-sl2r.cube", "-dg_intra.cube"),
        ],
    )
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn paired_cube_candidates(input_path: &Path, replacements: &[(&str, &str)]) -> Vec<PathBuf> {
    let Some(name) = input_path.file_name().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let Some(parent) = input_path.parent() else {
        return Vec::new();
    };
    let lower = name.to_ascii_lowercase();
    let mut candidates = Vec::new();
    for (from, to) in replacements.iter().copied() {
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

fn nci_iso_arguments(path: &Path) -> Vec<String> {
    let name = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name.contains("dg_intra") || name.contains("dg-intra") {
        vec!["--iso".to_string(), "0.2".to_string()]
    } else if name.contains("dg_inter") || name.contains("dg-inter") {
        vec!["--iso".to_string(), "0.005".to_string()]
    } else {
        vec!["--iso".to_string(), "0.3".to_string()]
    }
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

fn xyzrender_ref_unsupported_for_periodic(log: &str) -> bool {
    log.contains("--ref is not supported for periodic structures")
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
        "vdw" => "vdw",
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
    direct_smiles: Option<&str>,
) -> Vec<String> {
    let mut args = if let Some(smiles) = direct_smiles.filter(|value| !value.trim().is_empty()) {
        vec!["--smi".to_string(), smiles.trim().to_string()]
    } else {
        vec![input_path.display().to_string()]
    };
    args.extend([
        "-o".to_string(),
        output_path.display().to_string(),
        "--config".to_string(),
        resolve_config_argument(preset, controls).to_string(),
    ]);
    if let Some(path) = orientation_ref_path {
        args.push("--ref".to_string());
        args.push(path.display().to_string());
    }
    if preset == "vdw" {
        args.push("--vdw".to_string());
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
        if preset != "vdw" && controls.show_vdw == Some(true) {
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
        if direct_smiles.is_none() {
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
        }
        if normalized_field_mode(controls.field_mode.as_deref()).is_some() {
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

fn surface_mode_from_controls(controls: &XyzrenderControls) -> Option<String> {
    if let Some(mode) = normalized_field_mode(controls.field_mode.as_deref()) {
        return Some(mode.to_string());
    }
    let tokens = split_command_line(controls.extra_arguments.as_deref().unwrap_or_default());
    if tokens.iter().any(|token| token == "--nci-surf") {
        return Some("nci".to_string());
    }
    if tokens.iter().any(|token| token == "--esp") {
        return Some("esp".to_string());
    }
    if tokens.iter().any(|token| token == "--mo") {
        return Some("mo".to_string());
    }
    if tokens.iter().any(|token| token == "--dens") {
        return Some("density".to_string());
    }
    None
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
    if preset == "vdw" {
        return "default";
    }
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

fn xyzrender_cache_key(
    input_path: &Path,
    converted_input: Option<&[u8]>,
    direct_smiles: Option<&str>,
    orientation_ref_text: Option<&str>,
    preset: &'static str,
    config_argument: &str,
    controls: Option<&XyzrenderControls>,
    executable: &Path,
) -> Result<String, String> {
    let has_content_input = converted_input
        .map(|data| !data.is_empty())
        .unwrap_or(false)
        || direct_smiles
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
    let source_metadata = if has_content_input {
        None
    } else {
        fs::metadata(input_path).ok()
    };
    let executable_metadata = fs::metadata(executable).ok();
    let payload = json!({
        "version": 1,
        "sourcePath": if has_content_input { None } else { Some(canonical_path_string(input_path)) },
        "sourceSize": source_metadata.as_ref().map(fs::Metadata::len),
        "sourceModifiedMs": source_metadata.as_ref().and_then(|metadata| metadata.modified().ok()).map(system_time_millis),
        "convertedInputSha256": converted_input.filter(|data| !data.is_empty()).map(sha256_hex),
        "directSmilesSha256": direct_smiles.map(str::trim).filter(|value| !value.is_empty()).map(|value| sha256_hex(value.as_bytes())),
        "orientationRefSha256": normalize_orientation_ref(orientation_ref_text).map(|text| sha256_hex(text.as_bytes())),
        "preset": preset,
        "configArgument": config_argument,
        "controls": controls.and_then(|value| serde_json::to_value(value).ok()),
        "executablePath": canonical_path_string(executable),
        "executableSize": executable_metadata.as_ref().map(fs::Metadata::len),
        "executableModifiedMs": executable_metadata.as_ref().and_then(|metadata| metadata.modified().ok()).map(system_time_millis),
        "xyzrenderVersion": serde_json::Value::Null,
    });
    serde_json::to_vec(&payload)
        .map(|bytes| sha256_hex(&bytes))
        .map_err(|err| format!("Could not build xyzrender cache key: {err}"))
}

fn canonical_path_string(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    let mut text = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(text, "{byte:02x}");
    }
    text
}

fn system_time_millis(value: SystemTime) -> u128 {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn cache_entry_expired(metadata: &fs::Metadata) -> bool {
    metadata
        .modified()
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > XYZRENDER_CACHE_MAX_AGE)
}

fn prune_xyzrender_cache(cache_directory: &Path) {
    let Ok(entries) = fs::read_dir(cache_directory) else {
        return;
    };
    let mut cache_entries = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let svg = path.join("xyzrender.svg");
        let Ok(metadata) = fs::metadata(&svg) else {
            let _ = fs::remove_dir_all(&path);
            continue;
        };
        if cache_entry_expired(&metadata) {
            let _ = fs::remove_dir_all(&path);
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let size = directory_size(&path);
        cache_entries.push((path, modified, size));
    }
    cache_entries.sort_by_key(|(_, modified, _)| *modified);
    let mut total_size: u64 = cache_entries.iter().map(|(_, _, size)| *size).sum();
    let overflow = cache_entries
        .len()
        .saturating_sub(XYZRENDER_CACHE_MAX_ENTRIES);
    for (path, _, size) in cache_entries.iter().take(overflow) {
        let _ = fs::remove_dir_all(path);
        total_size = total_size.saturating_sub(*size);
    }
    for (path, _, size) in cache_entries.into_iter().skip(overflow) {
        if total_size <= XYZRENDER_CACHE_MAX_BYTES {
            break;
        }
        let _ = fs::remove_dir_all(path);
        total_size = total_size.saturating_sub(size);
    }
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                directory_size(&path)
            } else {
                fs::metadata(&path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0)
            }
        })
        .sum()
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
    Err("External xyzrender executable was not found or is not executable. Bundle xyzrender-runtime with Burrete, install xyzrender in ~/.local/bin, or make it available on PATH.".into())
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
        { "value": "vdw", "label": "vdW" },
        { "value": "custom", "label": "Custom JSON" }
    ])
}

pub(crate) fn xyzrender_runtime_status() -> XyzrenderRuntimeStatus {
    const INSTALL_HINT: &str = "Bundle xyzrender-runtime with Burrete, install xyzrender in ~/.local/bin, or make it available on PATH.";
    match resolve_xyzrender_executable() {
        Ok(path) => XyzrenderRuntimeStatus {
            installed: true,
            executable_path: Some(path.to_string_lossy().to_string()),
            source: Some(xyzrender_source_for_path(&path)),
            install_hint: INSTALL_HINT,
            message: "External xyzrender runtime is available".into(),
        },
        Err(error) => XyzrenderRuntimeStatus {
            installed: false,
            executable_path: None,
            source: None,
            install_hint: INSTALL_HINT,
            message: error,
        },
    }
}

fn xyzrender_source_for_path(path: &Path) -> &'static str {
    let text = path.to_string_lossy();
    if text.contains("xyzrender-runtime") {
        "bundled"
    } else if text.contains(".local/bin") || text.contains(".local/share") {
        "user-local"
    } else if text.contains("/opt/homebrew/") || text.contains("/usr/local/") {
        "system"
    } else {
        "resolved-path"
    }
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
    fn detects_periodic_ref_rejection() {
        assert!(xyzrender_ref_unsupported_for_periodic(
            "xyzrender: error: --ref is not supported for periodic structures"
        ));
        assert!(!xyzrender_ref_unsupported_for_periodic(
            "xyzrender: error: input could not be parsed"
        ));
    }

    #[test]
    fn xyzrender_cache_key_changes_for_file_and_controls() {
        let directory = std::env::temp_dir().join(format!(
            "burrete-xyzrender-cache-key-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let input = directory.join("input.xyz");
        let executable = directory.join("xyzrender");
        fs::write(&input, "1\nA\nH 0 0 0\n").expect("input should be written");
        fs::write(&executable, "#!/bin/sh\n").expect("executable should be written");

        let base_key = xyzrender_cache_key(
            &input,
            None,
            None,
            None,
            "default",
            "default",
            None,
            &executable,
        )
        .expect("cache key should be built");
        let controls = XyzrenderControls {
            atom_scale: Some(1.4),
            ..XyzrenderControls::default()
        };
        let controls_key = xyzrender_cache_key(
            &input,
            None,
            None,
            None,
            "default",
            "default",
            Some(&controls),
            &executable,
        )
        .expect("cache key should include controls");
        fs::write(&input, "2\nA\nH 0 0 0\nH 0 0 1\n").expect("input should change");
        let changed_file_key = xyzrender_cache_key(
            &input,
            None,
            None,
            None,
            "default",
            "default",
            None,
            &executable,
        )
        .expect("cache key should include file metadata");

        assert_ne!(base_key, controls_key);
        assert_ne!(base_key, changed_file_key);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn xyzrender_cache_key_uses_inline_content_not_temporary_path() {
        let directory = std::env::temp_dir().join(format!(
            "burrete-xyzrender-inline-cache-key-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        let input_a = directory.join("a").join("sheet-input.mol");
        let input_b = directory.join("b").join("sheet-input.mol");
        let executable = directory.join("xyzrender");
        fs::create_dir_all(input_a.parent().unwrap()).expect("input directory should be created");
        fs::create_dir_all(input_b.parent().unwrap()).expect("input directory should be created");
        fs::write(&input_a, "temporary A").expect("input should be written");
        fs::write(&input_b, "temporary B").expect("input should be written");
        fs::write(&executable, "#!/bin/sh\n").expect("executable should be written");
        let converted = b"2\ninline\nH 0 0 0\nH 0 0 1\n";

        let key_a = xyzrender_cache_key(
            &input_a,
            Some(converted),
            None,
            None,
            "default",
            "default",
            None,
            &executable,
        )
        .expect("cache key should be built");
        let key_b = xyzrender_cache_key(
            &input_b,
            Some(converted),
            None,
            None,
            "default",
            "default",
            None,
            &executable,
        )
        .expect("cache key should be built");
        let smiles_key = xyzrender_cache_key(
            &input_b,
            None,
            Some("CCO"),
            None,
            "default",
            "default",
            None,
            &executable,
        )
        .expect("cache key should include direct smiles");

        assert_eq!(key_a, key_b);
        assert_ne!(key_a, smiles_key);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn cached_xyzrender_artifact_copies_svg_without_process() {
        let directory = std::env::temp_dir().join(format!(
            "burrete-xyzrender-cache-hit-{}",
            uuid::Uuid::new_v4()
        ));
        let entry = directory.join("entry");
        let runtime = directory.join("runtime");
        fs::create_dir_all(&entry).expect("cache entry should be created");
        fs::create_dir_all(&runtime).expect("runtime should be created");
        fs::write(entry.join("xyzrender.svg"), "<svg id=\"cached\" />")
            .expect("cached svg should be written");
        fs::write(entry.join("log.txt"), "cached log").expect("cached log should be written");

        let artifact = read_cached_xyzrender_artifact(
            &entry,
            &runtime.join("xyzrender.svg"),
            &runtime.join("xyzrender.log"),
            "cache-key",
            "default",
            "default",
            Some("density"),
        )
        .expect("cache read should not fail")
        .expect("cache entry should be valid");

        assert!(artifact.cache_hit);
        assert_eq!(artifact.surface_mode.as_deref(), Some("density"));
        assert_eq!(artifact.cache_key, "cache-key");
        assert!(artifact.inline_svg.contains("cached"));
        assert_eq!(
            fs::read_to_string(runtime.join("xyzrender.log")).expect("runtime log should exist"),
            "cached log"
        );
        let _ = fs::remove_dir_all(&directory);
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
    fn resolves_bundled_xyzrender_batch_helper_python_from_shell_wrapper() {
        let directory = std::env::temp_dir().join(format!(
            "burrete-xyzrender-batch-python-{}",
            uuid::Uuid::new_v4()
        ));
        let runtime_bin = directory.join("Resources/xyzrender-runtime/bin");
        let site_packages =
            directory.join("Resources/xyzrender-runtime/lib/python3.13/site-packages");
        let python_bin = directory.join("Resources/xyzrender-python/bin");
        fs::create_dir_all(&runtime_bin).expect("runtime bin should be created");
        fs::create_dir_all(&site_packages).expect("site-packages should be created");
        fs::create_dir_all(&python_bin).expect("python bin should be created");
        let wrapper = runtime_bin.join("xyzrender");
        let python = python_bin.join("python3");
        fs::write(&wrapper, "#!/bin/sh\nexec \"$0\"\n").expect("wrapper should be written");
        fs::write(&python, "").expect("python should be written");

        let launch = xyzrender_batch_helper_launch(&wrapper)
            .expect("bundled shell wrapper should resolve adjacent python");

        assert_eq!(launch.program, python);
        assert!(launch.envs.iter().any(|(key, value)| {
            *key == "PYTHONPATH" && value == &site_packages.display().to_string()
        }));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn default_cube_controls_select_expected_field_surfaces() {
        let density =
            default_cube_surface_defaults(Path::new("/tmp/caffeine_dens.cube"), "density cube\n");
        assert_eq!(density.controls.field_mode.as_deref(), Some("density"));
        assert_eq!(density.controls.field_opacity, Some(0.45));
        assert_eq!(
            density.controls.field_surface_style.as_deref(),
            Some("solid")
        );

        let esp = default_cube_surface_defaults(
            Path::new("/tmp/caffeine_esp.cube"),
            "electrostatic potential\n",
        );
        assert_eq!(esp.controls.field_mode.as_deref(), Some("esp"));
        assert_eq!(esp.controls.field_opacity, Some(0.5));
        assert_eq!(esp.controls.field_surface_style.as_deref(), Some("solid"));

        let homo = default_cube_surface_defaults(
            Path::new("/tmp/caffeine_homo.cube"),
            "molecular orbital\n",
        );
        assert_eq!(homo.controls.field_mode.as_deref(), Some("mo"));
        assert_eq!(homo.controls.field_opacity, Some(0.62));
        assert_eq!(homo.controls.field_surface_style.as_deref(), Some("solid"));
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
            None,
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
        let zero_iso_args =
            build_xyzrender_args(&input, &output, "default", None, Some(&controls), None);
        assert!(!zero_iso_args.join(" ").contains("--iso 0"));

        let vdw_args = build_xyzrender_args(&input, &output, "vdw", None, None, None);
        let vdw_joined = vdw_args.join(" ");
        assert!(vdw_joined.contains("--config default"));
        assert!(vdw_joined.contains("--vdw"));
    }

    #[test]
    fn builds_direct_smiles_xyzrender_args() {
        let input = PathBuf::from("/tmp/in.smi");
        let output = PathBuf::from("/tmp/out.svg");
        let controls = XyzrenderControls {
            field_mode: Some("esp".into()),
            ..XyzrenderControls::default()
        };

        let args = build_xyzrender_args(
            &input,
            &output,
            "default",
            None,
            Some(&controls),
            Some("c1ccccc1"),
        );
        let joined = args.join(" ");

        assert!(joined.starts_with("--smi c1ccccc1 -o /tmp/out.svg --config default"));
        assert!(!joined.contains("/tmp/in.smi"));
        assert!(!joined.contains("--esp"));
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
        assert_eq!(defaults.controls.field_mode.as_deref(), Some("mo"));
        assert_eq!(defaults.controls.field_opacity, Some(0.62));
        assert_eq!(
            defaults.controls.field_surface_style.as_deref(),
            Some("solid")
        );

        let defaults = default_xyzrender_document_defaults(
            "cube",
            Path::new("/tmp/caffeine_esp.cube"),
            b"Cube data generated by ORCA\nElectrostatic Potential\n",
        )
        .expect("cube should get default controls");
        assert_eq!(defaults.controls.field_mode.as_deref(), Some("esp"));
        assert_eq!(defaults.controls.field_opacity, Some(0.5));
        assert_eq!(
            defaults.controls.field_surface_style.as_deref(),
            Some("solid")
        );

        let defaults = default_xyzrender_document_defaults(
            "cube",
            Path::new("/tmp/caffeine_dens.cube"),
            b"Cube data generated by ORCA\nTotal electron density\n",
        )
        .expect("cube should get default controls");
        assert_eq!(defaults.controls.field_mode.as_deref(), Some("density"));
        assert_eq!(defaults.controls.field_opacity, Some(0.45));
        assert_eq!(
            defaults.controls.field_surface_style.as_deref(),
            Some("solid")
        );
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
        assert_eq!(defaults.input_path.as_deref(), Some(dens_path.as_path()));
        assert_eq!(defaults.controls.field_mode.as_deref(), None);
        assert!(defaults
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

        let sl2r_path = directory.join("phenol_di-sl2r.cub");
        let dg_inter_path = directory.join("phenol_di-dg_inter.cub");
        fs::write(&sl2r_path, b"sl2r").expect("sl2r cube fixture should be written");
        fs::write(&dg_inter_path, b"dg inter").expect("dg cube fixture should be written");

        let defaults = default_xyzrender_document_defaults(
            "cub",
            &sl2r_path,
            b"Cube data generated by Multiwfn\nsl2r field\n",
        )
        .expect("sl2r cube should get nci defaults");
        assert_eq!(defaults.input_path.as_deref(), None);
        let extra_arguments = defaults
            .controls
            .extra_arguments
            .as_deref()
            .unwrap_or_default();
        assert!(extra_arguments.contains("--nci-surf"));
        assert!(extra_arguments.contains("0.005"));

        let _ = fs::remove_dir_all(directory);
    }
}
