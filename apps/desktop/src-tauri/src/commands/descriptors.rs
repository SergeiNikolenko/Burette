use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Runtime, State};

use crate::preview::grid_store::{
    descriptor_source_row_batch, descriptor_source_rows_by_indices,
    replace_descriptor_values_in_database, GridDescriptorRunSummary, GridDescriptorSourceRow,
    GridDescriptorValueInput, GridRuntimeRegistry,
};

const DESCRIPTOR_INPUT_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const DESCRIPTOR_GRID_BATCH_INPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const DESCRIPTOR_RUN_TIMEOUT: Duration = Duration::from_secs(30);
const DESCRIPTOR_GRID_BATCH_SIZE: usize = 16;
const DESCRIPTOR_GRID_BATCH_TIMEOUT: Duration = Duration::from_secs(300);
const DESCRIPTOR_STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const DESCRIPTOR_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

const DESCRIPTOR_RUNNER: &str = r#"
import io
import json
import math
import sys
import traceback


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def import_engine():
    try:
        from rdkit import Chem
        import rdkit
        import mordred
        from mordred import Calculator, descriptors
        return {
            "ok": True,
            "Chem": Chem,
            "rdkit_version": getattr(rdkit, "__version__", None),
            "mordred_version": getattr(mordred, "__version__", None),
            "Calculator": Calculator,
            "descriptors": descriptors,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def molecule_from_payload(Chem, payload):
    fmt = (payload.get("format") or "").lower()
    text = payload.get("text") or ""
    if fmt in ("molfile", "mol"):
        return Chem.MolFromMolBlock(text, sanitize=True, removeHs=False), None
    if fmt in ("sdf", "sd"):
        supplier = Chem.ForwardSDMolSupplier(io.BytesIO(text.encode("utf-8")), sanitize=True, removeHs=False)
        for mol in supplier:
            if mol is not None:
                return mol, None
        return None, "SDF did not contain a readable molecule"
    if fmt in ("smiles", "smi"):
        first = text.strip().splitlines()[0].strip() if text.strip() else ""
        smiles = first.split()[0] if first else ""
        return Chem.MolFromSmiles(smiles), None
    return None, f"Unsupported descriptor payload format: {fmt or 'unknown'}"


PREFERRED_LABELS = {
    "MW": "Molecular weight",
    "AMW": "Average molecular weight",
    "nAtom": "Atoms",
    "nHeavyAtom": "Heavy atoms",
    "nHetero": "Hetero atoms",
    "nBonds": "Bonds",
    "nBondsO": "Order-sensitive bonds",
    "nBondsS": "Single bonds",
    "nRot": "Rotatable bonds",
    "nRing": "Rings",
    "nAromAtom": "Aromatic atoms",
    "nAromBond": "Aromatic bonds",
    "TopoPSA": "Topological polar surface area",
    "SLogP": "SLogP",
}


def normalize_value(value):
    module = type(value).__module__
    if module.startswith("mordred.error"):
        return {
            "value": None,
            "missingKind": type(value).__name__,
            "errorText": str(value),
        }
    if value is None:
        return {"value": None, "missingKind": "missing", "errorText": None}
    if isinstance(value, bool):
        return {"value": value, "missingKind": None, "errorText": None}
    if isinstance(value, int):
        return {"value": value, "missingKind": None, "errorText": None}
    if isinstance(value, float):
        if math.isfinite(value):
            return {"value": value, "missingKind": None, "errorText": None}
        return {"value": None, "missingKind": "nonFinite", "errorText": str(value)}
    try:
        numeric = float(value)
        if math.isfinite(numeric):
            return {"value": numeric, "missingKind": None, "errorText": None}
    except Exception:
        pass
    return {"value": str(value), "missingKind": None, "errorText": None}


def descriptor_values(calc, mol):
    result = calc(mol).asdict()
    values = []
    for descriptor in calc.descriptors:
        key = str(descriptor)
        if key not in result:
            continue
        normalized = normalize_value(result[key])
        values.append({
            "id": key,
            "label": PREFERRED_LABELS.get(key, key),
            "value": normalized["value"],
            "missingKind": normalized["missingKind"],
            "errorText": normalized["errorText"],
        })
    return values


def calculate_payload(payload, engine, calc):
    mol, error = molecule_from_payload(engine["Chem"], payload)
    if mol is None:
        return {"ok": False, "error": error or "Descriptor payload did not produce a molecule"}
    return {
        "ok": True,
        "descriptorSet": payload.get("descriptorSet") or "all-2d",
        "molecule": {
            "atomCount": int(mol.GetNumAtoms()),
            "bondCount": int(mol.GetNumBonds()),
        },
        "engine": {
            "mordredVersion": engine["mordred_version"],
            "rdkitVersion": engine["rdkit_version"],
        },
        "values": descriptor_values(calc, mol),
    }


def calculate(payload, engine):
    calc = engine["Calculator"](engine["descriptors"], ignore_3D=True)
    emit(calculate_payload(payload, engine, calc))


def calculate_grid_batch(payload, engine):
    calc = engine["Calculator"](engine["descriptors"], ignore_3D=True)
    results = []
    for row in payload.get("rows") or []:
        row_payload = {
            "format": row.get("format"),
            "text": row.get("text"),
            "label": row.get("sourceLabel"),
            "descriptorSet": payload.get("descriptorSet") or "all-2d",
        }
        result = calculate_payload(row_payload, engine, calc)
        result["rowId"] = row.get("rowId")
        results.append(result)
    emit({
        "ok": True,
        "descriptorSet": payload.get("descriptorSet") or "all-2d",
        "rows": results,
    })


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    engine = import_engine()
    if payload.get("mode") == "status":
        if not engine["ok"]:
            emit({"ok": False, "error": engine["error"]})
            return
        emit({
            "ok": True,
            "mordredVersion": engine["mordred_version"],
            "rdkitVersion": engine["rdkit_version"],
        })
        return
    if not engine["ok"]:
        emit({"ok": False, "error": engine["error"]})
        return
    if payload.get("mode") == "gridBatch":
        calculate_grid_batch(payload, engine)
        return
    calculate(payload, engine)


try:
    main()
except Exception as exc:
    emit({"ok": False, "error": str(exc), "traceback": traceback.format_exc(limit=8)})
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorSourcePayload {
    format: String,
    text: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorCalculateRequest {
    source_kind: String,
    source_label: String,
    descriptor_set: Option<String>,
    source_payload: DescriptorSourcePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorGridRunRequest {
    document_id: String,
    row_indexes: Option<Vec<usize>>,
}

#[derive(Default)]
pub(crate) struct DescriptorGridJobRegistry {
    jobs: Mutex<HashMap<String, Arc<DescriptorGridJob>>>,
}

struct DescriptorGridJob {
    cancel: Arc<AtomicBool>,
    state: Mutex<DescriptorGridJobState>,
}

#[derive(Debug, Clone)]
struct DescriptorGridJobState {
    status: DescriptorGridJobStateKind,
    total_rows: usize,
    processed_rows: usize,
    calculated_rows: usize,
    failed_rows: usize,
    message: String,
    started_at_ms: u64,
    finished_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DescriptorGridJobStateKind {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorGridJobStatus {
    document_id: String,
    status: String,
    running: bool,
    total_rows: usize,
    processed_rows: usize,
    calculated_rows: usize,
    failed_rows: usize,
    message: String,
    started_at_ms: u64,
    finished_at_ms: Option<u64>,
    summary: Option<GridDescriptorRunSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorRuntimeStatus {
    available: bool,
    python_path: Option<String>,
    mordred_version: Option<String>,
    rdkit_version: Option<String>,
    message: String,
    install_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DescriptorRuntimeInstallResult {
    python_path: String,
    message: String,
}

impl DescriptorGridJobRegistry {
    fn start(
        &self,
        document_id: String,
        database_path: PathBuf,
        total_rows: usize,
        python_path: PathBuf,
        row_indexes: Option<Vec<usize>>,
    ) -> Result<Arc<DescriptorGridJob>, String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "descriptor job registry is poisoned")?;
        if let Some(job) = jobs.get(&document_id).filter(|job| job.is_running()) {
            return Ok(Arc::clone(job));
        }
        let job = Arc::new(DescriptorGridJob {
            cancel: Arc::new(AtomicBool::new(false)),
            state: Mutex::new(DescriptorGridJobState {
                status: DescriptorGridJobStateKind::Running,
                total_rows,
                processed_rows: 0,
                calculated_rows: 0,
                failed_rows: 0,
                message: "Descriptor calculation is running".into(),
                started_at_ms: current_time_millis(),
                finished_at_ms: None,
            }),
        });
        jobs.insert(document_id.clone(), Arc::clone(&job));
        let worker_job = Arc::clone(&job);
        thread::spawn(move || {
            run_descriptor_grid_job(worker_job, database_path, python_path, row_indexes);
        });
        Ok(job)
    }

    fn get(&self, document_id: &str) -> Result<Option<Arc<DescriptorGridJob>>, String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "descriptor job registry is poisoned")?;
        Ok(jobs.get(document_id).map(Arc::clone))
    }
}

impl DescriptorGridJob {
    fn is_running(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.status == DescriptorGridJobStateKind::Running)
            .unwrap_or(false)
    }

    fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.update(|state| {
            if state.status == DescriptorGridJobStateKind::Running {
                state.message = "Descriptor calculation is cancelling".into();
            }
        });
    }

    fn update(&self, apply: impl FnOnce(&mut DescriptorGridJobState)) {
        if let Ok(mut state) = self.state.lock() {
            apply(&mut state);
        }
    }

    fn snapshot(
        &self,
        document_id: String,
        summary: Option<GridDescriptorRunSummary>,
    ) -> DescriptorGridJobStatus {
        match self.state.lock() {
            Ok(state) => DescriptorGridJobStatus::from_state(document_id, &state, summary),
            Err(_) => DescriptorGridJobStatus {
                document_id,
                status: "failed".into(),
                running: false,
                total_rows: 0,
                processed_rows: 0,
                calculated_rows: 0,
                failed_rows: 0,
                message: "Descriptor job state is unavailable".into(),
                started_at_ms: current_time_millis(),
                finished_at_ms: Some(current_time_millis()),
                summary,
            },
        }
    }
}

impl DescriptorGridJobStatus {
    fn idle(document_id: String, summary: Option<GridDescriptorRunSummary>) -> Self {
        let total_rows = summary
            .as_ref()
            .map(|summary| summary.total_rows)
            .unwrap_or(0);
        let calculated_rows = summary
            .as_ref()
            .map(|summary| summary.calculated_rows)
            .unwrap_or(0);
        let failed_rows = summary
            .as_ref()
            .map(|summary| summary.failed_rows)
            .unwrap_or(0);
        Self {
            document_id,
            status: "idle".into(),
            running: false,
            total_rows,
            processed_rows: calculated_rows,
            calculated_rows,
            failed_rows,
            message: "No descriptor calculation is running".into(),
            started_at_ms: 0,
            finished_at_ms: None,
            summary,
        }
    }

    fn from_state(
        document_id: String,
        state: &DescriptorGridJobState,
        summary: Option<GridDescriptorRunSummary>,
    ) -> Self {
        Self {
            document_id,
            status: state.status.as_str().into(),
            running: state.status == DescriptorGridJobStateKind::Running,
            total_rows: state.total_rows,
            processed_rows: state.processed_rows,
            calculated_rows: state.calculated_rows,
            failed_rows: state.failed_rows,
            message: state.message.clone(),
            started_at_ms: state.started_at_ms,
            finished_at_ms: state.finished_at_ms,
            summary,
        }
    }
}

impl DescriptorGridJobStateKind {
    fn as_str(self) -> &'static str {
        match self {
            DescriptorGridJobStateKind::Running => "running",
            DescriptorGridJobStateKind::Completed => "completed",
            DescriptorGridJobStateKind::Cancelled => "cancelled",
            DescriptorGridJobStateKind::Failed => "failed",
        }
    }
}

