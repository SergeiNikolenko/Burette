use serde_json::Value;
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Manager, Runtime};

const RUNNER_DEPENDENCIES: [&str; 4] = ["numpy", "scipy", "MDAnalysis", "deeptime"];

#[tauri::command]
pub(crate) fn run_mdsmooth<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: Value,
) -> Result<Value, String> {
    let runner = runner_path(&app)?;
    validate_request_paths(&request)?;
    let payload = serde_json::to_vec(&request)
        .map_err(|error| format!("Could not serialize the MDSmooth request: {error}"))?;
    let uv = resolve_uv_executable()?;
    let mut command = Command::new(&uv);
    command.arg("run");
    for dependency in RUNNER_DEPENDENCIES {
        command.args(["--with", dependency]);
    }
    command
        .arg("python")
        .arg(&runner)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start the MDSmooth runtime with {}: {error}",
            uv.display()
        )
    })?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Could not open MDSmooth input.".to_string())?
        .write_all(&payload)
        .map_err(|error| format!("Could not send the MDSmooth request: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for MDSmooth: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "MDSmooth exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let response: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "MDSmooth returned invalid JSON: {error}. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
    })?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("MDSmooth analysis failed.")
            .to_string());
    }
    Ok(response)
}

fn validate_request_paths(request: &Value) -> Result<(), String> {
    if matches!(
        request.get("operation").and_then(Value::as_str),
        Some("capabilities" | "installDeepTica")
    ) {
        return Ok(());
    }
    let trajectory = request
        .get("trajectoryPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "trajectoryPath is required.".to_string())?;
    if !Path::new(trajectory).is_file() {
        return Err(format!("Trajectory does not exist: {trajectory}"));
    }
    if let Some(topology) = request
        .get("topologyPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        if !Path::new(topology).is_file() {
            return Err(format!("Topology does not exist: {topology}"));
        }
    }
    Ok(())
}

fn runner_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource) = app
        .path()
        .resolve("mdsmooth_runner.py", tauri::path::BaseDirectory::Resource)
    {
        if resource.is_file() {
            return Ok(resource);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or(&manifest_dir);
    let source = repo_root.join("scripts").join("mdsmooth_runner.py");
    if source.is_file() {
        return Ok(source);
    }
    Err("The bundled MDSmooth runner is unavailable.".to_string())
}

fn resolve_uv_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("BURETTE_UV") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/uv"));
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join("uv")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/uv"),
        PathBuf::from("/usr/local/bin/uv"),
    ]);
    resolve_uv_from_candidates(candidates).ok_or_else(|| {
        "uv was not found. Install uv or set BURETTE_UV to the uv executable.".into()
    })
}

fn resolve_uv_from_candidates(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| path.is_file() && is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::{resolve_uv_from_candidates, validate_request_paths};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn capabilities_request_does_not_need_paths() {
        assert!(validate_request_paths(&json!({ "operation": "capabilities" })).is_ok());
    }

    #[test]
    fn analysis_requires_a_trajectory() {
        assert_eq!(
            validate_request_paths(&json!({})).expect_err("trajectory should be required"),
            "trajectoryPath is required."
        );
    }

    #[test]
    fn uv_resolution_accepts_an_executable_outside_path() {
        let root = std::env::temp_dir().join(format!(
            "burette-mdsmooth-uv-resolution-{}",
            std::process::id()
        ));
        let uv = root.join(".local/bin/uv");
        fs::create_dir_all(uv.parent().expect("uv parent")).expect("create uv parent");
        fs::write(&uv, "#!/bin/sh\n").expect("write uv");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&uv).expect("uv metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&uv, permissions).expect("make uv executable");
        }

        assert_eq!(
            resolve_uv_from_candidates(vec![PathBuf::from("/missing/uv"), uv.clone()]),
            Some(uv)
        );

        fs::remove_dir_all(root).expect("remove test directory");
    }
}
