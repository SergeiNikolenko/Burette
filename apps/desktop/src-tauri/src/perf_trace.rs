//! Performance trace: how long work holds the AppKit main thread, plus the
//! frontend's journey marks, as JSON lines in PerfTrace.jsonl next to
//! BuretteApp.log in the app cache directory.
//!
//! WebKit hands IPC requests to the app on the main thread, and a command
//! declared without `async` runs inline there, so the time an IPC handler
//! takes is time the window can neither paint nor take input. Handlers that
//! hold the thread for `STALL_THRESHOLD` or longer are always recorded.
//! With `BURETTE_PERF_TRACE=1` in the environment the trace is verbose: every
//! IPC call is recorded, a watchdog samples how late the main queue runs, and
//! the frontend sends its journey marks through `append_perf_trace`.
//!
//! Every line carries `at`, the Unix time in milliseconds when the interval
//! started, which is the same clock as `performance.timeOrigin + now()` in
//! the webviews, so one journey can be read across the shell, the viewer
//! iframes and Rust. Lines are written on a background thread; the live file
//! rolls into PerfTrace.1.jsonl at `PERF_TRACE_LIMIT_BYTES`.

use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Invoke;
use tauri::{Runtime, WebviewWindow};

pub(crate) const PERF_TRACE_NAME: &str = "PerfTrace.jsonl";
pub(crate) const PERF_TRACE_ARCHIVE_NAME: &str = "PerfTrace.1.jsonl";
const PERF_TRACE_LIMIT_BYTES: u64 = 8 * 1024 * 1024;
const STALL_THRESHOLD: Duration = Duration::from_millis(50);
#[cfg(target_os = "macos")]
const WATCHDOG_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(target_os = "macos")]
const WATCHDOG_REPORT: Duration = Duration::from_millis(17);
const MAX_ENTRIES_PER_BATCH: usize = 400;
const MAX_NAME_CHARS: usize = 96;
const MAX_DETAIL_CHARS: usize = 2048;

struct PerfTrace {
    lines: Sender<String>,
    verbose: bool,
}

static TRACE: OnceLock<PerfTrace> = OnceLock::new();

/// Starts the writer thread. Events recorded before this call are dropped.
pub(crate) fn install(cache_dir: PathBuf) {
    let verbose = std::env::var("BURETTE_PERF_TRACE").is_ok_and(|value| value == "1");
    let (lines, receiver) = mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("perf-trace".into())
        .spawn(move || write_lines(&cache_dir, receiver));
    if spawned.is_err() || TRACE.set(PerfTrace { lines, verbose }).is_err() {
        return;
    }
    mark("app:setup", json!({ "pid": std::process::id() }));
    #[cfg(target_os = "macos")]
    if verbose {
        watch_main_queue();
    }
}

/// Records a native journey mark, such as an open request arriving from
/// Launch Services. Ignored unless the trace is verbose.
pub(crate) fn mark(name: &str, detail: Value) {
    if let Some(trace) = TRACE.get().filter(|trace| trace.verbose) {
        trace.send(json!({
            "at": unix_ms(),
            "source": "native",
            "name": name,
            "detail": detail,
        }));
    }
}

/// Whether the frontend should record journey marks.
pub(crate) fn verbose() -> bool {
    TRACE.get().is_some_and(|trace| trace.verbose)
}

/// Wraps the app's IPC handler so each call is timed on the thread that ran it.
pub(crate) fn timed<R, F>(handler: F) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    F: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        let Some(trace) = TRACE.get() else {
            return handler(invoke);
        };
        let command = invoke.message.command().to_owned();
        let window = invoke.message.webview_ref().label().to_owned();
        let at = unix_ms();
        let started = Instant::now();
        let handled = handler(invoke);
        let held = started.elapsed();
        if trace.verbose || held >= STALL_THRESHOLD {
            trace.send(json!({
                "at": at,
                "source": "ipc",
                "name": command,
                "window": window,
                "ms": millis(held),
                "mainThread": is_main_thread(),
            }));
        }
        handled
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct PerfTraceEntry {
    at: f64,
    name: String,
    #[serde(default)]
    ms: Option<f64>,
    #[serde(default)]
    detail: Option<Value>,
}

/// Journey marks from a workspace window; ignored unless the trace is verbose.
#[tauri::command]
pub(crate) fn append_perf_trace<R: Runtime>(
    window: WebviewWindow<R>,
    entries: Vec<PerfTraceEntry>,
) {
    let Some(trace) = TRACE.get().filter(|trace| trace.verbose) else {
        return;
    };
    for entry in entries.into_iter().take(MAX_ENTRIES_PER_BATCH) {
        trace.send(web_line(window.label(), entry));
    }
}

impl PerfTrace {
    fn send(&self, line: Value) {
        let _ = self.lines.send(line.to_string() + "\n");
    }
}

