//! Detached calculations on SSH hosts. A job keeps running when the app quits,
//! the Mac sleeps, or the network drops; the app polls it, downloads its `work/`
//! folder into the local run folder when it ends, and reattaches to unfinished
//! jobs after a restart. See docs/remote-jobs.md.
use super::{run, run_worker, validate, Request};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime};

const RUNNER: &str = include_str!("runner.py");
const JOBS_ROOT: &str = "~/burette-jobs";
const STORE_FILE: &str = "remote-jobs.json";
const MAX_RECORDS: usize = 200;
const MAX_UPLOAD_BYTES: u64 = 24 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_secs(15);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const LOST_NOTE: &str = "\nThe job stopped on the host without reporting a result.\n";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RemoteTool {
    Xtb,
    Crest,
    Prism,
}

impl RemoteTool {
    pub(crate) fn executable(self) -> &'static str {
        match self {
            Self::Xtb => "xtb",
            Self::Crest => "crest",
            Self::Prism => "prism",
        }
    }
}

/// A remote job as remembered on this Mac until its results are downloaded.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteJob {
    pub(crate) id: String,
    pub(crate) host: String,
    pub(crate) tool: RemoteTool,
    pub(crate) work_dir: String,
    pub(crate) log_path: String,
    pub(crate) command: Vec<String>,
    /// Tool-specific request details needed to finish the run after a restart.
    pub(crate) context: Value,
    pub(crate) state: String,
    pub(crate) submitted_at: u128,
}

/// A second attempt the host makes on its own when the first run's log matches `pattern`.
#[derive(Serialize)]
pub(crate) struct RemoteRetry {
    pub(crate) args: Vec<String>,
    /// Python regular expression searched in the combined log.
    pub(crate) pattern: &'static str,
    pub(crate) label: &'static str,
}

pub(crate) struct RemoteOutcome {
    exit_code: i32,
}

impl RemoteOutcome {
    pub(crate) fn exit_status(&self) -> std::process::ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(self.exit_code << 8)
    }
}

struct Attachment {
    host: String,
    detached: bool,
}

fn attachments() -> &'static Mutex<HashMap<String, Attachment>> {
    static ATTACHMENTS: OnceLock<Mutex<HashMap<String, Attachment>>> = OnceLock::new();
    ATTACHMENTS.get_or_init(Default::default)
}

/// Marks a job as followed by this app process; one follower per job.
struct Attached(String);

impl Attached {
    fn new(job: &RemoteJob) -> Result<Self, String> {
        let mut map = attachments()
            .lock()
            .map_err(|_| "Remote job registry is unavailable.")?;
        if map.contains_key(&job.id) {
            return Err("This remote job is already followed in another window.".into());
        }
        map.insert(
            job.id.clone(),
            Attachment {
                host: job.host.clone(),
                detached: false,
            },
        );
        Ok(Self(job.id.clone()))
    }

    fn detached(&self) -> bool {
        attachments()
            .lock()
            .map(|map| map.get(&self.0).is_some_and(|entry| entry.detached))
            .unwrap_or(false)
    }

    /// Sleeps for `delay`, returning early with `true` once the job is detached.
    fn pause(&self, delay: Duration) -> bool {
        let end = Instant::now() + delay;
        while let Some(remaining) = end.checked_duration_since(Instant::now()) {
            if self.detached() {
                return true;
            }
            std::thread::sleep(remaining.min(Duration::from_secs(1)));
        }
        self.detached()
    }
}

impl Drop for Attached {
    fn drop(&mut self) {
        if let Ok(mut map) = attachments().lock() {
            map.remove(&self.0);
        }
    }
}

static STORE_LOCK: Mutex<()> = Mutex::new(());

fn store_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(STORE_FILE))
}

fn load(path: &Path) -> Vec<RemoteJob> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn update_store<R: Runtime>(
    app: &tauri::AppHandle<R>,
    change: impl FnOnce(&mut Vec<RemoteJob>),
) -> Result<(), String> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| "Remote job store is unavailable.")?;
    let path = store_path(app)?;
    let mut jobs = load(&path);
    change(&mut jobs);
    let excess = jobs.len().saturating_sub(MAX_RECORDS);
    jobs.drain(..excess);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&jobs).map_err(|e| e.to_string())?;
    fs::write(&temporary, bytes).map_err(|e| format!("{}: {e}", temporary.display()))?;
    fs::rename(&temporary, &path).map_err(|e| format!("{}: {e}", path.display()))
}

