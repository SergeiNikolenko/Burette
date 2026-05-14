use serde_json::json;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const XYZRENDER_TIMEOUT: Duration = Duration::from_secs(20);
const XYZRENDER_LOG_CAPTURE_BYTES: usize = 64 * 1024;

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
) -> Result<XyzrenderArtifact, String> {
    let output_path = output_directory.join("xyzrender.svg");
    let log_path = output_directory.join("xyzrender.log");
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&log_path);
    let started = Instant::now();
    let (status, log) = run_xyzrender_command(
        &resolve_xyzrender_executable()?,
        input_path,
        &output_path,
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
        preset: "default",
        config_argument: "default",
        elapsed_ms: started.elapsed().as_millis(),
        log,
    })
}

fn run_xyzrender_command(
    executable: &Path,
    input_path: &Path,
    output_path: &Path,
    log_path: &Path,
    timeout: Duration,
) -> Result<(ExitStatus, String), String> {
    let mut child = Command::new(executable)
        .arg(input_path)
        .arg("-o")
        .arg(output_path)
        .arg("--config")
        .arg("default")
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
            &directory.join("input.xyz"),
            &directory.join("xyzrender.svg"),
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
}
