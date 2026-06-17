use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

const CONFORMER_LOG_CAPTURE_BYTES: usize = 512 * 1024;
const CONFORMER_RUN_METADATA_FILE: &str = ".burrete-conformer-run.json";
const DIRECT_CONFORMER_ATOM_LIMIT: usize = 300;

type RunningConformerJobs = Mutex<HashMap<String, Arc<Mutex<Child>>>>;
static RUNNING_CONFORMER_JOBS: OnceLock<RunningConformerJobs> = OnceLock::new();
static CANCELLED_CONFORMER_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerToolStatus {
    installed: bool,
    executable: Option<String>,
    version: Option<String>,
    install_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerStatus {
    crest: ConformerToolStatus,
    prism: ConformerToolStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerRunRequest {
    operation: String,
    job_id: Option<String>,
    path: String,
    title: String,
    extension: String,
    input_data_base64: Option<String>,
    output_directory: Option<String>,
    work_dir: Option<String>,
    method: Option<String>,
    solvent: Option<String>,
    charge: Option<i32>,
    uhf: Option<i32>,
    threads: Option<u32>,
    timeout_seconds: Option<u64>,
    energy_window_kcal_mol: Option<f64>,
    rmsd_threshold_angstrom: Option<f64>,
    sampling_mode: Option<String>,
    prism_energy_sort: Option<bool>,
    prism_rotamer_pruning: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerPreparedRun {
    operation: String,
    work_dir: String,
    log_path: String,
    report_path: String,
    output_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerArtifact {
    title: String,
    path: String,
    extension: String,
    byte_count: u64,
    kind: String,
    valid_ensemble: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerRunResult {
    ok: bool,
    operation: String,
    title: String,
    input_path: String,
    work_dir: String,
    log_path: String,
    report_path: String,
    exit_code: i32,
    error_summary: Option<String>,
    elapsed_ms: u128,
    command: Vec<String>,
    preparation: ConformerPreparation,
    recovery: Option<String>,
    artifacts: Vec<ConformerArtifact>,
    primary_open_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerPreparation {
    path: String,
    source: String,
}

struct PreparedInput {
    path: PathBuf,
    text: String,
    source: String,
}

struct CopiedInput {
    input_path: PathBuf,
    source_path: PathBuf,
    input_title: String,
    input_extension: String,
}

#[tauri::command]
pub(crate) fn conformer_status() -> ConformerStatus {
    ConformerStatus {
        crest: conformer_tool_status(
            resolve_executable("crest"),
            "CREST is available. Burrete will use this executable for conformer generation.",
            "Install CREST with pixi global install crest, conda-forge, or expose crest on PATH.",
            &["--version"],
        ),
        prism: conformer_tool_status(
            resolve_executable("prism_pruner").or_else(|| resolve_executable("prism-pruner")),
            "PRISM Pruner is available. Burrete will use this executable for ensemble pruning.",
            "Install PRISM Pruner with uv tool install prism_pruner, or expose prism_pruner on PATH.",
            &["--help"],
        ),
    }
}

#[tauri::command]
pub(crate) fn prepare_conformer_job<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ConformerRunRequest,
) -> Result<ConformerPreparedRun, String> {
    let operation = conformer_operation(&request);
    let output_root = conformer_output_root(&app, &request)?;
    let work_dir = create_numbered_conformer_run_dir(&output_root, &operation)?;
    let log_path = work_dir.join(format!("{operation}.log"));
    let report_path = work_dir.join(format!("{operation}-report.md"));
    write_conformer_run_metadata(&work_dir, &request, &operation, unix_timestamp_ms())?;
    fs::write(&log_path, "Waiting for job to start...\n")
        .map_err(|err| format!("{}: {err}", log_path.display()))?;
    fs::write(
        &report_path,
        "# Conformer Job\n\nStatus: waiting for job to start.\n",
    )
    .map_err(|err| format!("{}: {err}", report_path.display()))?;
    Ok(ConformerPreparedRun {
        operation,
        work_dir: work_dir.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
        report_path: report_path.to_string_lossy().to_string(),
        output_root: output_root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn run_conformer_job<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ConformerRunRequest,
) -> Result<ConformerRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_conformer_job_blocking(app, request))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_conformer_job(job_id: String) -> Result<(), String> {
    let job_id = job_id.trim().to_string();
    if job_id.is_empty() {
        return Ok(());
    }
    cancelled_conformer_jobs()
        .lock()
        .map_err(|_| "Conformer job cancellation registry is unavailable.".to_string())?
        .insert(job_id.clone());
    let child = {
        let jobs = running_conformer_jobs()
            .lock()
            .map_err(|_| "Conformer job registry is unavailable.".to_string())?;
        jobs.get(&job_id).cloned()
    };
    let Some(child) = child else {
        return Ok(());
    };
    let mut child = child
        .lock()
        .map_err(|_| "Conformer job process is unavailable.".to_string())?;
    match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => child
            .kill()
            .map_err(|err| format!("Could not cancel conformer job: {err}")),
        Err(err) => Err(format!("Could not inspect conformer job: {err}")),
    }
}

fn run_conformer_job_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ConformerRunRequest,
) -> Result<ConformerRunResult, String> {
    let started = Instant::now();
    let operation = conformer_operation(&request);
    let executable = conformer_executable(&operation)?;
    let output_root = conformer_output_root(&app, &request)?;
    let requested_work_dir = request
        .work_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    let work_dir = match requested_work_dir {
        Some(path) if is_path_at_or_under(&path, &output_root) => path,
        _ => create_numbered_conformer_run_dir(&output_root, &operation)?,
    };
    fs::create_dir_all(&work_dir).map_err(|err| format!("{}: {err}", work_dir.display()))?;
    write_conformer_run_metadata(&work_dir, &request, &operation, unix_timestamp_ms())?;

    let log_path = work_dir.join(format!("{operation}.log"));
    let report_path = work_dir.join(format!("{operation}-report.md"));
    let copied_input = conformer_input_path(&request, &work_dir)?;
    let input_text = fs::read_to_string(&copied_input.input_path)
        .map_err(|err| format!("{}: {err}", copied_input.input_path.display()))?;
    assert_direct_conformer_input(&input_text, &copied_input.input_extension, &operation)?;

    let mut prepared_input = if operation == "crest-generate" {
        prepare_crest_input(&copied_input.input_path, &input_text, &work_dir)?
    } else {
        PreparedInput {
            path: copied_input.input_path.clone(),
            text: input_text.clone(),
            source: "input".into(),
        }
    };

    let timeout = Duration::from_secs(
        request
            .timeout_seconds
            .unwrap_or(if operation == "prism-prune" {
                300
            } else {
                3600
            })
            .clamp(5, 86_400),
    );
    let job_id = request
        .job_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let mut run_request = request_clone_without_job(&request);
    let mut args = conformer_args(
        &operation,
        &run_request,
        &prepared_input.path,
        &input_text,
        &prepared_input.text,
        &prepared_input.source,
    );
    let mut status =
        run_logged_executable(&executable, &args, &work_dir, &log_path, timeout, job_id)?;
    let mut log = fs::read_to_string(&log_path).unwrap_or_default();
    let mut recoveries = Vec::new();

    if operation == "crest-generate"
        && should_retry_crest_with_xtb_preopt(&run_request, &status, &log)
    {
        if let Some(xtb) = resolve_executable("xtb") {
            let recovery = "xTB pre-optimization after CREST initial geometry optimization failure";
            let xtb_log_path = work_dir.join("crest-generate-xtb-preopt.log");
            let preopt_charge = effective_conformer_charge(
                &run_request,
                &prepared_input.text,
                &prepared_input.source,
            );
            let xtb_args = xtb_preopt_args(
                &run_request,
                &prepared_input.path,
                &prepared_input.text,
                &prepared_input.source,
            );
            let xtb_status =
                run_logged_executable(&xtb, &xtb_args, &work_dir, &xtb_log_path, timeout, job_id)?;
            append_file_to_log(&log_path, recovery, &xtb_log_path)?;
            log = fs::read_to_string(&log_path).unwrap_or_default();
            if xtb_status.success() {
                if let Some(xtb_opt_path) = xtb_preopt_result_path(&work_dir) {
                    let xtb_opt_text = fs::read_to_string(&xtb_opt_path)
                        .map_err(|err| format!("{}: {err}", xtb_opt_path.display()))?;
                    prepared_input = PreparedInput {
                        path: xtb_opt_path,
                        text: xtb_opt_text,
                        source: "xtb:preopt".into(),
                    };
                    run_request = ConformerRunRequest {
                        charge: preopt_charge.or(request.charge),
                        ..request_clone_without_job(&request)
                    };
                    args = conformer_args(
                        &operation,
                        &run_request,
                        &prepared_input.path,
                        &input_text,
                        &prepared_input.text,
                        &prepared_input.source,
                    );
                    let retry_log_path = work_dir.join("crest-generate-xtb-preopt-retry.log");
                    status = run_logged_executable(
                        &executable,
                        &args,
                        &work_dir,
                        &retry_log_path,
                        timeout,
                        job_id,
                    )?;
                    append_file_to_log(
                        &log_path,
                        "CREST retry after xTB pre-optimization",
                        &retry_log_path,
                    )?;
                    log = fs::read_to_string(&log_path).unwrap_or_default();
                    recoveries.push(recovery.to_string());
                    if should_retry_crest_without_solvent_after_preopt(&run_request, &status, &log)
                    {
                        run_request = ConformerRunRequest {
                            solvent: Some("none".into()),
                            ..request_clone_without_job(&run_request)
                        };
                        args = conformer_args(
                            &operation,
                            &run_request,
                            &prepared_input.path,
                            &input_text,
                            &prepared_input.text,
                            &prepared_input.source,
                        );
                        let vacuum_log_path =
                            work_dir.join("crest-generate-xtb-preopt-vacuum-retry.log");
                        status = run_logged_executable(
                            &executable,
                            &args,
                            &work_dir,
                            &vacuum_log_path,
                            timeout,
                            job_id,
                        )?;
                        append_file_to_log(
                            &log_path,
                            "CREST retry without implicit solvent after xTB pre-optimization",
                            &vacuum_log_path,
                        )?;
                        log = fs::read_to_string(&log_path).unwrap_or_default();
                        recoveries.push(
                            "CREST retry without implicit solvent after xTB pre-optimization"
                                .into(),
                        );
                    }
                }
            }
        }
    }

    if operation == "crest-generate" && should_retry_crest_with_gfnff(&run_request, &status, &log) {
        run_request = ConformerRunRequest {
            method: Some("gfnff".into()),
            ..request_clone_without_job(&run_request)
        };
        args = conformer_args(
            &operation,
            &run_request,
            &prepared_input.path,
            &input_text,
            &prepared_input.text,
            &prepared_input.source,
        );
        let retry_log_path = work_dir.join("crest-generate-gfnff-retry.log");
        status = run_logged_executable(
            &executable,
            &args,
            &work_dir,
            &retry_log_path,
            timeout,
            job_id,
        )?;
        append_file_to_log(
            &log_path,
            "GFN-FF retry after initial geometry optimization failure",
            &retry_log_path,
        )?;
        log = fs::read_to_string(&log_path).unwrap_or_default();
        recoveries.push("GFN-FF retry after initial geometry optimization failure".into());
    }

    let cancelled = conformer_job_was_cancelled(job_id);
    let exit_code = if cancelled {
        130
    } else {
        exit_code_for_status(&status)
    };
    if cancelled {
        fs::write(&log_path, "Conformer job cancelled.\n")
            .map_err(|err| format!("{}: {err}", log_path.display()))?;
        log = "Conformer job cancelled.\n".into();
    }
    let artifacts = if cancelled {
        Vec::new()
    } else {
        collect_conformer_artifacts(&work_dir)?
    };
    let recovered_primary_open_path = if exit_code != 0 && exit_code != 124 {
        primary_conformer_open_path(&operation, &artifacts, true)
    } else {
        None
    };
    let primary_open_path = primary_conformer_open_path(&operation, &artifacts, exit_code == 0)
        .or(recovered_primary_open_path);
    let ok = !cancelled && (exit_code == 0 || (exit_code != 124 && primary_open_path.is_some()));
    let result = ConformerRunResult {
        ok,
        operation: operation.clone(),
        title: copied_input.input_title.clone(),
        input_path: copied_input.source_path.to_string_lossy().to_string(),
        work_dir: work_dir.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
        report_path: report_path.to_string_lossy().to_string(),
        exit_code,
        error_summary: conformer_error_summary(
            &operation,
            exit_code,
            &log,
            &prepared_input.source,
            &input_text,
            ok,
            cancelled,
        ),
        elapsed_ms: started.elapsed().as_millis(),
        command: std::iter::once(executable.to_string_lossy().to_string())
            .chain(args.iter().cloned())
            .collect(),
        preparation: ConformerPreparation {
            path: prepared_input.path.to_string_lossy().to_string(),
            source: prepared_input.source,
        },
        recovery: if recoveries.is_empty() {
            None
        } else {
            Some(recoveries.join("; "))
        },
        artifacts,
        primary_open_path,
    };
    write_conformer_report(&report_path, &result, &log)?;
    finish_conformer_job(job_id);
    Ok(result)
}

fn conformer_tool_status(
    executable: Option<PathBuf>,
    ready_hint: &str,
    missing_hint: &str,
    version_args: &[&str],
) -> ConformerToolStatus {
    match executable {
        Some(path) => ConformerToolStatus {
            installed: true,
            version: executable_version(&path, version_args),
            executable: Some(path.to_string_lossy().to_string()),
            install_hint: ready_hint.into(),
        },
        None => ConformerToolStatus {
            installed: false,
            executable: None,
            version: None,
            install_hint: missing_hint.into(),
        },
    }
}

fn conformer_operation(request: &ConformerRunRequest) -> String {
    if request.operation == "prism-prune" {
        "prism-prune".into()
    } else {
        "crest-generate".into()
    }
}

fn conformer_executable(operation: &str) -> Result<PathBuf, String> {
    if operation == "prism-prune" {
        resolve_executable("prism_pruner")
            .or_else(|| resolve_executable("prism-pruner"))
            .ok_or_else(|| "PRISM Pruner executable was not found. Install it with uv tool install prism_pruner or expose prism_pruner on PATH.".into())
    } else {
        resolve_executable("crest").ok_or_else(|| {
            "CREST executable was not found. Install it with pixi global install crest or expose crest on PATH.".into()
        })
    }
}

fn conformer_output_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: &ConformerRunRequest,
) -> Result<PathBuf, String> {
    if let Some(output_directory) = request
        .output_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(PathBuf::from(output_directory));
    }
    let source = PathBuf::from(&request.path);
    if source.is_file() {
        if let Some(parent) = source.parent() {
            return Ok(parent.to_path_buf());
        }
    }
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("conformer-jobs"))
}

fn create_numbered_conformer_run_dir(
    parent_dir: &Path,
    operation: &str,
) -> Result<PathBuf, String> {
    let prefix = if operation == "prism-prune" {
        "prism_run"
    } else {
        "crest_run"
    };
    fs::create_dir_all(parent_dir).map_err(|err| format!("{}: {err}", parent_dir.display()))?;
    for index in 1..=9999 {
        let work_dir = parent_dir.join(format!("{prefix}_{index}"));
        match fs::create_dir(&work_dir) {
            Ok(()) => return Ok(work_dir),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("{}: {err}", work_dir.display())),
        }
    }
    Err(format!(
        "Could not create a {prefix}_N directory in {}.",
        parent_dir.display()
    ))
}

