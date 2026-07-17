use std::num::NonZeroU32;

use burrete_compute_core::{
    initialize_conformer_positions, optimize_distance_geometry, optimize_etk_geometry,
    optimize_mmff, plan_conformer_batches, validate_conformer_stereo, ChiralVolumeConstraint,
    ConformerDistanceEngine, ConformerEnginePackArrays, ConformerMoleculeWork,
    ConformerSchedulingOptions, ConformerWorkIdentity, DistanceConstraint,
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, EtkDistanceConstraint,
    EtkGeometryTerms, EtkImproperConstraint, EtkTorsionConstraint, MmffOptimizerKind,
    NativeMmffParameters, TetrahedralConstraint,
};
use burrete_compute_metal::{MetalDistanceEmbedding, MetalTanimotoRuntime};
use burrete_compute_protocol::{Backend, ConformerInitialization, ConformerV1SubmitRequest};
use uuid::Uuid;

use super::{
    conformer_plan::ConformerMoleculeIdentity,
    error::{ComputeCoordinatorError, ComputeResult},
    service::ComputeServiceClient,
};

const LBFGS_HISTORY: u32 = 8;
const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;

#[derive(Debug)]
pub(crate) struct ConformerDistanceComputation {
    pub(crate) distance_engine: ConformerDistanceEngine,
    #[allow(dead_code, reason = "consumed by the next ETK/stereo execution stage")]
    pub(crate) deferred: ConformerDeferredConstraints,
    pub(crate) conformer_atom_starts: Vec<u64>,
    pub(crate) conformer_molecule_indices: Vec<u32>,
    pub(crate) conformer_ordinals: Vec<u32>,
    pub(crate) embedding_attempt_counts: Vec<u16>,
    pub(crate) embedding_energies: Vec<f32>,
    pub(crate) embedding_statuses: Vec<u8>,
    pub(crate) etk_energies: Vec<f32>,
    pub(crate) etk_statuses: Vec<u8>,
    pub(crate) mmff_energies: Vec<f32>,
    pub(crate) mmff_statuses: Vec<u8>,
    pub(crate) mmff_optimizer_kinds: Vec<u8>,
    pub(crate) retry_stereo_failure_flags: Vec<u32>,
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) seed_words: Vec<[u32; 4]>,
    pub(crate) gpu_time_ms: Option<u64>,
}

#[derive(Debug)]
#[allow(dead_code, reason = "consumed by the next ETK/stereo execution stage")]
pub(crate) struct ConformerDeferredConstraints {
    pub(crate) molecule_atom_starts: Vec<u64>,
    pub(crate) chiral_atom_quads: Vec<[u32; 4]>,
    pub(crate) chiral_term_starts: Vec<u64>,
    pub(crate) chiral_volume_bounds: Vec<[f32; 2]>,
    pub(crate) etk_distance_atom_pairs: Vec<[u32; 2]>,
    pub(crate) etk_distance_bounds: Vec<[f32; 2]>,
    pub(crate) etk_distance_kinds: Vec<u8>,
    pub(crate) etk_distance_term_starts: Vec<u64>,
    pub(crate) etk_distance_weights: Vec<f32>,
    pub(crate) improper_atom_quads: Vec<[u32; 4]>,
    pub(crate) improper_term_starts: Vec<u64>,
    pub(crate) improper_weights: Vec<f32>,
    pub(crate) stereo_atom_quints: Vec<[u32; 5]>,
    pub(crate) stereo_center_starts: Vec<u64>,
    pub(crate) stereo_flags: Vec<u8>,
    pub(crate) torsion_atom_quads: Vec<[u32; 4]>,
    pub(crate) torsion_coefficients: Vec<[f32; 6]>,
    pub(crate) torsion_signs: Vec<[i8; 6]>,
    pub(crate) torsion_term_starts: Vec<u64>,
}

#[cfg(test)]
fn execute_conformer_distance_geometry(
    job_id: Uuid,
    request: &ConformerV1SubmitRequest,
    arrays: ConformerEnginePackArrays,
    identities: &[ConformerMoleculeIdentity],
    mmff_parameters: &[Option<NativeMmffParameters>],
    input_positions: &[Option<Vec<[f32; 4]>>],
    distance_backend: Backend,
    stereo_backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
) -> ComputeResult<ConformerDistanceComputation> {
    execute_conformer_distance_geometry_with_service(
        job_id,
        request,
        arrays,
        identities,
        mmff_parameters,
        input_positions,
        distance_backend,
        stereo_backend,
        metal,
        None,
    )
}

