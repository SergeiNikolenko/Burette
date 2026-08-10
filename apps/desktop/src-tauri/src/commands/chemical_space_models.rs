//! Managed runtime and worker execution for learned chemical-space
//! representations (ChemBERTa, MoLFormer, Uni-Mol).
//!
//! The runtime is a uv-managed Python environment mirroring the descriptor
//! runtime install, staged and promoted like the managed xTB runtime so a
//! failed download never destroys a working environment. The worker itself is
//! the same script browser dev runs; it is embedded in the binary and written
//! next to the runtime before every job, so packaged builds never depend on a
//! repo checkout.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const WORKER_SCRIPT: &str =
    include_str!("../../../../../compute/models/chemical_space_representations.py");
const REQUIREMENTS: &str = include_str!("../../../../../compute/models/requirements.txt");
const INSTALL_TIMEOUT: Duration = Duration::from_secs(45 * 60);
const VALIDATE_TIMEOUT: Duration = Duration::from_secs(3 * 60);
const REPRESENT_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const REPRESENT_STDOUT_LIMIT: usize = 64 * 1024 * 1024;
const ERROR_TAIL_BYTES: usize = 16 * 1024;
const MAX_REPRESENT_RECORDS: usize = 20_000;
const MAX_REPRESENT_INPUT_BYTES: usize = 32 * 1024 * 1024;
const REPRESENT_JOB_RETENTION: Duration = Duration::from_secs(2 * 60 * 60);
const STALE_STAGING_RETENTION: Duration = Duration::from_secs(48 * 60 * 60);
const WORKER_NEIGHBORS: u32 = 64;
const INSTALL_SIZE_HINT: &str = "~1.5 GB";
const WEIGHTS_NOTE: &str =
    "Model weights download on first use into Application Support/Burette/chemical-space-models.";
const STAMP_FILE: &str = "burette-install.json";
const REPRESENT_ENGINES: [&str; 4] = ["chemberta", "molformer", "unimol2-84m", "unimol-v1"];
pub(crate) const RUNTIME_MISSING_MESSAGE: &str =
    "The learned-model runtime is not installed. Install it from the Chemical Space panel.";

static INSTALL_STATE: OnceLock<Mutex<InstallState>> = OnceLock::new();
static REPRESENT_JOBS: OnceLock<Mutex<HashMap<String, RepresentJob>>> = OnceLock::new();

