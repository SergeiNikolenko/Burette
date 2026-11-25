use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static POOL: OnceLock<Pool> = OnceLock::new();
static HELPER_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

const WORKER_WARMUP_TIMEOUT: Duration = Duration::from_secs(60);
const WORKER_JOB_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_STDERR_CAPTURE_BYTES: usize = 8 * 1024;
const WORKER_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const WORKER_REAP_INTERVAL: Duration = Duration::from_secs(30);
const WORKER_MIN_COUNT: usize = 2;
#[cfg(windows)]
const WORKER_MAX_COUNT: usize = 4;
#[cfg(not(windows))]
const WORKER_MAX_COUNT: usize = 6;
#[cfg(windows)]
const MAX_CONCURRENT_SPAWNS: usize = 2;
#[cfg(not(windows))]
const MAX_CONCURRENT_SPAWNS: usize = 4;

pub(super) struct XyzrenderWorkerLaunch {
    pub(super) program: PathBuf,
    pub(super) envs: Vec<(&'static str, String)>,
    pub(super) signature: String,
}

pub(super) struct XyzrenderCardJob {
    pub(super) id: String,
    pub(super) smiles: Option<String>,
    pub(super) thumbnail: bool,
    pub(super) input_path: Option<PathBuf>,
    pub(super) output_path: PathBuf,
    pub(super) config: String,
    pub(super) canvas_size: Option<f64>,
    pub(super) display_hydrogens: Option<&'static str>,
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
    thumbnail: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    input_path: Option<String>,
    output_path: String,
    config: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    canvas_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_hydrogens: Option<&'a str>,
}

#[derive(Serialize)]
struct WorkerCliRequest<'a> {
    op: &'static str,
    id: &'static str,
    args: &'a [String],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    #[serde(default)]
    log: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    status: Option<i32>,
}

