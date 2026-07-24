use burette_compute_core::{
    validate_conformer_stereo, ChiralVolumeConstraint, TetrahedralConstraint,
};
use burette_compute_metal::MetalTanimotoRuntime;
use burette_compute_protocol::Backend;

use super::{
    conformer_executor::ConformerDistanceComputation,
    error::{ComputeCoordinatorError, ComputeResult},
};

#[derive(Debug)]
pub(crate) struct ConformerStereoComputation {
    pub(crate) failure_flags: Vec<u32>,
    pub(crate) passed_count: usize,
    pub(crate) gpu_time_ms: Option<u64>,
}

pub(crate) fn execute_conformer_stereo_validation(
    distance: &ConformerDistanceComputation,
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    max_memory_bytes: u64,
) -> ComputeResult<ConformerStereoComputation> {
    let mut failure_flags = Vec::new();
    failure_flags
        .try_reserve_exact(distance.conformer_count())
        .map_err(|_| unavailable("cannot allocate conformer stereo results"))?;
    let mut total_gpu_time = 0_u64;
    let mut conformer = 0;
    while conformer < distance.conformer_count() {
        let record = distance.conformer_molecule_indices[conformer] as usize;
        let first = conformer;
        while conformer < distance.conformer_count()
            && distance.conformer_molecule_indices[conformer] as usize == record
        {
            conformer += 1;
        }
        let atom_start = *distance
            .deferred
            .molecule_atom_starts
            .get(record)
            .ok_or_else(|| protocol("conformer stereo record atom start is missing"))?;
        let atom_end = *distance
            .deferred
            .molecule_atom_starts
            .get(record + 1)
            .ok_or_else(|| protocol("conformer stereo record atom end is missing"))?;
        let atom_count = u32::try_from(atom_end - atom_start)
            .map_err(|_| protocol("conformer stereo atom count exceeds uint32"))?;
        let chiral = local_chiral(distance, record, atom_start)?;
        let tetrahedral = local_tetrahedral(distance, record, atom_start)?;
        let position_start = distance.conformer_atom_starts[first] as usize;
        let position_end = distance.conformer_atom_starts[conformer] as usize;
        let positions = distance.positions[position_start..position_end]
            .iter()
            .map(|position| [position[0], position[1], position[2], 0.0])
            .collect::<Vec<_>>();
        match backend {
            Backend::NativeMetal => {
                let runtime = metal
                    .ok_or_else(|| unavailable("admitted Metal stereo runtime is unavailable"))?;
                let result = runtime
                    .validate_stereo_profiled(
                        &positions,
                        atom_count,
                        &chiral,
                        &tetrahedral,
                        max_memory_bytes,
                    )
                    .map_err(|error| {
                        ComputeCoordinatorError::Validation(format!(
                            "native Metal stereo validation failed: {error}"
                        ))
                    })?;
                total_gpu_time = total_gpu_time
                    .checked_add(result.gpu_time_ms)
                    .ok_or_else(|| protocol("conformer stereo GPU time overflowed"))?;
                failure_flags.extend(result.failure_flags);
            }
            Backend::ReferenceCpu => {
                for position in positions.chunks_exact(atom_count as usize) {
                    failure_flags.push(
                        validate_conformer_stereo(position, &chiral, &tetrahedral).map_err(
                            |error| ComputeCoordinatorError::Validation(error.to_string()),
                        )?,
                    );
                }
            }
            other => {
                return Err(protocol(format!(
                    "unsupported conformer stereo backend: {other:?}"
                )))
            }
        }
    }
    if failure_flags.len() != distance.conformer_count() {
        return Err(protocol("conformer stereo result count is inconsistent"));
    }
    if failure_flags != distance.retry_stereo_failure_flags {
        return Err(protocol(
            "final conformer stereo validation differs from retry validation",
        ));
    }
    let passed_count = failure_flags.iter().filter(|flags| **flags == 0).count();
    Ok(ConformerStereoComputation {
        failure_flags,
        passed_count,
        gpu_time_ms: (backend == Backend::NativeMetal).then_some(total_gpu_time),
    })
}

fn local_chiral(
    distance: &ConformerDistanceComputation,
    record: usize,
    atom_start: u64,
) -> ComputeResult<Vec<ChiralVolumeConstraint>> {
    let range = term_range(&distance.deferred.chiral_term_starts, record, "chiral")?;
    range
        .map(|term| {
            Ok(ChiralVolumeConstraint {
                atoms: local_indices(distance.deferred.chiral_atom_quads[term], atom_start)?,
                lower: distance.deferred.chiral_volume_bounds[term][0],
                upper: distance.deferred.chiral_volume_bounds[term][1],
            })
        })
        .collect()
}

fn local_tetrahedral(
    distance: &ConformerDistanceComputation,
    record: usize,
    atom_start: u64,
) -> ComputeResult<Vec<TetrahedralConstraint>> {
    let range = term_range(
        &distance.deferred.stereo_center_starts,
        record,
        "tetrahedral",
    )?;
    range
        .map(|term| {
            Ok(TetrahedralConstraint {
                atoms: local_indices(distance.deferred.stereo_atom_quints[term], atom_start)?,
                in_fused_small_ring: match distance.deferred.stereo_flags[term] {
                    0 => false,
                    1 => true,
                    _ => return Err(protocol("conformer stereo flag is not canonical")),
                },
            })
        })
        .collect()
}

fn term_range(starts: &[u64], record: usize, label: &str) -> ComputeResult<std::ops::Range<usize>> {
    let start = *starts
        .get(record)
        .ok_or_else(|| protocol(format!("conformer {label} term start is missing")))?;
    let end = *starts
        .get(record + 1)
        .ok_or_else(|| protocol(format!("conformer {label} term end is missing")))?;
    Ok(start as usize..end as usize)
}

fn local_indices<const N: usize>(indices: [u32; N], atom_start: u64) -> ComputeResult<[u32; N]> {
    indices
        .map(|index| {
            u64::from(index)
                .checked_sub(atom_start)
                .and_then(|index| u32::try_from(index).ok())
                .ok_or_else(|| protocol("conformer stereo atom index precedes its molecule"))
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?
        .try_into()
        .map_err(|_| protocol("conformer stereo atom index width changed"))
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}
