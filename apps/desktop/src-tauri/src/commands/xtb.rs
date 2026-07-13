use crate::commands::xtb_runtime::{self, XtbRuntimeSource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{ErrorKind, Read, Write};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

const XTB_LOG_CAPTURE_BYTES: usize = 128 * 1024;
const DEFAULT_XTB_TIMEOUT_SECONDS: u64 = 180;
const XTB_RUN_METADATA_FILE: &str = ".burrete-xtb-run.json";

type RunningXtbJobs = Mutex<HashMap<String, Arc<Mutex<Child>>>>;
static RUNNING_XTB_JOBS: OnceLock<RunningXtbJobs> = OnceLock::new();
static CANCELLED_XTB_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct XtbJobCleanup {
    job_id: Option<String>,
}

impl Drop for XtbJobCleanup {
    fn drop(&mut self) {
        finish_xtb_job(self.job_id.as_deref());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XtbStatus {
    installed: bool,
    executable_path: Option<String>,
    version: Option<String>,
    installer: Option<String>,
    install_hint: String,
    source: Option<XtbRuntimeSource>,
    selected_executable_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XtbRunRequest {
    operation: String,
    job_id: Option<String>,
    input_path: Option<String>,
    input_text: Option<String>,
    input_extension: Option<String>,
    source_path: Option<String>,
    label: Option<String>,
    method: Option<String>,
    charge: Option<i32>,
    uhf: Option<i32>,
    opt_level: Option<String>,
    solvation_model: Option<String>,
    solvent: Option<String>,
    threads: Option<u32>,
    accuracy: Option<f64>,
    electronic_temperature: Option<i32>,
    properties: Option<Value>,
    md_temperature: Option<i32>,
    md_time_ps: Option<f64>,
    md_step_fs: Option<f64>,
    md_snapshots: Option<i32>,
    timeout_seconds: Option<u64>,
    save_run_files: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XtbArtifact {
    path: String,
    title: String,
    extension: String,
    kind: String,
    byte_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XtbRunResult {
    ok: bool,
    operation: String,
    command: Vec<String>,
    work_dir: String,
    elapsed_ms: u128,
    exit_code: Option<i32>,
    log_path: String,
    report_path: String,
    primary_open_path: Option<String>,
    artifacts: Vec<XtbArtifact>,
    summary: Option<Value>,
    error: Option<String>,
}

#[tauri::command]
pub(crate) fn xtb_status<R: Runtime>(app: tauri::AppHandle<R>) -> XtbStatus {
    xtb_status_from_environment(&app)
}

#[tauri::command]
pub(crate) fn select_xtb_executable<R: Runtime>(
    app: tauri::AppHandle<R>,
    executable_path: Option<String>,
) -> Result<XtbStatus, String> {
    xtb_runtime::select(&app, executable_path)?;
    Ok(xtb_status_from_environment(&app))
}

#[tauri::command]
pub(crate) async fn install_xtb<R: Runtime>(app: tauri::AppHandle<R>) -> Result<XtbStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        xtb_runtime::install_managed(&app)?;
        Ok(xtb_status_from_environment(&app))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_xtb_job<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: XtbRunRequest,
) -> Result<XtbRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_xtb_job_blocking(app, request))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_xtb_job(job_id: String) -> Result<(), String> {
    let job_id = job_id.trim().to_string();
    if job_id.is_empty() {
        return Ok(());
    }
    cancelled_xtb_jobs()
        .lock()
        .map_err(|_| "xTB job cancellation registry is unavailable.".to_string())?
        .insert(job_id.clone());
    let child = {
        let registry = running_xtb_jobs();
        let jobs = registry
            .lock()
            .map_err(|_| "xTB job registry is unavailable.".to_string())?;
        jobs.get(&job_id).cloned()
    };
    let Some(child) = child else {
        return Ok(());
    };
    let mut child = child
        .lock()
        .map_err(|_| "xTB job process is unavailable.".to_string())?;
    match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => child
            .kill()
            .map_err(|err| format!("Could not cancel xTB job: {err}")),
        Err(err) => Err(format!("Could not inspect xTB job: {err}")),
    }
}

fn run_xtb_job_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: XtbRunRequest,
) -> Result<XtbRunResult, String> {
    let started = Instant::now();
    let job_id = request
        .job_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let _job_cleanup = XtbJobCleanup {
        job_id: job_id.clone(),
    };
    assert_supported_xtb_operation(&request.operation)?;
    let started_at_ms = unix_timestamp_ms();
    let executable = xtb_runtime::resolve(&app)?.executable_path;
    let work_dir = xtb_work_dir(&app, &request)?;
    write_xtb_run_metadata(&work_dir, &request, started_at_ms)?;
    let log_path = work_dir.join("xtb.log");
    let report_path = work_dir.join("xtb-report.md");
    let input_path = prepare_xtb_input_with_hydrogens(
        &prepare_xtb_input(&request, &work_dir)?,
        &work_dir,
        "input-with-h",
    )?;
    let command_args = build_xtb_args(&request, &input_path, &work_dir)?;
    let timeout = Duration::from_secs(
        request
            .timeout_seconds
            .unwrap_or(DEFAULT_XTB_TIMEOUT_SECONDS)
            .max(1),
    );
    let threads = request.threads.unwrap_or(0);

    let (status, log) = run_xtb_command(
        &executable,
        &command_args,
        &work_dir,
        &log_path,
        timeout,
        threads,
        job_id.as_deref(),
    )?;
    let cancelled = xtb_job_was_cancelled(job_id.as_deref());
    let artifacts = if cancelled {
        Vec::new()
    } else {
        collect_xtb_artifacts(&work_dir)?
    };
    let summary = if cancelled {
        None
    } else {
        read_xtb_summary(&work_dir)
    };
    let primary_open_path = if cancelled {
        None
    } else {
        primary_open_path_for(&request.operation, &artifacts)
    };
    let ok = status.success() && !cancelled;
    let error = if cancelled {
        Some("xTB job cancelled.".into())
    } else if ok {
        None
    } else if status.code() == Some(124) {
        Some(format!(
            "xTB timed out after {} seconds. {}",
            timeout.as_secs(),
            truncate_text(&log, 480)
        ))
    } else {
        let recovery_note = if primary_open_path.is_some() {
            " A partial artifact was captured, but xTB did not produce a complete final result."
        } else {
            ""
        };
        Some(format!(
            "xTB ended {}.{} {}",
            xtb_exit_status_text(status),
            recovery_note,
            truncate_text(&log, 480)
        ))
    };
    let result = XtbRunResult {
        ok,
        operation: request.operation.clone(),
        command: std::iter::once(executable.to_string_lossy().to_string())
            .chain(command_args.iter().cloned())
            .collect(),
        work_dir: work_dir.to_string_lossy().to_string(),
        elapsed_ms: started.elapsed().as_millis(),
        exit_code: status.code(),
        log_path: log_path.to_string_lossy().to_string(),
        report_path: report_path.to_string_lossy().to_string(),
        primary_open_path,
        artifacts,
        summary,
        error,
    };
    write_xtb_report(&report_path, &result, &log)?;
    Ok(result)
}

fn xtb_work_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: &XtbRunRequest,
) -> Result<PathBuf, String> {
    if request.save_run_files.unwrap_or(true) {
        if let Some(source_path) = request
            .source_path
            .as_deref()
            .or(request.input_path.as_deref())
        {
            let canonical = PathBuf::from(source_path)
                .canonicalize()
                .map_err(|err| format!("{source_path}: {err}"))?;
            if !canonical.is_file() {
                return Err(format!("{} is not a file.", canonical.display()));
            }
            let parent = xtb_run_parent_for_source_path(&canonical)?;
            return create_numbered_xtb_run_dir(&parent, &request.operation);
        }
    }

    let cache_dir = app.path().app_cache_dir().map_err(|err| err.to_string())?;
    let work_dir = cache_dir.join("xtb-jobs").join(format!(
        "{}-{}",
        unix_timestamp_ms(),
        safe_slug(request.label.as_deref().unwrap_or(&request.operation))
    ));
    fs::create_dir_all(&work_dir).map_err(|err| format!("{}: {err}", work_dir.display()))?;
    Ok(work_dir)
}

fn create_numbered_xtb_run_dir(parent: &Path, operation: &str) -> Result<PathBuf, String> {
    let prefix = xtb_run_dir_prefix(operation);
    for index in 1..=9999 {
        let work_dir = parent.join(format!("{prefix}_{index}"));
        match fs::create_dir(&work_dir) {
            Ok(()) => return Ok(work_dir),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("{}: {err}", work_dir.display())),
        }
    }
    Err(format!(
        "Could not create a {prefix}_N directory in {}.",
        parent.display()
    ))
}