#[derive(Clone, Debug, Default)]
struct InstallState {
    phase: InstallPhase,
    line: Option<String>,
    error: Option<String>,
    child_pid: Option<u32>,
    cancel_requested: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum InstallPhase {
    #[default]
    Idle,
    Installing,
    Completed,
    Failed,
    Cancelled,
}

impl InstallPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Installing => "installing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Default)]
struct RepresentJob {
    progress: Option<Value>,
    result: Option<Value>,
    error: Option<String>,
    child_pid: Option<u32>,
    cancel_requested: bool,
    done: bool,
    started_at: Option<Instant>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChemicalSpaceModelRuntimeStatus {
    installed: bool,
    python_path: Option<String>,
    source: Option<&'static str>,
    installer_available: bool,
    install_hint: String,
    install_size_hint: &'static str,
    weights_note: &'static str,
    install_phase: &'static str,
    install_line: Option<String>,
    install_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepresentInputRecord {
    source_record_id: u64,
    format: String,
    input: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepresentJobStatus {
    running: bool,
    progress: Option<Value>,
    result: Option<Value>,
    error: Option<String>,
}

fn install_state() -> &'static Mutex<InstallState> {
    INSTALL_STATE.get_or_init(|| Mutex::new(InstallState::default()))
}

fn represent_jobs() -> &'static Mutex<HashMap<String, RepresentJob>> {
    REPRESENT_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub(crate) fn chemical_space_model_runtime_status() -> ChemicalSpaceModelRuntimeStatus {
    let install = install_state()
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default();
    let installer_available = resolve_uv_executable().is_ok();
    let (python_path, source) = match resolve_model_python() {
        Some((path, source)) => (Some(path.to_string_lossy().to_string()), Some(source)),
        None => (None, None),
    };
    ChemicalSpaceModelRuntimeStatus {
        installed: python_path.is_some(),
        python_path,
        source,
        installer_available,
        install_hint: if installer_available {
            "The runtime installs through uv into Application Support/Burette/model-python.".into()
        } else {
            "Managed installation requires the uv package manager. Install uv (https://docs.astral.sh/uv) or set BURETTE_CHEMICAL_SPACE_MODEL_PYTHON to an existing environment.".into()
        },
        install_size_hint: INSTALL_SIZE_HINT,
        weights_note: WEIGHTS_NOTE,
        install_phase: install.phase.as_str(),
        install_line: install.line,
        install_error: install.error,
    }
}

#[tauri::command]
pub(crate) fn chemical_space_model_runtime_install() -> Result<(), String> {
    {
        let mut state = install_state()
            .lock()
            .map_err(|_| "The model runtime installer lock is unavailable.".to_string())?;
        if state.phase == InstallPhase::Installing {
            return Ok(());
        }
        *state = InstallState {
            phase: InstallPhase::Installing,
            line: Some("Preparing the model runtime installation…".into()),
            ..InstallState::default()
        };
    }
    thread::spawn(|| {
        let outcome = run_managed_install();
        let mut state = match install_state().lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        state.child_pid = None;
        match outcome {
            Ok(()) => {
                state.phase = InstallPhase::Completed;
                state.line = Some("Model runtime installed.".into());
                state.error = None;
            }
            Err(error) if state.cancel_requested => {
                state.phase = InstallPhase::Cancelled;
                state.line = None;
                state.error = Some(error);
            }
            Err(error) => {
                state.phase = InstallPhase::Failed;
                state.line = None;
                state.error = Some(error);
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn chemical_space_model_runtime_cancel_install() -> Result<(), String> {
    let mut state = install_state()
        .lock()
        .map_err(|_| "The model runtime installer lock is unavailable.".to_string())?;
    if state.phase != InstallPhase::Installing {
        return Ok(());
    }
    state.cancel_requested = true;
    if let Some(pid) = state.child_pid {
        kill_process(pid);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn chemical_space_represent_start(
    request_id: String,
    engine: String,
    records: Vec<RepresentInputRecord>,
) -> Result<(), String> {
    validate_represent_request(&engine, &records)?;
    let (python, _source) = resolve_model_python().ok_or(RUNTIME_MISSING_MESSAGE.to_string())?;
    let request_id = validate_request_id(&request_id)?;
    {
        let mut jobs = represent_jobs()
            .lock()
            .map_err(|_| "The representation job registry is unavailable.".to_string())?;
        prune_stale_jobs(&mut jobs);
        if jobs.contains_key(&request_id) {
            return Err("A representation job with this ID is already running.".into());
        }
        jobs.insert(
            request_id.clone(),
            RepresentJob {
                started_at: Some(Instant::now()),
                ..RepresentJob::default()
            },
        );
    }
    let input = json!({
        "operation": "represent",
        "engine": engine,
        "neighbors": WORKER_NEIGHBORS,
        "records": records,
    });
    thread::spawn(move || {
        let outcome = run_represent_worker(&python, &engine, &input, &request_id);
        let mut jobs = match represent_jobs().lock() {
            Ok(jobs) => jobs,
            Err(_) => return,
        };
        let Some(job) = jobs.get_mut(&request_id) else {
            return;
        };
        job.child_pid = None;
        job.done = true;
        match outcome {
            Ok(result) => job.result = Some(result),
            Err(error) if job.cancel_requested => {
                job.error = Some("The representation was cancelled.".into());
                let _ = error;
            }
            Err(error) => job.error = Some(error),
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn chemical_space_represent_status(
    request_id: String,
) -> Result<RepresentJobStatus, String> {
    let request_id = validate_request_id(&request_id)?;
    let mut jobs = represent_jobs()
        .lock()
        .map_err(|_| "The representation job registry is unavailable.".to_string())?;
    let Some(job) = jobs.get_mut(&request_id) else {
        return Err("This representation job is unknown or already collected.".into());
    };
    if !job.done {
        return Ok(RepresentJobStatus {
            running: true,
            progress: job.progress.clone(),
            result: None,
            error: None,
        });
    }
    let finished = jobs
        .remove(&request_id)
        .expect("job present under the registry lock");
    Ok(RepresentJobStatus {
        running: false,
        progress: finished.progress,
        result: finished.result,
        error: finished.error,
    })
}

#[tauri::command]
pub(crate) fn chemical_space_represent_cancel(request_id: String) -> Result<(), String> {
    let request_id = validate_request_id(&request_id)?;
    let mut jobs = represent_jobs()
        .lock()
        .map_err(|_| "The representation job registry is unavailable.".to_string())?;
    let Some(job) = jobs.get_mut(&request_id) else {
        return Ok(());
    };
    job.cancel_requested = true;
    if let Some(pid) = job.child_pid {
        kill_process(pid);
    }
    Ok(())
}

fn validate_request_id(request_id: &str) -> Result<String, String> {
    let trimmed = request_id.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("The representation request ID is invalid.".into());
    }
    Ok(trimmed.to_string())
}

fn validate_represent_request(
    engine: &str,
    records: &[RepresentInputRecord],
) -> Result<(), String> {
    if !REPRESENT_ENGINES.contains(&engine) {
        return Err(format!("Unknown representation engine: {engine}"));
    }
    if records.len() < 2 || records.len() > MAX_REPRESENT_RECORDS {
        return Err(format!(
            "Learned representations accept between 2 and {MAX_REPRESENT_RECORDS} molecules."
        ));
    }
    let mut input_bytes = 0usize;
    for record in records {
        input_bytes = input_bytes.saturating_add(record.input.len());
    }
    if input_bytes > MAX_REPRESENT_INPUT_BYTES {
        return Err("Molecular inputs exceed the 32 MiB representation limit.".into());
    }
    Ok(())
}

fn prune_stale_jobs(jobs: &mut HashMap<String, RepresentJob>) {
    jobs.retain(|_, job| {
        job.started_at
            .is_none_or(|started| started.elapsed() < REPRESENT_JOB_RETENTION)
    });
}

/// Resolution order matches the browser-dev sidecar: an explicit override
/// first, then the managed environment.
fn resolve_model_python() -> Option<(PathBuf, &'static str)> {
    if let Some(value) = env::var_os("BURETTE_CHEMICAL_SPACE_MODEL_PYTHON") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some((path, "override"));
        }
    }
    let root = model_runtime_dir().ok()?;
    for name in ["python3", "python"] {
        let candidate = root.join("bin").join(name);
        if candidate.is_file() {
            return Some((candidate, "managed"));
        }
    }
    None
}

fn model_runtime_dir() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR") {
        return Ok(PathBuf::from(path));
    }
    let home = env::var_os("HOME").ok_or("HOME is not set for the model runtime install")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Burette")
        .join("model-python"))
}

fn model_weights_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or("HOME is not set for the model weights directory")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Burette")
        .join("chemical-space-models"))
}

fn resolve_uv_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("BURETTE_UV") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            candidates.push(dir.join("uv"));
        }
    }
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/bin/uv"));
        candidates.push(PathBuf::from(&home).join(".cargo/bin/uv"));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/uv"),
        PathBuf::from("/usr/local/bin/uv"),
    ]);
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "The uv package manager was not found. Install uv or set BURETTE_UV.".to_string()
        })
}

