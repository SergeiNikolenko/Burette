use std::{path::Path, time::Instant};

use burrete_compute_core::{
    evaluate_rm1, SemiempiricalAtom, SemiempiricalMolecule, SemiempiricalScfOptions,
    SemiempiricalScfStatus,
};
use burrete_compute_protocol::{CapabilityMaturity, RepresentativePolicy, WorkflowTemplateId};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::preview::{
    grid_analysis::{
        apply_analysis_run, GridAnalysisApplyInput, GridAnalysisValue, GridAnalysisValueInput,
    },
    grid_database::open_grid_database,
    grid_identity,
    grid_store::{alignment_source_rows_by_indices, GridAlignmentSourceRow},
};

use super::{
    alignment_workflow::parse_molfile,
    error::{ComputeCoordinatorError, ComputeResult},
};

const MAX_SEMIEMPIRICAL_MOLECULES: usize = 256;

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
    pub(crate) method: &'static str,
    pub(crate) rows: Vec<GridSemiempiricalRow>,
    pub(crate) host_time_ms: u64,
    pub(crate) backend: &'static str,
    pub(crate) grid_applied: bool,
}

pub(crate) fn execute_grid_semiempirical(
    database_path: &Path,
    request: &GridSemiempiricalRequest,
) -> ComputeResult<GridSemiempiricalResult> {
    if !request.method.trim().eq_ignore_ascii_case("rm1") {
        return Err(ComputeCoordinatorError::Validation(
            "Only RM1 is available in the current native semi-empirical evaluator".into(),
        ));
    }
    let indexes = normalized_indexes(&request.source_indexes)?;
    let source_rows = alignment_source_rows_by_indices(database_path, &indexes)
        .map_err(ComputeCoordinatorError::Validation)?;
    if source_rows.len() != indexes.len() {
        return Err(ComputeCoordinatorError::Validation(
            "One or more selected Grid rows no longer exist".into(),
        ));
    }

    let started = Instant::now();
    let rows = source_rows.iter().map(evaluate_row).collect::<Vec<_>>();
    let host_time_ms = started.elapsed().as_millis() as u64;
    let run_id = Uuid::new_v4();
    apply_grid_results(database_path, run_id, &source_rows, &rows, host_time_ms)?;
    Ok(GridSemiempiricalResult {
        run_id,
        method: "RM1",
        rows,
        host_time_ms,
        backend: "nativeCpuReference",
        grid_applied: true,
    })
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

fn evaluate_row(row: &GridAlignmentSourceRow) -> GridSemiempiricalRow {
    match evaluate_row_inner(row) {
        Ok(result) => result,
        Err(error) => GridSemiempiricalRow {
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
    }
}

fn evaluate_row_inner(row: &GridAlignmentSourceRow) -> Result<GridSemiempiricalRow, String> {
    let molblock = row
        .molblock
        .as_deref()
        .ok_or_else(|| "molecule has no molfile coordinates".to_string())?;
    let parsed = parse_molfile(molblock)?;
    let atoms = parsed
        .symbols
        .iter()
        .zip(&parsed.atoms)
        .map(|(symbol, atom)| {
            Ok(SemiempiricalAtom {
                atomic_number: atomic_number(symbol)
                    .ok_or_else(|| format!("element {symbol} is not parameterized for RM1"))?,
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
    let molecule = SemiempiricalMolecule::rm1(atoms, charge).map_err(|error| error.to_string())?;
    let evaluation = evaluate_rm1(&molecule, SemiempiricalScfOptions::default())
        .map_err(|error| error.to_string())?;
    let converged = evaluation.scf.status == SemiempiricalScfStatus::Converged;
    Ok(GridSemiempiricalRow {
        source_index: row.source_index,
        name: row.name.clone(),
        electronic_energy_ev: Some(evaluation.electronic_energy_ev),
        nuclear_energy_ev: Some(evaluation.nuclear_energy_ev),
        total_energy_ev: Some(evaluation.total_energy_ev),
        atomic_charges: Some(evaluation.atomic_charges),
        converged,
        iterations: Some(evaluation.scf.iterations),
        error: (!converged).then(|| "SCF reached the iteration limit".into()),
    })
}

fn atomic_number(symbol: &str) -> Option<u8> {
    Some(match symbol {
        "H" => 1,
        "C" => 6,
        "N" => 7,
        "O" => 8,
        "F" => 9,
        "P" => 15,
        "S" => 16,
        "Cl" => 17,
        "Br" => 35,
        "I" => 53,
        _ => return None,
    })
}

fn apply_grid_results(
    database_path: &Path,
    run_id: Uuid,
    source_rows: &[GridAlignmentSourceRow],
    results: &[GridSemiempiricalRow],
    host_time_ms: u64,
) -> ComputeResult<()> {
    let connection: Connection =
        open_grid_database(database_path).map_err(ComputeCoordinatorError::Validation)?;
    let identity = grid_identity::read_source_identity(&connection)
        .map_err(ComputeCoordinatorError::Validation)?;
    let settings = serde_json::json!({
        "method": "RM1",
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
    let snapshot_sha256 = sha256(
        &source_rows
            .iter()
            .flat_map(|row| row.molecule_content_sha256.as_bytes())
            .copied()
            .collect::<Vec<_>>(),
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
            "rm1Status",
            GridAnalysisValue::Text(
                if result.converged {
                    "converged"
                } else {
                    "failed"
                }
                .into(),
            ),
        );
        if let Some(value) = result.electronic_energy_ev {
            push("rm1ElectronicEnergyEv", GridAnalysisValue::Real(value));
        }
        if let Some(value) = result.nuclear_energy_ev {
            push("rm1NuclearEnergyEv", GridAnalysisValue::Real(value));
        }
        if let Some(value) = result.total_energy_ev {
            push("rm1TotalEnergyEv", GridAnalysisValue::Real(value));
        }
        if let Some(value) = result.iterations {
            push("rm1ScfIterations", GridAnalysisValue::Integer(value as i64));
        }
        if let Some(charges) = &result.atomic_charges {
            push(
                "rm1AtomicCharges",
                GridAnalysisValue::Text(
                    serde_json::to_string(charges)
                        .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?,
                ),
            );
        }
        if let Some(error) = &result.error {
            push("rm1Error", GridAnalysisValue::Text(error.clone()));
        }
    }
    apply_analysis_run(
        database_path,
        &GridAnalysisApplyInput {
            run_id,
            workflow_template: WorkflowTemplateId::SemiempiricalV1,
            document_fingerprint_sha256: identity.document_fingerprint_sha256,
            source_revision: identity.source_revision,
            snapshot_id: Uuid::new_v4(),
            snapshot_sha256,
            normalized_settings_sha256,
            maturity: CapabilityMaturity::Experimental,
            representative_policy: RepresentativePolicy::NotApplicable,
            provenance: serde_json::json!({
                "backend": "nativeCpuReference",
                "hostTimeMs": host_time_ms,
                "pythonRuntimeRequired": false,
                "method": "RM1",
                "chargeModel": "molfile formal charge; valence population analysis",
                "upstream": "https://github.com/guillaume-osmo/mlxmolkit",
            }),
            created_at_ms: now_ms(),
            values,
            artifacts: Vec::new(),
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
    use super::*;

    #[test]
    fn normalizes_selection_and_maps_the_rm1_domain() {
        assert_eq!(normalized_indexes(&[2, 1, 2]).unwrap(), [1, 2]);
        assert_eq!(atomic_number("Br"), Some(35));
        assert_eq!(atomic_number("Si"), None);
        assert!(normalized_indexes(&[]).is_err());
    }

    #[test]
    fn evaluates_explicit_water_from_a_grid_molfile() {
        let row = GridAlignmentSourceRow {
            row_id: 1,
            source_index: 0,
            molecule_content_sha256: "0".repeat(64),
            name: "water".into(),
            molblock: Some(
                "water\n  Burrete\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n    0.9584    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.2396    0.9275    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  1  3  1  0  0  0  0\nM  END"
                    .into(),
            ),
        };
        let result = evaluate_row_inner(&row).expect("evaluate water");
        assert!(result.converged);
        assert!(result.total_energy_ev.unwrap().is_finite());
        assert!(result.atomic_charges.unwrap().iter().sum::<f64>().abs() < 1.0e-8);
    }
}