fn write_conformer_run_metadata(
    work_dir: &Path,
    request: &ConformerRunRequest,
    operation: &str,
    started_at_ms: u128,
) -> Result<(), String> {
    let operation_label = if operation == "prism-prune" {
        "PRISM Prune"
    } else {
        "CREST Generate"
    };
    let input_label = if request.title.trim().is_empty() {
        path_basename(&request.path)
    } else {
        request.title.clone()
    };
    let path = work_dir.join(CONFORMER_RUN_METADATA_FILE);
    let metadata = json!({
        "kind": "conformer-run",
        "operation": operation,
        "operationLabel": operation_label,
        "inputLabel": input_label,
        "title": format!("{operation_label} · {input_label}"),
        "createdAtMs": started_at_ms,
    });
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(&metadata).unwrap()),
    )
    .map_err(|err| format!("{}: {err}", path.display()))
}

fn conformer_input_path(
    request: &ConformerRunRequest,
    work_dir: &Path,
) -> Result<CopiedInput, String> {
    let extension = safe_extension(if request.extension.trim().is_empty() {
        Path::new(&request.path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("xyz")
    } else {
        &request.extension
    });
    let input_path = work_dir.join(format!("input.{extension}"));
    if let Some(input_data_base64) = request
        .input_data_base64
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(input_data_base64)
            .map_err(|err| format!("Could not decode conformer input: {err}"))?;
        if bytes.is_empty() {
            return Err("Inline conformer input is empty.".into());
        }
        fs::write(&input_path, bytes).map_err(|err| format!("{}: {err}", input_path.display()))?;
        return Ok(CopiedInput {
            input_path: input_path.clone(),
            source_path: input_path,
            input_title: request.title.clone(),
            input_extension: extension,
        });
    }
    let source_path = PathBuf::from(&request.path)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", request.path))?;
    if !source_path.is_file() {
        return Err(format!("{} is not a file.", source_path.display()));
    }
    fs::copy(&source_path, &input_path).map_err(|err| {
        format!(
            "Could not copy {} to {}: {err}",
            source_path.display(),
            input_path.display()
        )
    })?;
    Ok(CopiedInput {
        input_path,
        source_path,
        input_title: if request.title.trim().is_empty() {
            path_basename(&request.path)
        } else {
            request.title.clone()
        },
        input_extension: extension,
    })
}