#[tauri::command]
pub(crate) fn descriptor_runtime_status() -> DescriptorRuntimeStatus {
    match resolve_python_executable() {
        Ok(python_path) => match run_descriptor_runner(
            &python_path,
            json!({ "mode": "status" }),
            DESCRIPTOR_STATUS_TIMEOUT,
        ) {
            Ok(payload) if payload.get("ok").and_then(Value::as_bool) == Some(true) => {
                DescriptorRuntimeStatus {
                    available: true,
                    python_path: Some(python_path.to_string_lossy().to_string()),
                    mordred_version: payload
                        .get("mordredVersion")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    rdkit_version: payload
                        .get("rdkitVersion")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    message: "Descriptor runtime is available".into(),
                    install_hint: descriptor_install_hint(),
                }
            }
            Ok(payload) => DescriptorRuntimeStatus {
                available: false,
                python_path: Some(python_path.to_string_lossy().to_string()),
                mordred_version: None,
                rdkit_version: None,
                message: payload
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Descriptor runtime could not import RDKit or Mordred")
                    .to_string(),
                install_hint: descriptor_install_hint(),
            },
            Err(error) => DescriptorRuntimeStatus {
                available: false,
                python_path: Some(python_path.to_string_lossy().to_string()),
                mordred_version: None,
                rdkit_version: None,
                message: error,
                install_hint: descriptor_install_hint(),
            },
        },
        Err(error) => DescriptorRuntimeStatus {
            available: false,
            python_path: None,
            mordred_version: None,
            rdkit_version: None,
            message: error,
            install_hint: descriptor_install_hint(),
        },
    }
}

