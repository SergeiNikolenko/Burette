use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::descriptors::{descriptor_install_hint, resolve_python_executable, run_python_script};

const RGROUP_STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const RGROUP_RUN_TIMEOUT: Duration = Duration::from_secs(600);
const RGROUP_ROW_LIMIT: usize = 5_000;
const RGROUP_INPUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;
const RGROUP_LABEL_LIMIT: usize = 40;

// R-group decomposition is the one SAR tool with no in-process engine behind
// it: openchemlib has no equivalent and the vendored RDKit WASM build ships
// without rdRGroupDecomposition, so the managed Python runtime does the work.
// The runner imports RDKit only - Mordred is the descriptor pipeline's
// dependency, not this one - so a plain RDKit interpreter is enough.
const RGROUP_RUNNER: &str = include_str!("rgroup_runner.py");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RGroupRow {
    row_id: i64,
    smiles: Option<String>,
    molblock: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RGroupDecomposeRequest {
    core: String,
    rows: Vec<RGroupRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RGroupRuntimeStatus {
    available: bool,
    python_path: Option<String>,
    rdkit_version: Option<String>,
    message: String,
    install_hint: String,
}

#[tauri::command]
pub(crate) fn rgroup_runtime_status() -> RGroupRuntimeStatus {
    let python_path = match resolve_python_executable() {
        Ok(path) => path,
        Err(error) => {
            return RGroupRuntimeStatus {
                available: false,
                python_path: None,
                rdkit_version: None,
                message: error,
                install_hint: descriptor_install_hint(),
            }
        }
    };
    let displayed_path = python_path.to_string_lossy().to_string();
    match run_python_script(
        &python_path,
        RGROUP_RUNNER,
        json!({ "mode": "status" }),
        RGROUP_STATUS_TIMEOUT,
    ) {
        Ok(payload) if payload.get("ok").and_then(Value::as_bool) == Some(true) => {
            RGroupRuntimeStatus {
                available: true,
                python_path: Some(displayed_path),
                rdkit_version: payload
                    .get("rdkitVersion")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                message: "R-group runtime is available".into(),
                install_hint: descriptor_install_hint(),
            }
        }
        Ok(payload) => RGroupRuntimeStatus {
            available: false,
            python_path: Some(displayed_path),
            rdkit_version: None,
            message: payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("R-group runtime could not import RDKit")
                .to_string(),
            install_hint: descriptor_install_hint(),
        },
        Err(error) => RGroupRuntimeStatus {
            available: false,
            python_path: Some(displayed_path),
            rdkit_version: None,
            message: error,
            install_hint: descriptor_install_hint(),
        },
    }
}

#[tauri::command]
pub(crate) async fn rgroup_decompose(request: RGroupDecomposeRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_decomposition(request))
        .await
        .map_err(|error| error.to_string())?
}

fn run_decomposition(request: RGroupDecomposeRequest) -> Result<Value, String> {
    let core = request.core.trim();
    if core.len() > RGROUP_INPUT_LIMIT_BYTES {
        return Err("R-group core is too large".into());
    }
    if request.rows.is_empty() {
        return Err("R-group decomposition needs at least one molecule".into());
    }
    if request.rows.len() > RGROUP_ROW_LIMIT {
        return Err(format!(
            "R-group decomposition is limited to {RGROUP_ROW_LIMIT} molecules, got {}",
            request.rows.len()
        ));
    }
    let payload = json!({
        "mode": "decompose",
        "core": core,
        "rows": request
            .rows
            .iter()
            .map(|row| json!({
                "rowId": row.row_id,
                "smiles": row.smiles,
                "molblock": row.molblock,
            }))
            .collect::<Vec<_>>(),
    });
    let payload_bytes = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if payload_bytes.len() > RGROUP_INPUT_LIMIT_BYTES {
        return Err(format!(
            "R-group input is too large: {} bytes, limit is {RGROUP_INPUT_LIMIT_BYTES} bytes",
            payload_bytes.len()
        ));
    }
    let python_path = resolve_python_executable()?;
    let result = run_python_script(&python_path, RGROUP_RUNNER, payload, RGROUP_RUN_TIMEOUT)?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("R-group decomposition failed")
            .to_string());
    }
    // Labels ride into derived column ids, which the store validates as
    // alphanumeric; rejecting a strange label here keeps the failure at the
    // command boundary instead of halfway through a run.
    if let Some(labels) = result.get("labels").and_then(Value::as_array) {
        for label in labels {
            let label = label.as_str().unwrap_or_default();
            if label.is_empty()
                || label.len() > RGROUP_LABEL_LIMIT
                || !label.bytes().all(|byte| byte.is_ascii_alphanumeric())
            {
                return Err(format!(
                    "R-group decomposition returned an unusable label: {label:?}"
                ));
            }
        }
    }
    Ok(result)
}