fn prepare_crest_input(
    input_path: &Path,
    input_text: &str,
    work_dir: &Path,
) -> Result<PreparedInput, String> {
    if should_use_prepared_sdf_directly(input_path, input_text) {
        return Ok(PreparedInput {
            path: input_path.to_path_buf(),
            text: input_text.into(),
            source: "input:prepared_sdf".into(),
        });
    }
    if should_prepare_crest_input_with_openbabel(input_path) {
        if let Some(prepared) =
            prepare_crest_input_with_openbabel(input_path, input_text, work_dir)?
        {
            return Ok(prepared);
        }
    }
    Ok(PreparedInput {
        path: input_path.to_path_buf(),
        text: input_text.into(),
        source: "input".into(),
    })
}

fn prepare_crest_input_with_openbabel(
    input_path: &Path,
    input_text: &str,
    work_dir: &Path,
) -> Result<Option<PreparedInput>, String> {
    let Some(obabel) = resolve_executable("obabel") else {
        return Ok(None);
    };
    let prepared_path = work_dir.join("prepared_obabel.sdf");
    let prep_log_path = work_dir.join("ligand-prep.log");
    let mut args = vec![
        input_path.to_string_lossy().to_string(),
        "-O".into(),
        prepared_path.to_string_lossy().to_string(),
        "-h".into(),
    ];
    if should_generate_crest_input_3d(input_text) {
        args.push("--gen3d".into());
    }
    let status = run_logged_executable(
        &obabel,
        &args,
        work_dir,
        &prep_log_path,
        Duration::from_secs(120),
        None,
    )?;
    if status.success()
        && prepared_path
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    {
        let text = fs::read_to_string(&prepared_path)
            .map_err(|err| format!("{}: {err}", prepared_path.display()))?;
        let source = if args.iter().any(|arg| arg == "--gen3d") {
            "obabel:gen3d_add_h"
        } else {
            "obabel:add_h"
        };
        return Ok(Some(PreparedInput {
            path: prepared_path,
            text,
            source: source.into(),
        }));
    }
    Ok(None)
}

