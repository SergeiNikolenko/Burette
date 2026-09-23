use std::{
    cell::{Cell, RefCell},
    path::Path,
    time::Instant,
};

use burette_compute_core::{
    evaluate_pm6_with_accelerators, evaluate_rm1_with_prepared_pairs_and_accelerators,
    evaluate_semiempirical, symmetric_eigendecomposition, Rm1Evaluation, SemiempiricalAtom,
    SemiempiricalError, SemiempiricalMethod, SemiempiricalMolecule, SemiempiricalScfOptions,
    SemiempiricalScfStatus,
};
use burette_compute_metal::{MetalPm6OneCenterFockBatch, MetalTanimotoRuntime};
use burette_compute_protocol::{
    AnalysisResourceLimits, BackendPolicy, CapabilityMaturity, ComputeJobSchemaVersion,
    ExecutionPolicy, GridScope, GridSourceReference, MolecularSnapshotRef, RepresentativePolicy,
    SchedulingPolicy, SelectedGridScope, SemiempiricalMethodV1, SemiempiricalV1Parameters,
    SemiempiricalV1SubmitRequest, WorkflowTemplateId,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::preview::{
    grid_analysis::{
        apply_analysis_run, GridAnalysisApplyInput, GridAnalysisArtifactInput, GridAnalysisValue,
        GridAnalysisValueInput,
    },
    grid_store::GridAlignmentSourceRow,
};

use super::{
    alignment_workflow::parse_molfile,
    error::{ComputeCoordinatorError, ComputeResult},
    service::ComputeServiceClient,
};

const MAX_SEMIEMPIRICAL_MOLECULES: usize = 256;
const DEFAULT_MAX_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct GridSemiempiricalMethod {
    method: SemiempiricalMethod,
    display_name: &'static str,
    column_prefix: &'static str,
}

impl GridSemiempiricalMethod {
    fn parse(value: &str) -> ComputeResult<Self> {
        let normalized = value.trim().to_ascii_lowercase().replace(['-', '*'], "_");
        let method = match normalized.as_str() {
            "rm1" => Self::new(SemiempiricalMethod::Rm1, "RM1", "rm1"),
            "am1" => Self::new(SemiempiricalMethod::Am1, "AM1", "am1"),
            "pm3" => Self::new(SemiempiricalMethod::Pm3, "PM3", "pm3"),
            "pm6" => Self::new(SemiempiricalMethod::Pm6, "PM6", "pm6"),
            "pm6_d" | "pm6d" => Self::new(SemiempiricalMethod::Pm6D, "PM6_D", "pm6D"),
            "pm6_d3h4" | "pm6d3h4" => {
                Self::new(SemiempiricalMethod::Pm6D3H4, "PM6_D3H4", "pm6D3H4")
            }
            "pm6_sp" | "pm6sp" => Self::new(SemiempiricalMethod::Pm6Sp, "PM6_SP", "pm6Sp"),
            "am1_star" | "am1star" | "am1_" => {
                Self::new(SemiempiricalMethod::Am1Star, "AM1*", "am1Star")
            }
            _ => return Err(ComputeCoordinatorError::Validation(
                "Supported native semi-empirical methods are RM1, AM1, PM3, PM6, PM6_D, PM6_D3H4, PM6_SP, and AM1*"
                    .into(),
            )),
        };
        Ok(method)
    }

    const fn new(
        method: SemiempiricalMethod,
        display_name: &'static str,
        column_prefix: &'static str,
    ) -> Self {
        Self {
            method,
            display_name,
            column_prefix,
        }
    }

    fn column(self, suffix: &str) -> String {
        format!("{}{suffix}", self.column_prefix)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GridSemiempiricalRequest {
    pub(crate) document_id: String,
    pub(crate) source_indexes: Vec<usize>,
    pub(crate) method: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridSemiempiricalRow {
    pub(crate) source_index: u64,
    pub(crate) name: String,
    pub(crate) electronic_energy_ev: Option<f64>,
    pub(crate) nuclear_energy_ev: Option<f64>,
    pub(crate) total_energy_ev: Option<f64>,
    pub(crate) atomic_charges: Option<Vec<f64>>,
    pub(crate) converged: bool,
    pub(crate) iterations: Option<usize>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridSemiempiricalResult {
    pub(crate) run_id: Uuid,
    pub(crate) artifact_id: Option<Uuid>,
    pub(crate) artifact_manifest_sha256: Option<String>,
    pub(crate) report_path: Option<String>,
    pub(crate) method: &'static str,
    pub(crate) rows: Vec<GridSemiempiricalRow>,
    pub(crate) host_time_ms: u64,
    pub(crate) gpu_time_ms: u64,
    pub(crate) backend: &'static str,
    pub(crate) grid_applied: bool,
    pub(crate) grid_warning: Option<String>,
}

pub(crate) fn durable_semiempirical_request(
    request: &GridSemiempiricalRequest,
) -> ComputeResult<SemiempiricalV1SubmitRequest> {
    let method = GridSemiempiricalMethod::parse(&request.method)?;
    let source_indexes = normalized_indexes(&request.source_indexes)?
        .into_iter()
        .map(|index| index as u64)
        .collect();
    SemiempiricalV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::SemiempiricalV1,
        source: GridSourceReference {
            document_id: request.document_id.clone(),
            scope: GridScope::Selected(SelectedGridScope { source_indexes }),
        },
        parameters: SemiempiricalV1Parameters {
            method: match method.method {
                SemiempiricalMethod::Rm1 => SemiempiricalMethodV1::Rm1,
                SemiempiricalMethod::Am1 => SemiempiricalMethodV1::Am1,
                SemiempiricalMethod::Pm3 => SemiempiricalMethodV1::Pm3,
                SemiempiricalMethod::Pm6 => SemiempiricalMethodV1::Pm6,
                SemiempiricalMethod::Pm6D => SemiempiricalMethodV1::Pm6D,
                SemiempiricalMethod::Pm6D3H4 => SemiempiricalMethodV1::Pm6D3H4,
                SemiempiricalMethod::Pm6Sp => SemiempiricalMethodV1::Pm6Sp,
                SemiempiricalMethod::Am1Star => SemiempiricalMethodV1::Am1Star,
            },
        },
        execution_policy: ExecutionPolicy {
            backend_policy: BackendPolicy::GpuRequired,
            scheduling_policy: SchedulingPolicy::Throughput,
        },
        limits: AnalysisResourceLimits {
            max_memory_bytes: DEFAULT_MAX_MEMORY_BYTES,
            max_dispatch_ms: 250,
        },
    }
    .normalized()
    .map_err(ComputeCoordinatorError::from)
}

pub(crate) fn execute_snapshot_semiempirical_with_run_id(
    runtime: Option<&MetalTanimotoRuntime>,
    compute_service: Option<&ComputeServiceClient>,
    source_rows: Vec<GridAlignmentSourceRow>,
    request: &GridSemiempiricalRequest,
    run_id: Uuid,
    checkpoint: super::analysis_control::AnalysisCheckpoint<'_>,
) -> ComputeResult<GridSemiempiricalResult> {
    let indexes = normalized_indexes(&request.source_indexes)?;
    if source_rows.len() != indexes.len()
        || source_rows
            .iter()
            .zip(indexes)
            .any(|(row, index)| row.source_index != index as u64)
    {
        return Err(ComputeCoordinatorError::Protocol(
            "Frozen semiempirical records differ from the normalized selected scope".into(),
        ));
    }
    execute_semiempirical_rows(
        runtime,
        compute_service,
        request,
        run_id,
        source_rows,
        checkpoint,
    )
}

fn execute_semiempirical_rows(
    runtime: Option<&MetalTanimotoRuntime>,
    compute_service: Option<&ComputeServiceClient>,
    request: &GridSemiempiricalRequest,
    run_id: Uuid,
    source_rows: Vec<GridAlignmentSourceRow>,
    checkpoint: super::analysis_control::AnalysisCheckpoint<'_>,
) -> ComputeResult<GridSemiempiricalResult> {
    let method = GridSemiempiricalMethod::parse(&request.method)?;
    let backend = if runtime.is_some() || compute_service.is_some() {
        "nativeMetalScfHybrid"
    } else {
        "nativeCpuReference"
    };

    let started = Instant::now();
    let mut evaluated = Vec::with_capacity(source_rows.len());
    for (index, row) in source_rows.iter().enumerate() {
        checkpoint(index, None)?;
        let result = evaluate_row(row, method, runtime, compute_service, run_id, &|| {
            checkpoint(index, None).map_err(|e| e.to_string())
        });
        if result.0.error.is_some() {
            checkpoint(index, None)?;
        }
        checkpoint(index + 1, Some(serde_json::to_value(&result.0)?))?;
        evaluated.push(result);
    }
    let gpu_time_ms = evaluated.iter().map(|(_, gpu_time)| gpu_time).sum();
    let rows = evaluated
        .into_iter()
        .map(|(row, _)| row)
        .collect::<Vec<_>>();
    let host_time_ms = started.elapsed().as_millis() as u64;
    Ok(GridSemiempiricalResult {
        run_id,
        artifact_id: None,
        artifact_manifest_sha256: None,
        report_path: None,
        method: method.display_name,
        rows,
        host_time_ms,
        gpu_time_ms,
        backend,
        grid_applied: false,
        grid_warning: None,
    })
}

pub(crate) fn apply_grid_semiempirical_result(
    database_path: &Path,
    snapshot: &MolecularSnapshotRef,
    frozen_rows: &[GridAlignmentSourceRow],
    result: &GridSemiempiricalResult,
    artifact_id: Uuid,
    artifact_manifest_sha256: &str,
) -> ComputeResult<()> {
    let source_rows =
        super::analysis_snapshot::resolve_analysis_source_rows(database_path, frozen_rows)?;
    let method = GridSemiempiricalMethod::parse(result.method)?;
    apply_grid_results(
        database_path,
        result.run_id,
        snapshot,
        &source_rows,
        &result.rows,
        method,
        result.backend,
        result.host_time_ms,
        result.gpu_time_ms,
        artifact_id,
        artifact_manifest_sha256,
    )
}

fn normalized_indexes(indexes: &[usize]) -> ComputeResult<Vec<usize>> {
    let mut normalized = indexes.to_vec();
    normalized.sort_unstable();
    normalized.dedup();
    if normalized.is_empty() || normalized.len() > MAX_SEMIEMPIRICAL_MOLECULES {
        return Err(ComputeCoordinatorError::Validation(format!(
            "Semi-empirical evaluation requires 1..={MAX_SEMIEMPIRICAL_MOLECULES} selected rows"
        )));
    }
    Ok(normalized)
}

fn evaluate_row(
    row: &GridAlignmentSourceRow,
    method: GridSemiempiricalMethod,
    runtime: Option<&MetalTanimotoRuntime>,
    compute_service: Option<&ComputeServiceClient>,
    job_id: Uuid,
    before_dispatch: &dyn Fn() -> Result<(), String>,
) -> (GridSemiempiricalRow, u64) {
    match evaluate_row_inner(
        row,
        method,
        runtime,
        compute_service,
        job_id,
        before_dispatch,
    ) {
        Ok(result) => result,
        Err(error) => (
            GridSemiempiricalRow {
                source_index: row.source_index,
                name: row.name.clone(),
                electronic_energy_ev: None,
                nuclear_energy_ev: None,
                total_energy_ev: None,
                atomic_charges: None,
                converged: false,
                iterations: None,
                error: Some(error),
            },
            0,
        ),
    }
}

fn evaluate_row_inner(
    row: &GridAlignmentSourceRow,
    method: GridSemiempiricalMethod,
    runtime: Option<&MetalTanimotoRuntime>,
    compute_service: Option<&ComputeServiceClient>,
    job_id: Uuid,
    before_dispatch: &dyn Fn() -> Result<(), String>,
) -> Result<(GridSemiempiricalRow, u64), String> {
    let molblock = row
        .molblock
        .as_deref()
        .ok_or_else(|| "molecule has no molfile coordinates".to_string())?;
    let parsed = parse_molfile(molblock)?;
    parsed.validate_energy_input()?;
    let atoms = parsed
        .symbols
        .iter()
        .zip(&parsed.atoms)
        .map(|(symbol, atom)| {
            Ok(SemiempiricalAtom {
                atomic_number: atomic_number(symbol).ok_or_else(|| {
                    format!("element {symbol} is not supported by the native evaluator")
                })?,
                position_angstrom: [
                    f64::from(atom.position[0]),
                    f64::from(atom.position[1]),
                    f64::from(atom.position[2]),
                ],
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let charge = parsed
        .atoms
        .iter()
        .map(|atom| atom.partial_charge.round() as i32)
        .sum();
    let molecule = SemiempiricalMolecule::new(method.method, atoms, charge)
        .map_err(|error| error.to_string())?;
    let (evaluation, gpu_time_ms) = if let Some(service) = compute_service {
        service.evaluate_semiempirical(
            job_id,
            &molecule,
            DEFAULT_MAX_MEMORY_BYTES,
            before_dispatch,
        )?
    } else {
        evaluate_semiempirical_molecule(runtime, &molecule, DEFAULT_MAX_MEMORY_BYTES)?
    };
    let converged = evaluation.scf.status == SemiempiricalScfStatus::Converged;
    Ok((
        GridSemiempiricalRow {
            source_index: row.source_index,
            name: row.name.clone(),
            electronic_energy_ev: Some(evaluation.electronic_energy_ev),
            nuclear_energy_ev: Some(evaluation.nuclear_energy_ev),
            total_energy_ev: Some(evaluation.total_energy_ev),
            atomic_charges: Some(evaluation.atomic_charges),
            converged,
            iterations: Some(evaluation.scf.iterations),
            error: (!converged).then(|| "SCF reached the iteration limit".into()),
        },
        gpu_time_ms,
    ))
}

pub(super) fn evaluate_semiempirical_molecule(
    runtime: Option<&MetalTanimotoRuntime>,
    molecule: &SemiempiricalMolecule,
    max_memory_bytes: u64,
) -> Result<(Rm1Evaluation, u64), String> {
    let gpu_time_ms = Cell::new(0_u64);
    let gpu_eigensolves = Cell::new(0_usize);
    let previous_fock = RefCell::new(None::<Vec<f64>>);
    let cpu_polishing = Cell::new(false);
    let evaluation = if let Some(runtime) = runtime {
        let diagonalize = |matrix: &[f64], order: usize| {
            if order > 32 {
                return symmetric_eigendecomposition(matrix, order);
            }
            let fock_change = previous_fock
                .borrow()
                .as_ref()
                .map(|previous| {
                    matrix
                        .iter()
                        .zip(previous)
                        .map(|(current, previous)| (current - previous).abs())
                        .fold(0.0_f64, f64::max)
                })
                .unwrap_or(f64::INFINITY);
            previous_fock.replace(Some(matrix.to_vec()));
            if cpu_polishing.get() || fock_change <= 1.0e-5 || gpu_eigensolves.get() >= 32 {
                cpu_polishing.set(true);
                return symmetric_eigendecomposition(matrix, order);
            }
            let dispatch = runtime
                .symmetric_eigen_profiled(matrix, order, max_memory_bytes)
                .map_err(|error| SemiempiricalError::FockBuild(error.to_string()))?;
            gpu_eigensolves.set(gpu_eigensolves.get() + 1);
            gpu_time_ms.set(gpu_time_ms.get() + dispatch.gpu_time_ms);
            Ok((dispatch.eigenvalues, dispatch.eigenvectors))
        };
        if matches!(
            molecule.method,
            SemiempiricalMethod::Pm6 | SemiempiricalMethod::Pm6D | SemiempiricalMethod::Pm6D3H4
        ) {
            evaluate_pm6_with_accelerators(
                molecule,
                SemiempiricalScfOptions::default(),
                |orbital_count, density, pairs| {
                    let dispatch = runtime
                        .contract_pm6_pair_fock_profiled(
                            orbital_count,
                            density,
                            pairs,
                            max_memory_bytes,
                        )
                        .map_err(|error| SemiempiricalError::FockBuild(error.to_string()))?;
                    gpu_time_ms.set(gpu_time_ms.get() + dispatch.gpu_time_ms);
                    Ok(dispatch
                        .contribution_ev
                        .into_iter()
                        .map(f64::from)
                        .collect())
                },
                |density, w_integrals| {
                    let dispatch = runtime
                        .evaluate_pm6_one_center_fock_profiled(
                            MetalPm6OneCenterFockBatch {
                                densities: std::slice::from_ref(density),
                                w_integrals: std::slice::from_ref(w_integrals),
                            },
                            max_memory_bytes,
                        )
                        .map_err(|error| SemiempiricalError::FockBuild(error.to_string()))?;
                    gpu_time_ms.set(gpu_time_ms.get() + dispatch.gpu_time_ms);
                    Ok(dispatch.contributions_ev[0])
                },
                diagonalize,
            )
        } else {
            let prepared = runtime
                .prepare_rm1_pairs_profiled(molecule, max_memory_bytes)
                .map_err(|error| error.to_string())?;
            gpu_time_ms.set(gpu_time_ms.get() + prepared.gpu_time_ms);
            evaluate_rm1_with_prepared_pairs_and_accelerators(
                molecule,
                SemiempiricalScfOptions::default(),
                &prepared.pairs,
                |orbital_count, density, pairs| {
                    let dispatch = runtime
                        .contract_rm1_pair_fock_profiled(
                            orbital_count,
                            density,
                            pairs,
                            max_memory_bytes,
                        )
                        .map_err(|error| SemiempiricalError::FockBuild(error.to_string()))?;
                    gpu_time_ms.set(gpu_time_ms.get() + dispatch.gpu_time_ms);
                    Ok(dispatch
                        .contribution_ev
                        .into_iter()
                        .map(f64::from)
                        .collect())
                },
                diagonalize,
            )
        }
    } else {
        evaluate_semiempirical(molecule, SemiempiricalScfOptions::default())
    }
    .map_err(|error| error.to_string())?;
    // The evaluator already includes D3/H4/HH in total_energy_ev.
    // Do not dispatch a second correction whose energies are discarded.

    Ok((evaluation, gpu_time_ms.get()))
}

fn atomic_number(symbol: &str) -> Option<u8> {
    Some(match symbol {
        "H" => 1,
        "Li" => 3,
        "Be" => 4,
        "B" => 5,
        "C" => 6,
        "N" => 7,
        "O" => 8,
        "F" => 9,
        "Na" => 11,
        "Mg" => 12,
        "Al" => 13,
        "Si" => 14,
        "P" => 15,
        "S" => 16,
        "Cl" => 17,
        "K" => 19,
        "Ca" => 20,
        "Sc" => 21,
        "Ti" => 22,
        "V" => 23,
        "Cr" => 24,
        "Mn" => 25,
        "Fe" => 26,
        "Co" => 27,
        "Ni" => 28,
        "Cu" => 29,
        "Zn" => 30,
        "Ga" => 31,
        "Ge" => 32,
        "As" => 33,
        "Se" => 34,
        "Br" => 35,
        "Rb" => 37,
        "Sr" => 38,
        "Cd" => 48,
        "In" => 49,
        "Sn" => 50,
        "Sb" => 51,
        "Te" => 52,
        "I" => 53,
        _ => return None,
    })
}

fn apply_grid_results(
    database_path: &Path,
    run_id: Uuid,
    snapshot: &MolecularSnapshotRef,
    source_rows: &[GridAlignmentSourceRow],
    results: &[GridSemiempiricalRow],
    method: GridSemiempiricalMethod,
    backend: &'static str,
    host_time_ms: u64,
    gpu_time_ms: u64,
    artifact_id: Uuid,
    artifact_manifest_sha256: &str,
) -> ComputeResult<()> {
    let settings = serde_json::json!({
        "method": method.display_name,
        "scf": {
            "maxIterations": SemiempiricalScfOptions::default().max_iterations,
            "densityTolerance": SemiempiricalScfOptions::default().density_tolerance,
            "diisHistory": SemiempiricalScfOptions::default().max_diis_history,
        },
    });
    let normalized_settings_sha256 = sha256(
        &serde_json::to_vec(&settings)
            .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?,
    );
    let mut values = Vec::new();
    for (source, result) in source_rows.iter().zip(results) {
        let mut push = |value_id: &str, value: GridAnalysisValue| {
            values.push(GridAnalysisValueInput {
                molecule_id: source.row_id,
                source_index: source.source_index,
                molecule_content_sha256: source.molecule_content_sha256.clone(),
                value_id: value_id.into(),
                value,
            });
        };
        push(
            &method.column("Status"),
            GridAnalysisValue::Text(
                if result.converged {
                    "converged"
                } else {
                    "failed"
                }
                .into(),
            ),
        );
        if let Some(value) = result.electronic_energy_ev.filter(|_| result.converged) {
            push(
                &method.column("ElectronicEnergyEv"),
                GridAnalysisValue::Real(value),
            );
        }
        if let Some(value) = result.nuclear_energy_ev.filter(|_| result.converged) {
            push(
                &method.column("NuclearEnergyEv"),
                GridAnalysisValue::Real(value),
            );
        }
        if let Some(value) = result.total_energy_ev.filter(|_| result.converged) {
            push(
                &method.column("TotalEnergyEv"),
                GridAnalysisValue::Real(value),
            );
        }
        if let Some(value) = result.iterations {
            push(
                &method.column("ScfIterations"),
                GridAnalysisValue::Integer(value as i64),
            );
        }
        if let Some(charges) = result.atomic_charges.as_ref().filter(|_| result.converged) {
            push(
                &method.column("AtomicCharges"),
                GridAnalysisValue::Text(
                    serde_json::to_string(charges)
                        .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?,
                ),
            );
        }
        if let Some(error) = &result.error {
            push(
                &method.column("Error"),
                GridAnalysisValue::Text(error.clone()),
            );
        }
    }
    apply_analysis_run(
        database_path,
        &GridAnalysisApplyInput {
            run_id,
            workflow_template: WorkflowTemplateId::SemiempiricalV1,
            document_fingerprint_sha256: snapshot.frozen_source.document_fingerprint_sha256.clone(),
            source_revision: snapshot.frozen_source.source_revision,
            snapshot_id: snapshot.snapshot_id,
            snapshot_sha256: snapshot.snapshot_sha256.clone(),
            normalized_settings_sha256,
            maturity: CapabilityMaturity::Experimental,
            representative_policy: RepresentativePolicy::NotApplicable,
            provenance: serde_json::json!({
                "backend": backend,
                "hostTimeMs": host_time_ms,
                "gpuTimeMs": gpu_time_ms,
                "cpuParity": if backend == "nativeMetalScfHybrid" { "passedPerScfKernel" } else { "notApplicable" },
                "precisionPolicy": if backend == "nativeMetalScfHybrid" { "float32MetalWithAdaptiveFloat64Polish" } else { "float64Cpu" },
                "pairPreparation": if backend == "nativeMetalScfHybrid" { "metalLocalIntegralsAndRotation" } else { "float64Cpu" },
                "pythonRuntimeRequired": false,
                "method": method.display_name,
                "chargeModel": "molfile formal charge; valence population analysis",
                "upstream": "https://github.com/guillaume-osmo/mlxmolkit",
            }),
            created_at_ms: now_ms(),
            values,
            artifacts: vec![GridAnalysisArtifactInput {
                artifact_id,
                role: "semiempiricalResult".into(),
                manifest_sha256: artifact_manifest_sha256.into(),
            }],
        },
    )
    .map_err(ComputeCoordinatorError::Validation)
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn normalizes_selection_and_maps_the_supported_domain() {
        assert_eq!(normalized_indexes(&[2, 1, 2]).unwrap(), [1, 2]);
        assert_eq!(atomic_number("Br"), Some(35));
        assert_eq!(atomic_number("Si"), Some(14));
        assert_eq!(atomic_number("Au"), None);
        assert!(normalized_indexes(&[]).is_err());
        assert_eq!(
            GridSemiempiricalMethod::parse("PM6_SP").unwrap().method,
            SemiempiricalMethod::Pm6Sp
        );
        assert_eq!(
            GridSemiempiricalMethod::parse("AM1*")
                .unwrap()
                .column_prefix,
            "am1Star"
        );
        assert_eq!(
            GridSemiempiricalMethod::parse("PM6_D").unwrap().method,
            SemiempiricalMethod::Pm6D
        );
        assert_eq!(
            GridSemiempiricalMethod::parse("PM6_D3H4").unwrap().method,
            SemiempiricalMethod::Pm6D3H4
        );
    }

    #[test]
    fn cancellation_after_first_molecule_preserves_its_progress_and_stops_the_batch() {
        let completed = std::cell::RefCell::new(Vec::new());
        let error = execute_semiempirical_rows(
            None,
            None,
            &GridSemiempiricalRequest {
                document_id: "test".into(),
                source_indexes: vec![0, 1],
                method: "RM1".into(),
            },
            Uuid::new_v4(),
            vec![water_row(), water_row()],
            &|count, row| {
                if let Some(row) = row {
                    completed.borrow_mut().push(row);
                }
                if count == 1 {
                    Err(ComputeCoordinatorError::Cancelled)
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();
        assert!(matches!(error, ComputeCoordinatorError::Cancelled));
        let rows = completed.borrow();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["converged"], true);
    }

    #[test]
    fn evaluates_explicit_water_from_a_grid_molfile() {
        let row = water_row();
        for method in [
            "RM1", "AM1", "PM3", "PM6", "PM6_D", "PM6_D3H4", "PM6_SP", "AM1*",
        ] {
            let method = GridSemiempiricalMethod::parse(method).unwrap();
            let (result, gpu_time_ms) =
                evaluate_row_inner(&row, method, None, None, Uuid::new_v4(), &|| Ok(()))
                    .expect("evaluate water");
            assert_eq!(gpu_time_ms, 0);
            assert!(result.converged, "{} did not converge", method.display_name);
            assert!(result.total_energy_ev.unwrap().is_finite());
            assert!(result.atomic_charges.unwrap().iter().sum::<f64>().abs() < 1.0e-8);
        }
        for method in ["AM1", "PM3", "PM6_SP"] {
            let method = GridSemiempiricalMethod::parse(method).unwrap();
            let (result, _) = evaluate_row_inner(
                &hydrogen_chloride_row(),
                method,
                None,
                None,
                Uuid::new_v4(),
                &|| Ok(()),
            )
            .expect("evaluate extended element domain");
            assert!(result.converged, "{} did not converge", method.display_name);
            assert!(result.atomic_charges.unwrap().iter().sum::<f64>().abs() < 1.0e-8);
        }
    }

    #[test]
    #[ignore = "manual real-GPU smoke; set BURETTE_METAL_RUNTIME_ROOT"]
    fn evaluates_explicit_water_with_metal_scf_kernels() {
        let root = std::env::var_os("BURETTE_METAL_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("BURETTE_METAL_RUNTIME_ROOT must name a packaged runtime");
        let runtime = MetalTanimotoRuntime::load(&root, &"0".repeat(64))
            .expect("load verified Metal runtime");
        let classified = execute_semiempirical_rows(
            Some(&runtime),
            None,
            &GridSemiempiricalRequest {
                document_id: "metal-backend-classification".into(),
                source_indexes: vec![0],
                method: "RM1".into(),
            },
            Uuid::new_v4(),
            vec![water_row()],
            &|_, _| Ok(()),
        )
        .expect("evaluate and classify Metal result");
        assert_eq!(classified.backend, "nativeMetalScfHybrid");
        for method in [
            "RM1", "AM1", "PM3", "PM6", "PM6_D", "PM6_D3H4", "PM6_SP", "AM1*",
        ] {
            let method = GridSemiempiricalMethod::parse(method).unwrap();
            let (result, _) = evaluate_row_inner(
                &water_row(),
                method,
                Some(&runtime),
                None,
                Uuid::new_v4(),
                &|| Ok(()),
            )
            .expect("evaluate water on Metal");
            assert!(result.converged, "{} did not converge", method.display_name);
            assert!(result.atomic_charges.unwrap().iter().sum::<f64>().abs() < 1.0e-6);
        }
        for method in ["AM1", "PM3", "PM6_SP"] {
            let method = GridSemiempiricalMethod::parse(method).unwrap();
            let (result, _) = evaluate_row_inner(
                &hydrogen_chloride_row(),
                method,
                Some(&runtime),
                None,
                Uuid::new_v4(),
                &|| Ok(()),
            )
            .expect("evaluate extended element domain on Metal");
            assert!(result.converged);
        }
        let method = GridSemiempiricalMethod::parse("PM6_D3H4").unwrap();
        let (result, _) = evaluate_row_inner(
            &hydrogen_sulfide_row(),
            method,
            Some(&runtime),
            None,
            Uuid::new_v4(),
            &|| Ok(()),
        )
        .expect("evaluate full-d hydrogen sulfide on Metal");
        assert!(result.converged);
        assert!(result.total_energy_ev.unwrap().is_finite());
    }

    #[test]
    fn writeback_keeps_frozen_identity_and_excludes_unconverged_energies() {
        use crate::preview::{
            grid_database::open_grid_database,
            grid_snapshot::{freeze_grid_scope, SnapshotPublicationRoot},
            grid_store::{alignment_source_rows_by_indices, build_grid_store},
        };
        use burette_compute_protocol::AllGridScope;
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("burette-energy-writeback-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("grid")).unwrap();
        let sdf = format!(
            "{}\n$$$$\n{}\n$$$$\n",
            water_row().molblock.unwrap(),
            water_row().molblock.unwrap()
        );
        let handle = build_grid_store(&root.join("grid"), "sdf", sdf.as_bytes())
            .unwrap()
            .unwrap();
        let db = &handle.database_path;
        let publication = SnapshotPublicationRoot::create(&root.join("snapshots")).unwrap();
        let frozen = freeze_grid_scope(
            db,
            &GridScope::All(AllGridScope {}),
            &publication,
            Uuid::new_v4(),
            Uuid::new_v4(),
            now_ms(),
        )
        .unwrap();
        let rows = alignment_source_rows_by_indices(db, &[0, 1]).unwrap();
        let mut result = execute_semiempirical_rows(
            None,
            None,
            &GridSemiempiricalRequest {
                document_id: "water".into(),
                source_indexes: vec![0, 1],
                method: "RM1".into(),
            },
            Uuid::new_v4(),
            rows.clone(),
            &|_, _| Ok(()),
        )
        .unwrap();
        result.rows[1].converged = false;
        result.rows[1].error = Some("SCF reached the iteration limit".into());
        apply_grid_semiempirical_result(
            db,
            &frozen.reference,
            &rows,
            &result,
            Uuid::new_v4(),
            &"a".repeat(64),
        )
        .unwrap();
        let conn = open_grid_database(db).unwrap();
        let identity: (String, String, u64) = conn
            .query_row(
                "select snapshot_id, snapshot_sha256, source_revision from analysis_runs",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            identity,
            (
                frozen.reference.snapshot_id.to_string(),
                frozen.reference.snapshot_sha256.clone(),
                frozen.reference.frozen_source.source_revision
            )
        );
        let values: Vec<(u64, String)> = conn.prepare("select source_index, value_id from analysis_values where value_real is not null order by value_id").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(values.len(), 3);
        assert!(values.iter().all(|(index, _)| *index == 0));
        result.run_id = Uuid::new_v4();
        conn.execute(
            "update grid_metadata set source_revision = source_revision + 1",
            [],
        )
        .unwrap();
        assert!(apply_grid_semiempirical_result(
            db,
            &frozen.reference,
            &rows,
            &result,
            Uuid::new_v4(),
            &"b".repeat(64)
        )
        .is_err());
        let count: usize = conn
            .query_row("select count(*) from analysis_runs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "stale writeback is atomic");
        conn.execute(
            "update molecules set molecule_content_sha256 = ?1 where source_index = 0",
            [&"c".repeat(64)],
        )
        .unwrap();
        assert!(super::super::analysis_snapshot::resolve_analysis_source_rows(db, &rows).is_err());
        drop(conn);
        drop(frozen);
        drop(publication);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn water_row() -> GridAlignmentSourceRow {
        GridAlignmentSourceRow {
            row_id: 1,
            source_index: 0,
            molecule_content_sha256: "0".repeat(64),
            name: "water".into(),
            molblock: Some(
                "water\n  Burette\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    0.9584    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.2396    0.9275    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  1  3  1  0  0  0  0\nM  END"
                    .into(),
            ),
        }
    }

    fn hydrogen_sulfide_row() -> GridAlignmentSourceRow {
        GridAlignmentSourceRow {
            row_id: 2,
            source_index: 1,
            molecule_content_sha256: "1".repeat(64),
            name: "hydrogen sulfide".into(),
            molblock: Some(
                "hydrogen sulfide\n  Burette\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 S   0  0  0  0  0  0  0  0  0  0  0  0\n    1.3360    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.4450    1.2600    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  1  3  1  0  0  0  0\nM  END"
                    .into(),
            ),
        }
    }

    fn hydrogen_chloride_row() -> GridAlignmentSourceRow {
        GridAlignmentSourceRow {
            row_id: 3,
            source_index: 2,
            molecule_content_sha256: "2".repeat(64),
            name: "hydrogen chloride".into(),
            molblock: Some(
                "hydrogen chloride\n  Burette\n\n  2  1  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n    1.2746    0.0000    0.0000 Cl  0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\nM  END"
                    .into(),
            ),
        }
    }
}