#[tauri::command]
pub(crate) fn descriptor_runtime_install() -> Result<DescriptorRuntimeInstallResult, String> {
    let uv_path = resolve_uv_executable()?;
    let runtime_dir = descriptor_runtime_dir()?;
    fs::create_dir_all(&runtime_dir).map_err(|err| {
        format!(
            "Failed to create descriptor runtime directory {}: {err}",
            runtime_dir.display()
        )
    })?;
    let python_path = runtime_dir.join("bin").join("python3");
    if python_path.is_file() {
        if let Ok(payload) = run_descriptor_runner(
            &python_path,
            json!({ "mode": "status" }),
            DESCRIPTOR_STATUS_TIMEOUT,
        ) {
            if payload.get("ok").and_then(Value::as_bool) == Some(true) {
                return Ok(DescriptorRuntimeInstallResult {
                    python_path: python_path.to_string_lossy().to_string(),
                    message:
                        "Descriptor runtime is already installed with RDKit and mordredcommunity"
                            .into(),
                });
            }
        }
    } else {
        let runtime_dir_arg = runtime_dir.to_string_lossy().to_string();
        run_external_command(
            &uv_path,
            &["venv", runtime_dir_arg.as_str()],
            DESCRIPTOR_INSTALL_TIMEOUT,
        )?;
    }
    if !python_path.is_file() {
        return Err(format!(
            "uv created a descriptor runtime without {}",
            python_path.display()
        ));
    }
    let python_arg = python_path.to_string_lossy().to_string();
    run_external_command(
        &uv_path,
        &[
            "pip",
            "install",
            "--python",
            python_arg.as_str(),
            "rdkit",
            "mordredcommunity",
        ],
        DESCRIPTOR_INSTALL_TIMEOUT,
    )?;
    Ok(DescriptorRuntimeInstallResult {
        python_path: python_path.to_string_lossy().to_string(),
        message: "Descriptor runtime installed with RDKit and mordredcommunity".into(),
    })
}

