use burette_compute_core::{evaluate_etk_geometry, EtkGeometryTerms};

use super::{
    conformer_executor::ConformerDistanceComputation,
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
    if !distance.etk_cpu_reference_validated {
        return Err(protocol(
            "conformer ETK energies were not checked against the CPU reference",
        ));
    }
    if stereo.failure_flags != distance.retry_stereo_failure_flags {
        return Err(protocol(
            "conformer retry and final stereo validation flags differ",
        ));
    }
    let conformer_count = distance.conformer_count();
    let passed_count = stereo.passed_count;
    Ok(ConformerReferenceValidation {
        conformer_count,
        passed_count,
        failed_count: conformer_count - passed_count,
    })
}

pub(crate) fn validate_etk_energy_batch(
    positions: &[[f32; 4]],
    atom_count: usize,
    observed_energies: &[f32],
    terms: EtkGeometryTerms<'_>,
) -> ComputeResult<()> {
    if atom_count == 0 || positions.len() != atom_count.saturating_mul(observed_energies.len()) {
        return Err(protocol(
            "conformer ETK reference batch has inconsistent dimensions",
        ));
    }
    for (conformer, conformer_positions) in positions.chunks_exact(atom_count).enumerate() {
        let reference = evaluate_etk_geometry(
            conformer_positions,
            terms.torsions,
            terms.impropers,
            terms.distances,
        )
        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
        let observed = observed_energies[conformer];
        let tolerance = ENERGY_ABSOLUTE_TOLERANCE
            + ENERGY_RELATIVE_TOLERANCE * reference.energy.abs().max(observed.abs());
        let delta = (reference.energy - observed).abs();
        if delta > tolerance {
            return Err(ComputeCoordinatorError::Validation(format!(
                "conformer {conformer} ETK energy differs from the CPU reference: observed={observed:.6}, reference={:.6}, delta={delta:.6}, tolerance={tolerance:.6}",
                reference.energy,
            )));
        }
    }
    Ok(())
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_the_energy_at_the_etk_geometry_boundary() {
        let positions = [[0.0, 0.0, 0.0, 0.0]];
        let terms = EtkGeometryTerms {
            torsions: &[],
            impropers: &[],
            distances: &[],
        };
        assert!(validate_etk_energy_batch(&positions, 1, &[0.0], terms).is_ok());
        let error = validate_etk_energy_batch(&positions, 1, &[1.0], terms)
            .expect_err("mismatched ETK energy must fail closed");
        assert!(error.to_string().contains("observed=1.000000"));
    }
}