fn run_managed_install() -> Result<(), String> {
    let uv = resolve_uv_executable()?;
    let root = model_runtime_dir()?;
    let parent = root
        .parent()
        .ok_or_else(|| "The model runtime directory has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    cleanup_stale_stagings(parent);
    if stamped_runtime_is_current(&root) {
        return Ok(());
    }
    let staging = parent.join(format!(
        "model-python.staging-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let install = install_into_staging(&uv, &staging);
    let install = install.and_then(|_| promote_staging(&root, &staging));
    if install.is_err() {
        fs::remove_dir_all(&staging).ok();
    }
    install
}

fn stamped_runtime_is_current(root: &Path) -> bool {
    let Ok(stamp) = fs::read_to_string(root.join(STAMP_FILE)) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&stamp) else {
        return false;
    };
    value.get("requirements").and_then(Value::as_str) == Some(REQUIREMENTS)
        && root.join("bin/python3").is_file()
}

fn install_into_staging(uv: &Path, staging: &Path) -> Result<(), String> {
    set_install_line("Creating the Python 3.12 environment…");
    run_install_step(
        Command::new(uv)
            .args(["venv", "--python", "3.12"])
            .arg(staging),
        "uv venv",
        INSTALL_TIMEOUT,
    )?;
    ensure_not_cancelled()?;
    let python = staging.join("bin/python3");
    if !python.is_file() {
        return Err("uv created an environment without bin/python3.".into());
    }
    let requirements_path = staging.join("requirements.txt");
    fs::write(&requirements_path, REQUIREMENTS)
        .map_err(|error| format!("Could not write the pinned requirements: {error}"))?;
    set_install_line("Downloading PyTorch, Transformers, and RDKit…");
    run_install_step(
        Command::new(uv)
            .args(["pip", "install", "--python"])
            .arg(&python)
            .arg("-r")
            .arg(&requirements_path),
        "uv pip install",
        INSTALL_TIMEOUT,
    )?;
    ensure_not_cancelled()?;
    set_install_line("Validating the installed runtime…");
    validate_runtime_imports(&python)?;
    let stamp = json!({
        "requirements": REQUIREMENTS,
        "validatedAtMs": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0),
    });
    fs::write(
        staging.join(STAMP_FILE),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&stamp).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("Could not stamp the model runtime: {error}"))?;
    Ok(())
}