#[tauri::command]
pub(crate) fn descriptor_calculate(request: DescriptorCalculateRequest) -> Result<Value, String> {
    let text_len = request.source_payload.text.len();
    if text_len == 0 {
        return Err("Descriptor source is empty".into());
    }
    if text_len > DESCRIPTOR_INPUT_LIMIT_BYTES {
        return Err(format!(
            "Descriptor source is too large: {} bytes, limit is {} bytes",
            text_len, DESCRIPTOR_INPUT_LIMIT_BYTES
        ));
    }
    let python_path = resolve_python_executable()?;
    let payload = json!({
        "mode": "calculate",
        "sourceKind": request.source_kind,
        "sourceLabel": request.source_label,
        "format": request.source_payload.format,
        "text": request.source_payload.text,
        "label": request.source_payload.label,
        "descriptorSet": request.descriptor_set.unwrap_or_else(|| "all-2d".to_string()),
    });
    let result = run_descriptor_runner(&python_path, payload, DESCRIPTOR_RUN_TIMEOUT)?;
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(result)
    } else {
        Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Descriptor calculation failed")
            .to_string())
    }
}

#[tauri::command]
pub(crate) fn descriptor_calculate_grid<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    jobs: State<'_, DescriptorGridJobRegistry>,
    request: DescriptorGridRunRequest,
) -> Result<DescriptorGridJobStatus, String> {
    descriptor_start_grid(window, registry, jobs, request)
}

