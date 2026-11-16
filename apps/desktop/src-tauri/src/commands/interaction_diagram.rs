use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::descriptors::{resolve_python_executable, run_python_script_with_env};
use crate::preview::xyzrender::xyzrender_runtime_python;

// The 2D ligand interaction diagram is computed in Python: gemmi reads the
// structure, RDKit does the chemistry and SciPy lays the residues out. The
// xyzrender runtime bundled with the app carries all three.
const RUNNER: &str = include_str!("interaction_diagram_runner.py");
const RUN_TIMEOUT: Duration = Duration::from_secs(120);
const STRUCTURE_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
const RULES_LIMIT_BYTES: usize = 1024;
// A diagram takes seconds; the card and the panel ask for the same ones while
// the user flips between ligands and designs.
const CACHED_DIAGRAMS: usize = 16;

static DIAGRAMS: Mutex<VecDeque<(String, Value)>> = Mutex::new(VecDeque::new());

/// Structure formats the engine reads: PDB and mmCIF. The desktop shell keeps
/// the same list in `apps/desktop/src/lib/interaction-diagram.ts`.
pub(crate) fn maps_interactions(extension: &str) -> bool {
    matches!(extension, "pdb" | "ent" | "cif" | "mmcif")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InteractionDiagramRequest {
    path: String,
    ligand: Option<String>,
    // A design's layout rules; the engine checks each one.
    #[serde(default)]
    rules: Map<String, Value>,
}

#[tauri::command]
pub(crate) async fn interaction_diagram(
    app: AppHandle,
    request: InteractionDiagramRequest,
) -> Result<Value, String> {
    let components = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("chemical-components");
    tauri::async_runtime::spawn_blocking(move || diagram(request, &components))
        .await
        .map_err(|error| error.to_string())?
}

fn diagram(request: InteractionDiagramRequest, components: &Path) -> Result<Value, String> {
    let path = PathBuf::from(&request.path);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !maps_interactions(&extension) {
        return Err("Interaction maps need a PDB or mmCIF structure".into());
    }
    let metadata = fs::metadata(&path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .ok_or("The structure file could not be read")?;
    if metadata.len() > STRUCTURE_LIMIT_BYTES {
        return Err("The structure is too large for an interaction map".into());
    }
    let rules = Value::Object(request.rules);
    if rules.to_string().len() > RULES_LIMIT_BYTES {
        return Err("Invalid diagram rules".into());
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    let key = format!(
        "{}\n{modified}\n{}\n{:?}\n{rules}",
        path.display(),
        metadata.len(),
        request.ligand
    );
    if let Some(cached) = cached_diagram(&key) {
        return Ok(cached);
    }
    let payload = json!({
        "path": path,
        "ccdCache": components,
        "ligand": request.ligand,
        "rules": rules,
    });
    let result = run_engine(payload)?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("The interaction map could not be drawn")
            .to_string());
    }
    remember_diagram(key, result.clone());
    Ok(result)
}

fn run_engine(payload: Value) -> Result<Value, String> {
    let (python, mut envs) = match xyzrender_runtime_python() {
        Some(runtime) => runtime,
        None => (resolve_python_executable()?, Vec::new()),
    };
    // One layout is a serial minimisation; BLAS threads on every core only
    // contend with each other and with the app.
    for name in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"] {
        envs.push((name, "1".into()));
    }
    run_python_script_with_env(&python, &envs, RUNNER, payload, RUN_TIMEOUT).map_err(|error| {
        if error.contains("ModuleNotFoundError") {
            "Interaction maps need the Python runtime that comes with Burette".into()
        } else {
            error
        }
    })
}

fn cached_diagram(key: &str) -> Option<Value> {
    let diagrams = DIAGRAMS.lock().ok()?;
    diagrams
        .iter()
        .find(|(cached, _)| cached == key)
        .map(|(_, value)| value.clone())
}

fn remember_diagram(key: String, value: Value) {
    let Ok(mut diagrams) = DIAGRAMS.lock() else {
        return;
    };
    diagrams.retain(|(cached, _)| *cached != key);
    if diagrams.len() >= CACHED_DIAGRAMS {
        diagrams.pop_front();
    }
    diagrams.push_back((key, value));
}
