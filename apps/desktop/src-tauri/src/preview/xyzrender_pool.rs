use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const WORKER_WARMUP_TIMEOUT: Duration = Duration::from_secs(60);
const WORKER_JOB_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_STDERR_CAPTURE_BYTES: usize = 8 * 1024;
const WORKER_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const WORKER_REAP_INTERVAL: Duration = Duration::from_secs(30);
const WORKER_MIN_COUNT: usize = 2;
const WORKER_MAX_COUNT: usize = 6;

pub(super) struct XyzrenderWorkerLaunch {
    pub(super) program: PathBuf,
    pub(super) envs: Vec<(&'static str, String)>,
    pub(super) signature: String,
}

pub(super) struct XyzrenderCardJob {
    pub(super) id: String,
    pub(super) smiles: Option<String>,
    pub(super) input_path: Option<PathBuf>,
    pub(super) output_path: PathBuf,
    pub(super) config: String,
    pub(super) canvas_size: Option<f64>,
}

pub(super) struct XyzrenderCardOutcome {
    pub(super) id: String,
    pub(super) log: String,
    pub(super) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest<'a> {
    id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    smiles: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input_path: Option<String>,
    output_path: String,
    config: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    canvas_size: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    #[serde(default)]
    log: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// Renders grid cards on a pool of long-lived xyzrender worker processes.
///
/// Starting `xyzrender` costs about 1.4 s before the first drawing appears while
/// a warm worker renders a card in tens of milliseconds, so grid throughput is
/// dominated by process startup unless workers are reused across cards.
pub(super) fn render_cards(
    launch: &XyzrenderWorkerLaunch,
    jobs: Vec<XyzrenderCardJob>,
) -> Vec<XyzrenderCardOutcome> {
    if jobs.is_empty() {
        return Vec::new();
    }
    let pool = pool();
    ensure_idle_worker_reaper();
    pool.discard_stale_workers(&launch.signature);
    let lanes = jobs.len().min(pool.capacity);
    let queue = Mutex::new(VecDeque::from(jobs));
    let outcomes = Mutex::new(Vec::new());
    thread::scope(|scope| {
        for _ in 0..lanes {
            scope.spawn(|| {
                let mut worker: Option<Worker> = None;
                loop {
                    let Some(job) = queue
                        .lock()
                        .unwrap_or_else(|err| err.into_inner())
                        .pop_front()
                    else {
                        break;
                    };
                    if worker.is_none() {
                        match pool.acquire(launch) {
                            Ok(value) => worker = Some(value),
                            Err(error) => {
                                push_outcome(&outcomes, failed_outcome(&job, &error));
                                break;
                            }
                        }
                    }
                    let Some(active) = worker.as_mut() else { break };
                    match active.render(&job) {
                        Ok(outcome) => push_outcome(&outcomes, outcome),
                        Err(WorkerFailure::Job(error)) => {
                            push_outcome(&outcomes, failed_outcome(&job, &error))
                        }
                        Err(WorkerFailure::Worker(error)) => {
                            push_outcome(&outcomes, failed_outcome(&job, &error));
                            if let Some(broken) = worker.take() {
                                pool.discard(broken);
                            }
                        }
                    }
                }
                if let Some(idle) = worker {
                    pool.release(idle);
                }
            });
        }
    });
    let mut results = outcomes.into_inner().unwrap_or_else(|err| err.into_inner());
    let remaining = queue.into_inner().unwrap_or_else(|err| err.into_inner());
    for job in remaining {
        results.push(failed_outcome(
            &job,
            "No xyzrender worker was available for this card.",
        ));
    }
    results
}

fn push_outcome(outcomes: &Mutex<Vec<XyzrenderCardOutcome>>, outcome: XyzrenderCardOutcome) {
    outcomes
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .push(outcome);
}

fn failed_outcome(job: &XyzrenderCardJob, error: &str) -> XyzrenderCardOutcome {
    XyzrenderCardOutcome {
        id: job.id.clone(),
        log: String::new(),
        error: Some(error.to_string()),
    }
}

fn pool() -> &'static Pool {
    static POOL: OnceLock<Pool> = OnceLock::new();
    POOL.get_or_init(|| Pool {
        state: Mutex::new(PoolState {
            signature: String::new(),
            idle: Vec::new(),
            live: 0,
        }),
        available: Condvar::new(),
        capacity: worker_capacity(),
    })
}

fn ensure_idle_worker_reaper() {
    static REAPER: OnceLock<()> = OnceLock::new();
    REAPER.get_or_init(|| {
        thread::spawn(|| loop {
            thread::sleep(WORKER_REAP_INTERVAL);
            pool().reap_idle_workers();
        });
    });
}

fn worker_capacity() -> usize {
    thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .saturating_sub(2)
        .clamp(WORKER_MIN_COUNT, WORKER_MAX_COUNT)
}

struct Pool {
    state: Mutex<PoolState>,
    available: Condvar,
    capacity: usize,
}

struct PoolState {
    signature: String,
    idle: Vec<IdleWorker>,
    live: usize,
}

struct IdleWorker {
    worker: Worker,
    since: Instant,
}

impl Pool {
    fn discard_stale_workers(&self, signature: &str) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        if state.signature == signature {
            return;
        }
        state.signature = signature.to_string();
        let stale = std::mem::take(&mut state.idle);
        state.live = state.live.saturating_sub(stale.len());
        drop(state);
        for idle in stale {
            idle.worker.kill();
        }
        self.available.notify_all();
    }