#[tauri::command]
pub(crate) fn descriptor_start_grid<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    jobs: State<'_, DescriptorGridJobRegistry>,
    request: DescriptorGridRunRequest,
) -> Result<DescriptorGridJobStatus, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let python_path = resolve_python_executable()?;
    let row_indexes = normalize_row_indexes(request.row_indexes);
    let total_rows = if row_indexes.is_empty() {
        registry.descriptor_source_row_count(&document_id)?
    } else {
        row_indexes.len()
    };
    let database_path = registry.descriptor_database_path(&document_id)?;
    let job = jobs.start(
        document_id.clone(),
        database_path,
        total_rows,
        python_path,
        if row_indexes.is_empty() {
            None
        } else {
            Some(row_indexes)
        },
    )?;
    let summary = registry.descriptor_run_summary(&document_id).ok();
    Ok(job.snapshot(document_id, summary))
}

#[tauri::command]
pub(crate) fn descriptor_grid_summary<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    document_id: String,
) -> Result<GridDescriptorRunSummary, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &document_id);
    registry.descriptor_run_summary(&document_id)
}

#[tauri::command]
pub(crate) fn descriptor_grid_job_status<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    jobs: State<'_, DescriptorGridJobRegistry>,
    document_id: String,
) -> Result<DescriptorGridJobStatus, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &document_id);
    let summary = registry.descriptor_run_summary(&document_id).ok();
    match jobs.get(&document_id)? {
        Some(job) => Ok(job.snapshot(document_id, summary)),
        None => Ok(DescriptorGridJobStatus::idle(document_id, summary)),
    }
}

#[tauri::command]
pub(crate) fn descriptor_cancel_grid<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    jobs: State<'_, DescriptorGridJobRegistry>,
    request: DescriptorGridRunRequest,
) -> Result<DescriptorGridJobStatus, String> {
    let document_id = crate::windows::runtime_document_id(window.label(), &request.document_id);
    let summary = registry.descriptor_run_summary(&document_id).ok();
    match jobs.get(&document_id)? {
        Some(job) => {
            job.cancel();
            Ok(job.snapshot(document_id, summary))
        }
        None => Ok(DescriptorGridJobStatus::idle(document_id, summary)),
    }
}