fn conformer_args(
    operation: &str,
    request: &ConformerRunRequest,
    input_path: &Path,
    original_input_text: &str,
    prepared_input_text: &str,
    prepared_input_source: &str,
) -> Vec<String> {
    if operation == "prism-prune" {
        let mut args = Vec::new();
        if request.prism_energy_sort != Some(false) {
            args.push("-e".into());
        }
        args.push(input_path.to_string_lossy().to_string());
        return args;
    }

    let method = request.method.as_deref().unwrap_or("gfn2");
    let mut args = vec![input_path.to_string_lossy().to_string()];
    match method {
        "gfnff" => args.push("--gfnff".into()),
        "gfn1" => args.push("--gfn1".into()),
        "gfn0" => args.push("--gfn0".into()),
        _ => args.push("--gfn2".into()),
    }
    if method == "gfnff" && is_raw_pdb_ligand_selection(original_input_text) {
        args.push("-nocbonds".into());
    }
    match request.sampling_mode.as_deref().unwrap_or("auto") {
        "quick" => args.push("-quick".into()),
        "squick" => args.push("-squick".into()),
        "mquick" => args.push("-mquick".into()),
        _ => {}
    }
    let solvent = request.solvent.as_deref().unwrap_or("none");
    if !solvent.is_empty() && solvent != "none" {
        args.push("--gbsa".into());
        args.push(solvent.into());
    }
    if let Some(charge) =
        effective_conformer_charge(request, prepared_input_text, prepared_input_source)
    {
        if charge != 0 {
            args.push("--chrg".into());
            args.push(charge.to_string());
        }
    }
    if let Some(uhf) = request.uhf.filter(|value| *value > 0) {
        args.push("--uhf".into());
        args.push(uhf.to_string());
    }
    if let Some(threads) = request.threads.filter(|value| *value > 0) {
        args.push("-T".into());
        args.push(threads.min(16).to_string());
    }
    if let Some(energy_window) = request
        .energy_window_kcal_mol
        .filter(|value| value.is_finite())
    {
        args.push("--ewin".into());
        args.push(energy_window.to_string());
    }
    if let Some(rmsd) = request
        .rmsd_threshold_angstrom
        .filter(|value| value.is_finite())
    {
        args.push("--rthr".into());
        args.push(rmsd.to_string());
    }
    args
}