fn call(host: &str, payload: Value, timeout: Duration) -> Result<Value, String> {
    validate(&Request {
        host: host.into(),
        root: JOBS_ROOT.into(),
        path: String::new(),
        chemical: false,
        archive: false,
    })?;
    let bytes = run_worker(
        host,
        RUNNER,
        payload.to_string().as_bytes(),
        2 * 1024 * 1024,
        timeout,
    )?;
    let reply: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid remote job response: {e}"))?;
    match reply.get("error").and_then(Value::as_str) {
        Some(error) => Err(format!("{host}: {error}")),
        None => Ok(reply),
    }
}

/// Rewrites file arguments relative to `work_dir`, copying inputs that live
/// elsewhere into it, so the same command runs inside the remote `work/` folder.
pub(crate) fn stage_args(args: &[String], work_dir: &Path) -> Result<Vec<String>, String> {
    let work_dir = work_dir
        .canonicalize()
        .map_err(|e| format!("{}: {e}", work_dir.display()))?;
    args.iter()
        .map(|arg| {
            let path = Path::new(arg);
            let Some(path) = path
                .is_absolute()
                .then(|| path.canonicalize().ok())
                .flatten()
                .filter(|path| path.is_file())
            else {
                return Ok(arg.clone());
            };
            if let Ok(relative) = path.strip_prefix(&work_dir) {
                if relative.components().count() == 1 {
                    return Ok(relative.to_string_lossy().into_owned());
                }
            }
            let name = path.file_name().ok_or("Input has no file name")?;
            let staged = work_dir.join(name);
            if !staged.exists() {
                fs::copy(&path, &staged).map_err(|e| format!("{}: {e}", staged.display()))?;
            }
            Ok(name.to_string_lossy().into_owned())
        })
        .collect()
}

fn upload_files(work_dir: &Path) -> Result<Vec<Value>, String> {
    let mut total = 0;
    let mut files = Vec::new();
    for entry in fs::read_dir(work_dir).map_err(|e| format!("{}: {e}", work_dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            continue;
        }
        total += metadata.len();
        if total > MAX_UPLOAD_BYTES {
            return Err("Inputs for a remote job are limited to 24 MB.".into());
        }
        let data = fs::read(entry.path()).map_err(|e| e.to_string())?;
        files.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "data": base64::engine::general_purpose::STANDARD.encode(data),
        }));
    }
    Ok(files)
}

/// Uploads the prepared run folder and starts `args` on the host, detached.
pub(crate) fn submit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    job: &RemoteJob,
    args: &[String],
    threads: Option<u32>,
    timeout: Duration,
    retry: Option<RemoteRetry>,
) -> Result<(), String> {
    if !is_safe_job_id(&job.id) {
        return Err("Invalid remote job id.".into());
    }
    let payload = json!({
        "operation": "submit",
        "root": JOBS_ROOT,
        "id": job.id,
        "tool": job.tool.executable(),
        "args": args,
        "threads": threads.unwrap_or(0),
        "timeout": timeout.as_secs(),
        "retry": retry,
        "files": upload_files(Path::new(&job.work_dir))?,
    });
    call(&job.host, payload, Duration::from_secs(180))?;
    update_store(app, |jobs| {
        jobs.retain(|entry| entry.id != job.id);
        jobs.push(job.clone());
    })
}

/// Follows the job until it ends, then downloads its outputs into the run folder.
pub(crate) fn wait<R: Runtime>(
    app: &tauri::AppHandle<R>,
    job: &RemoteJob,
) -> Result<RemoteOutcome, String> {
    let attached = Attached::new(job)?;
    let mut known_state = job.state.clone();
    let mut record_state = |state: &str| {
        if known_state != state {
            known_state = state.to_string();
            let _ = update_store(app, |jobs| {
                for entry in jobs.iter_mut().filter(|entry| entry.id == job.id) {
                    entry.state = state.to_string();
                }
            });
        }
    };
    let mut delay = Duration::ZERO;
    let mut log = String::new();
    let (state, exit_code) = loop {
        if attached.pause(delay) {
            break ("cancelled".to_string(), None);
        }
        let status = json!({"operation": "status", "root": JOBS_ROOT, "id": job.id});
        match call(&job.host, status, Duration::from_secs(45)) {
            Ok(reply) => {
                log = reply["log"].as_str().unwrap_or_default().to_string();
                let _ = fs::write(&job.log_path, &log);
                let state = reply["status"]["state"].as_str().unwrap_or("queued");
                record_state(state);
                if matches!(state, "success" | "failed" | "cancelled" | "lost") {
                    break (state.to_string(), reply["status"]["exitCode"].as_i64());
                }
                delay = POLL_INTERVAL;
            }
            // Network errors leave the remote job alone; the next poll may reach it again.
            Err(_) => {
                record_state("unreachable");
                delay = RETRY_INTERVAL;
            }
        }
    };
    let exit_code = match state.as_str() {
        "cancelled" => 130,
        "lost" => {
            log.push_str(LOST_NOTE);
            1
        }
        _ => exit_code
            .and_then(|code| i32::try_from(code).ok())
            .unwrap_or(1),
    };
    if state != "cancelled" {
        fetch(job)?;
    }
    // The download may replace the log with the uploaded placeholder.
    let _ = fs::write(&job.log_path, &log);
    update_store(app, |jobs| jobs.retain(|entry| entry.id != job.id))?;
    Ok(RemoteOutcome { exit_code })
}