pub(crate) fn execute_conformer_distance_geometry_with_service(
    job_id: Uuid,
    request: &ConformerV1SubmitRequest,
    arrays: ConformerEnginePackArrays,
    identities: &[ConformerMoleculeIdentity],
    mmff_parameters: &[Option<NativeMmffParameters>],
    input_positions: &[Option<Vec<[f32; 4]>>],
    distance_backend: Backend,
    stereo_backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    compute_service: Option<&ComputeServiceClient>,
) -> ComputeResult<ConformerDistanceComputation> {
    if identities.len() != arrays.record_count()
        || mmff_parameters.len() != identities.len()
        || input_positions.len() != identities.len()
    {
        return Err(protocol(
            "conformer identity count differs from the extracted EnginePack",
        ));
    }
    let requested_mmff = match request.parameters.mmff_variant {
        burrete_compute_protocol::MmffVariant::Mmff94 => burrete_compute_core::MmffVariant::Mmff94,
        burrete_compute_protocol::MmffVariant::Mmff94s => {
            burrete_compute_core::MmffVariant::Mmff94s
        }
    };
    if mmff_parameters
        .iter()
        .flatten()
        .any(|parameters| parameters.parameters.variant != requested_mmff)
    {
        return Err(protocol(
            "extracted MMFF parameter variant differs from the admitted request",
        ));
    }
    let engine_pack_bytes = arrays
        .payload_bytes()
        .map_err(|error| protocol(error.to_string()))?;
    let ConformerEnginePackArrays {
        atomic_numbers,
        chiral_atom_quads,
        chiral_term_starts,
        chiral_volume_bounds,
        distance_atom_pairs,
        distance_bounds_squared,
        distance_term_starts,
        distance_weights,
        etk_distance_atom_pairs,
        etk_distance_bounds,
        etk_distance_kinds,
        etk_distance_term_starts,
        etk_distance_weights,
        formal_charges,
        improper_atom_quads,
        improper_term_starts,
        improper_weights,
        molecule_atom_starts,
        record_validity,
        stereo_atom_quints,
        stereo_center_starts,
        stereo_flags,
        torsion_atom_quads,
        torsion_coefficients,
        torsion_signs,
        torsion_term_starts,
    } = arrays;
    let deferred = ConformerDeferredConstraints {
        molecule_atom_starts: molecule_atom_starts.clone(),
        chiral_atom_quads,
        chiral_term_starts,
        chiral_volume_bounds,
        etk_distance_atom_pairs,
        etk_distance_bounds,
        etk_distance_kinds,
        etk_distance_term_starts,
        etk_distance_weights,
        improper_atom_quads,
        improper_term_starts,
        improper_weights,
        stereo_atom_quints,
        stereo_center_starts,
        stereo_flags,
        torsion_atom_quads,
        torsion_coefficients,
        torsion_signs,
        torsion_term_starts,
    };
    let engine = ConformerDistanceEngine::new(
        record_validity,
        molecule_atom_starts,
        atomic_numbers,
        formal_charges,
        distance_term_starts,
        distance_atom_pairs,
        distance_bounds_squared,
        distance_weights,
    )
    .map_err(|error| protocol(error.to_string()))?;
    if request.parameters.initialization == ConformerInitialization::InputGeometry {
        return optimize_input_geometries(
            request,
            engine,
            deferred,
            mmff_parameters,
            input_positions,
            distance_backend,
            metal,
            compute_service.map(|service| (service, job_id)),
        );
    }
    let conformer_count = NonZeroU32::new(request.parameters.conformers_per_molecule)
        .expect("validated conformer count is nonzero");
    let mut work = Vec::new();
    let mut valid_records = Vec::new();
    work.try_reserve_exact(engine.valid_record_count() as usize)
        .map_err(|_| unavailable("cannot allocate conformer work plan"))?;
    valid_records
        .try_reserve_exact(engine.valid_record_count() as usize)
        .map_err(|_| unavailable("cannot allocate conformer record map"))?;
    for (record_index, identity) in identities.iter().enumerate() {
        let Some(molecule) = engine
            .molecule(record_index as u64)
            .map_err(|error| protocol(error.to_string()))?
        else {
            continue;
        };
        work.push(ConformerMoleculeWork {
            source_record_id: identity.source_record_id,
            molecule_content_sha256: decode_sha256(&identity.molecule_content_sha256)?,
            atom_count: NonZeroU32::new(molecule.atomic_numbers.len() as u32)
                .expect("validated molecule has atoms"),
            conformer_count,
        });
        valid_records.push(record_index as u32);
    }
    let schedule = plan_conformer_batches(
        &work,
        ConformerSchedulingOptions {
            max_memory_bytes: request.limits.max_memory_bytes,
            resident_engine_bytes: engine_pack_bytes,
            max_conformers_per_batch: NonZeroU32::new(request.limits.max_conformers_per_batch)
                .expect("validated batch limit is nonzero"),
            lbfgs_history: NonZeroU32::new(LBFGS_HISTORY).expect("nonzero history"),
        },
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let working_memory = request
        .limits
        .max_memory_bytes
        .checked_sub(engine_pack_bytes)
        .and_then(|bytes| bytes.checked_sub(MEMORY_HEADROOM_BYTES))
        .ok_or_else(|| unavailable("conformer EnginePack leaves no numeric working memory"))?;
    let mut output = ConformerDistanceComputation::with_capacity(
        engine,
        deferred,
        schedule.conformer_count,
        work.iter()
            .map(|molecule| {
                u64::from(molecule.atom_count.get()) * u64::from(molecule.conformer_count.get())
            })
            .sum(),
    )?;
    let options = DistanceGeometryOptimizationOptions::default();
    let mut total_gpu_time = 0_u64;

    for batch in schedule.batches {
        for span in batch.spans {
            let work_index = span.molecule_index as usize;
            let record_index = valid_records[work_index];
            let molecule = output
                .distance_engine
                .molecule(u64::from(record_index))
                .map_err(|error| protocol(error.to_string()))?
                .expect("scheduler contains only valid records");
            let constraints = molecule.local_distance_constraints();
            let etk = local_etk_terms(&output.deferred, record_index as usize)?;
            let stereo = local_stereo_terms(&output.deferred, record_index as usize)?;
            let mmff = mmff_parameters[record_index as usize].as_ref();
            let identity = work[work_index];
            let count = span.conformer_count.get() as usize;
            let mut final_attempts = vec![0_u16; count];
            let mut final_energies = vec![0.0_f32; count];
            let mut final_statuses = vec![DistanceGeometryOptimizationStatus::MaxIterations; count];
            let mut final_etk_energies = vec![0.0_f32; count];
            let mut final_etk_statuses =
                vec![DistanceGeometryOptimizationStatus::MaxIterations; count];
            let mut final_mmff_energies = vec![0.0_f32; count];
            let mut final_mmff_statuses = vec![4_u8; count];
            let mut final_mmff_optimizers = vec![2_u8; count];
            let mut final_stereo_flags = vec![u32::MAX; count];
            let mut final_positions = vec![Vec::<[f32; 4]>::new(); count];
            let mut final_seeds = vec![[0_u32; 4]; count];
            let mut pending = (0..count).collect::<Vec<_>>();
            for retry_index in 0..request.parameters.max_attempts_per_conformer {
                if pending.is_empty() {
                    break;
                }
                let seeds = pending
                    .iter()
                    .map(|local| {
                        ConformerWorkIdentity {
                            job_id: *job_id.as_bytes(),
                            source_record_id: identity.source_record_id,
                            molecule_content_sha256: identity.molecule_content_sha256,
                            variant: request.parameters.variant,
                            conformer_index: span.first_conformer + *local as u32,
                            retry_index,
                        }
                        .seed_words()
                    })
                    .collect::<Vec<_>>();
                let mut attempt = embed(
                    distance_backend,
                    metal,
                    compute_service.map(|service| (service, job_id)),
                    &seeds,
                    molecule.atomic_numbers.len() as u32,
                    &constraints,
                    options,
                    working_memory,
                )?;
                let refinement = refine_etk(
                    distance_backend,
                    metal,
                    &attempt.positions,
                    molecule.atomic_numbers.len() as u32,
                    etk.as_terms(),
                    options,
                    working_memory,
                )?;
                let expected_positions = pending.len() * molecule.atomic_numbers.len();
                if refinement.positions.len() != expected_positions
                    || refinement.energies.len() != pending.len()
                    || refinement.statuses.len() != pending.len()
                {
                    return Err(protocol("conformer ETK result arrays are inconsistent"));
                }
                let mmff_refinement = refine_mmff(
                    distance_backend,
                    metal,
                    compute_service.map(|service| (service, job_id)),
                    &refinement.positions,
                    molecule.atomic_numbers.len() as u32,
                    mmff,
                    options,
                    working_memory,
                )?;
                if mmff_refinement.positions.len() != expected_positions
                    || mmff_refinement.energies.len() != pending.len()
                    || mmff_refinement.statuses.len() != pending.len()
                    || mmff_refinement.optimizers.len() != pending.len()
                {
                    return Err(protocol("conformer MMFF result arrays are inconsistent"));
                }
                let stereo_validation = validate_stereo_attempts(
                    stereo_backend,
                    metal,
                    &mmff_refinement.positions,
                    molecule.atomic_numbers.len() as u32,
                    &stereo.chiral,
                    &stereo.tetrahedral,
                    working_memory,
                )?;
                if stereo_validation.failure_flags.len() != pending.len() {
                    return Err(protocol(
                        "conformer stereo retry result count is inconsistent",
                    ));
                }
                attempt.positions = mmff_refinement.positions;
                total_gpu_time = total_gpu_time
                    .checked_add(attempt.gpu_time_ms.unwrap_or(0))
                    .and_then(|time| time.checked_add(refinement.gpu_time_ms.unwrap_or(0)))
                    .and_then(|time| time.checked_add(mmff_refinement.gpu_time_ms.unwrap_or(0)))
                    .and_then(|time| time.checked_add(stereo_validation.gpu_time_ms.unwrap_or(0)))
                    .ok_or_else(|| protocol("conformer GPU time overflowed"))?;
                let mut retry = Vec::new();
                for (attempt_index, local) in pending.into_iter().enumerate() {
                    let atom_count = molecule.atomic_numbers.len();
                    let start = attempt_index * atom_count;
                    let end = start + atom_count;
                    final_attempts[local] = retry_index + 1;
                    final_energies[local] = attempt.energies[attempt_index];
                    final_statuses[local] = attempt.statuses[attempt_index];
                    final_etk_energies[local] = refinement.energies[attempt_index];
                    final_etk_statuses[local] = refinement.statuses[attempt_index];
                    final_mmff_energies[local] = mmff_refinement.energies[attempt_index];
                    final_mmff_statuses[local] = mmff_refinement.statuses[attempt_index];
                    final_mmff_optimizers[local] = mmff_refinement.optimizers[attempt_index];
                    final_stereo_flags[local] = stereo_validation.failure_flags[attempt_index];
                    final_positions[local] = attempt.positions[start..end].to_vec();
                    final_seeds[local] = seeds[attempt_index];
                    if (!converged(attempt.statuses[attempt_index])
                        || !converged(refinement.statuses[attempt_index])
                        || !matches!(mmff_refinement.statuses[attempt_index], 0 | 1 | 4)
                        || stereo_validation.failure_flags[attempt_index] != 0)
                        && retry_index + 1 < request.parameters.max_attempts_per_conformer
                    {
                        retry.push(local);
                    }
                }
                pending = retry;
            }
            for local in 0..count {
                output.conformer_molecule_indices.push(record_index);
                output
                    .conformer_ordinals
                    .push(span.first_conformer + local as u32);
                output.embedding_attempt_counts.push(final_attempts[local]);
                output.embedding_energies.push(final_energies[local]);
                output.etk_energies.push(final_etk_energies[local]);
                output.mmff_energies.push(final_mmff_energies[local]);
                output.mmff_statuses.push(final_mmff_statuses[local]);
                output
                    .mmff_optimizer_kinds
                    .push(final_mmff_optimizers[local]);
                output
                    .embedding_statuses
                    .push(status_tag(final_statuses[local]));
                output
                    .etk_statuses
                    .push(status_tag(final_etk_statuses[local]));
                output
                    .retry_stereo_failure_flags
                    .push(final_stereo_flags[local]);
                output.seed_words.push(final_seeds[local]);
                output.positions.extend(
                    final_positions[local]
                        .iter()
                        .map(|position| [position[0], position[1], position[2]]),
                );
                output
                    .conformer_atom_starts
                    .push(output.positions.len() as u64);
            }
        }
    }
    output.gpu_time_ms = (distance_backend == Backend::NativeMetal
        || stereo_backend == Backend::NativeMetal)
        .then_some(total_gpu_time);
    output.validate(schedule.conformer_count)?;
    Ok(output)
}

fn optimize_input_geometries(
    request: &ConformerV1SubmitRequest,
    engine: ConformerDistanceEngine,
    deferred: ConformerDeferredConstraints,
    mmff_parameters: &[Option<NativeMmffParameters>],
    input_positions: &[Option<Vec<[f32; 4]>>],
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    compute_service: Option<(&ComputeServiceClient, Uuid)>,
) -> ComputeResult<ConformerDistanceComputation> {
    let expected = input_positions
        .iter()
        .filter(|positions| positions.is_some())
        .count() as u64;
    let atom_count = input_positions
        .iter()
        .flatten()
        .map(|positions| positions.len() as u64)
        .sum();
    let mut output =
        ConformerDistanceComputation::with_capacity(engine, deferred, expected, atom_count)?;
    let options = DistanceGeometryOptimizationOptions::default();
    let mut gpu_time_ms = 0_u64;
    for (record, positions) in input_positions.iter().enumerate() {
        let Some(positions) = positions else { continue };
        let Some(molecule) = output
            .distance_engine
            .molecule(record as u64)
            .map_err(|error| protocol(error.to_string()))?
        else {
            continue;
        };
        if positions.len() != molecule.atomic_numbers.len() {
            return Err(protocol(
                "input geometry atom count differs from the extracted MMFF topology",
            ));
        }
        let optimized = refine_mmff(
            backend,
            metal,
            compute_service,
            positions,
            positions.len() as u32,
            mmff_parameters[record].as_ref(),
            options,
            request.limits.max_memory_bytes,
        )?;
        gpu_time_ms = gpu_time_ms.saturating_add(optimized.gpu_time_ms.unwrap_or(0));
        output.conformer_molecule_indices.push(record as u32);
        output.conformer_ordinals.push(0);
        output.embedding_attempt_counts.push(0);
        output.embedding_energies.push(0.0);
        output.embedding_statuses.push(4);
        output.etk_energies.push(0.0);
        output.etk_statuses.push(4);
        output.mmff_energies.push(optimized.energies[0]);
        output.mmff_statuses.push(optimized.statuses[0]);
        output.mmff_optimizer_kinds.push(optimized.optimizers[0]);
        output.retry_stereo_failure_flags.push(0);
        output.seed_words.push([0; 4]);
        output.positions.extend(
            optimized
                .positions
                .iter()
                .map(|position| [position[0], position[1], position[2]]),
        );
        output
            .conformer_atom_starts
            .push(output.positions.len() as u64);
    }
    output.gpu_time_ms = (backend == Backend::NativeMetal).then_some(gpu_time_ms);
    output.validate(output.conformer_count() as u64)?;
    Ok(output)
}

struct AttemptBatch {
    positions: Vec<[f32; 4]>,
    energies: Vec<f32>,
    statuses: Vec<DistanceGeometryOptimizationStatus>,
    gpu_time_ms: Option<u64>,
}

pub(crate) struct LocalEtkTerms {
    pub(crate) torsions: Vec<EtkTorsionConstraint>,
    pub(crate) impropers: Vec<EtkImproperConstraint>,
    pub(crate) distances: Vec<EtkDistanceConstraint>,
}

struct LocalStereoTerms {
    chiral: Vec<ChiralVolumeConstraint>,
    tetrahedral: Vec<TetrahedralConstraint>,
}

impl LocalEtkTerms {
    pub(crate) fn as_terms(&self) -> EtkGeometryTerms<'_> {
        EtkGeometryTerms {
            torsions: &self.torsions,
            impropers: &self.impropers,
            distances: &self.distances,
        }
    }
}