    /// Idle workers hold an interpreter with the render stack loaded, so they are
    /// retired once a grid stops asking for cards.
    fn reap_idle_workers(&self) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        let mut kept = Vec::new();
        let mut retired = Vec::new();
        for idle in std::mem::take(&mut state.idle) {
            if idle.since.elapsed() < WORKER_IDLE_TIMEOUT {
                kept.push(idle);
            } else {
                retired.push(idle.worker);
            }
        }
        state.idle = kept;
        state.live = state.live.saturating_sub(retired.len());
        drop(state);
        for worker in retired {
            worker.kill();
        }
    }

    fn acquire(&self, launch: &XyzrenderWorkerLaunch) -> Result<Worker, String> {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        loop {
            if let Some(idle) = state.idle.pop() {
                return Ok(idle.worker);
            }
            if state.live < self.capacity {
                state.live += 1;
                drop(state);
                return spawn_worker(launch).inspect_err(|_| {
                    let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
                    state.live = state.live.saturating_sub(1);
                    self.available.notify_one();
                });
            }
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|err| err.into_inner());
        }
    }

    fn release(&self, worker: Worker) {
        self.state
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .idle
            .push(IdleWorker {
                worker,
                since: Instant::now(),
            });
        self.available.notify_one();
    }

    fn discard(&self, worker: Worker) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state.live = state.live.saturating_sub(1);
        drop(state);
        worker.kill();
        self.available.notify_one();
    }
}

enum WorkerFailure {
    Job(String),
    Worker(String),
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<String>,
    stderr: Arc<Mutex<String>>,
}

impl Worker {
    fn render(&mut self, job: &XyzrenderCardJob) -> Result<XyzrenderCardOutcome, WorkerFailure> {
        let request = WorkerRequest {
            id: &job.id,
            smiles: job.smiles.as_deref(),
            input_path: job
                .input_path
                .as_ref()
                .map(|path| path.display().to_string()),
            output_path: job.output_path.display().to_string(),
            config: &job.config,
            canvas_size: job.canvas_size,
        };
        let payload = serde_json::to_string(&request).map_err(|err| {
            WorkerFailure::Job(format!("Could not encode xyzrender card request: {err}"))
        })?;
        let response = self.exchange(&payload, WORKER_JOB_TIMEOUT)?;
        if let Some(error) = response.error.filter(|value| !value.is_empty()) {
            return Err(WorkerFailure::Job(error));
        }
        Ok(XyzrenderCardOutcome {
            id: job.id.clone(),
            log: response.log.unwrap_or_default(),
            error: None,
        })
    }