fn xtb_preopt_args(
    request: &ConformerRunRequest,
    input_path: &Path,
    prepared_input_text: &str,
    prepared_input_source: &str,
) -> Vec<String> {
    let mut args = vec![input_path.to_string_lossy().to_string()];
    match request.method.as_deref().unwrap_or("gfn2") {
        "gfn1" => args.extend(["--gfn".into(), "1".into()]),
        "gfn0" => args.extend(["--gfn".into(), "0".into()]),
        _ => args.extend(["--gfn".into(), "2".into()]),
    }
    args.push("--opt".into());
    if let Some(charge) =
        effective_conformer_charge(request, prepared_input_text, prepared_input_source)
    {
        args.push("--chrg".into());
        args.push(charge.to_string());
    }
    if let Some(uhf) = request.uhf.filter(|value| *value > 0) {
        args.push("--uhf".into());
        args.push(uhf.to_string());
    }
    if let Some(threads) = request.threads.filter(|value| *value > 0) {
        args.push("--parallel".into());
        args.push(threads.min(16).to_string());
    }
    args
}

fn run_logged_executable(
    executable: &Path,
    args: &[String],
    cwd: &Path,
    log_path: &Path,
    timeout: Duration,
    job_id: Option<&str>,
) -> Result<ExitStatus, String> {
    fs::write(
        log_path,
        format!("$ {}\n\n", command_line(executable, args)),
    )
    .map_err(|err| format!("{}: {err}", log_path.display()))?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("Could not start {}: {err}", executable.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture conformer stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture conformer stderr.".to_string())?;
    let child = Arc::new(Mutex::new(child));
    register_conformer_job(job_id, Arc::clone(&child))?;
    let stdout_reader = thread::spawn(move || read_capped_text(stdout));
    let stderr_reader = thread::spawn(move || read_capped_text(stderr));
    let started = Instant::now();
    loop {
        let status = {
            let mut child = child
                .lock()
                .map_err(|_| "Conformer job process is unavailable.".to_string())?;
            child
                .try_wait()
                .map_err(|err| format!("Could not wait for conformer job: {err}"))?
        };
        if let Some(status) = status {
            unregister_conformer_job(job_id);
            append_captured_log(stdout_reader, stderr_reader, log_path);
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            {
                let mut child = child
                    .lock()
                    .map_err(|_| "Conformer job process is unavailable.".to_string())?;
                let _ = child.kill();
                let _ = child.wait();
            }
            unregister_conformer_job(job_id);
            append_captured_log(stdout_reader, stderr_reader, log_path);
            return Ok(timeout_exit_status());
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn running_conformer_jobs() -> &'static RunningConformerJobs {
    RUNNING_CONFORMER_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_conformer_jobs() -> &'static Mutex<HashSet<String>> {
    CANCELLED_CONFORMER_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn register_conformer_job(job_id: Option<&str>, child: Arc<Mutex<Child>>) -> Result<(), String> {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    running_conformer_jobs()
        .lock()
        .map_err(|_| "Conformer job registry is unavailable.".to_string())?
        .insert(job_id.to_string(), child);
    Ok(())
}

fn unregister_conformer_job(job_id: Option<&str>) {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    if let Ok(mut jobs) = running_conformer_jobs().lock() {
        jobs.remove(job_id);
    }
}

fn conformer_job_was_cancelled(job_id: Option<&str>) -> bool {
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return false;
    };
    cancelled_conformer_jobs()
        .lock()
        .map(|jobs| jobs.contains(job_id))
        .unwrap_or(false)
}

fn finish_conformer_job(job_id: Option<&str>) {
    unregister_conformer_job(job_id);
    let Some(job_id) = job_id.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    if let Ok(mut jobs) = cancelled_conformer_jobs().lock() {
        jobs.remove(job_id);
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
        let remaining = CONFORMER_LOG_CAPTURE_BYTES.saturating_sub(stored.len());
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
        text.push_str("\n... conformer log truncated ...");
    }
    text
}

fn append_captured_log(
    stdout_reader: thread::JoinHandle<String>,
    stderr_reader: thread::JoinHandle<String>,
    log_path: &Path,
) {
    if let Ok(mut file) = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path)
    {
        if let Ok(stdout) = stdout_reader.join() {
            let _ = file.write_all(stdout.as_bytes());
        }
        if let Ok(stderr) = stderr_reader.join() {
            let _ = file.write_all(stderr.as_bytes());
        }
    }
}

fn append_file_to_log(log_path: &Path, label: &str, source_path: &Path) -> Result<(), String> {
    let source = fs::read_to_string(source_path).unwrap_or_default();
    let mut file = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path)
        .map_err(|err| format!("{}: {err}", log_path.display()))?;
    writeln!(file, "\n\n--- {label} ---\n").map_err(|err| err.to_string())?;
    file.write_all(source.as_bytes())
        .map_err(|err| err.to_string())
}

fn collect_conformer_artifacts(work_dir: &Path) -> Result<Vec<ConformerArtifact>, String> {
    let mut artifacts = Vec::new();
    for entry in fs::read_dir(work_dir).map_err(|err| format!("{}: {err}", work_dir.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let title = entry.file_name().to_string_lossy().to_string();
        if title == CONFORMER_RUN_METADATA_FILE {
            continue;
        }
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        let extension = file_extension(&title);
        let valid_ensemble = valid_conformer_artifact(&title, &path, metadata.len());
        artifacts.push(ConformerArtifact {
            kind: conformer_artifact_kind(&title),
            title,
            path: path.to_string_lossy().to_string(),
            extension,
            byte_count: metadata.len(),
            valid_ensemble,
        });
    }
    artifacts.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(artifacts)
}

fn valid_conformer_artifact(name: &str, path: &Path, byte_count: u64) -> Option<bool> {
    if byte_count == 0 || name.starts_with('.') {
        return Some(false);
    }
    let lower = name.to_ascii_lowercase();
    if !is_conformer_result_artifact(&lower) {
        return None;
    }
    let extension = file_extension(&lower);
    if !matches!(extension.as_str(), "xyz" | "sdf" | "sd" | "mol") {
        return Some(false);
    }
    let text = fs::read_to_string(path).unwrap_or_default();
    if extension == "xyz" {
        Some(valid_xyz_ensemble_text(&text))
    } else if extension == "sdf" || extension == "sd" {
        Some(valid_sdf_ensemble_text(&text))
    } else {
        Some(byte_count > 20)
    }
}

fn is_conformer_result_artifact(lower: &str) -> bool {
    matches!(
        lower,
        "crest_best.xyz"
            | "crest_conformers.xyz"
            | "crest_conformers.sdf"
            | "crest_ensemble.xyz"
            | "crest_rotamers.xyz"
            | "xtbopt.sdf"
            | "xtbopt.xyz"
            | "xtbopt.mol"
            | "xtbtopo.sdf"
            | "input_pruned.xyz"
            | "input_pruned.sdf"
    )
}

fn conformer_artifact_kind(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("report") {
        "report".into()
    } else if lower.ends_with(".log") || lower.ends_with(".out") {
        "log".into()
    } else if lower == "coord" || lower.starts_with("input.") || lower.starts_with("prepared_") {
        "artifact".into()
    } else if lower.ends_with(".json") {
        "summary".into()
    } else if lower.ends_with(".xyz")
        || lower.ends_with(".sdf")
        || lower.ends_with(".sd")
        || lower.ends_with(".mol")
    {
        "ensemble".into()
    } else {
        "artifact".into()
    }
}

fn primary_conformer_open_path(
    operation: &str,
    artifacts: &[ConformerArtifact],
    ok: bool,
) -> Option<String> {
    if !ok {
        return None;
    }
    let preferred: &[&str] = if operation == "prism-prune" {
        &["input_pruned.xyz", "input_pruned.sdf"]
    } else {
        &[
            "crest_conformers.xyz",
            "crest_conformers.sdf",
            "crest_ensemble.xyz",
            "crest_best.xyz",
            "crest_rotamers.xyz",
            "xtbopt.sdf",
            "xtbopt.xyz",
            "xtbopt.mol",
            "xtbtopo.sdf",
        ]
    };
    for name in preferred {
        if let Some(path) = artifacts
            .iter()
            .find(|artifact| artifact.title == *name && artifact.valid_ensemble == Some(true))
            .map(|artifact| artifact.path.clone())
        {
            return Some(path);
        }
    }
    for name in preferred {
        if let Some(path) = artifacts
            .iter()
            .find(|artifact| {
                artifact.title.starts_with(name) && artifact.valid_ensemble == Some(true)
            })
            .map(|artifact| artifact.path.clone())
        {
            return Some(path);
        }
    }
    None
}

fn conformer_error_summary(
    operation: &str,
    status: i32,
    log: &str,
    preparation_source: &str,
    input_text: &str,
    ok: bool,
    cancelled: bool,
) -> Option<String> {
    if cancelled {
        return Some("Conformer job cancelled.".into());
    }
    if ok {
        return None;
    }
    let tool = if operation == "prism-prune" {
        "PRISM"
    } else {
        "CREST"
    };
    if status == 124 {
        return Some(format!(
            "{tool} timed out before producing an ensemble. Increase the timeout or use a faster preset."
        ));
    }
    if log
        .to_ascii_lowercase()
        .contains("initial geometry optimization failed")
    {
        if operation != "crest-generate" {
            return Some("Initial geometry optimization failed.".into());
        }
        if preparation_source != "input" {
            return Some("Initial geometry optimization failed after ligand preparation. Check charge, protonation, or the prepared ligand template.".into());
        }
        return Some(if is_raw_pdb_ligand_selection(input_text) {
            "Initial geometry optimization failed. Raw PDB ligands need preparation: add hydrogens, set charge/protonation, or use a prepared SDF.".into()
        } else {
            "Initial geometry optimization failed. Check input geometry, charge, protonation, or use a prepared SDF.".into()
        });
    }
    log.lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("error") || lower.contains("failed") || lower.contains("failure")
        })
        .map(str::to_string)
        .or_else(|| Some(format!("{tool} exited with code {status}.")))
}