fn validate_runtime_imports(python: &Path) -> Result<(), String> {
    run_install_step(
        Command::new(python).args([
            "-c",
            "import numpy, rdkit, torch, transformers; print('imports ok')",
        ]),
        "runtime validation",
        VALIDATE_TIMEOUT,
    )
    .map_err(|error| format!("The installed runtime failed validation: {error}"))
}

/// The staged environment only ever runs `bin/python3` and its site-packages,
/// both of which survive the rename: uv points the interpreter symlink and
/// `pyvenv.cfg` at its own managed CPython, not at the staging path.
fn promote_staging(root: &Path, staging: &Path) -> Result<(), String> {
    let mut legacy = None;
    if root.exists() {
        let legacy_path = root.with_file_name(format!(
            "model-python.legacy-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::rename(root, &legacy_path)
            .map_err(|error| format!("Could not preserve the previous model runtime: {error}"))?;
        legacy = Some(legacy_path);
    }
    if let Err(error) = fs::rename(staging, root) {
        if let Some(legacy) = legacy {
            fs::rename(legacy, root).ok();
        }
        return Err(format!("Could not activate the model runtime: {error}"));
    }
    if let Some(legacy) = legacy {
        fs::remove_dir_all(legacy).ok();
    }
    Ok(())
}

fn cleanup_stale_stagings(parent: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("model-python.staging-") && !name.starts_with("model-python.legacy-") {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_STAGING_RETENTION);
        if old_enough {
            fs::remove_dir_all(entry.path()).ok();
        }
    }
}

fn set_install_line(line: &str) {
    if let Ok(mut state) = install_state().lock() {
        state.line = Some(line.to_string());
    }
}

fn ensure_not_cancelled() -> Result<(), String> {
    let cancelled = install_state()
        .lock()
        .map(|state| state.cancel_requested)
        .unwrap_or(false);
    if cancelled {
        return Err("The model runtime installation was cancelled.".into());
    }
    Ok(())
}

/// Runs one installer step, streaming its output lines into the install state
/// so the panel can show live progress, honouring cancellation and a deadline.
fn run_install_step(command: &mut Command, label: &str, timeout: Duration) -> Result<(), String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start {label}: {error}"))?;
    if let Ok(mut state) = install_state().lock() {
        state.child_pid = Some(child.id());
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Could not capture {label} output."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Could not capture {label} errors."))?;
    let stdout_reader = thread::spawn(move || stream_lines(stdout, true));
    let stderr_reader = thread::spawn(move || stream_lines(stderr, true));
    let status = wait_with_deadline(&mut child, timeout, label)?;
    let stdout_tail = stdout_reader.join().unwrap_or_default();
    let stderr_tail = stderr_reader.join().unwrap_or_default();
    if let Ok(mut state) = install_state().lock() {
        state.child_pid = None;
    }
    if !status.success() {
        return Err(format!(
            "{label} failed (status {status}): {}",
            truncate_tail(&format!("{stderr_tail}\n{stdout_tail}"))
        ));
    }
    Ok(())
}