fn run_descriptor_grid_job(
    job: Arc<DescriptorGridJob>,
    database_path: PathBuf,
    python_path: PathBuf,
    row_indexes: Option<Vec<usize>>,
) {
    let total_rows = job.state.lock().map(|state| state.total_rows).unwrap_or(0);
    if total_rows == 0 {
        job.update(|state| {
            state.status = DescriptorGridJobStateKind::Completed;
            state.message = "Descriptor calculation completed".into();
            state.finished_at_ms = Some(current_time_millis());
        });
        return;
    }
    if let Some(indexes) = row_indexes {
        for chunk in indexes.chunks(DESCRIPTOR_GRID_BATCH_SIZE) {
            if job.cancel.load(Ordering::Relaxed) {
                job.update(|state| {
                    state.status = DescriptorGridJobStateKind::Cancelled;
                    state.message = "Descriptor calculation cancelled".into();
                    state.finished_at_ms = Some(current_time_millis());
                });
                return;
            }
            let batch = match descriptor_source_rows_by_indices(&database_path, chunk) {
                Ok(batch) => batch,
                Err(error) => {
                    job.update(|state| {
                        if state.status == DescriptorGridJobStateKind::Running {
                            state.status = DescriptorGridJobStateKind::Failed;
                            state.message = error;
                            state.finished_at_ms = Some(current_time_millis());
                        }
                    });
                    return;
                }
            };
            if batch.is_empty() {
                continue;
            }
            if let Err(error) =
                run_descriptor_grid_batch(&job, &database_path, &batch, &python_path)
            {
                job.update(|state| {
                    if state.status == DescriptorGridJobStateKind::Running {
                        state.status = DescriptorGridJobStateKind::Failed;
                        state.message = error;
                        state.finished_at_ms = Some(current_time_millis());
                    }
                });
                return;
            }
        }
        job.update(|state| {
            state.status = DescriptorGridJobStateKind::Completed;
            state.message = "Descriptor calculation completed".into();
            state.finished_at_ms = Some(current_time_millis());
        });
        return;
    }
    let mut offset = 0usize;
    while offset < total_rows {
        if job.cancel.load(Ordering::Relaxed) {
            job.update(|state| {
                state.status = DescriptorGridJobStateKind::Cancelled;
                state.message = "Descriptor calculation cancelled".into();
                state.finished_at_ms = Some(current_time_millis());
            });
            return;
        }
        let batch =
            match descriptor_source_row_batch(&database_path, offset, DESCRIPTOR_GRID_BATCH_SIZE) {
                Ok(batch) => batch,
                Err(error) => {
                    job.update(|state| {
                        if state.status == DescriptorGridJobStateKind::Running {
                            state.status = DescriptorGridJobStateKind::Failed;
                            state.message = error;
                            state.finished_at_ms = Some(current_time_millis());
                        }
                    });
                    return;
                }
            };
        if batch.is_empty() {
            break;
        }
        if let Err(error) = run_descriptor_grid_batch(&job, &database_path, &batch, &python_path) {
            job.update(|state| {
                if state.status == DescriptorGridJobStateKind::Running {
                    state.status = DescriptorGridJobStateKind::Failed;
                    state.message = error;
                    state.finished_at_ms = Some(current_time_millis());
                }
            });
            return;
        }
        offset += batch.len();
    }
    job.update(|state| {
        state.status = DescriptorGridJobStateKind::Completed;
        state.message = "Descriptor calculation completed".into();
        state.finished_at_ms = Some(current_time_millis());
    });
}

fn normalize_row_indexes(row_indexes: Option<Vec<usize>>) -> Vec<usize> {
    let mut indexes = row_indexes.unwrap_or_default();
    indexes.sort_unstable();
    indexes.dedup();
    indexes
}

fn run_descriptor_grid_batch(
    job: &Arc<DescriptorGridJob>,
    database_path: &Path,
    rows: &[GridDescriptorSourceRow],
    python_path: &Path,
) -> Result<(), String> {
    let payload_rows = descriptor_grid_batch_rows(rows);
    let payload = json!({
        "mode": "gridBatch",
        "descriptorSet": "all-2d",
        "rows": payload_rows,
    });
    let payload_len = serde_json::to_vec(&payload)
        .map_err(|err| err.to_string())?
        .len();
    if payload_len > DESCRIPTOR_GRID_BATCH_INPUT_LIMIT_BYTES {
        if rows.len() > 1 {
            let midpoint = rows.len() / 2;
            run_descriptor_grid_batch(job, database_path, &rows[..midpoint], python_path)?;
            run_descriptor_grid_batch(job, database_path, &rows[midpoint..], python_path)?;
            return Ok(());
        }
        let row = rows
            .first()
            .ok_or("Descriptor grid batch had no rows after payload size check")?;
        return store_descriptor_grid_values(
            job,
            database_path,
            row.row_id,
            vec![descriptor_error_value(&format!(
                "Descriptor source is too large: {payload_len} bytes, batch limit is {DESCRIPTOR_GRID_BATCH_INPUT_LIMIT_BYTES} bytes"
            ))],
        );
    }
    let result = run_descriptor_runner(python_path, payload, DESCRIPTOR_GRID_BATCH_TIMEOUT)?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Descriptor grid batch failed")
            .to_string());
    }
    let result_rows = result
        .get("rows")
        .and_then(Value::as_array)
        .ok_or("Descriptor grid batch returned no rows")?;
    if result_rows.len() != rows.len() {
        return Err(format!(
            "Descriptor grid batch returned {} rows for {} inputs",
            result_rows.len(),
            rows.len()
        ));
    }
    for result in result_rows {
        if job.cancel.load(Ordering::Relaxed) {
            job.update(|state| {
                state.status = DescriptorGridJobStateKind::Cancelled;
                state.message = "Descriptor calculation cancelled".into();
                state.finished_at_ms = Some(current_time_millis());
            });
            return Ok(());
        }
        let row_id = result
            .get("rowId")
            .and_then(Value::as_i64)
            .ok_or("Descriptor runtime returned a row without rowId")?;
        let values = if result.get("ok").and_then(Value::as_bool) == Some(true) {
            grid_descriptor_values_from_result(result)
        } else {
            vec![descriptor_error_value(
                result
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Descriptor calculation failed"),
            )]
        };
        store_descriptor_grid_values(job, database_path, row_id, values)?;
    }
    Ok(())
}

