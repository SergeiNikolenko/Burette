//! Read-only SSH previews using the user's OpenSSH configuration and agent.
use serde::{Deserialize, Serialize};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::Manager;
static REQUEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

const WORKER: &str = include_str!("reader.py");
const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    host: String,
    root: String,
    path: String,
}

#[derive(Serialize)]
pub(crate) struct Host {
    alias: String,
}

fn validate(request: &Request) -> Result<(), String> {
    if request.host.is_empty()
        || request.host.len() > 255
        || request.host.starts_with('-')
        || !request
            .host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-@:".contains(&c))
    {
        return Err("Choose an SSH alias or user@hostname".into());
    }
    if request.root.len() + request.path.len() > 8192
        || request.root.contains('\0')
        || request.path.contains('\0')
    {
        return Err("Invalid remote path".into());
    }
    Ok(())
}

fn run(request: &Request, operation: &str) -> Result<Vec<u8>, String> {
    validate(request)?;
    let _guard = REQUEST_LOCK
        .try_lock()
        .map_err(|_| "Another SSH request is running; try again when it finishes")?;
    // Only the bundled worker is shell-quoted. User paths travel as JSON on stdin.
    let remote_command = format!("python3 -c '{}'", WORKER.replace('\'', "'\\''"));
    let mut child = Command::new("/usr/bin/ssh")
        .args([
            "-T",
            "-oBatchMode=yes",
            "-oStrictHostKeyChecking=yes",
            "-oConnectTimeout=10",
            "-oServerAliveInterval=5",
            "-oServerAliveCountMax=2",
            "-oForwardAgent=no",
            "-oClearAllForwardings=yes",
            "--",
            &request.host,
            &remote_command,
        ])
        .process_group(0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("SSH stdin unavailable")?;
    let output = child.stdout.take().ok_or("SSH stdout unavailable")?;
    let errors = child.stderr.take().ok_or("SSH stderr unavailable")?;
    let limit = if operation == "read" {
        MAX_BYTES
    } else {
        2 * 1024 * 1024
    };
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let error_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        errors.take(8192).read_to_end(&mut bytes).map(|_| bytes)
    });
    let payload =
        serde_json::json!({"operation": operation, "root": request.root, "path": request.path});
    let written = input.write_all(payload.to_string().as_bytes());
    drop(input);
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < Duration::from_secs(45) && written.is_ok() => {
                std::thread::sleep(Duration::from_millis(25))
            }
            other => {
                // Kill proxy descendants too so their inherited pipes cannot hold readers open.
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                break Err(match other {
                    Err(e) => e.to_string(),
                    _ => "SSH request timed out or connection closed".into(),
                });
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "SSH reader failed")?
        .map_err(|e| e.to_string())?;
    let errors = error_reader
        .join()
        .map_err(|_| "SSH error reader failed")?
        .map_err(|e| e.to_string())?;
    if !status?.success() {
        return Err(format!("SSH: {}", String::from_utf8_lossy(&errors).trim()));
    }
    if bytes.len() as u64 > limit {
        return Err("SSH response exceeds preview limit".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub(crate) async fn ssh_hosts() -> Result<Vec<Host>, String> {
    // Literal aliases are suggestions; OpenSSH resolves Include, Match and ProxyJump on connection.
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let mut config = String::new();
    if let Ok(file) = std::fs::File::open(format!("{home}/.ssh/config")) {
        file.take(512 * 1024)
            .read_to_string(&mut config)
            .map_err(|e| e.to_string())?;
    }
    let mut aliases = std::collections::BTreeSet::new();
    for line in config.lines().take(10000) {
        let mut words = line
            .split('#')
            .next()
            .unwrap_or_default()
            .split_whitespace();
        if !words
            .next()
            .is_some_and(|key| key.eq_ignore_ascii_case("host"))
        {
            continue;
        }
        for alias in words {
            if !alias.contains(['*', '?', '!'])
                && validate(&Request {
                    host: alias.into(),
                    root: String::new(),
                    path: String::new(),
                })
                .is_ok()
            {
                aliases.insert(alias.to_owned());
            }
        }
    }
    Ok(aliases
        .into_iter()
        .take(100)
        .map(|alias| Host { alias })
        .collect())
}

#[tauri::command]
pub(crate) async fn ssh_list(request: Request) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = run(&request, "list")?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid directory response: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn ssh_preview(app: tauri::AppHandle, request: Request) -> Result<String, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("ssh-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = run(&request, "read")?;
        let name = std::path::Path::new(&request.path)
            .file_name()
            .ok_or("Choose a file")?;
        let directory = cache.join(uuid::Uuid::new_v4().to_string());
        let mut count = 0;
        let mut total = 0_u64;
        if let Ok(entries) = std::fs::read_dir(&cache) {
            for entry in entries.take(257).flatten() {
                count += 1;
                if let Ok(files) = std::fs::read_dir(entry.path()) {
                    for file in files.take(2).flatten() {
                        total += file.metadata().map(|m| m.len()).unwrap_or(0);
                    }
                }
            }
        }
        if count >= 256 || total.saturating_add(bytes.len() as u64) > 512 * 1024 * 1024 {
            return Err(
                "SSH preview cache is full. Clear Preview cache in Settings → Maintenance.".into(),
            );
        }
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)
            .map_err(|e| e.to_string())?;
        let path = directory.join(name);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_ssh_options_and_shell_fragments_before_spawning() {
        for host in [
            "-oProxyCommand=evil",
            "user@host;touch /tmp/x",
            "$(id)",
            "host\nother",
        ] {
            let request = Request {
                host: host.into(),
                root: "~".into(),
                path: ".".into(),
            };
            assert!(run(&request, "list").is_err());
        }
        for host in ["Research", "user@server.example", "192.0.2.1"] {
            assert!(validate(&Request {
                host: host.into(),
                root: "~/My structures".into(),
                path: "ligand's molecule.sdf".into()
            })
            .is_ok());
        }
    }
    #[test]
    #[ignore = "requires an explicitly selected trusted SSH host and sample directory"]
    fn live_remote_structure_roundtrip() {
        let host = std::env::var("BURETTE_SSH_TEST_HOST").expect("test host");
        let root = std::env::var("BURETTE_SSH_TEST_ROOT").expect("test root");
        let mut request = Request {
            host,
            root,
            path: ".".into(),
        };
        let listing: serde_json::Value =
            serde_json::from_slice(&run(&request, "list").expect("remote listing")).unwrap();
        assert!(listing["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["name"] == "mini.pdb"));
        request.path = "mini.pdb".into();
        let bytes = run(&request, "read").expect("remote file");
        let molecule = String::from_utf8(bytes).unwrap();
        assert!(molecule
            .lines()
            .any(|line| line.starts_with("ATOM") || line.starts_with("HETATM")));
        request.path = "../outside.pdb".into();
        assert!(run(&request, "read").is_err());
    }
}