fn write_conformer_report(
    path: &Path,
    result: &ConformerRunResult,
    log: &str,
) -> Result<(), String> {
    let artifact_lines = if result.artifacts.is_empty() {
        "No artifacts were produced.".into()
    } else {
        result
            .artifacts
            .iter()
            .map(|artifact| {
                format!(
                    "- {} ({}, {} B): {}",
                    artifact.title, artifact.kind, artifact.byte_count, artifact.path
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let report = format!(
        "# Conformer Job Report\n\n- Operation: {}\n- Input: {}\n- Work dir: {}\n- Exit code: {}\n- Error summary: {}\n- Preparation: {}\n- Prepared input: {}\n- Elapsed: {:.1} s\n- Command: {}\n- Recovery: {}\n\n## Artifacts\n\n{}\n\n## Log excerpt\n\n```text\n{}\n```\n",
        result.operation,
        result.input_path,
        result.work_dir,
        result.exit_code,
        result.error_summary.as_deref().unwrap_or("None"),
        result.preparation.source,
        result.preparation.path,
        result.elapsed_ms as f64 / 1000.0,
        result.command.join(" "),
        result.recovery.as_deref().unwrap_or("None"),
        artifact_lines,
        tail_text(log, 8000),
    );
    fs::write(path, report).map_err(|err| format!("{}: {err}", path.display()))
}

fn assert_direct_conformer_input(
    text: &str,
    extension: &str,
    operation: &str,
) -> Result<(), String> {
    let count = atom_count_for_text(text, extension);
    if count > DIRECT_CONFORMER_ATOM_LIMIT {
        let tool = if operation == "prism-prune" {
            "PRISM"
        } else {
            "CREST"
        };
        return Err(format!(
            "{tool} direct jobs are limited to {DIRECT_CONFORMER_ATOM_LIMIT} atoms. Select a ligand or open a prepared small-molecule file instead."
        ));
    }
    Ok(())
}

fn atom_count_for_text(text: &str, extension: &str) -> usize {
    match extension
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "pdb" | "pdbqt" | "ent" => text
            .lines()
            .filter(|line| line.starts_with("ATOM") || line.starts_with("HETATM"))
            .count(),
        "xyz" => text
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0),
        "sdf" | "sd" | "mol" => sdf_atom_block_stats(text).atom_count,
        _ => 0,
    }
}

#[derive(Clone, Copy)]
struct SdfAtomStats {
    atom_count: usize,
    has_explicit_hydrogen: bool,
    has_non_planar_3d_coordinates: bool,
}

fn sdf_atom_block_stats(text: &str) -> SdfAtomStats {
    let lines = text.lines().collect::<Vec<_>>();
    let Some(counts_index) = lines
        .iter()
        .position(|line| line.contains("V2000") && line.split_whitespace().next().is_some())
    else {
        return SdfAtomStats {
            atom_count: 0,
            has_explicit_hydrogen: false,
            has_non_planar_3d_coordinates: false,
        };
    };
    let atom_count = lines[counts_index]
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if atom_count == 0 {
        return SdfAtomStats {
            atom_count: 0,
            has_explicit_hydrogen: false,
            has_non_planar_3d_coordinates: false,
        };
    }
    let atom_lines = lines
        .iter()
        .skip(counts_index + 1)
        .take(atom_count)
        .collect::<Vec<_>>();
    let mut parsed_atoms = 0;
    let mut max_abs_z = 0.0_f64;
    let mut has_explicit_hydrogen = false;
    for line in atom_lines {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 4 {
            continue;
        }
        let z = parts[2].parse::<f64>().unwrap_or(0.0).abs();
        max_abs_z = max_abs_z.max(z);
        if parts[3].eq_ignore_ascii_case("H") {
            has_explicit_hydrogen = true;
        }
        parsed_atoms += 1;
    }
    SdfAtomStats {
        atom_count: if parsed_atoms == atom_count {
            atom_count
        } else {
            0
        },
        has_explicit_hydrogen,
        has_non_planar_3d_coordinates: parsed_atoms == atom_count && max_abs_z >= 1e-4,
    }
}

fn should_use_prepared_sdf_directly(input_path: &Path, input_text: &str) -> bool {
    let extension = file_extension_path(input_path);
    if extension != "sdf" && extension != "sd" {
        return false;
    }
    if !is_valid_sdf_text(input_text) {
        return false;
    }
    let stats = sdf_atom_block_stats(input_text);
    stats.atom_count > 0 && stats.has_explicit_hydrogen && stats.has_non_planar_3d_coordinates
}

fn should_prepare_crest_input_with_openbabel(input_path: &Path) -> bool {
    matches!(
        file_extension_path(input_path).as_str(),
        "sdf" | "sd" | "mol" | "mol2" | "pdb" | "pdbqt" | "ent" | "cif" | "mcif" | "mmcif"
    )
}

fn should_generate_crest_input_3d(input_text: &str) -> bool {
    let stats = sdf_atom_block_stats(input_text);
    stats.atom_count > 0 && !stats.has_non_planar_3d_coordinates
}

fn is_valid_sdf_text(text: &str) -> bool {
    text.contains("$$$$") && text.contains("M  END")
}

fn effective_conformer_charge(
    request: &ConformerRunRequest,
    prepared_input_text: &str,
    prepared_input_source: &str,
) -> Option<i32> {
    let inferred = infer_sdf_formal_charge(prepared_input_text);
    if (prepared_input_source.starts_with("ccd") || prepared_input_source == "xtb:preopt")
        && inferred.is_some()
    {
        return inferred;
    }
    match request.charge {
        Some(charge) if charge != 0 || inferred.is_none() => Some(charge),
        _ => inferred,
    }
}

fn infer_sdf_formal_charge(text: &str) -> Option<i32> {
    let mut total = 0;
    let mut found = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("M  CHG") {
            continue;
        }
        let values = trimmed.split_whitespace().skip(3).collect::<Vec<_>>();
        for pair in values.chunks(2) {
            if pair.len() == 2 {
                if let Ok(charge) = pair[1].parse::<i32>() {
                    total += charge;
                    found = true;
                }
            }
        }
    }
    if found {
        return Some(total);
    }
    None
}

fn should_retry_crest_with_xtb_preopt(
    request: &ConformerRunRequest,
    status: &ExitStatus,
    log: &str,
) -> bool {
    request.method.as_deref() != Some("gfnff")
        && should_retry_crest_after_initial_optimization_failure(status, log)
}

fn should_retry_crest_with_gfnff(
    request: &ConformerRunRequest,
    status: &ExitStatus,
    log: &str,
) -> bool {
    request.method.as_deref() != Some("gfnff")
        && should_retry_crest_after_initial_optimization_failure(status, log)
}

fn should_retry_crest_without_solvent_after_preopt(
    request: &ConformerRunRequest,
    status: &ExitStatus,
    log: &str,
) -> bool {
    !status.success()
        && exit_code_for_status(status) != 124
        && request.solvent.as_deref().unwrap_or("none") != "none"
        && log
            .to_ascii_lowercase()
            .contains("initial geometry optimization failed")
}

fn should_retry_crest_after_initial_optimization_failure(status: &ExitStatus, log: &str) -> bool {
    !status.success()
        && exit_code_for_status(status) != 124
        && log
            .to_ascii_lowercase()
            .contains("initial geometry optimization failed")
}

fn xtb_preopt_result_path(work_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(work_dir).ok()?;
    let paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    for name in ["xtbopt.sdf", "xtbopt.xyz", "xtbopt.mol", "xtbopt.pdb"] {
        let path = work_dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    paths.into_iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("xtbopt."))
    })
}