fn store_descriptor_grid_values(
    job: &Arc<DescriptorGridJob>,
    database_path: &Path,
    row_id: i64,
    values: Vec<GridDescriptorValueInput>,
) -> Result<(), String> {
    let failed = descriptor_row_failed(&values);
    replace_descriptor_values_in_database(database_path, row_id, &values)
        .map_err(|error| format!("Descriptor storage failed: {error}"))?;
    job.update(|state| {
        state.processed_rows += 1;
        if failed {
            state.failed_rows += 1;
        } else {
            state.calculated_rows += 1;
        }
        state.message = format!(
            "Calculated descriptors for {} of {} rows",
            state.processed_rows, state.total_rows
        );
    });
    Ok(())
}

fn descriptor_row_failed(values: &[GridDescriptorValueInput]) -> bool {
    values
        .iter()
        .any(|value| value.id == "error" && value.error_text.is_some())
}

fn descriptor_grid_batch_rows(rows: &[GridDescriptorSourceRow]) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let (format, text) =
                descriptor_source_for_grid_row(row).unwrap_or_else(|| ("missing", String::new()));
            json!({
                "rowId": row.row_id,
                "sourceLabel": row.name,
                "format": format,
                "text": text,
            })
        })
        .collect()
}

fn descriptor_source_for_grid_row(row: &GridDescriptorSourceRow) -> Option<(&'static str, String)> {
    if let Some(molblock) = row
        .molblock
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(("molfile", molblock.clone()));
    } else if let Some(smiles) = row.smiles.as_ref().filter(|value| !value.trim().is_empty()) {
        return Some(("smiles", smiles.clone()));
    }
    None
}

fn descriptor_error_value(error: &str) -> GridDescriptorValueInput {
    GridDescriptorValueInput {
        id: "error".into(),
        label: "Descriptor error".into(),
        value: None,
        missing_kind: None,
        error_text: Some(error.to_string()),
    }
}