    fn exchange(
        &mut self,
        payload: &str,
        timeout: Duration,
    ) -> Result<WorkerResponse, WorkerFailure> {
        self.stdin
            .write_all(payload.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|err| {
                WorkerFailure::Worker(format!("xyzrender worker stopped accepting work: {err}"))
            })?;
        let line = match self.responses.recv_timeout(timeout) {
            Ok(value) => value,
            Err(RecvTimeoutError::Timeout) => {
                return Err(WorkerFailure::Worker(format!(
                    "xyzrender worker timed out after {} seconds. {}",
                    timeout.as_secs(),
                    self.captured_stderr()
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(WorkerFailure::Worker(format!(
                    "xyzrender worker exited unexpectedly. {}",
                    self.captured_stderr()
                )))
            }
        };
        serde_json::from_str::<WorkerResponse>(&line).map_err(|err| {
            WorkerFailure::Worker(format!("Could not decode xyzrender worker response: {err}"))
        })
    }

    fn captured_stderr(&self) -> String {
        self.stderr
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    fn kill(mut self) {
        drop(self.stdin);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_worker(launch: &XyzrenderWorkerLaunch) -> Result<Worker, String> {
    let helper_path = write_worker_helper()?;
    let mut command = Command::new(&launch.program);
    command.arg(helper_path);
    for (key, value) in &launch.envs {
        command.env(key, value);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not start xyzrender worker: {err}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open xyzrender worker stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture xyzrender worker stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture xyzrender worker stderr.".to_string())?;
    let (sender, responses) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let captured = Arc::new(Mutex::new(String::new()));
    let stderr_sink = Arc::clone(&captured);
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            let mut stored = stderr_sink.lock().unwrap_or_else(|err| err.into_inner());
            if stored.len() >= WORKER_STDERR_CAPTURE_BYTES {
                continue;
            }
            stored.push_str(&line);
            stored.push('\n');
        }
    });
    let mut worker = Worker {
        child,
        stdin,
        responses,
        stderr: captured,
    };
    match worker.exchange(
        "{\"op\":\"warmup\",\"id\":\"warmup\"}",
        WORKER_WARMUP_TIMEOUT,
    ) {
        Ok(response) => {
            if let Some(error) = response.error.filter(|value| !value.is_empty()) {
                worker.kill();
                return Err(format!("xyzrender worker failed to start: {error}"));
            }
            Ok(worker)
        }
        Err(WorkerFailure::Job(error)) | Err(WorkerFailure::Worker(error)) => {
            worker.kill();
            Err(error)
        }
    }
}

fn write_worker_helper() -> Result<PathBuf, String> {
    static HELPER_PATH: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    HELPER_PATH
        .get_or_init(|| {
            let directory = std::env::temp_dir();
            let helper_path = directory.join(format!(
                "burette-xyzrender-grid-worker-{}.py",
                std::process::id()
            ));
            std::fs::write(&helper_path, XYZRENDER_GRID_WORKER_HELPER)
                .map(|_| helper_path)
                .map_err(|err| format!("Could not write xyzrender worker helper: {err}"))
        })
        .clone()
}

const XYZRENDER_GRID_WORKER_HELPER: &str = r#"
import json
import os
import sys

responses = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

from xyzrender import load, render


def draw(request):
    smiles = request.get("smiles")
    if smiles:
        mol = load(str(smiles), smiles=True)
    else:
        mol = load(str(request.get("inputPath") or ""))
    kwargs = {"config": request.get("config") or "default"}
    canvas_size = request.get("canvasSize")
    if canvas_size:
        kwargs["canvas_size"] = canvas_size
    svg = render(mol, **kwargs)
    with open(request["outputPath"], "w", encoding="utf-8") as handle:
        handle.write(str(svg))


def handle(request):
    identifier = str(request.get("id", ""))
    try:
        if request.get("op") == "warmup":
            render(load("C", smiles=True), config="default")
        else:
            draw(request)
        return {"id": identifier, "log": ""}
    except Exception as exc:
        return {"id": identifier, "error": str(exc)}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
    except Exception as exc:
        response = {"id": "", "error": "invalid xyzrender worker request: " + str(exc)}
    else:
        response = handle(request)
    responses.write(json.dumps(response) + "\n")
    responses.flush()
"#;