fn valid_xyz_ensemble_text(text: &str) -> bool {
    let lines = text.lines().collect::<Vec<_>>();
    let Some(first) = lines.first() else {
        return false;
    };
    let atom_count = first.trim().parse::<usize>().unwrap_or(0);
    if atom_count == 0 || lines.len() < atom_count + 2 {
        return false;
    }
    lines
        .iter()
        .skip(2)
        .take(atom_count)
        .filter(|line| !line.trim().is_empty())
        .count()
        == atom_count
}

fn valid_sdf_ensemble_text(text: &str) -> bool {
    text.split("$$$$").any(|record| {
        (record.contains("V2000") || record.contains("V3000")) && record.trim().len() > 80
    })
}

fn request_clone_without_job(request: &ConformerRunRequest) -> ConformerRunRequest {
    ConformerRunRequest {
        operation: request.operation.clone(),
        job_id: request.job_id.clone(),
        path: request.path.clone(),
        title: request.title.clone(),
        extension: request.extension.clone(),
        input_data_base64: request.input_data_base64.clone(),
        output_directory: request.output_directory.clone(),
        work_dir: request.work_dir.clone(),
        method: request.method.clone(),
        solvent: request.solvent.clone(),
        charge: request.charge,
        uhf: request.uhf,
        threads: request.threads,
        timeout_seconds: request.timeout_seconds,
        energy_window_kcal_mol: request.energy_window_kcal_mol,
        rmsd_threshold_angstrom: request.rmsd_threshold_angstrom,
        sampling_mode: request.sampling_mode.clone(),
        prism_energy_sort: request.prism_energy_sort,
        prism_rotamer_pruning: request.prism_rotamer_pruning,
    }
}