fn web_line(window_label: &str, entry: PerfTraceEntry) -> Value {
    let mut line = json!({
        "at": entry.at,
        "source": "web",
        "name": bounded(&entry.name, MAX_NAME_CHARS),
        "window": bounded(window_label, MAX_NAME_CHARS),
    });
    let object = line.as_object_mut().expect("trace line is an object");
    if let Some(ms) = entry.ms.filter(|ms| ms.is_finite()) {
        object.insert("ms".into(), ms.into());
    }
    if let Some(detail) = entry.detail.filter(|detail| !detail.is_null()) {
        let detail = if detail.to_string().chars().count() > MAX_DETAIL_CHARS {
            json!({ "truncated": true })
        } else {
            detail
        };
        object.insert("detail".into(), detail);
    }
    line
}

fn write_lines(cache_dir: &Path, receiver: Receiver<String>) {
    let path = cache_dir.join(PERF_TRACE_NAME);
    let mut size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    while let Ok(first) = receiver.recv() {
        let mut text = first;
        while text.len() < 64 * 1024 {
            match receiver.try_recv() {
                Ok(line) => text.push_str(&line),
                Err(_) => break,
            }
        }
        if size > 0 && size + text.len() as u64 > PERF_TRACE_LIMIT_BYTES {
            let _ = fs::rename(&path, cache_dir.join(PERF_TRACE_ARCHIVE_NAME));
            size = 0;
        }
        let written = fs::create_dir_all(cache_dir).and_then(|_| {
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)?
                .write_all(text.as_bytes())
        });
        if written.is_ok() {
            size += text.len() as u64;
        }
    }
}

/// Queues a block on the main dispatch queue every `WATCHDOG_INTERVAL` and
/// records how late it ran. The main queue is served in every run loop mode,
/// including modal panels and menu tracking, so this measures when the thread
/// was busy no matter which code held it.
#[cfg(target_os = "macos")]
fn watch_main_queue() {
    let _ = std::thread::Builder::new()
        .name("perf-main-queue-watchdog".into())
        .spawn(|| loop {
            std::thread::sleep(WATCHDOG_INTERVAL);
            let (ran, wait) = mpsc::channel();
            let at = unix_ms();
            let queued = Instant::now();
            crate::macos::after_current_appkit_event(move || {
                let _ = ran.send(queued.elapsed());
            });
            let Ok(late) = wait.recv() else {
                return;
            };
            if late >= WATCHDOG_REPORT {
                if let Some(trace) = TRACE.get() {
                    trace.send(json!({
                        "at": at,
                        "source": "main-queue",
                        "name": "main-queue:late",
                        "ms": millis(late),
                    }));
                }
            }
        });
}

fn is_main_thread() -> bool {
    std::thread::current().name() == Some("main")
}

fn millis(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000_000.0).round() / 1000.0
}

fn unix_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| (duration.as_secs_f64() * 1_000_000.0).round() / 1000.0)
        .unwrap_or(0.0)
}

fn bounded(value: &str, limit: usize) -> String {
    let single_line = value.replace(['\n', '\r'], " ");
    if single_line.chars().count() <= limit {
        return single_line;
    }
    single_line.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_lines_are_bounded_and_keep_the_shared_clock() {
        let line = web_line(
            "main",
            PerfTraceEntry {
                at: 1_760_000_000_123.456,
                name: format!("tab:visible\n{}", "x".repeat(200)),
                ms: Some(f64::NAN),
                detail: Some(Value::String("y".repeat(5000))),
            },
        );
        assert_eq!(line["at"], json!(1_760_000_000_123.456));
        assert_eq!(line["source"], "web");
        assert_eq!(
            line["name"].as_str().unwrap().chars().count(),
            MAX_NAME_CHARS
        );
        assert!(!line["name"].as_str().unwrap().contains('\n'));
        assert!(line.get("ms").is_none());
        assert_eq!(line["detail"], json!({ "truncated": true }));
    }

    #[test]
    fn writer_rolls_the_live_file_into_one_archive() {
        let dir = std::env::temp_dir().join(format!("burette-perf-trace-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let live = dir.join(PERF_TRACE_NAME);
        fs::write(&live, vec![b'x'; PERF_TRACE_LIMIT_BYTES as usize]).unwrap();
        let (lines, receiver) = mpsc::channel();
        lines.send("{\"name\":\"after\"}\n".to_string()).unwrap();
        drop(lines);
        write_lines(&dir, receiver);
        assert_eq!(fs::read_to_string(&live).unwrap(), "{\"name\":\"after\"}\n");
        assert_eq!(
            fs::metadata(dir.join(PERF_TRACE_ARCHIVE_NAME))
                .unwrap()
                .len(),
            PERF_TRACE_LIMIT_BYTES
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