/// Reads a child stream line by line. When `publish` is set every line becomes
/// the live install status line; the bounded tail is returned for error
/// reporting either way.
fn stream_lines(stream: impl Read, publish: bool) -> String {
    let mut tail = String::new();
    for line in BufReader::new(stream).lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if publish {
            set_install_line(trimmed);
        }
        if tail.len() < ERROR_TAIL_BYTES {
            tail.push_str(trimmed);
            tail.push('\n');
        }
    }
    tail
}

fn wait_with_deadline(
    child: &mut Child,
    timeout: Duration,
    label: &str,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                child.kill().ok();
                child.wait().ok();
                return Err(format!(
                    "{label} timed out after {} seconds.",
                    timeout.as_secs()
                ));
            }
            Err(error) => return Err(format!("Could not inspect {label}: {error}")),
        }
    }
}

fn truncate_tail(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= 1_200 {
        return trimmed.to_string();
    }
    let start = trimmed.len() - 1_200;
    let mut boundary = start;
    while boundary < trimmed.len() && !trimmed.is_char_boundary(boundary) {
        boundary += 1;
    }
    format!("…{}", &trimmed[boundary..])
}

fn kill_process(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    let _ = pid;
}

fn run_represent_worker(
    python: &Path,
    engine: &str,
    input: &Value,
    request_id: &str,
) -> Result<Value, String> {
    let weights = model_weights_dir()?;
    let script = write_worker_script()?;
    let mut child = Command::new(python)
        .arg(&script)
        .env("PYTORCH_ENABLE_MPS_FALLBACK", "0")
        .env("HF_HOME", weights.join("huggingface"))
        .env("UNIMOL_WEIGHT_DIR", weights.join("unimol"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the model worker: {error}"))?;
    if let Ok(mut jobs) = represent_jobs().lock() {
        if let Some(job) = jobs.get_mut(request_id) {
            job.child_pid = Some(child.id());
        }
    }
    let input_text = serde_json::to_string(input).map_err(|error| error.to_string())?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or("Could not open the model worker input stream.")?;
        stdin
            .write_all(input_text.as_bytes())
            .map_err(|error| format!("Could not send the representation request: {error}"))?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or("Could not capture the model worker output.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not capture the model worker errors.")?;
    let stdout_reader = thread::spawn(move || {
        let mut output = Vec::new();
        let mut bounded = stdout.take(REPRESENT_STDOUT_LIMIT as u64);
        bounded.read_to_end(&mut output).ok();
        output
    });
    let progress_request_id = request_id.to_string();
    let stderr_reader = thread::spawn(move || {
        let mut tail = String::new();
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            if let Some(payload) = line.strip_prefix("BURETTE_PROGRESS\t") {
                if let Ok(progress) = serde_json::from_str::<Value>(payload) {
                    if let Ok(mut jobs) = represent_jobs().lock() {
                        if let Some(job) = jobs.get_mut(&progress_request_id) {
                            job.progress = Some(progress);
                        }
                    }
                }
                continue;
            }
            if tail.len() < ERROR_TAIL_BYTES {
                tail.push_str(&line);
                tail.push('\n');
            }
        }
        tail
    });
    let status = wait_with_deadline(&mut child, REPRESENT_TIMEOUT, "The model worker")?;
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr_tail = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "The model worker failed (status {status}): {}",
            truncate_tail(&stderr_tail)
        ));
    }
    let payload: Value = serde_json::from_slice(&stdout)
        .map_err(|_| "The model worker returned invalid JSON.".to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| "The model worker failed without an error message.".into()));
    }
    let result = payload
        .get("result")
        .cloned()
        .ok_or("The model worker returned no result.")?;
    if result.get("backend").and_then(Value::as_str) != Some("metalMps")
        || result.get("engine").and_then(Value::as_str) != Some(engine)
    {
        return Err("The model worker returned an unattested result.".into());
    }
    Ok(result)
}