fn resolve_executable(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".pixi/bin").join(name));
        candidates.push(home.join(".local/bin").join(name));
        candidates.push(home.join(".cargo/bin").join(name));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
    ]);
    candidates
        .into_iter()
        .find(|path| path.is_file() && is_executable(path))
}

fn executable_version(executable: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(executable)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    command_output_text(&output.stdout, &output.stderr)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

fn is_path_at_or_under(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok()
}

fn is_raw_pdb_ligand_selection(input_text: &str) -> bool {
    input_text.contains("PDB ligand selection")
}

fn command_output_text(stdout: &[u8], stderr: &[u8]) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
}

fn command_line(executable: &Path, args: &[String]) -> String {
    std::iter::once(executable.to_string_lossy().to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn file_extension(value: &str) -> String {
    Path::new(value)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn file_extension_path(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn safe_extension(value: &str) -> String {
    let extension = value
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    if extension.is_empty() {
        "xyz".into()
    } else {
        extension
    }
}

fn tail_text(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        text
    } else {
        &text[text.len() - limit..]
    }
}

fn exit_code_for_status(status: &ExitStatus) -> i32 {
    status
        .code()
        .or_else(|| {
            #[cfg(unix)]
            {
                status.signal().map(|signal| 128 + signal)
            }
            #[cfg(not(unix))]
            {
                None
            }
        })
        .unwrap_or(1)
}

#[cfg(unix)]
fn timeout_exit_status() -> ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    ExitStatus::from_raw(124 << 8)
}

#[cfg(not(unix))]
fn timeout_exit_status() -> ExitStatus {
    Command::new("false")
        .status()
        .expect("false command should produce an exit status")
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}