fn xtb_run_parent_for_source_path(path: &Path) -> Result<PathBuf, String> {
    let mut parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory.", path.display()))?
        .to_path_buf();
    while parent
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(is_xtb_run_dir_name)
    {
        parent = parent
            .parent()
            .ok_or_else(|| format!("{} has no parent directory.", parent.display()))?
            .to_path_buf();
    }
    Ok(parent)
}

fn is_xtb_run_dir_name(name: &str) -> bool {
    let Some((prefix, suffix)) = name.rsplit_once('_') else {
        return false;
    };
    matches!(
        prefix,
        "xtb_run"
            | "xtb_optimize"
            | "xtb_properties"
            | "xtb_hessian"
            | "xtb_ip_ea"
            | "xtb_fukui"
            | "xtb_md"
            | "xtb_metadyn"
    ) && !suffix.is_empty()
        && suffix.chars().all(|ch| ch.is_ascii_digit())
}

fn xtb_run_dir_prefix(operation: &str) -> &'static str {
    match operation {
        "optimize" => "xtb_optimize",
        "properties" => "xtb_properties",
        "optimized-hessian" => "xtb_hessian",
        "vipea" => "xtb_ip_ea",
        "vfukui" => "xtb_fukui",
        "md" => "xtb_md",
        "metadyn" => "xtb_metadyn",
        _ => "xtb_run",
    }
}

fn write_xtb_run_metadata(
    work_dir: &Path,
    request: &XtbRunRequest,
    started_at_ms: u128,
) -> Result<(), String> {
    let operation_label = xtb_operation_label(&request.operation);
    let input_label = request
        .source_path
        .as_deref()
        .or(request.input_path.as_deref())
        .or(request.label.as_deref())
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or(&request.operation);
    let title = if input_label.is_empty() {
        operation_label.to_string()
    } else {
        format!("{operation_label} · {input_label}")
    };
    let metadata = json!({
        "kind": "xtb-run",
        "operation": &request.operation,
        "operationLabel": operation_label,
        "inputLabel": input_label,
        "title": title,
        "createdAtMs": started_at_ms,
    });
    let path = work_dir.join(XTB_RUN_METADATA_FILE);
    fs::write(
        &path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&metadata).map_err(|err| err.to_string())?
        ),
    )
    .map_err(|err| format!("{}: {err}", path.display()))
}

fn xtb_operation_label(operation: &str) -> &'static str {
    match operation {
        "optimize" => "xTB Optimize",
        "properties" => "xTB Properties",
        "cube" => "xTB Cube",
        "hessian" => "xTB Hessian",
        "optimized-hessian" => "xTB Optimized Hessian",
        "vip" | "vea" | "vipea" => "xTB IP/EA",
        "vfukui" => "xTB Fukui",
        "vomega" => "xTB Omega",
        "md" => "xTB MD",
        "metadyn" => "xTB Metadynamics",
        _ => "xTB Job",
    }
}