fn fetch(job: &RemoteJob) -> Result<(), String> {
    let bytes = run(
        &Request {
            host: job.host.clone(),
            root: JOBS_ROOT.into(),
            path: format!("{}/work", job.id),
            chemical: false,
            archive: true,
        },
        "archive",
    )?;
    let work_dir = Path::new(&job.work_dir);
    fs::create_dir_all(work_dir).map_err(|e| format!("{}: {e}", work_dir.display()))?;
    let archive = work_dir.join(".burette-remote-results.zip");
    fs::write(&archive, bytes).map_err(|e| format!("{}: {e}", archive.display()))?;
    let unpacked = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(&archive)
        .arg(work_dir)
        .status();
    let _ = fs::remove_file(&archive);
    match unpacked {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err("Could not unpack the results downloaded from the host.".into()),
        Err(error) => Err(error.to_string()),
    }
}

/// Stops a job this process follows. Returns false for jobs that are not remote.
/// When the host cannot be reached, the job is detached from this Mac instead.
pub(crate) fn cancel(job_id: &str) -> bool {
    let Some(host) = attachments()
        .lock()
        .ok()
        .and_then(|map| map.get(job_id).map(|entry| entry.host.clone()))
    else {
        return false;
    };
    let request = json!({"operation": "cancel", "root": JOBS_ROOT, "id": job_id});
    if call(&host, request, Duration::from_secs(45)).is_err() {
        if let Ok(mut map) = attachments().lock() {
            if let Some(entry) = map.get_mut(job_id) {
                entry.detached = true;
            }
        }
    }
    true
}

fn is_safe_job_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Remote jobs started earlier that no window currently follows.
#[tauri::command]
pub(crate) fn remote_job_list<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<RemoteJob>, String> {
    let followed: HashSet<String> = attachments()
        .lock()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    Ok(load(&store_path(&app)?)
        .into_iter()
        .filter(|job| !followed.contains(&job.id))
        .collect())
}

/// Reattaches to a remote job and resolves with the same result shape a local run returns.
#[tauri::command]
pub(crate) async fn remote_job_resume<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = load(&store_path(&app)?)
            .into_iter()
            .find(|job| job.id == job_id)
            .ok_or("This remote job is no longer known.")?;
        match job.tool {
            RemoteTool::Xtb => {
                serde_json::to_value(crate::commands::xtb::resume_remote(&app, job)?)
            }
            RemoteTool::Crest | RemoteTool::Prism => {
                serde_json::to_value(crate::commands::conformer::resume_remote(&app, job)?)
            }
        }
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_arguments_point_into_the_run_folder() {
        let root = std::env::temp_dir().join(format!("burette-stage-{}", uuid::Uuid::new_v4()));
        let work = root.join("xtb_md_1");
        fs::create_dir_all(&work).unwrap();
        fs::write(work.join("md.inp"), "$md\n$end\n").unwrap();
        fs::write(root.join("ligand.xyz"), "1\n\nH 0 0 0\n").unwrap();
        let args = [
            root.join("ligand.xyz").to_string_lossy().into_owned(),
            "--input".into(),
            work.join("md.inp").to_string_lossy().into_owned(),
            "--chrg".into(),
            "-1".into(),
        ];
        assert_eq!(
            stage_args(&args, &work).unwrap(),
            ["ligand.xyz", "--input", "md.inp", "--chrg", "-1"]
        );
        assert!(work.join("ligand.xyz").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn job_ids_cannot_leave_the_jobs_root() {
        assert!(is_safe_job_id("xtb-1760000000000-ab12cd"));
        for id in ["", "../x", "a/b", "x y", ".."] {
            assert!(!is_safe_job_id(id));
        }
    }
}