pub(super) struct XyzrenderCliOutcome {
    pub(super) success: bool,
    pub(super) status: Option<i32>,
    pub(super) log: String,
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
    pool.ensure_workers(launch, lanes);
    let queue = Mutex::new(VecDeque::from(jobs));
    let outcomes = Mutex::new(Vec::new());
    let spawn_error: Mutex<Option<String>> = Mutex::new(None);
    thread::scope(|scope| {
        for _ in 0..lanes {
            scope.spawn(|| {
                let mut worker: Option<Worker> = None;
                let mut respawned_after_failure = false;
                loop {
                    if worker.is_none() {
                        match pool.acquire_while_pending(&queue) {
                            AcquireOutcome::Worker(value) => worker = Some(value),
                            AcquireOutcome::QueueEmpty => break,
                            AcquireOutcome::Failed(error) => {
                                let mut slot =
                                    spawn_error.lock().unwrap_or_else(|err| err.into_inner());
                                if slot.is_none() {
                                    *slot = Some(error);
                                }
                                break;
                            }
                        }
                    }
                    let (job, queue_now_empty) = {
                        let mut pending = queue.lock().unwrap_or_else(|err| err.into_inner());
                        let next = pending.pop_front();
                        (next, pending.is_empty())
                    };
                    if queue_now_empty {
                        pool.available.notify_all();
                    }
                    let Some(job) = job else {
                        break;
                    };
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
                            if !respawned_after_failure && !queue_now_empty {
                                respawned_after_failure = true;
                                pool.ensure_workers(launch, 1);
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
    let fallback_error = spawn_error
        .into_inner()
        .unwrap_or_else(|err| err.into_inner())
        .unwrap_or_else(|| "No xyzrender worker was available for this card.".to_string());
    for job in remaining {
        results.push(failed_outcome(&job, &fallback_error));
    }
    results
}

/// Runs one xyzrender command line inside a warm pool worker.
///
/// A command-line animation starts a new interpreter and then a new process
/// pool that imports the render stack again for its frames. The worker keeps
/// both alive, which cut a default 120-frame rotation GIF from about 4 s to
/// 1.4 s with byte-identical output.
pub(super) fn run_cli(
    launch: &XyzrenderWorkerLaunch,
    args: &[String],
    timeout: Duration,
) -> Result<XyzrenderCliOutcome, String> {
    let payload = serde_json::to_string(&WorkerCliRequest {
        op: "cli",
        id: "cli",
        args,
    })
    .map_err(|err| format!("Could not encode xyzrender request: {err}"))?;
    let pool = pool();
    ensure_idle_worker_reaper();
    pool.discard_stale_workers(&launch.signature);
    let mut worker = pool.acquire(launch)?;
    match worker.exchange(&payload, timeout) {
        Ok(response) => {
            pool.release(worker);
            if let Some(error) = response.error.filter(|value| !value.is_empty()) {
                return Err(error);
            }
            Ok(XyzrenderCliOutcome {
                success: response.status == Some(0),
                status: response.status,
                log: response.log.unwrap_or_default(),
            })
        }
        Err(WorkerFailure::Job(error) | WorkerFailure::Worker(error)) => {
            pool.discard(worker);
            Err(error)
        }
    }
}

/// Prepare the bounded pool while the molecular grid is opening. Reserving slots under
/// the pool lock makes concurrent document opens bounded and non-blocking.
pub(super) fn warmup(launch: XyzrenderWorkerLaunch, desired_workers: usize) {
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        return;
    }
    let pool = pool();
    ensure_idle_worker_reaper();
    pool.ensure_workers_owned(launch, desired_workers);
}

pub(super) fn shutdown() {
    SHUTTING_DOWN.store(true, Ordering::Release);
    if let Some(pool) = POOL.get() {
        let mut state = pool.state.lock().unwrap_or_else(|err| err.into_inner());
        state.generation = state.generation.wrapping_add(1);
        let idle = std::mem::take(&mut state.idle);
        state.live = state.live.saturating_sub(idle.len());
        drop(state);
        for entry in idle {
            entry.worker.kill();
        }
        pool.available.notify_all();
    }
    if let Some(lock) = HELPER_PATH.get() {
        if let Some(path) = lock.lock().unwrap_or_else(|err| err.into_inner()).take() {
            let _ = std::fs::remove_file(path);
        }
    }
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
    POOL.get_or_init(|| Pool {
        state: Mutex::new(PoolState {
            signature: String::new(),
            generation: 0,
            idle: Vec::new(),
            live: 0,
            spawning: 0,
            last_spawn_error: None,
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
    generation: u64,
    idle: Vec<IdleWorker>,
    live: usize,
    spawning: usize,
    last_spawn_error: Option<String>,
}

enum AcquireOutcome {
    Worker(Worker),
    QueueEmpty,
    Failed(String),
}

struct IdleWorker {
    worker: Worker,
    since: Instant,
}

impl Pool {
    fn ensure_workers(&self, launch: &XyzrenderWorkerLaunch, desired_workers: usize) {
        let owned = XyzrenderWorkerLaunch {
            program: launch.program.clone(),
            envs: launch.envs.clone(),
            signature: launch.signature.clone(),
        };
        self.ensure_workers_owned(owned, desired_workers);
    }

    fn ensure_workers_owned(&self, launch: XyzrenderWorkerLaunch, desired_workers: usize) {
        if SHUTTING_DOWN.load(Ordering::Acquire) {
            return;
        }
        let (generation, count) = self.reserve_warmup(&launch.signature, desired_workers);
        if count == 0 {
            return;
        }
        let launch = Arc::new(launch);
        // Bound simultaneous cold Python startups (especially on Windows where
        // concurrent interpreter imports contend on disk I/O and Defender) so
        // the first warm worker becomes ready as quickly as possible.
        let concurrency = count.min(MAX_CONCURRENT_SPAWNS);
        let remaining = Arc::new(Mutex::new(count));
        for _ in 0..concurrency {
            let launch = Arc::clone(&launch);
            let remaining = Arc::clone(&remaining);
            thread::spawn(move || {
                let pool = pool();
                loop {
                    let should_spawn = {
                        let mut left = remaining.lock().unwrap_or_else(|err| err.into_inner());
                        if *left == 0 {
                            false
                        } else {
                            *left -= 1;
                            true
                        }
                    };
                    if !should_spawn {
                        break;
                    }
                    if SHUTTING_DOWN.load(Ordering::Acquire) {
                        pool.finish_failed_spawn(
                            generation,
                            "xyzrender pool is shutting down".into(),
                        );
                        continue;
                    }
                    match spawn_worker(&launch, generation) {
                        Ok(worker) => pool.finish_spawned_worker(worker),
                        Err(error) => pool.finish_failed_spawn(generation, error),
                    }
                }
            });
        }
    }

    fn finish_spawned_worker(&self, worker: Worker) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state.spawning = state.spawning.saturating_sub(1);
        if SHUTTING_DOWN.load(Ordering::Acquire) || worker.generation != state.generation {
            state.live = state.live.saturating_sub(1);
            drop(state);
            worker.kill();
            self.available.notify_all();
            return;
        }
        state.last_spawn_error = None;
        state.idle.push(IdleWorker {
            worker,
            since: Instant::now(),
        });
        drop(state);
        self.available.notify_all();
    }

    fn finish_failed_spawn(&self, generation: u64, error: String) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state.spawning = state.spawning.saturating_sub(1);
        state.live = state.live.saturating_sub(1);
        if state.generation == generation {
            state.last_spawn_error = Some(error);
        }
        drop(state);
        self.available.notify_all();
    }

    fn reserve_warmup(&self, signature: &str, desired_workers: usize) -> (u64, usize) {
        let (generation, count, stale) = {
            let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
            let stale = if state.signature != signature {
                state.signature = signature.to_string();
                state.generation = state.generation.wrapping_add(1);
                state.last_spawn_error = None;
                let drained = std::mem::take(&mut state.idle);
                state.live = state.live.saturating_sub(drained.len());
                drained
            } else {
                Vec::new()
            };
            let count = desired_workers
                .min(self.capacity)
                .saturating_sub(state.live);
            state.live += count;
            state.spawning += count;
            (state.generation, count, stale)
        };
        let had_stale = !stale.is_empty();
        for idle in stale {
            idle.worker.kill();
        }
        if had_stale {
            self.available.notify_all();
        }
        (generation, count)
    }

    fn discard_stale_workers(&self, signature: &str) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        if state.signature == signature {
            return;
        }
        state.signature = signature.to_string();
        state.generation = state.generation.wrapping_add(1);
        state.last_spawn_error = None;
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

    fn acquire_while_pending(&self, queue: &Mutex<VecDeque<XyzrenderCardJob>>) -> AcquireOutcome {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        loop {
            if SHUTTING_DOWN.load(Ordering::Acquire) {
                return AcquireOutcome::Failed("xyzrender pool is shutting down".to_string());
            }
            let empty = queue
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .is_empty();
            if empty {
                return AcquireOutcome::QueueEmpty;
            }
            if let Some(idle) = state.idle.pop() {
                return AcquireOutcome::Worker(idle.worker);
            }
            if state.live == 0 {
                return AcquireOutcome::Failed(
                    state.last_spawn_error.clone().unwrap_or_else(|| {
                        "No xyzrender worker was available for this card.".into()
                    }),
                );
            }
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|err| err.into_inner());
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
                state.spawning += 1;
                let generation = state.generation;
                drop(state);
                match spawn_worker(launch, generation) {
                    Ok(worker) => {
                        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
                        state.spawning = state.spawning.saturating_sub(1);
                        state.last_spawn_error = None;
                        return Ok(worker);
                    }
                    Err(error) => {
                        self.finish_failed_spawn(generation, error.clone());
                        return Err(error);
                    }
                }
            }
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|err| err.into_inner());
        }
    }

    fn release(&self, worker: Worker) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        if SHUTTING_DOWN.load(Ordering::Acquire) || worker.generation != state.generation {
            state.live = state.live.saturating_sub(1);
            drop(state);
            worker.kill();
            self.available.notify_all();
            return;
        }
        state.idle.push(IdleWorker {
            worker,
            since: Instant::now(),
        });
        drop(state);
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
    generation: u64,
}

impl Worker {
    fn render(&mut self, job: &XyzrenderCardJob) -> Result<XyzrenderCardOutcome, WorkerFailure> {
        let request = WorkerRequest {
            id: &job.id,
            smiles: job.smiles.as_deref(),
            thumbnail: job.thumbnail,
            input_path: job
                .input_path
                .as_ref()
                .map(|path| path.display().to_string()),
            output_path: job.output_path.display().to_string(),
            config: &job.config,
            canvas_size: job.canvas_size,
            display_hydrogens: job.display_hydrogens,
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

fn spawn_worker(launch: &XyzrenderWorkerLaunch, generation: u64) -> Result<Worker, String> {
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        return Err("xyzrender pool is shutting down".to_string());
    }
    let helper_path = write_worker_helper()?;
    let mut command = crate::preview::runtime_utils::background_command(&launch.program);
    command.arg(helper_path);
    // Keep BLAS/OpenMP single-threaded inside each pooled worker so multiple
    // workers do not spawn dozens of competing threads per process on Windows.
    command
        .env("OPENBLAS_NUM_THREADS", "1")
        .env("OMP_NUM_THREADS", "1")
        .env("MKL_NUM_THREADS", "1")
        .env("NUMEXPR_NUM_THREADS", "1");
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
        generation,
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
    let lock = HELPER_PATH.get_or_init(|| Mutex::new(None));
    let mut cached = lock.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(path) = cached.as_ref() {
        if path.exists() {
            return Ok(path.clone());
        }
    }
    let directory = std::env::temp_dir();
    let helper_path = directory.join(format!(
        "burette-xyzrender-grid-worker-{}.py",
        std::process::id()
    ));
    std::fs::write(&helper_path, XYZRENDER_GRID_WORKER_HELPER)
        .map_err(|err| format!("Could not write xyzrender worker helper: {err}"))?;
    *cached = Some(helper_path.clone());
    Ok(helper_path)
}

const XYZRENDER_GRID_WORKER_HELPER: &str = r#"
import json
import os
import sys
import tempfile
from collections import OrderedDict

# Animation frame processes import this file as __mp_main__; only the worker
# itself owns the response pipe and the request loop.
if __name__ == "__main__":
    responses = os.fdopen(os.dup(1), "w")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

from xyzrender import load, render

ANIMATION_FRAME_PROCESSES = 4
CLI_LOG_BYTES = 64 * 1024
frame_pool = None


thumbnail_cache = OrderedDict()


def load_thumbnail(smiles):
    if smiles in thumbnail_cache:
        molecule = thumbnail_cache.pop(smiles)
        thumbnail_cache[smiles] = molecule
        return molecule
    # A card needs one reproducible 3D layout, not a ten-conformer energy search.
    # Use public RDKit/xyzrender APIs; coordinate-bearing files bypass this path.
    from rdkit import Chem
    from rdkit.Chem import rdDistGeom, rdForceFieldHelpers

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Could not parse molecule")
    mol = Chem.AddHs(mol)
    params = rdDistGeom.ETKDGv3()
    params.randomSeed = 42
    if rdDistGeom.EmbedMolecule(mol, params) < 0:
        # Keep the existing recovery path for difficult embeddings.
        return load(smiles, smiles=True)
    rdForceFieldHelpers.MMFFOptimizeMolecule(mol)
    molecule = load(mol)
    # Bound both entry count and molecule/key size, including explicit H atoms.
    if mol.GetNumAtoms() <= 256 and len(smiles) <= 4096:
        thumbnail_cache[smiles] = molecule
        while len(thumbnail_cache) > 32:
            thumbnail_cache.popitem(last=False)
    return molecule


def draw(request):
    smiles = request.get("smiles")
    if smiles:
        mol = load_thumbnail(str(smiles)) if request.get("thumbnail") else load(str(smiles), smiles=True)
    else:
        mol = load(str(request.get("inputPath") or ""))
    kwargs = {"config": request.get("config") or "default"}
    canvas_size = request.get("canvasSize")
    if canvas_size:
        kwargs["canvas_size"] = canvas_size
    hydrogens = request.get("displayHydrogens")
    if hydrogens == "none":
        kwargs["no_hy"] = True
    elif hydrogens == "all":
        kwargs["hy"] = True
    svg = render(mol, **kwargs)
    with open(request["outputPath"], "w", encoding="utf-8") as handle:
        handle.write(str(svg))


def use_frame_pool():
    # xyzrender opens a new spawn pool for every GIF, so each animation paid for
    # importing the render stack in every frame process. Keep one pool per warm
    # worker, created lazily only when a GIF animation actually renders frames.
    from xyzrender import gif

    def parallel_render(worker, items, total):
        global frame_pool
        if frame_pool is None:
            import multiprocessing

            frame_pool = multiprocessing.get_context("spawn").Pool(ANIMATION_FRAME_PROCESSES)
        pngs = [b""] * total
        for index, png in frame_pool.imap_unordered(worker, items, chunksize=4):
            pngs[index] = png
        return pngs

    gif._parallel_render = parallel_render


def run_cli(request):
    from xyzrender import cli

    use_frame_pool()
    status = 0
    saved_argv = sys.argv
    sys.stderr.flush()
    saved_stderr = os.dup(2)
    with tempfile.TemporaryFile() as capture:
        os.dup2(capture.fileno(), 2)
        try:
            sys.argv = ["xyzrender", *[str(value) for value in request.get("args") or []]]
            cli.main()
        except SystemExit as exc:
            if isinstance(exc.code, int):
                status = exc.code
            elif exc.code is not None:
                status = 1
                print(exc.code, file=sys.stderr)
        except Exception as exc:
            status = 1
            print("xyzrender: error: " + str(exc), file=sys.stderr)
        finally:
            sys.argv = saved_argv
            sys.stderr.flush()
            os.dup2(saved_stderr, 2)
            os.close(saved_stderr)
        capture.seek(0)
        log = capture.read()[-CLI_LOG_BYTES:].decode("utf-8", "replace")
    return {"id": str(request.get("id", "")), "log": log, "status": status}


def handle(request):
    identifier = str(request.get("id", ""))
    try:
        if request.get("op") == "cli":
            return run_cli(request)
        if request.get("op") == "warmup":
            render(load_thumbnail("C"), config="default")
        else:
            draw(request)
        return {"id": identifier, "log": ""}
    except Exception as exc:
        return {"id": identifier, "error": str(exc)}


def serve():
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


if __name__ == "__main__":
    serve()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_spawn_surfaces_error_for_all_queued_cards_without_hanging() {
        let launch = XyzrenderWorkerLaunch {
            program: PathBuf::from("/nonexistent/burette-missing-python"),
            envs: Vec::new(),
            signature: format!("missing-python-{}", uuid::Uuid::new_v4()),
        };
        let jobs = (0..3)
            .map(|index| XyzrenderCardJob {
                id: format!("card-{index}"),
                smiles: Some("CCO".to_string()),
                thumbnail: true,
                input_path: None,
                output_path: std::env::temp_dir().join(format!("burette-unused-{index}.svg")),
                config: "default".to_string(),
                canvas_size: None,
                display_hydrogens: Some("none"),
            })
            .collect();
        let outcomes = render_cards(&launch, jobs);
        assert_eq!(outcomes.len(), 3);
        for outcome in outcomes {
            assert!(
                outcome
                    .error
                    .as_deref()
                    .is_some_and(|message| message.contains("Could not start xyzrender worker")),
                "expected spawn failure error, got {:?}",
                outcome.error
            );
        }
    }
}
