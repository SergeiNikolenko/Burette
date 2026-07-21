use burrete_compute_core::evaluate_etk_geometry;

use super::{
    conformer_executor::{local_etk_terms, ConformerDistanceComputation},
    conformer_stereo_executor::ConformerStereoComputation,
    error::{ComputeCoordinatorError, ComputeResult},
};

const ENERGY_ABSOLUTE_TOLERANCE: f32 = 2.0e-3;
const ENERGY_RELATIVE_TOLERANCE: f32 = 2.0e-3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ConformerReferenceValidation {
    pub(crate) conformer_count: usize,
    pub(crate) passed_count: usize,
    pub(crate) failed_count: usize,
}

pub(crate) fn validate_conformer_reference(
    distance: &ConformerDistanceComputation,
    stereo: &ConformerStereoComputation,
) -> ComputeResult<ConformerReferenceValidation> {
    if stereo.failure_flags != distance.retry_stereo_failure_flags {
        return Err(protocol(
            "conformer retry and final stereo validation flags differ",
        ));
    }
    for conformer in 0..distance.conformer_count() {
        let record = distance.conformer_molecule_indices[conformer] as usize;
        let terms = local_etk_terms(&distance.deferred, record)?;
        let start = distance.conformer_atom_starts[conformer] as usize;
        let end = distance.conformer_atom_starts[conformer + 1] as usize;
        let positions = distance.positions[start..end]
            .iter()
            .map(|position| [position[0], position[1], position[2], 0.0])
            .collect::<Vec<_>>();
        let reference = evaluate_etk_geometry(
            &positions,
            &terms.torsions,
            &terms.impropers,
            &terms.distances,
        )
        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
        let observed = distance.etk_energies[conformer];
        let tolerance = ENERGY_ABSOLUTE_TOLERANCE
            + ENERGY_RELATIVE_TOLERANCE * reference.energy.abs().max(observed.abs());
        if (reference.energy - observed).abs() > tolerance {
            return Err(ComputeCoordinatorError::Validation(format!(
                "conformer {conformer} ETK energy differs from the CPU reference"
            )));
        }
    }
    let conformer_count = distance.conformer_count();
    let passed_count = stereo.passed_count;
    Ok(ConformerReferenceValidation {
        conformer_count,
        passed_count,
        failed_count: conformer_count - passed_count,
    })
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}