struct RefinementBatch {
    positions: Vec<[f32; 4]>,
    energies: Vec<f32>,
    statuses: Vec<DistanceGeometryOptimizationStatus>,
    gpu_time_ms: Option<u64>,
}

struct MmffRefinementBatch {
    positions: Vec<[f32; 4]>,
    energies: Vec<f32>,
    statuses: Vec<u8>,
    optimizers: Vec<u8>,
    gpu_time_ms: Option<u64>,
}

fn refine_mmff(
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    compute_service: Option<(&ComputeServiceClient, Uuid)>,
    positions: &[[f32; 4]],
    atom_count: u32,
    parameters: Option<&NativeMmffParameters>,
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> ComputeResult<MmffRefinementBatch> {
    let atom_count = atom_count as usize;
    let conformer_count = positions.len() / atom_count;
    let Some(parameters) = parameters else {
        return Ok(MmffRefinementBatch {
            positions: positions.to_vec(),
            energies: vec![0.0; conformer_count],
            statuses: vec![4; conformer_count],
            optimizers: vec![2; conformer_count],
            gpu_time_ms: (backend == Backend::NativeMetal).then_some(0),
        });
    };
    if parameters.parameters.atom_count as usize != atom_count {
        return Err(protocol(
            "MMFF atom count differs from the conformer EnginePack",
        ));
    }
    match backend {
        Backend::NativeMetal => {
            let runtime =
                metal.ok_or_else(|| unavailable("admitted Metal MMFF runtime is unavailable"))?;
            let execute = |positions: &[[f32; 4]], options| {
                compute_service.map_or_else(
                    || {
                        runtime
                            .optimize_mmff_profiled(
                                positions,
                                &parameters.parameters,
                                options,
                                max_memory_bytes,
                            )
                            .map_err(|error| error.to_string())
                    },
                    |(service, job_id)| {
                        service.optimize_mmff(
                            job_id,
                            positions,
                            &parameters.parameters,
                            options,
                            max_memory_bytes,
                        )
                    },
                )
            };
            let mut optimized = execute(positions, options)
                .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
            let retry_indices = optimized
                .statuses
                .iter()
                .enumerate()
                .filter_map(|(index, status)| (!converged(*status)).then_some(index))
                .collect::<Vec<_>>();
            if !retry_indices.is_empty() {
                let retry_positions = retry_indices
                    .iter()
                    .flat_map(|index| {
                        let start = index * atom_count;
                        optimized.positions[start..start + atom_count]
                            .iter()
                            .copied()
                    })
                    .collect::<Vec<_>>();
                let retry = execute(&retry_positions, mmff_retry_options(options))
                    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
                for (retry_index, original_index) in retry_indices.into_iter().enumerate() {
                    let source = retry_index * atom_count..(retry_index + 1) * atom_count;
                    let target = original_index * atom_count..(original_index + 1) * atom_count;
                    optimized.positions[target].copy_from_slice(&retry.positions[source]);
                    optimized.energies[original_index] = retry.energies[retry_index];
                    optimized.scaled_gradient_maxima[original_index] =
                        retry.scaled_gradient_maxima[retry_index];
                    optimized.iterations[original_index] = optimized.iterations[original_index]
                        .saturating_add(retry.iterations[retry_index]);
                    optimized.statuses[original_index] = retry.statuses[retry_index];
                    optimized.optimizers[original_index] = retry.optimizers[retry_index];
                }
                optimized.gpu_time_ms = optimized.gpu_time_ms.saturating_add(retry.gpu_time_ms);
            }
            Ok(MmffRefinementBatch {
                positions: optimized.positions,
                energies: optimized.energies,
                statuses: optimized.statuses.into_iter().map(status_tag).collect(),
                optimizers: optimized
                    .optimizers
                    .into_iter()
                    .map(mmff_optimizer_tag)
                    .collect(),
                gpu_time_ms: Some(optimized.gpu_time_ms),
            })
        }
        Backend::ReferenceCpu => {
            let mut refined_positions = Vec::with_capacity(positions.len());
            let mut energies = Vec::with_capacity(conformer_count);
            let mut statuses = Vec::with_capacity(conformer_count);
            let mut optimizers = Vec::with_capacity(conformer_count);
            for conformer in positions.chunks_exact(atom_count) {
                let mut optimized = optimize_mmff(conformer, &parameters.parameters, options)
                    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
                if !converged(optimized.status) {
                    let retry = optimize_mmff(
                        &optimized.positions,
                        &parameters.parameters,
                        mmff_retry_options(options),
                    )
                    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
                    optimized = retry;
                }
                refined_positions.extend(optimized.positions);
                energies.push(optimized.energy);
                statuses.push(status_tag(optimized.status));
                optimizers.push(mmff_optimizer_tag(optimized.optimizer));
            }
            Ok(MmffRefinementBatch {
                positions: refined_positions,
                energies,
                statuses,
                optimizers,
                gpu_time_ms: None,
            })
        }
        other => Err(protocol(format!(
            "unsupported conformer MMFF backend: {other:?}"
        ))),
    }
}

fn mmff_retry_options(
    options: DistanceGeometryOptimizationOptions,
) -> DistanceGeometryOptimizationOptions {
    DistanceGeometryOptimizationOptions {
        gradient_tolerance: options.gradient_tolerance.max(1.0e-3),
        relative_step_tolerance: options.relative_step_tolerance.max(1.0e-5),
        armijo_coefficient: options.armijo_coefficient.min(1.0e-5),
        max_line_search_steps: options.max_line_search_steps.max(64),
        max_step_factor: options.max_step_factor.min(1.0),
        ..options
    }
}

struct StereoValidationBatch {
    failure_flags: Vec<u32>,
    gpu_time_ms: Option<u64>,
}

fn embed(
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    compute_service: Option<(&ComputeServiceClient, Uuid)>,
    seeds: &[[u32; 4]],
    atom_count: u32,
    constraints: &[DistanceConstraint],
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> ComputeResult<AttemptBatch> {
    match backend {
        Backend::NativeMetal => {
            let MetalDistanceEmbedding {
                positions,
                energies,
                statuses,
                gpu_time_ms,
                ..
            } = if let Some((service, job_id)) = compute_service {
                service.embed_distance_bounds(
                    job_id,
                    seeds,
                    atom_count,
                    constraints,
                    options,
                    max_memory_bytes,
                )
            } else {
                metal
                    .ok_or_else(|| unavailable("admitted Metal runtime is unavailable"))?
                    .embed_distance_bounds_profiled(
                        seeds,
                        atom_count,
                        constraints,
                        options,
                        max_memory_bytes,
                    )
                    .map_err(|error| error.to_string())
            }
            .map_err(ComputeCoordinatorError::Validation)?;
            Ok(AttemptBatch {
                positions,
                energies,
                statuses,
                gpu_time_ms: Some(gpu_time_ms),
            })
        }
        Backend::ReferenceCpu => {
            let mut positions = Vec::new();
            let mut energies = Vec::new();
            let mut statuses = Vec::new();
            for seed in seeds {
                let initial = initialize_conformer_positions(*seed, atom_count);
                let optimized = optimize_distance_geometry(&initial, constraints, options)
                    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
                positions.extend(optimized.positions);
                energies.push(optimized.energy);
                statuses.push(optimized.status);
            }
            Ok(AttemptBatch {
                positions,
                energies,
                statuses,
                gpu_time_ms: None,
            })
        }
        other => Err(protocol(format!(
            "unsupported conformer distance backend: {other:?}"
        ))),
    }
}

fn refine_etk(
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    positions: &[[f32; 4]],
    atom_count: u32,
    terms: EtkGeometryTerms<'_>,
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> ComputeResult<RefinementBatch> {
    if terms.torsions.is_empty() && terms.impropers.is_empty() && terms.distances.is_empty() {
        let conformer_count = positions.len() / atom_count as usize;
        return Ok(RefinementBatch {
            positions: positions.to_vec(),
            energies: vec![0.0; conformer_count],
            statuses: vec![DistanceGeometryOptimizationStatus::ConvergedGradient; conformer_count],
            gpu_time_ms: (backend == Backend::NativeMetal).then_some(0),
        });
    }
    match backend {
        Backend::NativeMetal => {
            let runtime =
                metal.ok_or_else(|| unavailable("admitted Metal runtime is unavailable"))?;
            let optimized = runtime
                .optimize_etk_profiled(positions, atom_count, terms, options, max_memory_bytes)
                .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
            Ok(RefinementBatch {
                positions: optimized.positions,
                energies: optimized.energies,
                statuses: optimized.statuses,
                gpu_time_ms: Some(optimized.gpu_time_ms),
            })
        }
        Backend::ReferenceCpu => {
            let atom_count = atom_count as usize;
            let mut refined_positions = Vec::with_capacity(positions.len());
            let mut energies = Vec::with_capacity(positions.len() / atom_count);
            let mut statuses = Vec::with_capacity(positions.len() / atom_count);
            for conformer in positions.chunks_exact(atom_count) {
                let optimized = optimize_etk_geometry(conformer, terms, options)
                    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
                refined_positions.extend(optimized.positions);
                energies.push(optimized.energy);
                statuses.push(optimized.status);
            }
            Ok(RefinementBatch {
                positions: refined_positions,
                energies,
                statuses,
                gpu_time_ms: None,
            })
        }
        other => Err(protocol(format!(
            "unsupported conformer ETK backend: {other:?}"
        ))),
    }
}

pub(crate) fn local_etk_terms(
    deferred: &ConformerDeferredConstraints,
    record: usize,
) -> ComputeResult<LocalEtkTerms> {
    let atom_start = *deferred
        .molecule_atom_starts
        .get(record)
        .ok_or_else(|| protocol("conformer molecule atom start is missing"))?;
    let torsions = term_range(&deferred.torsion_term_starts, record, "torsion")?
        .map(|term| {
            Ok(EtkTorsionConstraint {
                atoms: local_indices(deferred.torsion_atom_quads[term], atom_start)?,
                coefficients: deferred.torsion_coefficients[term],
                signs: deferred.torsion_signs[term],
            })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    let impropers = term_range(&deferred.improper_term_starts, record, "improper")?
        .map(|term| {
            Ok(EtkImproperConstraint {
                atoms: local_indices(deferred.improper_atom_quads[term], atom_start)?,
                weight: deferred.improper_weights[term],
            })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    let distances = term_range(&deferred.etk_distance_term_starts, record, "ETK distance")?
        .map(|term| {
            if deferred.etk_distance_kinds[term] == 0 {
                return Err(protocol("conformer ETK distance kind is not canonical"));
            }
            Ok(EtkDistanceConstraint {
                atoms: local_indices(deferred.etk_distance_atom_pairs[term], atom_start)?,
                lower: deferred.etk_distance_bounds[term][0],
                upper: deferred.etk_distance_bounds[term][1],
                weight: deferred.etk_distance_weights[term],
            })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    Ok(LocalEtkTerms {
        torsions,
        impropers,
        distances,
    })
}

fn local_stereo_terms(
    deferred: &ConformerDeferredConstraints,
    record: usize,
) -> ComputeResult<LocalStereoTerms> {
    let atom_start = *deferred
        .molecule_atom_starts
        .get(record)
        .ok_or_else(|| protocol("conformer molecule atom start is missing"))?;
    let chiral = term_range(&deferred.chiral_term_starts, record, "chiral")?
        .map(|term| {
            Ok(ChiralVolumeConstraint {
                atoms: local_indices(deferred.chiral_atom_quads[term], atom_start)?,
                lower: deferred.chiral_volume_bounds[term][0],
                upper: deferred.chiral_volume_bounds[term][1],
            })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    let tetrahedral = term_range(&deferred.stereo_center_starts, record, "tetrahedral")?
        .map(|term| {
            Ok(TetrahedralConstraint {
                atoms: local_indices(deferred.stereo_atom_quints[term], atom_start)?,
                in_fused_small_ring: match deferred.stereo_flags[term] {
                    0 => false,
                    1 => true,
                    _ => return Err(protocol("conformer stereo flag is not canonical")),
                },
            })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    Ok(LocalStereoTerms {
        chiral,
        tetrahedral,
    })
}

fn validate_stereo_attempts(
    backend: Backend,
    metal: Option<&MetalTanimotoRuntime>,
    positions: &[[f32; 4]],
    atom_count: u32,
    chiral: &[ChiralVolumeConstraint],
    tetrahedral: &[TetrahedralConstraint],
    max_memory_bytes: u64,
) -> ComputeResult<StereoValidationBatch> {
    let conformer_count = positions.len() / atom_count as usize;
    if chiral.is_empty() && tetrahedral.is_empty() {
        return Ok(StereoValidationBatch {
            failure_flags: vec![0; conformer_count],
            gpu_time_ms: (backend == Backend::NativeMetal).then_some(0),
        });
    }
    match backend {
        Backend::NativeMetal => {
            let runtime =
                metal.ok_or_else(|| unavailable("admitted Metal stereo runtime is unavailable"))?;
            let validated = runtime
                .validate_stereo_profiled(
                    positions,
                    atom_count,
                    chiral,
                    tetrahedral,
                    max_memory_bytes,
                )
                .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
            Ok(StereoValidationBatch {
                failure_flags: validated.failure_flags,
                gpu_time_ms: Some(validated.gpu_time_ms),
            })
        }
        Backend::ReferenceCpu => {
            let failure_flags = positions
                .chunks_exact(atom_count as usize)
                .map(|conformer| {
                    validate_conformer_stereo(conformer, chiral, tetrahedral)
                        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))
                })
                .collect::<ComputeResult<Vec<_>>>()?;
            Ok(StereoValidationBatch {
                failure_flags,
                gpu_time_ms: None,
            })
        }
        other => Err(protocol(format!(
            "unsupported conformer stereo retry backend: {other:?}"
        ))),
    }
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
                .ok_or_else(|| protocol("conformer ETK atom index precedes its molecule"))
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?
        .try_into()
        .map_err(|_| protocol("conformer ETK atom index width changed"))
}

impl ConformerDistanceComputation {
    pub(crate) fn conformer_count(&self) -> usize {
        self.conformer_molecule_indices.len()
    }

    fn with_capacity(
        distance_engine: ConformerDistanceEngine,
        deferred: ConformerDeferredConstraints,
        conformers: u64,
        atoms: u64,
    ) -> ComputeResult<Self> {
        let conformers = usize::try_from(conformers)
            .map_err(|_| unavailable("conformer result count exceeds address space"))?;
        let atoms = usize::try_from(atoms)
            .map_err(|_| unavailable("conformer position count exceeds address space"))?;
        let mut result = Self {
            distance_engine,
            deferred,
            conformer_atom_starts: Vec::new(),
            conformer_molecule_indices: Vec::new(),
            conformer_ordinals: Vec::new(),
            embedding_attempt_counts: Vec::new(),
            embedding_energies: Vec::new(),
            embedding_statuses: Vec::new(),
            etk_energies: Vec::new(),
            etk_statuses: Vec::new(),
            mmff_energies: Vec::new(),
            mmff_statuses: Vec::new(),
            mmff_optimizer_kinds: Vec::new(),
            retry_stereo_failure_flags: Vec::new(),
            positions: Vec::new(),
            seed_words: Vec::new(),
            gpu_time_ms: None,
        };
        result
            .conformer_atom_starts
            .try_reserve_exact(conformers + 1)
            .map_err(|_| unavailable("cannot allocate conformer offsets"))?;
        result.conformer_atom_starts.push(0);
        for vector in [
            &mut result.conformer_molecule_indices,
            &mut result.conformer_ordinals,
        ] {
            vector
                .try_reserve_exact(conformers)
                .map_err(|_| unavailable("cannot allocate conformer identity arrays"))?;
        }
        result
            .embedding_attempt_counts
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer attempt counts"))?;
        result
            .embedding_energies
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer energies"))?;
        result
            .embedding_statuses
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer statuses"))?;
        result
            .etk_energies
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer ETK energies"))?;
        result
            .etk_statuses
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer ETK statuses"))?;
        result
            .mmff_energies
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer MMFF energies"))?;
        result
            .mmff_statuses
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer MMFF statuses"))?;
        result
            .mmff_optimizer_kinds
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer MMFF optimizer kinds"))?;
        result
            .retry_stereo_failure_flags
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer stereo retry flags"))?;
        result
            .seed_words
            .try_reserve_exact(conformers)
            .map_err(|_| unavailable("cannot allocate conformer seeds"))?;
        result
            .positions
            .try_reserve_exact(atoms)
            .map_err(|_| unavailable("cannot allocate conformer positions"))?;
        Ok(result)
    }

    fn validate(&self, expected_conformers: u64) -> ComputeResult<()> {
        let count = self.conformer_molecule_indices.len();
        if count as u64 != expected_conformers
            || self.conformer_atom_starts.len() != count + 1
            || self.conformer_ordinals.len() != count
            || self.embedding_attempt_counts.len() != count
            || self.embedding_energies.len() != count
            || self.embedding_statuses.len() != count
            || self.etk_energies.len() != count
            || self.etk_statuses.len() != count
            || self.mmff_energies.len() != count
            || self.mmff_statuses.len() != count
            || self.mmff_optimizer_kinds.len() != count
            || self.retry_stereo_failure_flags.len() != count
            || self.seed_words.len() != count
            || self.conformer_atom_starts.last().copied() != Some(self.positions.len() as u64)
            || self
                .positions
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
            || self
                .embedding_energies
                .iter()
                .any(|value| !value.is_finite())
            || self.etk_energies.iter().any(|value| !value.is_finite())
            || self.mmff_energies.iter().any(|value| !value.is_finite())
            || self.mmff_statuses.iter().any(|status| *status > 4)
            || self.mmff_optimizer_kinds.iter().any(|kind| *kind > 2)
        {
            return Err(protocol(
                "conformer distance result arrays are inconsistent",
            ));
        }
        Ok(())
    }
}

fn converged(status: DistanceGeometryOptimizationStatus) -> bool {
    matches!(
        status,
        DistanceGeometryOptimizationStatus::ConvergedGradient
            | DistanceGeometryOptimizationStatus::ConvergedStep
    )
}

fn status_tag(status: DistanceGeometryOptimizationStatus) -> u8 {
    match status {
        DistanceGeometryOptimizationStatus::ConvergedGradient => 0,
        DistanceGeometryOptimizationStatus::ConvergedStep => 1,
        DistanceGeometryOptimizationStatus::LineSearchExhausted => 2,
        DistanceGeometryOptimizationStatus::MaxIterations => 3,
    }
}

fn mmff_optimizer_tag(optimizer: MmffOptimizerKind) -> u8 {
    match optimizer {
        MmffOptimizerKind::Bfgs => 0,
        MmffOptimizerKind::Lbfgs => 1,
    }
}

fn decode_sha256(value: &str) -> ComputeResult<[u8; 32]> {
    if value.len() != 64 {
        return Err(protocol("conformer molecule identity is not SHA-256"));
    }
    let mut bytes = [0_u8; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| protocol("conformer molecule identity is not lowercase hexadecimal"))?;
    }
    Ok(bytes)
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use burrete_compute_core::{
        ConformerEnginePackBuilder, ExtractedConformerParameters, MmffBondTerm, MmffParameters,
        MmffVariant,
    };
    use burrete_compute_protocol::{
        AllGridScope, BackendPolicy, ComputeJobSchemaVersion, ConformerResourceLimits,
        ConformerV1Parameters, ExecutionPolicy, GridScope, GridSourceReference, SchedulingPolicy,
        WorkflowTemplateId, MIN_COMPUTE_MEMORY_BYTES,
    };
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitConformerFixture {
        cases: Vec<RdkitConformerCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitConformerCase {
        name: String,
        variant: String,
        atom_count: usize,
        bcex_base64: String,
    }

    #[test]
    fn reference_executor_preserves_order_seeds_and_ragged_offsets() {
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder.append_valid(extracted()).expect("valid molecule");
        builder.append_invalid().expect("invalid molecule");
        let arrays = builder.finish(2).expect("engine arrays");
        let request = request();
        let identities = vec![
            ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            },
            ConformerMoleculeIdentity {
                source_record_id: 20,
                molecule_content_sha256: "22".repeat(32),
            },
        ];

        let first = execute_conformer_distance_geometry(
            Uuid::from_u128(7),
            &request,
            arrays.clone(),
            &identities,
            &[None, None],
            &[None, None],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("reference execution");
        let second = execute_conformer_distance_geometry(
            Uuid::from_u128(7),
            &request,
            arrays,
            &identities,
            &[None, None],
            &[None, None],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("repeated execution");

        assert_eq!(first.conformer_molecule_indices, [0, 0]);
        assert_eq!(first.conformer_ordinals, [0, 1]);
        assert_eq!(first.conformer_atom_starts, [0, 2, 4]);
        assert_eq!(first.positions, second.positions);
        assert_eq!(first.seed_words, second.seed_words);
        assert_ne!(first.seed_words[0], first.seed_words[1]);
        assert_eq!(first.gpu_time_ms, None);
    }

    #[test]
    fn reference_executor_applies_etk_refinement_terms() {
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder
            .append_valid(extracted_etk())
            .expect("valid molecule");
        let result = execute_conformer_distance_geometry(
            Uuid::from_u128(9),
            &request(),
            builder.finish(1).expect("engine arrays"),
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[None],
            &[None],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("reference ETK execution");

        assert_eq!(result.conformer_atom_starts, [0, 4, 8]);
        assert_eq!(result.etk_energies.len(), 2);
        assert!(result.etk_energies.iter().all(|energy| energy.is_finite()));
        assert!(result.etk_statuses.iter().all(|status| *status <= 3));
        assert_eq!(result.gpu_time_ms, None);
    }

    #[test]
    fn reference_executor_applies_mmff94s_and_records_optimizer_provenance() {
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder.append_valid(extracted()).expect("valid molecule");
        let result = execute_conformer_distance_geometry(
            Uuid::from_u128(10),
            &request(),
            builder.finish(1).expect("engine arrays"),
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[Some(mmff_parameters(2))],
            &[None],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("reference MMFF execution");

        assert_eq!(result.mmff_energies.len(), 2);
        assert!(result.mmff_statuses.iter().all(|status| *status <= 1));
        assert_eq!(result.mmff_optimizer_kinds, [0, 0]);
        assert!(result.mmff_energies.iter().all(|energy| energy.is_finite()));
    }

    #[test]
    fn reference_executor_retries_rejected_stereochemistry_to_the_limit() {
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder
            .append_valid(extracted_impossible_stereo())
            .expect("valid molecule");
        let result = execute_conformer_distance_geometry(
            Uuid::from_u128(11),
            &request(),
            builder.finish(1).expect("engine arrays"),
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[None],
            &[None],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("reference stereo retry execution");

        assert_eq!(result.embedding_attempt_counts, [2, 2]);
        assert_eq!(result.retry_stereo_failure_flags, [1, 1]);
        assert!(result.embedding_statuses.iter().all(|status| *status <= 1));
        assert!(result.etk_statuses.iter().all(|status| *status <= 1));
    }

    #[test]
    fn reference_executor_optimizes_the_supplied_input_geometry() {
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder.append_valid(extracted()).expect("valid molecule");
        let mut request = request();
        request.parameters.initialization =
            burrete_compute_protocol::ConformerInitialization::InputGeometry;
        request.parameters.conformers_per_molecule = 1;
        let initial = vec![[0.0, 0.0, 0.0, 0.0], [3.0, 0.0, 0.0, 0.0]];
        let result = execute_conformer_distance_geometry(
            Uuid::from_u128(12),
            &request,
            builder.finish(1).expect("engine arrays"),
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[Some(mmff_parameters(2))],
            &[Some(initial)],
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            None,
        )
        .expect("input geometry optimization");

        assert_eq!(result.conformer_count(), 1);
        assert_eq!(result.embedding_attempt_counts, [0]);
        assert_eq!(result.embedding_statuses, [4]);
        assert!(result.mmff_statuses[0] <= 1);
        let distance = (result.positions[1][0] - result.positions[0][0]).abs();
        assert!(
            (distance - 1.5).abs() < 1.0e-3,
            "optimized distance={distance}"
        );
    }

    #[test]
    #[ignore = "manual real-GPU smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn native_executor_dispatches_adaptive_batches_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(std::path::PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged runtime");
        let runtime = MetalTanimotoRuntime::load(&root, &"0".repeat(64))
            .expect("load verified Metal runtime");
        let mut builder = ConformerEnginePackBuilder::new(
            burrete_compute_protocol::ConformerVariant::EtkdgV3,
            1024 * 1024,
        );
        builder
            .append_valid(extracted_etk())
            .expect("valid molecule");
        let result = execute_conformer_distance_geometry(
            Uuid::from_u128(7),
            &request(),
            builder.finish(1).expect("engine arrays"),
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[Some(mmff_parameters(4))],
            &[None],
            Backend::NativeMetal,
            Backend::NativeMetal,
            Some(&runtime),
        )
        .expect("native Metal conformer execution");

        assert_eq!(result.conformer_count(), 2);
        assert!(result.gpu_time_ms.is_some());
        assert!(result.embedding_statuses.iter().all(|status| *status <= 3));
        assert!(result.etk_statuses.iter().all(|status| *status <= 3));
        assert!(result.etk_energies.iter().all(|energy| energy.is_finite()));
        assert!(result.mmff_energies.iter().all(|energy| energy.is_finite()));
        assert!(result.mmff_statuses.iter().all(|status| *status <= 1));
        let mut input_request = request();
        input_request.parameters.initialization =
            burrete_compute_protocol::ConformerInitialization::InputGeometry;
        input_request.parameters.conformers_per_molecule = 1;
        let input = execute_conformer_distance_geometry(
            Uuid::from_u128(8),
            &input_request,
            {
                let mut builder = ConformerEnginePackBuilder::new(
                    burrete_compute_protocol::ConformerVariant::EtkdgV3,
                    1024 * 1024,
                );
                builder
                    .append_valid(extracted_etk())
                    .expect("valid molecule");
                builder.finish(1).expect("engine arrays")
            },
            &[ConformerMoleculeIdentity {
                source_record_id: 10,
                molecule_content_sha256: "11".repeat(32),
            }],
            &[Some(mmff_parameters(4))],
            &[Some(vec![
                [0.0, 0.0, 0.0, 0.0],
                [1.45, 0.0, 0.0, 0.0],
                [2.90, 0.0, 0.0, 0.0],
                [4.35, 0.0, 0.0, 0.0],
            ])],
            Backend::NativeMetal,
            Backend::NativeMetal,
            Some(&runtime),
        )
        .expect("native Metal input geometry optimization");
        assert_eq!(input.conformer_count(), 1);
        assert!(input.gpu_time_ms.is_some());
        assert!(
            input.mmff_statuses[0] <= 1,
            "input MMFF status={}, energy={}",
            input.mmff_statuses[0],
            input.mmff_energies[0]
        );
        let stereo =
            crate::compute::conformer_stereo_executor::execute_conformer_stereo_validation(
                &result,
                Backend::NativeMetal,
                Some(&runtime),
                MIN_COMPUTE_MEMORY_BYTES,
            )
            .expect("native Metal conformer stereo validation");
        assert_eq!(stereo.failure_flags, [0, 0]);
        assert_eq!(stereo.passed_count, 2);
        assert!(stereo.gpu_time_ms.is_some());
        eprintln!(
            "conformer executor Metal smoke: device={}, conformers={}, distanceGpuTimeMs={:?}, inputGeometryGpuTimeMs={:?}, stereoGpuTimeMs={:?}",
            runtime.device_identity().name,
            result.conformer_count(),
            result.gpu_time_ms,
            input.gpu_time_ms,
            stereo.gpu_time_ms,
        );
    }

    #[test]
    #[ignore = "manual RDKit conformer corpus smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn executes_all_pinned_rdkit_conformer_variants_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(std::path::PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged runtime");
        let runtime = MetalTanimotoRuntime::load(&root, &"0".repeat(64))
            .expect("load verified Metal runtime");
        let fixture: RdkitConformerFixture = serde_json::from_str(include_str!(
            "../../../../../compute/rdkit-conformer/fixtures/conformer-rdkit-2025.03.4.json"
        ))
        .expect("decode pinned RDKit conformer corpus");
        assert_eq!(fixture.cases.len(), 32);
        let mut maximum_attempt_count = 0;
        for (case_index, case) in fixture.cases.into_iter().enumerate() {
            let variant: burrete_compute_protocol::ConformerVariant =
                serde_json::from_value(serde_json::Value::String(case.variant.clone()))
                    .expect("decode conformer variant");
            let bytes = STANDARD
                .decode(&case.bcex_base64)
                .expect("decode BCEX fixture");
            let extracted =
                ExtractedConformerParameters::decode(&bytes, variant, bytes.len() as u64)
                    .unwrap_or_else(|error| panic!("{} {} BCEX: {error}", case.name, case.variant));
            assert_eq!(extracted.atomic_numbers.len(), case.atom_count);
            let mut builder = ConformerEnginePackBuilder::new(variant, 4 * 1024 * 1024);
            builder.append_valid(extracted).expect("append corpus case");
            let mut request = request();
            request.parameters.variant = variant;
            request.parameters.conformers_per_molecule = 1;
            request.parameters.max_attempts_per_conformer = 32;
            let result = execute_conformer_distance_geometry(
                Uuid::from_u128(10_000 + case_index as u128),
                &request,
                builder.finish(1).expect("build corpus EnginePack"),
                &[ConformerMoleculeIdentity {
                    source_record_id: case_index as u64 + 1,
                    molecule_content_sha256: format!("{:064x}", case_index + 1),
                }],
                &[None],
                &[None],
                Backend::NativeMetal,
                Backend::NativeMetal,
                Some(&runtime),
            )
            .unwrap_or_else(|error| {
                panic!("{} {} Metal conformer: {error}", case.name, case.variant)
            });
            assert_eq!(result.conformer_count(), 1);
            maximum_attempt_count = maximum_attempt_count.max(result.embedding_attempt_counts[0]);
            assert_eq!(
                result.retry_stereo_failure_flags,
                [0],
                "{} {} retained a stereo failure",
                case.name,
                case.variant
            );
            assert!(result.embedding_statuses[0] <= 3);
            assert!(result.etk_statuses[0] <= 3);
            assert!(result
                .positions
                .iter()
                .flatten()
                .all(|value| value.is_finite()));
            assert!(result.gpu_time_ms.is_some());
        }
        assert!(maximum_attempt_count <= 32);
        eprintln!("32-case conformer corpus maximum attempt count: {maximum_attempt_count}");
    }

    fn extracted() -> ExtractedConformerParameters {
        ExtractedConformerParameters {
            variant: burrete_compute_protocol::ConformerVariant::EtkdgV3,
            atomic_numbers: vec![6, 8],
            formal_charges: vec![0, 0],
            distance_atom_pairs: vec![[0, 1]],
            distance_bounds_squared: vec![[1.0, 2.25]],
            distance_weights: vec![1.0],
            chiral_atom_quads: Vec::new(),
            chiral_volume_bounds: Vec::new(),
            torsion_atom_quads: Vec::new(),
            torsion_coefficients: Vec::new(),
            torsion_signs: Vec::new(),
            improper_atom_quads: Vec::new(),
            improper_weights: Vec::new(),
            etk_distance_atom_pairs: Vec::new(),
            etk_distance_bounds: Vec::new(),
            etk_distance_kinds: Vec::new(),
            etk_distance_weights: Vec::new(),
            stereo_atom_quints: Vec::new(),
            stereo_flags: Vec::new(),
        }
    }

    fn mmff_parameters(atom_count: u32) -> NativeMmffParameters {
        NativeMmffParameters {
            parameters: MmffParameters {
                variant: MmffVariant::Mmff94s,
                atom_count,
                bonds: (1..atom_count)
                    .map(|atom| MmffBondTerm {
                        atoms: [atom - 1, atom],
                        force_constant: 4.0,
                        equilibrium_distance: 1.5,
                    })
                    .collect(),
                angles: Vec::new(),
                stretch_bends: Vec::new(),
                out_of_planes: Vec::new(),
                torsions: Vec::new(),
                van_der_waals: Vec::new(),
                electrostatics: Vec::new(),
            },
            partial_charges: vec![0.0; atom_count as usize],
        }
    }

    fn extracted_etk() -> ExtractedConformerParameters {
        ExtractedConformerParameters {
            variant: burrete_compute_protocol::ConformerVariant::EtkdgV3,
            atomic_numbers: vec![6, 6, 6, 8],
            formal_charges: vec![0, 0, 0, 0],
            distance_atom_pairs: vec![[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]],
            distance_bounds_squared: vec![
                [1.0, 2.25],
                [2.25, 9.0],
                [1.0, 2.25],
                [2.25, 9.0],
                [1.0, 2.25],
            ],
            distance_weights: vec![1.0; 5],
            chiral_atom_quads: vec![[0, 1, 2, 3]],
            chiral_volume_bounds: vec![[-1_000_000.0, 1_000_000.0]],
            torsion_atom_quads: vec![[0, 1, 2, 3]],
            torsion_coefficients: vec![[0.8, 0.3, 0.1, 0.0, 0.0, 0.0]],
            torsion_signs: vec![[1, -1, 1, 0, 0, 0]],
            improper_atom_quads: vec![[3, 2, 1, 0]],
            improper_weights: vec![0.2],
            etk_distance_atom_pairs: vec![[0, 3]],
            etk_distance_bounds: vec![[1.8, 3.5]],
            etk_distance_kinds: vec![1],
            etk_distance_weights: vec![0.5],
            stereo_atom_quints: Vec::new(),
            stereo_flags: Vec::new(),
        }
    }

    fn extracted_impossible_stereo() -> ExtractedConformerParameters {
        ExtractedConformerParameters {
            variant: burrete_compute_protocol::ConformerVariant::EtkdgV3,
            atomic_numbers: vec![6, 6, 6, 6],
            formal_charges: vec![0; 4],
            distance_atom_pairs: vec![[0, 1]],
            distance_bounds_squared: vec![[0.0, 100.0]],
            distance_weights: vec![1.0],
            chiral_atom_quads: vec![[0, 1, 2, 3]],
            chiral_volume_bounds: vec![[10_000.0, 10_001.0]],
            torsion_atom_quads: Vec::new(),
            torsion_coefficients: Vec::new(),
            torsion_signs: Vec::new(),
            improper_atom_quads: Vec::new(),
            improper_weights: Vec::new(),
            etk_distance_atom_pairs: Vec::new(),
            etk_distance_bounds: Vec::new(),
            etk_distance_kinds: Vec::new(),
            etk_distance_weights: Vec::new(),
            stereo_atom_quints: Vec::new(),
            stereo_flags: Vec::new(),
        }
    }

    fn request() -> ConformerV1SubmitRequest {
        ConformerV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ConformerV1,
            source: GridSourceReference {
                document_id: "grid".into(),
                scope: GridScope::All(AllGridScope::default()),
            },
            parameters: ConformerV1Parameters {
                variant: burrete_compute_protocol::ConformerVariant::EtkdgV3,
                initialization: burrete_compute_protocol::ConformerInitialization::Generated,
                mmff_variant: burrete_compute_protocol::MmffVariant::Mmff94s,
                conformers_per_molecule: 2,
                max_attempts_per_conformer: 2,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: BackendPolicy::ReferenceCpu,
                scheduling_policy: SchedulingPolicy::Throughput,
            },
            limits: ConformerResourceLimits {
                max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
                max_dispatch_ms: 250,
                max_conformers_per_batch: 1,
            },
        }
    }
}