fn assert_supported_xtb_operation(operation: &str) -> Result<(), String> {
    if operation == "grid-properties" {
        return Err("xTB Properties requires one molecule. Open a specific molecule in Mol* before running it.".into());
    }
    Ok(())
}

fn xtb_status_from_environment<R: Runtime>(app: &tauri::AppHandle<R>) -> XtbStatus {
    match xtb_runtime::resolve(app) {
        Ok(resolution) => XtbStatus {
            installed: true,
            version: xtb_version(&resolution.executable_path),
            installer: installer_for_executable(&resolution.executable_path),
            executable_path: Some(resolution.executable_path.to_string_lossy().to_string()),
            install_hint: "xTB is available. Burrete will use this executable for local xTB jobs."
                .into(),
            source: Some(resolution.source),
            selected_executable_path: resolution
                .selected_executable_path
                .map(|path| path.to_string_lossy().to_string()),
        },
        Err(error) => XtbStatus {
            installed: false,
            executable_path: None,
            version: None,
            installer: resolve_executable("pixi").map(|_| "pixi".to_string()),
            install_hint: error,
            source: None,
            selected_executable_path: xtb_runtime::selected(app)
                .ok()
                .flatten()
                .map(|path| path.to_string_lossy().to_string()),
        },
    }
}

fn resolve_executable(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".pixi/bin").join(name));
        candidates.push(home.join(".local/bin").join(name));
        candidates.push(home.join(".cargo/bin").join(name));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
    ]);
    candidates
        .into_iter()
        .find(|path| path.is_file() && is_executable(path))
}