fn grid_descriptor_values_from_result(result: &Value) -> Vec<GridDescriptorValueInput> {
    result
        .get("values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            let id = value.get("id").and_then(Value::as_str)?.to_string();
            Some(GridDescriptorValueInput {
                id,
                label: value
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("Descriptor")
                    .to_string(),
                value: value.get("value").cloned().filter(|value| !value.is_null()),
                missing_kind: value
                    .get("missingKind")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                error_text: value
                    .get("errorText")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

fn run_descriptor_runner(
    python_path: &Path,
    payload: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let input = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
    let mut child = Command::new(python_path)
        .arg("-c")
        .arg(DESCRIPTOR_RUNNER)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONNOUSERSITE", "1")
        .spawn()
        .map_err(|err| format!("Failed to launch descriptor runtime: {err}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&input)
            .map_err(|err| format!("Failed to send descriptor input: {err}"))?;
    }
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|err| err.to_string())?.is_some() {
            let output = child.wait_with_output().map_err(|err| err.to_string())?;
            if !output.status.success() {
                return Err(format!(
                    "Descriptor runtime exited with status {}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            return parse_descriptor_runner_output(&stdout);
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Descriptor runtime timed out after {} seconds",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn parse_descriptor_runner_output(stdout: &str) -> Result<Value, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("Descriptor runtime returned no JSON output".into());
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }
    for line in trimmed
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            return Ok(value);
        }
    }
    Err(format!(
        "Descriptor runtime returned invalid JSON. Output: {}",
        trimmed
    ))
}

fn run_external_command(path: &Path, args: &[&str], timeout: Duration) -> Result<(), String> {
    let mut child = Command::new(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to launch {}: {err}", path.display()))?;
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|err| err.to_string())?.is_some() {
            let output = child.wait_with_output().map_err(|err| err.to_string())?;
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "{} failed with status {}: {}{}{}",
                path.display(),
                output.status,
                stderr.trim(),
                if stderr.trim().is_empty() || stdout.trim().is_empty() {
                    ""
                } else {
                    "\n"
                },
                stdout.trim()
            ));
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{} timed out after {} seconds",
                path.display(),
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn resolve_python_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("BURRETE_DESCRIPTOR_PYTHON") {
        candidates.push(PathBuf::from(path));
    }
    candidates.extend(descriptor_runtime_python_candidates());
    if let Ok(executable) = env::current_exe() {
        candidates.extend(bundled_descriptor_python_candidates(&executable));
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            candidates.push(dir.join("python3"));
            candidates.push(dir.join("python"));
        }
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/python3"),
        PathBuf::from("/usr/local/bin/python3"),
        PathBuf::from("/usr/bin/python3"),
    ]);
    for path in candidates {
        if path.is_file() && is_executable(&path) {
            return Ok(path);
        }
    }
    Err("Python 3 was not found for descriptor calculation".into())
}

fn descriptor_runtime_python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(runtime_dir) = descriptor_runtime_dir() {
        candidates.push(runtime_dir.join("bin").join("python3"));
        candidates.push(runtime_dir.join("Scripts").join("python.exe"));
    }
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(
            home.join(".local")
                .join("share")
                .join("burrete")
                .join("descriptor-python")
                .join("bin")
                .join("python3"),
        );
    }
    candidates
}

fn descriptor_runtime_dir() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("BURRETE_DESCRIPTOR_RUNTIME_DIR") {
        return Ok(PathBuf::from(path));
    }
    let home = env::var_os("HOME").ok_or("HOME is not set for descriptor runtime install")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Burrete")
        .join("descriptor-python"))
}

fn resolve_uv_executable() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("BURRETE_UV") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            candidates.push(dir.join("uv"));
        }
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/uv"),
        PathBuf::from("/usr/local/bin/uv"),
    ]);
    for path in candidates {
        if path.is_file() && is_executable(&path) {
            return Ok(path);
        }
    }
    Err("uv was not found. Install uv or set BURRETE_UV to the uv executable.".into())
}

fn bundled_descriptor_python_candidates(executable: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for ancestor in executable.ancestors() {
        candidates.push(
            ancestor
                .join("Resources")
                .join("descriptor-python")
                .join("bin")
                .join("python3"),
        );
        candidates.push(
            ancestor
                .join("Contents")
                .join("Resources")
                .join("descriptor-python")
                .join("bin")
                .join("python3"),
        );
    }
    candidates
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

fn descriptor_install_hint() -> String {
    "Install a uv-managed descriptor runtime from the Descriptors panel, or set BURRETE_DESCRIPTOR_PYTHON to a Python interpreter with RDKit and mordredcommunity.".into()
}

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_descriptor_runner_json_with_warning_prefix() {
        let value = parse_descriptor_runner_output("warning: noisy import\n{\"ok\":true}\n")
            .expect("parse last json line");
        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn rejects_descriptor_runner_output_without_json() {
        let error = parse_descriptor_runner_output("warning only\nanother line")
            .expect_err("invalid output should fail");
        assert!(error.contains("invalid JSON"));
    }

    #[test]
    fn descriptor_row_failure_uses_row_error_sentinel_only() {
        let mordred_missing_value = GridDescriptorValueInput {
            id: "ABC".into(),
            label: "ABC".into(),
            value: None,
            missing_kind: Some("Missing".into()),
            error_text: Some("descriptor is not available".into()),
        };
        assert!(!descriptor_row_failed(&[mordred_missing_value]));

        let row_error = descriptor_error_value("SMILES did not parse");
        assert!(descriptor_row_failed(&[row_error]));
    }
}