/// The worker script ships inside the binary; it is written next to the
/// managed runtime so packaged builds never depend on a repo checkout.
fn write_worker_script() -> Result<PathBuf, String> {
    let root = model_runtime_dir()?;
    let parent = root
        .parent()
        .ok_or_else(|| "The model runtime directory has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    let path = parent.join("chemical-space-worker.py");
    let temporary = parent.join("chemical-space-worker.py.tmp");
    fs::write(&temporary, WORKER_SCRIPT)
        .map_err(|error| format!("Could not write the model worker script: {error}"))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not replace the model worker script: {error}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(input: &str) -> RepresentInputRecord {
        RepresentInputRecord {
            source_record_id: 1,
            format: "smiles".into(),
            input: input.into(),
        }
    }

    #[test]
    fn represent_requests_reject_unknown_engines_and_bad_sizes() {
        let records = vec![record("CCO"), record("c1ccccc1")];
        assert!(validate_represent_request("chemberta", &records).is_ok());
        assert!(validate_represent_request("morgan", &records).is_err());
        assert!(validate_represent_request("chemberta", &records[..1]).is_err());
    }

    #[test]
    fn represent_requests_reject_oversized_inputs() {
        let big = "C".repeat(MAX_REPRESENT_INPUT_BYTES / 2 + 1);
        let records = vec![record(&big), record(&big)];
        assert!(validate_represent_request("chemberta", &records).is_err());
    }

    #[test]
    fn runtime_dir_honours_the_environment_override() {
        let previous = env::var_os("BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR");
        env::set_var("BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR", "/tmp/model-rt");
        assert_eq!(
            model_runtime_dir().expect("runtime dir"),
            PathBuf::from("/tmp/model-rt")
        );
        match previous {
            Some(value) => env::set_var("BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR", value),
            None => env::remove_var("BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR"),
        }
    }

    #[test]
    fn stamps_only_match_the_pinned_requirements() {
        let dir = std::env::temp_dir().join(format!("model-stamp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("bin")).expect("create runtime dir");
        fs::write(dir.join("bin/python3"), "").expect("write python placeholder");
        assert!(!stamped_runtime_is_current(&dir));
        fs::write(
            dir.join(STAMP_FILE),
            serde_json::to_string(&json!({ "requirements": REQUIREMENTS })).expect("stamp"),
        )
        .expect("write stamp");
        assert!(stamped_runtime_is_current(&dir));
        fs::remove_dir_all(&dir).ok();
    }
}