fn installer_for_executable(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    if text.contains("/.pixi/") {
        Some("pixi".into())
    } else if text.contains("/.local/bin/") {
        Some("uv-or-local".into())
    } else if text.contains("homebrew")
        || text.contains("/opt/homebrew/")
        || text.contains("/usr/local/")
    {
        Some("homebrew-or-path".into())
    } else {
        Some("path".into())
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

fn xtb_version(executable: &Path) -> Option<String> {
    let started = Instant::now();
    let mut child = Command::new(executable)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let status = loop {
        match child.try_wait().ok()? {
            Some(status) => break status,
            None if started.elapsed() < Duration::from_secs(5) => {
                thread::sleep(Duration::from_millis(20));
            }
            None => {
                child.kill().ok();
                child.wait().ok();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    child
        .stdout
        .take()?
        .take(128 * 1024)
        .read_to_end(&mut stdout)
        .ok()?;
    child
        .stderr
        .take()?
        .take(128 * 1024)
        .read_to_end(&mut stderr)
        .ok()?;
    let text = command_output_text(&stdout, &stderr);
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    lines
        .iter()
        .find(|line| line.to_ascii_lowercase().contains("xtb version"))
        .or_else(|| {
            lines
                .iter()
                .find(|line| line.to_ascii_lowercase().contains("version"))
        })
        .map(|line| (*line).to_string())
}

fn prepare_xtb_input(request: &XtbRunRequest, work_dir: &Path) -> Result<PathBuf, String> {
    if let Some(text) = request
        .input_text
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let extension = request
            .input_extension
            .as_deref()
            .unwrap_or("xyz")
            .trim_start_matches('.');
        let path = work_dir.join(format!("input.{}", safe_extension(extension)));
        fs::write(&path, text).map_err(|err| format!("{}: {err}", path.display()))?;
        return Ok(path);
    }
    let input_path = request
        .input_path
        .as_deref()
        .ok_or_else(|| "xTB job requires inputPath or inputText.".to_string())?;
    let canonical = PathBuf::from(input_path)
        .canonicalize()
        .map_err(|err| format!("{input_path}: {err}"))?;
    if !canonical.is_file() {
        return Err(format!("{} is not a file.", canonical.display()));
    }
    Ok(canonical)
}

fn prepare_xtb_input_with_hydrogens(
    input_path: &Path,
    work_dir: &Path,
    output_stem: &str,
) -> Result<PathBuf, String> {
    let extension = input_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let prep_log_path = work_dir.join("xtb-prep.log");
    if !supports_openbabel_hydrogen_extension(&extension) {
        append_xtb_prep_log(
            &prep_log_path,
            &format!(
                "Skipped hydrogen preparation for unsupported input extension '{}': {}",
                extension,
                input_path.display()
            ),
        );
        return Ok(input_path.to_path_buf());
    }
    let Some(obabel) = resolve_executable("obabel") else {
        append_xtb_prep_log(
            &prep_log_path,
            "Open Babel executable 'obabel' was not found; xTB will use the original input.",
        );
        return Ok(input_path.to_path_buf());
    };
    if is_cif_extension(&extension) {
        return prepare_xtb_cif_input_with_hydrogens(input_path, work_dir, output_stem, &obabel);
    }
    let output_path = work_dir.join(format!("{output_stem}.{}", safe_extension(&extension)));
    let output = Command::new(&obabel)
        .args([
            input_path.to_string_lossy().to_string(),
            "-O".into(),
            output_path.to_string_lossy().to_string(),
            "-h".into(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Could not start Open Babel for xTB input preparation: {err}"))?;
    if output.status.success()
        && output_path
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    {
        append_xtb_prep_log(
            &prep_log_path,
            &format!(
                "Prepared xTB input with hydrogens using {}: {}",
                obabel.display(),
                output_path.display()
            ),
        );
        return Ok(output_path);
    }
    append_xtb_prep_log(
        &prep_log_path,
        &format!(
            "Open Babel hydrogen preparation failed; xTB will use the original input. {}",
            command_output_text(&output.stdout, &output.stderr)
        ),
    );
    Ok(input_path.to_path_buf())
}

fn prepare_xtb_cif_input_with_hydrogens(
    input_path: &Path,
    work_dir: &Path,
    output_stem: &str,
    obabel: &Path,
) -> Result<PathBuf, String> {
    let prep_log_path = work_dir.join("xtb-prep.log");
    let pdb_path = work_dir.join(format!("{output_stem}-cif.pdb"));
    let output_path = work_dir.join(format!("{output_stem}.xyz"));
    let pdb_output = Command::new(obabel)
        .args([
            input_path.to_string_lossy().to_string(),
            "-O".into(),
            pdb_path.to_string_lossy().to_string(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| {
            format!("Could not start Open Babel for CIF xTB input preparation: {err}")
        })?;
    if !pdb_output.status.success()
        || !pdb_path
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    {
        append_xtb_prep_log(
            &prep_log_path,
            &format!(
                "Open Babel CIF to PDB preparation failed; xTB will use the original input. {}",
                command_output_text(&pdb_output.stdout, &pdb_output.stderr)
            ),
        );
        return Ok(input_path.to_path_buf());
    }
    let xyz_output = Command::new(obabel)
        .args([
            pdb_path.to_string_lossy().to_string(),
            "-O".into(),
            output_path.to_string_lossy().to_string(),
            "-h".into(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Could not start Open Babel for CIF hydrogen preparation: {err}"))?;
    if xyz_output.status.success()
        && output_path
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    {
        append_xtb_prep_log(
            &prep_log_path,
            &format!(
                "Prepared CIF xTB input as XYZ with hydrogens using {}: {}",
                obabel.display(),
                output_path.display()
            ),
        );
        return Ok(output_path);
    }
    append_xtb_prep_log(
        &prep_log_path,
        &format!(
            "Open Babel CIF hydrogen preparation failed; xTB will use the original input. {}",
            command_output_text(&xyz_output.stdout, &xyz_output.stderr)
        ),
    );
    Ok(input_path.to_path_buf())
}

fn is_cif_extension(extension: &str) -> bool {
    matches!(extension, "cif" | "mcif" | "mmcif")
}

fn supports_openbabel_hydrogen_extension(extension: &str) -> bool {
    matches!(
        extension,
        "pdb" | "ent" | "mol" | "mol2" | "sdf" | "sd" | "xyz" | "cif" | "mcif" | "mmcif"
    )
}

fn append_xtb_prep_log(path: &Path, message: &str) {
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn build_xtb_args(
    request: &XtbRunRequest,
    input_path: &Path,
    work_dir: &Path,
) -> Result<Vec<String>, String> {
    let operation = request.operation.as_str();
    let mut args = Vec::new();
    args.push(input_path.to_string_lossy().to_string());
    match operation {
        "optimize" => {
            args.push("--opt".into());
            args.push(xtb_opt_level(request.opt_level.as_deref()));
            args.push("--json".into());
        }
        "properties" => {
            args.push("--scc".into());
            args.push("--json".into());
            args.extend(xtb_property_args(request.properties.as_ref()));
        }
        "cube" => {
            let input_file = work_dir.join("xcontrol.inp");
            fs::write(&input_file, "$cube\n  density=true\n$end\n")
                .map_err(|err| format!("{}: {err}", input_file.display()))?;
            args.push("--scc".into());
            args.push("--json".into());
            args.push("--input".into());
            args.push(input_file.to_string_lossy().to_string());
        }
        "hessian" => {
            args.push("--hess".into());
            args.push("--json".into());
        }
        "optimized-hessian" => {
            args.push("--ohess".into());
            args.push(xtb_opt_level(request.opt_level.as_deref()));
            args.push("--json".into());
        }
        "vip" | "vea" | "vipea" | "vfukui" | "vomega" => {
            args.push(format!("--{operation}"));
            args.push("--json".into());
        }
        "md" => {
            let input_file = work_dir.join("md.inp");
            fs::write(&input_file, xtb_md_input(request))
                .map_err(|err| format!("{}: {err}", input_file.display()))?;
            args.push("--omd".into());
            args.push("--input".into());
            args.push(input_file.to_string_lossy().to_string());
        }
        "metadyn" => {
            args.push("--metadyn".into());
            args.push(clamp_i32(request.md_snapshots, 1, 1000, 10).to_string());
            let input_file = work_dir.join("md.inp");
            fs::write(&input_file, xtb_md_input(request))
                .map_err(|err| format!("{}: {err}", input_file.display()))?;
            args.push("--input".into());
            args.push(input_file.to_string_lossy().to_string());
        }
        other => return Err(format!("Unsupported xTB operation: {other}")),
    }
    append_common_xtb_args(&mut args, request);
    Ok(args)
}

fn append_common_xtb_args(args: &mut Vec<String>, request: &XtbRunRequest) {
    match request.method.as_deref().unwrap_or("gfn2") {
        "gfn0" => args.extend(["--gfn".into(), "0".into()]),
        "gfn1" => args.extend(["--gfn".into(), "1".into()]),
        "gfn2" => args.extend(["--gfn".into(), "2".into()]),
        "gfnff" => args.push("--gfnff".into()),
        _ => {}
    }
    if let Some(charge) = request.charge {
        args.extend(["--chrg".into(), charge.to_string()]);
    }
    if let Some(uhf) = request.uhf {
        args.extend(["--uhf".into(), uhf.to_string()]);
    }
    if let Some(threads) = request.threads.filter(|value| *value > 0) {
        args.extend(["--parallel".into(), threads.min(32).to_string()]);
    }
    if let Some(accuracy) = request.accuracy {
        args.extend([
            "--acc".into(),
            clamp_f64(Some(accuracy), 0.05, 10.0, 1.0).to_string(),
        ]);
    }
    if let Some(etemp) = request.electronic_temperature {
        args.extend([
            "--etemp".into(),
            clamp_i32(Some(etemp), 50, 5000, 300).to_string(),
        ]);
    }
    if let Some(solvent) = request
        .solvent
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")
    {
        let model = request.solvation_model.as_deref().unwrap_or("none");
        if model != "none" {
            args.extend([xtb_solvation_flag(model).into(), solvent.to_string()]);
        }
    }
}

fn xtb_property_args(properties: Option<&Value>) -> Vec<String> {
    let value = properties.and_then(Value::as_object);
    let enabled = |key: &str, fallback: bool| {
        value
            .and_then(|object| object.get(key))
            .and_then(Value::as_bool)
            .unwrap_or(fallback)
    };
    let mut args = Vec::new();
    if enabled("dipole", true) {
        args.push("--dipole".into());
    }
    if enabled("wbo", true) {
        args.push("--wbo".into());
    }
    if enabled("population", false) {
        args.push("--pop".into());
    }
    if enabled("molden", false) {
        args.push("--molden".into());
    }
    if enabled("alpha", false) {
        args.push("--alpha".into());
    }
    if enabled("fod", false) {
        args.push("--fod".into());
    }
    if enabled("esp", false) {
        args.push("--esp".into());
    }
    if enabled("fukui", false) {
        args.push("--vfukui".into());
    }
    args
}

fn xtb_opt_level(value: Option<&str>) -> String {
    match value.unwrap_or("normal") {
        "loose" | "normal" | "tight" | "verytight" => value.unwrap_or("normal").into(),
        _ => "normal".into(),
    }
}

fn xtb_solvation_flag(model: &str) -> &'static str {
    match model {
        "gbsa" => "--gbsa",
        "cosmo" => "--cosmo",
        "cpcmx" | "cpcm-x" => "--cpcmx",
        _ => "--alpb",
    }
}

fn xtb_md_input(request: &XtbRunRequest) -> String {
    let time_ps = clamp_f64(request.md_time_ps, 0.05, 100.0, 2.0);
    let step_fs = clamp_f64(request.md_step_fs, 0.1, 10.0, 1.0);
    let snapshots = clamp_i32(request.md_snapshots, 1, 1000, 100) as f64;
    let dump_fs = (time_ps * 1000.0 / snapshots).max(step_fs);
    format!(
        "$md\n  temp={}\n  time={}\n  step={}\n  dump={}\n$end\n",
        clamp_i32(request.md_temperature, 50, 2000, 298),
        time_ps,
        step_fs,
        dump_fs,
    )
}

fn clamp_i32(value: Option<i32>, min: i32, max: i32, fallback: i32) -> i32 {
    value.unwrap_or(fallback).clamp(min, max)
}

fn clamp_f64(value: Option<f64>, min: f64, max: f64, fallback: f64) -> f64 {
    let number = value.unwrap_or(fallback);
    if number.is_finite() {
        number.clamp(min, max)
    } else {
        fallback
    }
}

fn running_xtb_jobs() -> &'static RunningXtbJobs {
    RUNNING_XTB_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_xtb_jobs() -> &'static Mutex<HashSet<String>> {
    CANCELLED_XTB_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn xtb_job_was_cancelled(job_id: Option<&str>) -> bool {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return false;
    };
    cancelled_xtb_jobs()
        .lock()
        .map(|jobs| jobs.contains(job_id))
        .unwrap_or(false)
}

fn finish_xtb_job(job_id: Option<&str>) {
    unregister_xtb_job(job_id);
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    if let Ok(mut jobs) = cancelled_xtb_jobs().lock() {
        jobs.remove(job_id);
    }
}

fn register_xtb_job(job_id: Option<&str>, child: Arc<Mutex<Child>>) -> Result<(), String> {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let registry = running_xtb_jobs();
    let mut jobs = registry
        .lock()
        .map_err(|_| "xTB job registry is unavailable.".to_string())?;
    jobs.insert(job_id.to_string(), child);
    Ok(())
}

fn unregister_xtb_job(job_id: Option<&str>) {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    if let Ok(mut jobs) = running_xtb_jobs().lock() {
        jobs.remove(job_id);
    }
}

fn run_xtb_command(
    executable: &Path,
    args: &[String],
    work_dir: &Path,
    log_path: &Path,
    timeout: Duration,
    threads: u32,
    job_id: Option<&str>,
) -> Result<(ExitStatus, String), String> {
    if xtb_job_was_cancelled(job_id) {
        let log = "xTB job cancelled before the process started.\n".to_string();
        fs::write(log_path, &log).map_err(|err| format!("{}: {err}", log_path.display()))?;
        return Ok((cancelled_exit_status(), log));
    }
    let mut command = Command::new(executable);
    command.args(args).current_dir(work_dir);
    if threads > 0 {
        command.env("OMP_NUM_THREADS", threads.to_string());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("xTB could not be started: {err}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture xTB stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture xTB stderr.".to_string())?;
    let child = Arc::new(Mutex::new(child));
    register_xtb_job(job_id, Arc::clone(&child))?;
    let stdout_reader = thread::spawn(move || read_capped_text(stdout));
    let stderr_reader = thread::spawn(move || read_capped_text(stderr));
    let started = Instant::now();

    loop {
        if xtb_job_was_cancelled(job_id) {
            {
                let mut child = child
                    .lock()
                    .map_err(|_| "xTB job process is unavailable.".to_string())?;
                let _ = child.kill();
                let _ = child.wait();
            }
            unregister_xtb_job(job_id);
            let log = collect_xtb_log(stdout_reader, stderr_reader, log_path);
            return Ok((cancelled_exit_status(), log));
        }
        let status = {
            let mut child = child
                .lock()
                .map_err(|_| "xTB job process is unavailable.".to_string())?;
            child
                .try_wait()
                .map_err(|err| format!("Could not wait for xTB: {err}"))?
        };
        if let Some(status) = status {
            unregister_xtb_job(job_id);
            let log = collect_xtb_log(stdout_reader, stderr_reader, log_path);
            return Ok((status, log));
        }
        if started.elapsed() >= timeout {
            {
                let mut child = child
                    .lock()
                    .map_err(|_| "xTB job process is unavailable.".to_string())?;
                let _ = child.kill();
                let _ = child.wait();
            }
            unregister_xtb_job(job_id);
            let log = collect_xtb_log(stdout_reader, stderr_reader, log_path);
            return Ok((timeout_exit_status(), log));
        }
        thread::sleep(Duration::from_millis(80));
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
        let remaining = XTB_LOG_CAPTURE_BYTES.saturating_sub(stored.len());
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
        text.push_str("\n... xTB log truncated ...");
    }
    text
}

fn collect_xtb_log(
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

fn collect_xtb_artifacts(work_dir: &Path) -> Result<Vec<XtbArtifact>, String> {
    let mut artifacts = Vec::new();
    for entry in fs::read_dir(work_dir).map_err(|err| format!("{}: {err}", work_dir.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let title = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("artifact")
            .to_string();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = artifact_kind(&title, &extension);
        if kind == "internal" {
            continue;
        }
        artifacts.push(XtbArtifact {
            path: path.to_string_lossy().to_string(),
            title,
            extension,
            kind,
            byte_count: metadata.len(),
        });
    }
    artifacts.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(artifacts)
}

fn artifact_kind(title: &str, extension: &str) -> String {
    if title == XTB_RUN_METADATA_FILE
        || matches!(
            title,
            "xcontrol.inp"
                | "md.inp"
                | "input.sdf"
                | "input.xyz"
                | "input.mol"
                | "input.pdb"
                | "input.cif"
        )
        || title.starts_with("input-with-h.")
        || title.starts_with("input-with-h-")
        || (title.starts_with("secondary-") && title.contains("-with-h."))
        || (title.starts_with("secondary-") && title.contains("-with-h-"))
    {
        return "internal".into();
    }
    if title == "xtbopt.log" {
        return "trajectory".into();
    }
    match extension {
        "xyz" | "sdf" | "mol" | "pdb" | "cif" => "structure",
        "cub" | "cube" => "cube",
        "json" => "json",
        "log" | "out" => "log",
        "trj" | "arc" => "trajectory",
        "md" | "txt" => "text",
        _ => "artifact",
    }
    .into()
}

fn primary_open_path_for(operation: &str, artifacts: &[XtbArtifact]) -> Option<String> {
    let preferred = match operation {
        "optimize" => [
            "xtbopt.xyz",
            "xtbopt.pdb",
            "xtbopt.sdf",
            "xtbopt.mol",
            "xtbopt.log",
        ]
        .as_slice(),
        "optimized-hessian" => ["xtbopt.xyz", "xtbopt.pdb", "xtbopt.sdf", "xtbopt.mol"].as_slice(),
        "cube" => ["density.cub", "fod.cub", "density.cube"].as_slice(),
        "md" | "metadyn" => ["xtb.trj", "xtbopt.xyz"].as_slice(),
        _ => &[][..],
    };
    for name in preferred {
        if let Some(artifact) = artifacts.iter().find(|artifact| artifact.title == *name) {
            return Some(artifact.path.clone());
        }
    }
    None
}

fn xtb_exit_status_text(status: ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("with exit code {code}");
    }
    #[cfg(unix)]
    if let Some(signal) = status.signal() {
        return format!("after signal {signal}");
    }
    "without an exit code".into()
}

fn xtb_result_status_label(result: &XtbRunResult) -> &'static str {
    if result.exit_code == Some(130) {
        "cancelled"
    } else if result.ok {
        "success"
    } else if result.primary_open_path.is_some() {
        "recovered"
    } else {
        "failed"
    }
}

fn read_xtb_summary(work_dir: &Path) -> Option<Value> {
    let mut summary = None;
    for name in ["xtbout.json", "xtb.json"] {
        let path = work_dir.join(name);
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                summary = Some(value);
                break;
            }
        }
    }
    let mut value = summary.unwrap_or_else(|| json!({}));
    if let Some(object) = value.as_object_mut() {
        for (key, metric) in read_xtb_log_metrics(&work_dir.join("xtb.log")) {
            object.entry(key).or_insert(metric);
        }
        if !object.contains_key("partial charges") {
            let charges = read_xtb_numeric_rows(&work_dir.join("charges"));
            if !charges.is_empty() {
                object.insert("buretteCharges".into(), json!(charges));
            }
        }
        let wbo = read_xtb_wbo_rows(&work_dir.join("wbo"));
        if !wbo.is_empty() {
            object.insert("buretteWbo".into(), json!(wbo));
        }
        let fukui = read_xtb_fukui_rows(&work_dir.join("xtb.log"));
        if !fukui.is_empty() {
            object.insert("buretteFukui".into(), json!(fukui));
        }
    }
    value.as_object().filter(|object| !object.is_empty())?;
    Some(value)
}

fn read_xtb_log_metrics(path: &Path) -> Map<String, Value> {
    let Ok(text) = fs::read_to_string(path) else {
        return Map::new();
    };
    parse_xtb_log_metrics(&text)
}

fn parse_xtb_log_metrics(text: &str) -> Map<String, Value> {
    let mut metrics = Map::new();
    let mut in_dipole = false;
    for line in text.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        if (trimmed.contains(":: total energy") || trimmed.contains("| TOTAL ENERGY"))
            && !lower.contains("gain")
        {
            if let Some(value) = parse_xtb_float_values(trimmed).first().copied() {
                metrics.insert("total energy".into(), json!(value));
            }
        }
        if trimmed.contains(":: HOMO-LUMO gap") || trimmed.contains("| HOMO-LUMO GAP") {
            if let Some(value) = parse_xtb_float_values(trimmed).first().copied() {
                metrics.insert("HOMO-LUMO gap / eV".into(), json!(value));
            }
        }
        if lower == "molecular dipole:" {
            in_dipole = true;
            continue;
        }
        if in_dipole {
            if lower.starts_with("full:") {
                let values = parse_xtb_float_values(trimmed);
                if values.len() >= 3 {
                    metrics.insert(
                        "dipole / a.u.".into(),
                        json!([values[0], values[1], values[2]]),
                    );
                }
                in_dipole = false;
            } else if trimmed.starts_with("molecular quadrupole") {
                in_dipole = false;
            }
        }
    }
    metrics
}

fn parse_xtb_float_values(line: &str) -> Vec<f64> {
    line.split_whitespace()
        .filter_map(parse_xtb_float_token)
        .filter(|value| value.is_finite())
        .collect()
}

fn parse_xtb_float_token(token: &str) -> Option<f64> {
    let value = token.trim_matches(|character: char| {
        !(character.is_ascii_digit()
            || character == '-'
            || character == '+'
            || character == '.'
            || character == 'e'
            || character == 'E')
    });
    if value.is_empty() {
        return None;
    }
    value.parse::<f64>().ok()
}

fn read_xtb_numeric_rows(path: &Path) -> Vec<f64> {
    fs::read_to_string(path)
        .ok()
        .map(|text| {
            text.lines()
                .filter_map(|line| line.trim().parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .collect()
        })
        .unwrap_or_default()
}

fn read_xtb_wbo_rows(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .ok()
        .map(|text| {
            text.lines()
                .filter_map(|line| {
                    let values = line
                        .split_whitespace()
                        .filter_map(|value| value.parse::<f64>().ok())
                        .collect::<Vec<_>>();
                    if values.len() >= 3 {
                        Some(json!({ "from": values[0], "to": values[1], "order": values[2] }))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn read_xtb_fukui_rows(path: &Path) -> Vec<Value> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    let mut in_section = false;
    for line in text.lines() {
        if line.contains("Fukui functions:") {
            in_section = true;
            continue;
        }
        if !in_section {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        let Some(atom_label) = parts.first() else {
            continue;
        };
        let Some(atom) = atom_label
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok()
        else {
            if !rows.is_empty() {
                break;
            }
            continue;
        };
        let mut element = atom_label
            .chars()
            .skip_while(|character| character.is_ascii_digit())
            .collect::<String>();
        let mut value_start = 1;
        if element.is_empty()
            && parts.get(1).is_some_and(|part| {
                part.chars()
                    .all(|character| character.is_ascii_alphabetic())
            })
        {
            element = parts[1].to_string();
            value_start = 2;
        }
        if element.is_empty() {
            if !rows.is_empty() {
                break;
            }
            continue;
        }
        let values = parts
            .iter()
            .skip(value_start)
            .take(3)
            .filter_map(|value| value.parse::<f64>().ok())
            .collect::<Vec<_>>();
        if values.len() != 3 || !values.iter().all(|value| value.is_finite()) {
            if !rows.is_empty() {
                break;
            }
            continue;
        }
        rows.push(json!({
            "atom": atom,
            "element": element,
            "fplus": values[0],
            "fminus": values[1],
            "fzero": values[2],
        }));
    }
    rows
}

fn write_xtb_report(path: &Path, result: &XtbRunResult, log: &str) -> Result<(), String> {
    let mut report = String::new();
    report.push_str("# xTB Job Report\n\n");
    report.push_str(&format!("- Operation: `{}`\n", result.operation));
    report.push_str(&format!(
        "- Status: `{}`\n",
        xtb_result_status_label(result)
    ));
    report.push_str(&format!(
        "- Exit code: `{}`\n",
        result
            .exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".into())
    ));
    report.push_str(&format!("- Elapsed: `{}` ms\n", result.elapsed_ms));
    report.push_str(&format!("- Work directory: `{}`\n", result.work_dir));
    if let Some(path) = result.primary_open_path.as_deref() {
        report.push_str(&format!("- Primary artifact: `{path}`\n"));
    }
    if let Some(error) = result.error.as_deref() {
        report.push_str(&format!("- Error: `{}`\n", error.replace('`', "'")));
    }
    report.push_str("\n## Command\n\n```text\n");
    report.push_str(&result.command.join(" "));
    report.push_str("\n```\n\n");
    report.push_str("## Artifacts\n\n");
    if result.artifacts.is_empty() {
        report.push_str("No artifacts were produced.\n");
    } else {
        for artifact in &result.artifacts {
            report.push_str(&format!(
                "- `{}` ({}, {} bytes)\n",
                artifact.path, artifact.kind, artifact.byte_count
            ));
        }
    }
    if let Some(summary) = &result.summary {
        report.push_str("\n## JSON Summary\n\n```json\n");
        report.push_str(&serde_json::to_string_pretty(summary).unwrap_or_else(|_| "{}".into()));
        report.push_str("\n```\n");
    }
    report.push_str("\n## Log Tail\n\n```text\n");
    report.push_str(&truncate_text(log, 8000));
    report.push_str("\n```\n");
    fs::write(path, report).map_err(|err| format!("{}: {err}", path.display()))
}

fn command_output_text(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::from_utf8_lossy(stdout).to_string();
    text.push_str(&String::from_utf8_lossy(stderr));
    truncate_text(&text, 2000)
}

fn truncate_text(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    let mut truncated = text.chars().take(limit).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn safe_slug(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if slug.is_empty() {
        "xtb-job".into()
    } else {
        slug
    }
}

fn safe_extension(value: &str) -> String {
    let extension = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    if extension.is_empty() {
        "xyz".into()
    } else {
        extension
    }
}

#[cfg(unix)]
fn timeout_exit_status() -> ExitStatus {
    ExitStatus::from_raw(124 << 8)
}

#[cfg(not(unix))]
fn timeout_exit_status() -> ExitStatus {
    Command::new("false")
        .status()
        .expect("false command should produce an exit status")
}

#[cfg(unix)]
fn cancelled_exit_status() -> ExitStatus {
    ExitStatus::from_raw(130 << 8)
}

#[cfg(not(unix))]
fn cancelled_exit_status() -> ExitStatus {
    Command::new("false")
        .status()
        .expect("false command should produce an exit status")
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact(title: &str, kind: &str) -> XtbArtifact {
        XtbArtifact {
            path: format!("/tmp/{title}"),
            title: title.into(),
            extension: Path::new(title)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .into(),
            kind: kind.into(),
            byte_count: 1,
        }
    }

    #[test]
    fn parses_xtb_log_metrics() {
        let metrics = parse_xtb_log_metrics(
            r#"
         :: total energy             -29.756064436519 Eh    ::
         :: HOMO-LUMO gap              2.614196739406 eV    ::

molecular dipole:
                 x           y           z       tot (Debye)
 q only:        0.262      -0.939       0.559
   full:        0.342      -0.982       0.504       2.936
"#,
        );

        assert_eq!(
            metrics.get("total energy").and_then(Value::as_f64),
            Some(-29.756064436519)
        );
        assert_eq!(
            metrics.get("HOMO-LUMO gap / eV").and_then(Value::as_f64),
            Some(2.614196739406)
        );
        assert_eq!(
            metrics.get("dipole / a.u."),
            Some(&json!([0.342, -0.982, 0.504]))
        );
    }

    #[test]
    fn read_xtb_summary_uses_log_metrics_without_json() {
        let work_dir =
            std::env::temp_dir().join(format!("burrete-xtb-summary-test-{}", unix_timestamp_ms()));
        fs::create_dir(&work_dir).expect("create test work dir");
        fs::write(
            work_dir.join("xtb.log"),
            r#"
           -------------------------------------------------
          | TOTAL ENERGY              -16.938323000000 Eh   |
          | HOMO-LUMO GAP               3.146978000000 eV   |
           -------------------------------------------------

molecular dipole:
                 x           y           z       tot (Debye)
   full:       -1.210      -0.292       0.279       3.210
"#,
        )
        .expect("write xtb log");

        let summary = read_xtb_summary(&work_dir).expect("summary");
        fs::remove_dir_all(&work_dir).expect("remove test work dir");

        assert_eq!(
            summary.get("total energy").and_then(Value::as_f64),
            Some(-16.938323)
        );
        assert_eq!(
            summary.get("HOMO-LUMO gap / eV").and_then(Value::as_f64),
            Some(3.146978)
        );
        assert_eq!(
            summary.get("dipole / a.u."),
            Some(&json!([-1.210, -0.292, 0.279]))
        );
    }

    #[test]
    fn property_jobs_do_not_treat_topology_or_trajectory_as_primary_results() {
        let artifacts = vec![
            artifact("xtbtopo.mol", "structure"),
            artifact("xtb.trj", "trajectory"),
        ];

        assert_eq!(primary_open_path_for("properties", &artifacts), None);
        assert_eq!(primary_open_path_for("vipea", &artifacts), None);
    }

    #[test]
    fn grid_properties_is_rejected_before_x_tb_prepares_an_input() {
        assert!(assert_supported_xtb_operation("grid-properties").is_err());
    }

    #[test]
    fn optimization_uses_only_named_optimization_outputs() {
        let topology_only = vec![artifact("xtbtopo.mol", "structure")];
        let optimized = vec![
            artifact("xtbtopo.mol", "structure"),
            artifact("xtbopt.xyz", "structure"),
        ];

        assert_eq!(primary_open_path_for("optimize", &topology_only), None);
        assert_eq!(
            primary_open_path_for("optimize", &optimized),
            Some("/tmp/xtbopt.xyz".into())
        );
    }

    #[cfg(unix)]
    #[test]
    fn pre_cancelled_xtb_job_does_not_start_a_process() {
        let job_id = format!("xtb-cancel-test-{}", unix_timestamp_ms());
        cancelled_xtb_jobs()
            .lock()
            .expect("cancellation registry")
            .insert(job_id.clone());
        let work_dir = std::env::temp_dir().join(&job_id);
        fs::create_dir(&work_dir).expect("create test work dir");
        let marker = work_dir.join("process-started");
        let log_path = work_dir.join("xtb.log");
        let args = vec!["-c".into(), format!("touch {}", marker.to_string_lossy())];

        let (status, log) = run_xtb_command(
            Path::new("/bin/sh"),
            &args,
            &work_dir,
            &log_path,
            Duration::from_secs(1),
            0,
            Some(&job_id),
        )
        .expect("cancelled result");

        let process_started = marker.exists();
        finish_xtb_job(Some(&job_id));
        fs::remove_dir_all(&work_dir).expect("remove test work dir");
        assert_eq!(status.code(), Some(130));
        assert!(log.contains("cancelled before"));
        assert!(!process_started);
    }

    #[cfg(unix)]
    #[test]
    fn xtb_timeout_returns_a_structured_exit_status() {
        let work_dir =
            std::env::temp_dir().join(format!("xtb-timeout-test-{}", unix_timestamp_ms()));
        fs::create_dir(&work_dir).expect("create test work dir");
        let log_path = work_dir.join("xtb.log");
        let args = vec!["-c".into(), "sleep 1".into()];

        let (status, _) = run_xtb_command(
            Path::new("/bin/sh"),
            &args,
            &work_dir,
            &log_path,
            Duration::from_millis(10),
            0,
            None,
        )
        .expect("timeout status");

        fs::remove_dir_all(&work_dir).expect("remove test work dir");
        assert_eq!(status.code(), Some(124));
    }
}
