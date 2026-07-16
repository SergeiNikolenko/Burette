use std::{collections::HashSet, ffi::c_void, mem::size_of_val};

use burrete_compute_core::{
    pm6_h4_covalent_radius, rm1_multipole_parameters, semiempirical_parameters,
    validate_etk_geometry_constraints, validate_mmff_parameters, validate_stereo_constraints,
    AlignmentMode, ChiralVolumeConstraint, DistanceConstraint, DistanceGeometryOptimizationOptions,
    EtkDistanceConstraint, EtkGeometryTerms, EtkImproperConstraint, EtkTorsionConstraint,
    Fingerprint2048, GraphBuildOptions, MmffParameters, Rm1FockPair, SemiempiricalMolecule,
    SymmetricCsr, TanimotoCounts, TanimotoQueryOptions, TetrahedralConstraint,
};
use burrete_compute_protocol::{GpuDeviceIdentity, SimilarityCutoff};
use metal::{
    Buffer, BufferRef, CommandQueue, ComputeCommandEncoderRef, ComputePipelineState,
    ComputePipelineStateRef, Device, LibraryRef, MTLCommandBufferStatus, MTLResourceOptions,
    MTLSize,
};
use objc::rc::autoreleasepool;
use objc::{runtime::Sel, Message};

use crate::platform::{
    MetalAlignmentDispatch, MetalDistanceDispatch, MetalDistanceOptimizationDispatch,
    MetalEtkDispatch, MetalMmffDispatch, MetalMmffOptimizationDispatch, MetalPm6H4HhDispatch,
    MetalRm1FockDispatch, MetalRm1PairRotationDispatch, MetalStereoValidationDispatch,
    MetalSymmetricEigenDispatch,
};
use crate::runtime::{MetalAlignmentBatch, MetalPm6CorrectionBatch};
use crate::MetalRuntimeError;

const MAX_TILE_RECORDS: usize = 1_024;
const MAX_QUERY_BATCH_RECORDS: usize = 262_144;
const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;

#[repr(C)]
#[derive(Clone, Copy)]
struct TanimotoTileV1 {
    record_count: u64,
    row_start: u64,
    row_count: u64,
    column_start: u64,
    column_count: u64,
    cutoff_numerator: u64,
    cutoff_denominator: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct TanimotoQueryBatchV1 {
    record_count: u64,
    row_start: u64,
    row_count: u64,
}

#[repr(C, align(8))]
#[derive(Clone, Copy, Default)]
struct TanimotoQueryCountsV1 {
    intersection: u32,
    union: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerInitializeBatchV1 {
    atom_count: u32,
    conformer_count: u32,
    output_atom_offset: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerDistanceBatchV1 {
    atom_count: u32,
    conformer_count: u32,
    constraint_count: u32,
    reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerOptimizeConfigV1 {
    atom_count: u32,
    conformer_count: u32,
    constraint_count: u32,
    max_iterations: u32,
    history_size: u32,
    max_line_search_steps: u32,
    reserved0: u32,
    reserved1: u32,
    gradient_tolerance: f32,
    relative_step_tolerance: f32,
    armijo_coefficient: f32,
    max_step_factor: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerStereoBatchV1 {
    atom_count: u32,
    conformer_count: u32,
    chiral_count: u32,
    tetrahedral_count: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerEtkBatchV1 {
    atom_count: u32,
    conformer_count: u32,
    torsion_count: u32,
    improper_count: u32,
    distance_count: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ConformerEtkOptimizeConfigV1 {
    atom_count: u32,
    conformer_count: u32,
    torsion_count: u32,
    improper_count: u32,
    distance_count: u32,
    max_iterations: u32,
    history_size: u32,
    max_line_search_steps: u32,
    gradient_tolerance: f32,
    relative_step_tolerance: f32,
    armijo_coefficient: f32,
    max_step_factor: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MmffBatchV1 {
    atom_count: u32,
    conformer_count: u32,
    bond_count: u32,
    angle_count: u32,
    stretch_bend_count: u32,
    out_of_plane_count: u32,
    torsion_count: u32,
    van_der_waals_count: u32,
    electrostatic_count: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

#[repr(C, align(16))]
#[derive(Clone, Copy, Default)]
struct MmffTermV1 {
    atoms: [u32; 4],
    parameters0: [f32; 4],
    parameters1: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MmffOptimizeConfigV1 {
    batch: MmffBatchV1,
    max_iterations: u32,
    history_size: u32,
    max_line_search_steps: u32,
    bfgs_max_atoms: u32,
    gradient_tolerance: f32,
    relative_step_tolerance: f32,
    armijo_coefficient: f32,
    max_step_factor: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AlignmentPairV1 {
    probe_atom_start: u64,
    probe_atom_count: u64,
    reference_atom_start: u64,
    reference_atom_count: u64,
    mapping_start: u64,
    mapping_count: u64,
    flags: u64,
    reserved: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AtomMappingV1 {
    probe_atom: u32,
    reference_atom: u32,
    weight: f32,
    reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Rm1FockPairV1 {
    left_start: u32,
    left_count: u32,
    right_start: u32,
    right_count: u32,
    tensor_start: u32,
    reserved: u32,
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
struct Rm1PairRotationV1 {
    spans: [u32; 4],
    model: [u32; 4],
    delta: [f32; 4],
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
struct Rm1PairParametersV1 {
    left0: [f32; 4],
    left1: [f32; 4],
    right0: [f32; 4],
    right1: [f32; 4],
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
struct Pm6CorrectionAtomV1 {
    position_radius: [f32; 4],
    identity: [u32; 4],
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
struct Pm6CorrectionMoleculeV1 {
    span: [u32; 4],
}

#[derive(Debug)]
pub(crate) struct MetalHost {
    device: Device,
    queue: CommandQueue,
    degree_pipeline: ComputePipelineState,
    fill_pipeline: ComputePipelineState,
    query_pipeline: ComputePipelineState,
    conformer_initialize_pipeline: ComputePipelineState,
    conformer_distance_pipeline: ComputePipelineState,
    conformer_optimize_pipeline: ComputePipelineState,
    conformer_stereo_pipeline: ComputePipelineState,
    conformer_etk_pipeline: ComputePipelineState,
    conformer_etk_optimize_pipeline: ComputePipelineState,
    mmff_energy_pipeline: ComputePipelineState,
    mmff_gradient_pipeline: ComputePipelineState,
    mmff_optimize_pipeline: ComputePipelineState,
    alignment_score_pipeline: ComputePipelineState,
    rm1_fock_pipeline: ComputePipelineState,
    rm1_eigen_pipeline: ComputePipelineState,
    rm1_pair_rotate_pipeline: ComputePipelineState,
    pm6_h4_hh_pipeline: ComputePipelineState,
}

impl MetalHost {
    pub(crate) fn load(library_bytes: &[u8]) -> Result<Self, MetalRuntimeError> {
        if std::env::consts::ARCH != "aarch64" {
            return Err(MetalRuntimeError::UnsupportedPlatform(
                "native Metal compute requires Apple Silicon".into(),
            ));
        }
        let device = Device::system_default().ok_or_else(|| {
            MetalRuntimeError::MetalUnavailable("Metal has no default GPU device".into())
        })?;
        if !device.has_unified_memory() {
            return Err(MetalRuntimeError::UnsupportedPlatform(
                "native compute requires a unified-memory Apple GPU".into(),
            ));
        }
        let library = device
            .new_library_with_data(library_bytes)
            .map_err(|error| {
                MetalRuntimeError::KernelUnavailable(format!(
                    "verified Metal library cannot load: {error}"
                ))
            })?;
        Self::from_library(device, &library)
    }

    fn from_library(device: Device, library: &LibraryRef) -> Result<Self, MetalRuntimeError> {
        let degree_pipeline = pipeline(&device, library, "burrete_tanimoto_degree_count_v1")?;
        let fill_pipeline = pipeline(&device, library, "burrete_tanimoto_csr_fill_v1")?;
        let query_pipeline = pipeline(&device, library, "burrete_tanimoto_query_counts_v1")?;
        let conformer_initialize_pipeline =
            pipeline(&device, library, "burrete_conformer_initialize_v1")?;
        let conformer_distance_pipeline =
            pipeline(&device, library, "burrete_conformer_distance_v1")?;
        let conformer_optimize_pipeline =
            pipeline(&device, library, "burrete_conformer_optimize_v1")?;
        let conformer_stereo_pipeline =
            pipeline(&device, library, "burrete_conformer_stereo_validate_v1")?;
        let conformer_etk_pipeline = pipeline(&device, library, "burrete_conformer_etk_v1")?;
        let conformer_etk_optimize_pipeline =
            pipeline(&device, library, "burrete_conformer_etk_optimize_v1")?;
        let mmff_energy_pipeline = pipeline(&device, library, "burrete_mmff_energy_v1")?;
        let mmff_gradient_pipeline =
            pipeline(&device, library, "burrete_mmff_reference_gradient_v1")?;
        let mmff_optimize_pipeline = pipeline(&device, library, "burrete_mmff_optimize_v1")?;
        let alignment_score_pipeline = pipeline(&device, library, "burrete_alignment_score_v1")?;
        let rm1_fock_pipeline = pipeline(&device, library, "burrete_rm1_pair_fock_v1")?;
        let rm1_eigen_pipeline = pipeline(&device, library, "burrete_rm1_symmetric_eigen_v1")?;
        let rm1_pair_rotate_pipeline = pipeline(&device, library, "burrete_rm1_pair_rotate_v1")?;
        let pm6_h4_hh_pipeline = pipeline(&device, library, "burrete_pm6_h4_hh_v1")?;
        Ok(Self {
            queue: device.new_command_queue(),
            device,
            degree_pipeline,
            fill_pipeline,
            query_pipeline,
            conformer_initialize_pipeline,
            conformer_distance_pipeline,
            conformer_optimize_pipeline,
            conformer_stereo_pipeline,
            conformer_etk_pipeline,
            conformer_etk_optimize_pipeline,
            mmff_energy_pipeline,
            mmff_gradient_pipeline,
            mmff_optimize_pipeline,
            alignment_score_pipeline,
            rm1_fock_pipeline,
            rm1_eigen_pipeline,
            rm1_pair_rotate_pipeline,
            pm6_h4_hh_pipeline,
        })
    }

    pub(crate) fn device_identity(&self) -> GpuDeviceIdentity {
        GpuDeviceIdentity {
            name: self.device.name().into(),
            registry_id: Some(format!("0x{:x}", self.device.registry_id())),
            low_power: self.device.is_low_power(),
            unified_memory: self.device.has_unified_memory(),
        }
    }

    pub(crate) fn recommended_max_working_set_size(&self) -> u64 {
        self.device.recommended_max_working_set_size()
    }

    pub(crate) fn build_graph(
        &self,
        fingerprints: &[Fingerprint2048],
        cutoff: SimilarityCutoff,
        options: GraphBuildOptions,
    ) -> Result<SymmetricCsr, MetalRuntimeError> {
        self.build_graph_profiled(fingerprints, cutoff, options)
            .map(|(graph, _)| graph)
    }

    pub(crate) fn build_graph_profiled(
        &self,
        fingerprints: &[Fingerprint2048],
        cutoff: SimilarityCutoff,
        options: GraphBuildOptions,
    ) -> Result<(SymmetricCsr, f64), MetalRuntimeError> {
        let cutoff = cutoff
            .normalized()
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        if fingerprints.is_empty() {
            return SymmetricCsr::try_new(vec![0], Vec::new())
                .map(|graph| (graph, 0.0))
                .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()));
        }
        let record_count = fingerprints.len();
        if record_count > u32::MAX as usize {
            return resource_limit("fingerprint count exceeds the Metal uint32 row limit");
        }
        admit_memory(record_count, 0, options.max_memory_bytes())?;
        let fingerprints_buffer = buffer_with_slice(&self.device, fingerprints);
        let degree_buffer = buffer_with_slice(&self.device, &vec![0_u64; record_count]);
        let mut gpu_time_seconds = self.dispatch_tiles(
            record_count,
            cutoff,
            options.tile_size().get(),
            &self.degree_pipeline,
            |encoder| {
                encoder.set_buffer(0, Some(&fingerprints_buffer), 0);
                encoder.set_buffer(2, Some(&degree_buffer), 0);
            },
        )?;
        let degrees = read_buffer::<u64>(&degree_buffer, record_count, "degree")?;
        let row_offsets = prefix_offsets(&degrees, record_count, options.max_undirected_edges())?;
        let directed_entries = *row_offsets.last().expect("offsets include zero");
        admit_memory(record_count, directed_entries, options.max_memory_bytes())?;
        if directed_entries == 0 {
            return SymmetricCsr::try_new(row_offsets, Vec::new())
                .map(|graph| (graph, gpu_time_seconds))
                .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()));
        }

        let entry_count = usize::try_from(directed_entries)
            .map_err(|_| MetalRuntimeError::ResourceLimit("CSR exceeds address space".into()))?;
        let offsets_buffer = buffer_with_slice(&self.device, &row_offsets);
        let cursor_buffer = buffer_with_slice(&self.device, &row_offsets[..record_count]);
        let column_buffer = buffer_with_slice(&self.device, &vec![0_u64; entry_count]);
        let status_buffer = buffer_with_slice(&self.device, &vec![0_u32; record_count]);
        gpu_time_seconds += self.dispatch_tiles(
            record_count,
            cutoff,
            options.tile_size().get(),
            &self.fill_pipeline,
            |encoder| {
                encoder.set_buffer(0, Some(&fingerprints_buffer), 0);
                encoder.set_buffer(2, Some(&offsets_buffer), 0);
                encoder.set_buffer(3, Some(&cursor_buffer), 0);
                encoder.set_buffer(4, Some(&column_buffer), 0);
                encoder.set_buffer(5, Some(&status_buffer), 0);
            },
        )?;
        let cursors = read_buffer::<u64>(&cursor_buffer, record_count, "cursor")?;
        let statuses = read_buffer::<u32>(&status_buffer, record_count, "status")?;
        if statuses.iter().any(|status| *status != 0) || cursors != row_offsets[1..] {
            return Err(MetalRuntimeError::Dispatch(
                "Metal CSR fill violated its counted row bounds".into(),
            ));
        }
        let columns = read_buffer::<u64>(&column_buffer, entry_count, "column")?;
        SymmetricCsr::try_new(row_offsets, columns)
            .map(|graph| (graph, gpu_time_seconds))
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))
    }

    pub(crate) fn score_query(
        &self,
        query: &Fingerprint2048,
        fingerprints: &[Fingerprint2048],
        options: TanimotoQueryOptions,
    ) -> Result<Vec<TanimotoCounts>, MetalRuntimeError> {
        self.score_query_profiled(query, fingerprints, options)
            .map(|(counts, _)| counts)
    }

    pub(crate) fn score_query_profiled(
        &self,
        query: &Fingerprint2048,
        fingerprints: &[Fingerprint2048],
        options: TanimotoQueryOptions,
    ) -> Result<(Vec<TanimotoCounts>, f64), MetalRuntimeError> {
        if fingerprints.is_empty() {
            return Ok((Vec::new(), 0.0));
        }
        let record_count = fingerprints.len();
        if record_count > u32::MAX as usize {
            return resource_limit("fingerprint count exceeds the Metal uint32 row limit");
        }
        admit_query_memory(record_count, options.max_memory_bytes())?;
        let fingerprints_buffer = buffer_with_slice(&self.device, fingerprints);
        let output_buffer = buffer_with_slice(
            &self.device,
            &vec![TanimotoQueryCountsV1::default(); record_count],
        );
        let query_words = query.to_metal_words();
        let thread_width = self
            .query_pipeline
            .thread_execution_width()
            .min(self.query_pipeline.max_total_threads_per_threadgroup());
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal query pipeline advertises a zero thread width".into(),
            ));
        }

        let mut gpu_time_seconds = 0.0;
        for row_start in (0..record_count).step_by(MAX_QUERY_BATCH_RECORDS) {
            let row_count = MAX_QUERY_BATCH_RECORDS.min(record_count - row_start);
            let batch = TanimotoQueryBatchV1 {
                record_count: record_count as u64,
                row_start: row_start as u64,
                row_count: row_count as u64,
            };
            gpu_time_seconds += autoreleasepool(|| {
                let command = self.queue.new_command_buffer();
                let encoder = command.new_compute_command_encoder();
                encoder.set_compute_pipeline_state(&self.query_pipeline);
                encoder.set_buffer(0, Some(&fingerprints_buffer), 0);
                encoder.set_bytes(
                    1,
                    size_of_val(&query_words) as u64,
                    query_words.as_ptr().cast(),
                );
                encoder.set_buffer(2, Some(&output_buffer), 0);
                encoder.set_bytes(
                    3,
                    size_of_val(&batch) as u64,
                    (&batch as *const TanimotoQueryBatchV1).cast(),
                );
                encoder.dispatch_threads(
                    MTLSize {
                        width: row_count as u64,
                        height: 1,
                        depth: 1,
                    },
                    MTLSize {
                        width: thread_width,
                        height: 1,
                        depth: 1,
                    },
                );
                encoder.end_encoding();
                command.commit();
                command.wait_until_completed();
                completed_gpu_time(command)
            })?;
        }

        let raw_counts =
            read_buffer::<TanimotoQueryCountsV1>(&output_buffer, record_count, "query count")?;
        let mut counts = Vec::with_capacity(record_count);
        for value in raw_counts {
            if value.intersection > value.union || value.union > 2_048 {
                return Err(MetalRuntimeError::Dispatch(
                    "Metal query returned impossible Tanimoto counts".into(),
                ));
            }
            counts.push(TanimotoCounts {
                intersection: u64::from(value.intersection),
                union: u64::from(value.union),
            });
        }
        Ok((counts, gpu_time_seconds))
    }

    pub(crate) fn initialize_conformers_profiled(
        &self,
        seed_words: &[[u32; 4]],
        atom_count: u32,
        max_memory_bytes: u64,
    ) -> Result<(Vec<[f32; 4]>, f64), MetalRuntimeError> {
        if seed_words.is_empty() || atom_count == 0 {
            return resource_limit("conformer initialization requires seeds and atoms");
        }
        let conformer_count = u32::try_from(seed_words.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
        })?;
        let item_count = u64::from(atom_count)
            .checked_mul(u64::from(conformer_count))
            .ok_or_else(memory_overflow)?;
        if item_count > u64::from(u32::MAX) {
            return resource_limit("conformer initialization grid exceeds uint32");
        }
        let seed_bytes = u64::try_from(seed_words.len())
            .ok()
            .and_then(|count| count.checked_mul(size_of_val(&seed_words[0]) as u64))
            .ok_or_else(memory_overflow)?;
        // Apple Silicon uses unified memory: count caller input, Metal storage,
        // and the returned host Vec while it is copied from the completed buffer.
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(seed_bytes.checked_mul(2).ok_or_else(memory_overflow)?)
            .and_then(|bytes| bytes.checked_add(item_count.checked_mul(32)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "conformer initialization requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let output_len = usize::try_from(item_count).map_err(|_| {
            MetalRuntimeError::ResourceLimit("conformer output exceeds address space".into())
        })?;
        let seeds_buffer = buffer_with_slice(&self.device, seed_words);
        let output_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; output_len]);
        let batch = ConformerInitializeBatchV1 {
            atom_count,
            conformer_count,
            output_atom_offset: 0,
        };
        let thread_width = self
            .conformer_initialize_pipeline
            .thread_execution_width()
            .min(
                self.conformer_initialize_pipeline
                    .max_total_threads_per_threadgroup(),
            );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal conformer initializer advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_initialize_pipeline);
            encoder.set_buffer(0, Some(&seeds_buffer), 0);
            encoder.set_bytes(
                1,
                size_of_val(&batch) as u64,
                (&batch as *const ConformerInitializeBatchV1).cast(),
            );
            encoder.set_buffer(2, Some(&output_buffer), 0);
            encoder.dispatch_threads(
                MTLSize {
                    width: item_count,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        let positions = read_buffer::<[f32; 4]>(&output_buffer, output_len, "conformer position")?;
        Ok((positions, gpu_time))
    }

    pub(crate) fn evaluate_distance_constraints_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        constraints: &[DistanceConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceDispatch, MetalRuntimeError> {
        if atom_count == 0
            || positions.is_empty()
            || !positions.len().is_multiple_of(atom_count as usize)
        {
            return resource_limit(
                "distance evaluation positions must contain complete non-empty conformers",
            );
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "distance evaluation positions must be finite".into(),
            ));
        }
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
            })?;
        let constraint_count = u32::try_from(constraints.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("constraint count exceeds uint32".into())
        })?;
        for constraint in constraints {
            if constraint.left_atom >= atom_count
                || constraint.right_atom >= atom_count
                || constraint.left_atom == constraint.right_atom
                || !constraint.lower_squared.is_finite()
                || !constraint.upper_squared.is_finite()
                || constraint.lower_squared < 0.0
                || constraint.upper_squared <= 0.0
                || constraint.upper_squared < constraint.lower_squared
                || !constraint.weight.is_finite()
                || constraint.weight < 0.0
            {
                return Err(MetalRuntimeError::Dispatch(
                    "distance constraint is outside the supported domain".into(),
                ));
            }
        }
        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        if item_count > u64::from(u32::MAX) {
            return resource_limit("distance evaluation grid exceeds uint32");
        }
        let constraint_storage_count = u64::from(constraint_count).max(1);
        let constraint_bytes = constraint_storage_count
            .checked_mul(60)
            .ok_or_else(memory_overflow)?;
        let item_bytes = item_count.checked_mul(72).ok_or_else(memory_overflow)?;
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(32)
            .and_then(|bytes| bytes.checked_add(constraint_bytes))
            .and_then(|bytes| bytes.checked_add(item_bytes))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "distance evaluation requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }

        let mut pairs = constraints
            .iter()
            .map(|term| [term.left_atom, term.right_atom])
            .collect::<Vec<_>>();
        let mut bounds = constraints
            .iter()
            .map(|term| [term.lower_squared, term.upper_squared])
            .collect::<Vec<_>>();
        let mut weights = constraints
            .iter()
            .map(|term| term.weight)
            .collect::<Vec<_>>();
        if constraints.is_empty() {
            pairs.push([0, 0]);
            bounds.push([0.0, 0.0]);
            weights.push(0.0);
        }
        let position_buffer = buffer_with_slice(&self.device, positions);
        let pair_buffer = buffer_with_slice(&self.device, &pairs);
        let bounds_buffer = buffer_with_slice(&self.device, &bounds);
        let weight_buffer = buffer_with_slice(&self.device, &weights);
        let energy_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; positions.len()]);
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; positions.len()]);
        let batch = ConformerDistanceBatchV1 {
            atom_count,
            conformer_count,
            constraint_count,
            reserved: 0,
        };
        let thread_width = self
            .conformer_distance_pipeline
            .thread_execution_width()
            .min(
                self.conformer_distance_pipeline
                    .max_total_threads_per_threadgroup(),
            );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal distance pipeline advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_distance_pipeline);
            encoder.set_buffer(0, Some(&position_buffer), 0);
            encoder.set_buffer(1, Some(&pair_buffer), 0);
            encoder.set_buffer(2, Some(&bounds_buffer), 0);
            encoder.set_buffer(3, Some(&weight_buffer), 0);
            encoder.set_bytes(
                4,
                size_of_val(&batch) as u64,
                (&batch as *const ConformerDistanceBatchV1).cast(),
            );
            encoder.set_buffer(5, Some(&energy_buffer), 0);
            encoder.set_buffer(6, Some(&gradient_buffer), 0);
            encoder.dispatch_threads(
                MTLSize {
                    width: item_count,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        let energies = read_buffer::<f32>(&energy_buffer, positions.len(), "atom energy")?;
        let gradients =
            read_buffer::<[f32; 4]>(&gradient_buffer, positions.len(), "distance gradient")?;
        Ok(MetalDistanceDispatch {
            atom_energies: energies,
            gradients,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn optimize_distance_geometry_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        constraints: &[DistanceConstraint],
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimizationDispatch, MetalRuntimeError> {
        let options = options
            .validate()
            .map_err(|error| MetalRuntimeError::ResourceLimit(error.to_string()))?;
        if atom_count == 0
            || positions.is_empty()
            || !positions.len().is_multiple_of(atom_count as usize)
        {
            return resource_limit(
                "distance optimization positions must contain complete non-empty conformers",
            );
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "distance optimization positions must be finite".into(),
            ));
        }
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
            })?;
        let constraint_count = u32::try_from(constraints.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("constraint count exceeds uint32".into())
        })?;
        for constraint in constraints {
            if constraint.left_atom >= atom_count
                || constraint.right_atom >= atom_count
                || constraint.left_atom == constraint.right_atom
                || !constraint.lower_squared.is_finite()
                || !constraint.upper_squared.is_finite()
                || constraint.lower_squared < 0.0
                || constraint.upper_squared <= 0.0
                || constraint.upper_squared < constraint.lower_squared
                || !constraint.weight.is_finite()
                || constraint.weight < 0.0
            {
                return Err(MetalRuntimeError::Dispatch(
                    "distance constraint is outside the supported domain".into(),
                ));
            }
        }

        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        let history_count = item_count
            .checked_mul(u64::from(options.history_size))
            .ok_or_else(memory_overflow)?;
        let scalar_history_count = u64::from(conformer_count)
            .checked_mul(u64::from(options.history_size))
            .ok_or_else(memory_overflow)?;
        let constraint_storage_count = u64::from(constraint_count).max(1);
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(48)
            .and_then(|bytes| bytes.checked_add(constraint_storage_count.checked_mul(60)?))
            .and_then(|bytes| bytes.checked_add(item_count.checked_mul(112)?))
            .and_then(|bytes| bytes.checked_add(history_count.checked_mul(48)?))
            .and_then(|bytes| bytes.checked_add(scalar_history_count.checked_mul(12)?))
            .and_then(|bytes| bytes.checked_add(u64::from(conformer_count).checked_mul(32)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "distance optimization requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let item_len = usize::try_from(item_count).map_err(|_| memory_overflow())?;
        let history_len = usize::try_from(history_count).map_err(|_| memory_overflow())?;
        let scalar_history_len =
            usize::try_from(scalar_history_count).map_err(|_| memory_overflow())?;
        let conformer_len = conformer_count as usize;

        let mut pairs = constraints
            .iter()
            .map(|term| [term.left_atom, term.right_atom])
            .collect::<Vec<_>>();
        let mut bounds = constraints
            .iter()
            .map(|term| [term.lower_squared, term.upper_squared])
            .collect::<Vec<_>>();
        let mut weights = constraints
            .iter()
            .map(|term| term.weight)
            .collect::<Vec<_>>();
        if constraints.is_empty() {
            pairs.push([0, 0]);
            bounds.push([0.0, 1.0]);
            weights.push(0.0);
        }
        let position_buffer = buffer_with_slice(&self.device, positions);
        let pair_buffer = buffer_with_slice(&self.device, &pairs);
        let bounds_buffer = buffer_with_slice(&self.device, &bounds);
        let weight_buffer = buffer_with_slice(&self.device, &weights);
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let direction_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_position_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let history_step_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let history_gradient_buffer =
            buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let inverse_curvature_buffer =
            buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let alpha_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let energy_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let gradient_max_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let iteration_buffer = buffer_with_slice(&self.device, &vec![0_u32; conformer_len]);
        let status_buffer = buffer_with_slice(&self.device, &vec![3_u32; conformer_len]);
        let config = ConformerOptimizeConfigV1 {
            atom_count,
            conformer_count,
            constraint_count,
            max_iterations: options.max_iterations,
            history_size: u32::from(options.history_size),
            max_line_search_steps: u32::from(options.max_line_search_steps),
            reserved0: 0,
            reserved1: 0,
            gradient_tolerance: options.gradient_tolerance,
            relative_step_tolerance: options.relative_step_tolerance,
            armijo_coefficient: options.armijo_coefficient,
            max_step_factor: options.max_step_factor,
        };
        if self
            .conformer_optimize_pipeline
            .max_total_threads_per_threadgroup()
            < 32
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal optimizer pipeline cannot dispatch the required 32-thread group".into(),
            ));
        }

        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_optimize_pipeline);
            for (index, buffer) in [
                &position_buffer,
                &pair_buffer,
                &bounds_buffer,
                &weight_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer(index as u64, Some(buffer), 0);
            }
            encoder.set_bytes(
                4,
                size_of_val(&config) as u64,
                (&config as *const ConformerOptimizeConfigV1).cast(),
            );
            for (index, buffer) in [
                &gradient_buffer,
                &direction_buffer,
                &old_position_buffer,
                &old_gradient_buffer,
                &history_step_buffer,
                &history_gradient_buffer,
                &inverse_curvature_buffer,
                &alpha_buffer,
                &energy_buffer,
                &gradient_max_buffer,
                &iteration_buffer,
                &status_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer((index + 5) as u64, Some(buffer), 0);
            }
            encoder.dispatch_thread_groups(
                MTLSize {
                    width: u64::from(conformer_count),
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: 32,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalDistanceOptimizationDispatch {
            positions: read_buffer(&position_buffer, item_len, "optimized position")?,
            energies: read_buffer(&energy_buffer, conformer_len, "optimized energy")?,
            scaled_gradient_maxima: read_buffer(
                &gradient_max_buffer,
                conformer_len,
                "optimized gradient maximum",
            )?,
            iterations: read_buffer(&iteration_buffer, conformer_len, "optimizer iteration")?,
            statuses: read_buffer(&status_buffer, conformer_len, "optimizer status")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn validate_stereo_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        chiral: &[ChiralVolumeConstraint],
        tetrahedral: &[TetrahedralConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalStereoValidationDispatch, MetalRuntimeError> {
        if atom_count == 0
            || positions.is_empty()
            || !positions.len().is_multiple_of(atom_count as usize)
        {
            return resource_limit(
                "stereo validation positions must contain complete non-empty conformers",
            );
        }
        validate_stereo_constraints(atom_count as usize, chiral, tetrahedral)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        if tetrahedral
            .iter()
            .any(|constraint| constraint.in_fused_small_ring && constraint.atoms[0] >= atom_count)
        {
            return Err(MetalRuntimeError::Dispatch(
                "tetrahedral center is outside the supported atom range".into(),
            ));
        }
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
            })?;
        let chiral_count = u32::try_from(chiral.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("chiral term count exceeds uint32".into())
        })?;
        let tetrahedral_count = u32::try_from(tetrahedral.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("tetrahedral term count exceeds uint32".into())
        })?;
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(
                u64::try_from(positions.len())
                    .map_err(|_| memory_overflow())?
                    .checked_mul(32)
                    .ok_or_else(memory_overflow)?,
            )
            .and_then(|bytes| bytes.checked_add(u64::from(chiral_count).max(1).checked_mul(48)?))
            .and_then(|bytes| {
                bytes.checked_add(u64::from(tetrahedral_count).max(1).checked_mul(44)?)
            })
            .and_then(|bytes| bytes.checked_add(u64::from(conformer_count).checked_mul(8)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "stereo validation requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }

        let mut chiral_atoms = chiral.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut chiral_bounds = chiral
            .iter()
            .map(|term| [term.lower, term.upper])
            .collect::<Vec<_>>();
        if chiral_atoms.is_empty() {
            chiral_atoms.push([0; 4]);
            chiral_bounds.push([0.0; 2]);
        }
        let mut tetrahedral_atoms = tetrahedral
            .iter()
            .flat_map(|term| term.atoms)
            .collect::<Vec<_>>();
        let mut tetrahedral_flags = tetrahedral
            .iter()
            .map(|term| u32::from(term.in_fused_small_ring))
            .collect::<Vec<_>>();
        if tetrahedral_atoms.is_empty() {
            tetrahedral_atoms.extend([0; 5]);
            tetrahedral_flags.push(0);
        }
        let position_buffer = buffer_with_slice(&self.device, positions);
        let chiral_atom_buffer = buffer_with_slice(&self.device, &chiral_atoms);
        let chiral_bounds_buffer = buffer_with_slice(&self.device, &chiral_bounds);
        let tetrahedral_atom_buffer = buffer_with_slice(&self.device, &tetrahedral_atoms);
        let tetrahedral_flags_buffer = buffer_with_slice(&self.device, &tetrahedral_flags);
        let failure_buffer =
            buffer_with_slice(&self.device, &vec![0_u32; conformer_count as usize]);
        let batch = ConformerStereoBatchV1 {
            atom_count,
            conformer_count,
            chiral_count,
            tetrahedral_count,
        };
        let thread_width = self.conformer_stereo_pipeline.thread_execution_width().min(
            self.conformer_stereo_pipeline
                .max_total_threads_per_threadgroup(),
        );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal stereo pipeline advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_stereo_pipeline);
            for (index, buffer) in [
                &position_buffer,
                &chiral_atom_buffer,
                &chiral_bounds_buffer,
                &tetrahedral_atom_buffer,
                &tetrahedral_flags_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer(index as u64, Some(buffer), 0);
            }
            encoder.set_bytes(
                5,
                size_of_val(&batch) as u64,
                (&batch as *const ConformerStereoBatchV1).cast(),
            );
            encoder.set_buffer(6, Some(&failure_buffer), 0);
            encoder.dispatch_threads(
                MTLSize {
                    width: u64::from(conformer_count),
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        let failure_flags =
            read_buffer(&failure_buffer, conformer_count as usize, "stereo failure")?;
        if failure_flags.iter().any(|flags| flags & !0b111 != 0) {
            return Err(MetalRuntimeError::Dispatch(
                "Metal stereo validator returned unknown failure bits".into(),
            ));
        }
        Ok(MetalStereoValidationDispatch {
            failure_flags,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn evaluate_etk_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        torsions: &[EtkTorsionConstraint],
        impropers: &[EtkImproperConstraint],
        distances: &[EtkDistanceConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalEtkDispatch, MetalRuntimeError> {
        if atom_count == 0
            || positions.is_empty()
            || !positions.len().is_multiple_of(atom_count as usize)
        {
            return resource_limit("ETK positions must contain complete non-empty conformers");
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "ETK positions must be finite".into(),
            ));
        }
        validate_etk_geometry_constraints(atom_count as usize, torsions, impropers, distances)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
            })?;
        let torsion_count = u32::try_from(torsions.len())
            .map_err(|_| MetalRuntimeError::ResourceLimit("torsion count exceeds uint32".into()))?;
        let improper_count = u32::try_from(impropers.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("improper count exceeds uint32".into())
        })?;
        let distance_count = u32::try_from(distances.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("ETK distance count exceeds uint32".into())
        })?;
        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        if item_count > u64::from(u32::MAX) {
            return resource_limit("ETK evaluation grid exceeds uint32");
        }
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(item_count.checked_mul(52).ok_or_else(memory_overflow)?)
            .and_then(|bytes| bytes.checked_add(u64::from(torsion_count).max(1).checked_mul(62)?))
            .and_then(|bytes| bytes.checked_add(u64::from(improper_count).max(1).checked_mul(20)?))
            .and_then(|bytes| bytes.checked_add(u64::from(distance_count).max(1).checked_mul(20)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "ETK evaluation requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let mut torsion_atoms = torsions.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut torsion_coefficients = torsions
            .iter()
            .map(|term| term.coefficients)
            .collect::<Vec<_>>();
        let mut torsion_signs = torsions.iter().map(|term| term.signs).collect::<Vec<_>>();
        let mut improper_atoms = impropers.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut improper_weights = impropers.iter().map(|term| term.weight).collect::<Vec<_>>();
        let mut distance_atoms = distances.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut distance_bounds = distances
            .iter()
            .map(|term| [term.lower, term.upper])
            .collect::<Vec<_>>();
        let mut distance_weights = distances.iter().map(|term| term.weight).collect::<Vec<_>>();
        if torsion_atoms.is_empty() {
            torsion_atoms.push([0; 4]);
            torsion_coefficients.push([0.0; 6]);
            torsion_signs.push([0; 6]);
        }
        if improper_atoms.is_empty() {
            improper_atoms.push([0; 4]);
            improper_weights.push(0.0);
        }
        if distance_atoms.is_empty() {
            distance_atoms.push([0; 2]);
            distance_bounds.push([0.0; 2]);
            distance_weights.push(0.0);
        }
        let input_buffers = [
            buffer_with_slice(&self.device, positions),
            buffer_with_slice(&self.device, &torsion_atoms),
            buffer_with_slice(&self.device, &torsion_coefficients),
            buffer_with_slice(&self.device, &torsion_signs),
            buffer_with_slice(&self.device, &improper_atoms),
            buffer_with_slice(&self.device, &improper_weights),
            buffer_with_slice(&self.device, &distance_atoms),
            buffer_with_slice(&self.device, &distance_bounds),
            buffer_with_slice(&self.device, &distance_weights),
        ];
        let energy_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; positions.len()]);
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; positions.len()]);
        let batch = ConformerEtkBatchV1 {
            atom_count,
            conformer_count,
            torsion_count,
            improper_count,
            distance_count,
            reserved0: 0,
            reserved1: 0,
            reserved2: 0,
        };
        let thread_width = self.conformer_etk_pipeline.thread_execution_width().min(
            self.conformer_etk_pipeline
                .max_total_threads_per_threadgroup(),
        );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal ETK pipeline advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_etk_pipeline);
            for (index, buffer) in input_buffers.iter().enumerate() {
                encoder.set_buffer(index as u64, Some(buffer), 0);
            }
            encoder.set_bytes(
                9,
                size_of_val(&batch) as u64,
                (&batch as *const ConformerEtkBatchV1).cast(),
            );
            encoder.set_buffer(10, Some(&energy_buffer), 0);
            encoder.set_buffer(11, Some(&gradient_buffer), 0);
            encoder.dispatch_threads(
                MTLSize {
                    width: item_count,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalEtkDispatch {
            atom_energies: read_buffer(&energy_buffer, positions.len(), "ETK atom energy")?,
            gradients: read_buffer(&gradient_buffer, positions.len(), "ETK gradient")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn optimize_etk_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        terms: EtkGeometryTerms<'_>,
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimizationDispatch, MetalRuntimeError> {
        let EtkGeometryTerms {
            torsions,
            impropers,
            distances,
        } = terms;
        let options = options
            .validate()
            .map_err(|error| MetalRuntimeError::ResourceLimit(error.to_string()))?;
        if atom_count == 0
            || positions.is_empty()
            || !positions.len().is_multiple_of(atom_count as usize)
        {
            return resource_limit("ETK optimization requires complete non-empty conformers");
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "ETK optimization positions must be finite".into(),
            ));
        }
        validate_etk_geometry_constraints(atom_count as usize, torsions, impropers, distances)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into())
            })?;
        let torsion_count = u32::try_from(torsions.len())
            .map_err(|_| MetalRuntimeError::ResourceLimit("torsion count exceeds uint32".into()))?;
        let improper_count = u32::try_from(impropers.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("improper count exceeds uint32".into())
        })?;
        let distance_count = u32::try_from(distances.len()).map_err(|_| {
            MetalRuntimeError::ResourceLimit("ETK distance count exceeds uint32".into())
        })?;
        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        let history_count = item_count
            .checked_mul(u64::from(options.history_size))
            .ok_or_else(memory_overflow)?;
        let scalar_history_count = u64::from(conformer_count)
            .checked_mul(u64::from(options.history_size))
            .ok_or_else(memory_overflow)?;
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(48)
            .and_then(|bytes| bytes.checked_add(u64::from(torsion_count).max(1).checked_mul(62)?))
            .and_then(|bytes| bytes.checked_add(u64::from(improper_count).max(1).checked_mul(20)?))
            .and_then(|bytes| bytes.checked_add(u64::from(distance_count).max(1).checked_mul(20)?))
            .and_then(|bytes| bytes.checked_add(item_count.checked_mul(112)?))
            .and_then(|bytes| bytes.checked_add(history_count.checked_mul(48)?))
            .and_then(|bytes| bytes.checked_add(scalar_history_count.checked_mul(12)?))
            .and_then(|bytes| bytes.checked_add(u64::from(conformer_count).checked_mul(32)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "ETK optimization requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let item_len = usize::try_from(item_count).map_err(|_| memory_overflow())?;
        let history_len = usize::try_from(history_count).map_err(|_| memory_overflow())?;
        let scalar_history_len =
            usize::try_from(scalar_history_count).map_err(|_| memory_overflow())?;
        let conformer_len = conformer_count as usize;
        let mut torsion_atoms = torsions.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut torsion_coefficients = torsions
            .iter()
            .map(|term| term.coefficients)
            .collect::<Vec<_>>();
        let mut torsion_signs = torsions.iter().map(|term| term.signs).collect::<Vec<_>>();
        let mut improper_atoms = impropers.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut improper_weights = impropers.iter().map(|term| term.weight).collect::<Vec<_>>();
        let mut distance_atoms = distances.iter().map(|term| term.atoms).collect::<Vec<_>>();
        let mut distance_bounds = distances
            .iter()
            .map(|term| [term.lower, term.upper])
            .collect::<Vec<_>>();
        let mut distance_weights = distances.iter().map(|term| term.weight).collect::<Vec<_>>();
        if torsion_atoms.is_empty() {
            torsion_atoms.push([0; 4]);
            torsion_coefficients.push([0.0; 6]);
            torsion_signs.push([0; 6]);
        }
        if improper_atoms.is_empty() {
            improper_atoms.push([0; 4]);
            improper_weights.push(0.0);
        }
        if distance_atoms.is_empty() {
            distance_atoms.push([0; 2]);
            distance_bounds.push([0.0; 2]);
            distance_weights.push(0.0);
        }
        let input_buffers = [
            buffer_with_slice(&self.device, positions),
            buffer_with_slice(&self.device, &torsion_atoms),
            buffer_with_slice(&self.device, &torsion_coefficients),
            buffer_with_slice(&self.device, &torsion_signs),
            buffer_with_slice(&self.device, &improper_atoms),
            buffer_with_slice(&self.device, &improper_weights),
            buffer_with_slice(&self.device, &distance_atoms),
            buffer_with_slice(&self.device, &distance_bounds),
            buffer_with_slice(&self.device, &distance_weights),
        ];
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let direction_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_position_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let history_step_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let history_gradient_buffer =
            buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let inverse_curvature_buffer =
            buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let alpha_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let energy_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let gradient_max_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let iteration_buffer = buffer_with_slice(&self.device, &vec![0_u32; conformer_len]);
        let status_buffer = buffer_with_slice(&self.device, &vec![3_u32; conformer_len]);
        let config = ConformerEtkOptimizeConfigV1 {
            atom_count,
            conformer_count,
            torsion_count,
            improper_count,
            distance_count,
            max_iterations: options.max_iterations,
            history_size: u32::from(options.history_size),
            max_line_search_steps: u32::from(options.max_line_search_steps),
            gradient_tolerance: options.gradient_tolerance,
            relative_step_tolerance: options.relative_step_tolerance,
            armijo_coefficient: options.armijo_coefficient,
            max_step_factor: options.max_step_factor,
        };
        if self
            .conformer_etk_optimize_pipeline
            .max_total_threads_per_threadgroup()
            < 32
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal ETK optimizer cannot dispatch the required 32-thread group".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.conformer_etk_optimize_pipeline);
            for (index, buffer) in input_buffers.iter().enumerate() {
                encoder.set_buffer(index as u64, Some(buffer), 0);
            }
            encoder.set_bytes(
                9,
                size_of_val(&config) as u64,
                (&config as *const ConformerEtkOptimizeConfigV1).cast(),
            );
            for (index, buffer) in [
                &gradient_buffer,
                &direction_buffer,
                &old_position_buffer,
                &old_gradient_buffer,
                &history_step_buffer,
                &history_gradient_buffer,
                &inverse_curvature_buffer,
                &alpha_buffer,
                &energy_buffer,
                &gradient_max_buffer,
                &iteration_buffer,
                &status_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer((index + 10) as u64, Some(buffer), 0);
            }
            encoder.dispatch_thread_groups(
                MTLSize {
                    width: u64::from(conformer_count),
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: 32,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalDistanceOptimizationDispatch {
            positions: read_buffer(&input_buffers[0], item_len, "ETK optimized position")?,
            energies: read_buffer(&energy_buffer, conformer_len, "ETK optimized energy")?,
            scaled_gradient_maxima: read_buffer(
                &gradient_max_buffer,
                conformer_len,
                "ETK optimized gradient maximum",
            )?,
            iterations: read_buffer(&iteration_buffer, conformer_len, "ETK optimizer iteration")?,
            statuses: read_buffer(&status_buffer, conformer_len, "ETK optimizer status")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn align_and_score_profiled(
        &self,
        batch: MetalAlignmentBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalAlignmentDispatch, MetalRuntimeError> {
        if batch.pairs.is_empty() {
            return resource_limit("alignment batch must contain at least one pair");
        }
        validate_alignment_atoms("probe", batch.probe_atoms)?;
        validate_alignment_atoms("reference", batch.reference_atoms)?;
        let mut packed_pairs = Vec::with_capacity(batch.pairs.len());
        for (pair_index, pair) in batch.pairs.iter().enumerate() {
            let probe_end = pair
                .probe_atom_start
                .checked_add(pair.probe_atom_count)
                .ok_or_else(memory_overflow)?;
            let reference_end = pair
                .reference_atom_start
                .checked_add(pair.reference_atom_count)
                .ok_or_else(memory_overflow)?;
            let mapping_end = pair
                .mapping_start
                .checked_add(pair.mapping_count)
                .ok_or_else(memory_overflow)?;
            if pair.probe_atom_count == 0
                || pair.reference_atom_count == 0
                || probe_end > batch.probe_atoms.len() as u64
                || reference_end > batch.reference_atoms.len() as u64
                || mapping_end > batch.mappings.len() as u64
            {
                return resource_limit(format!(
                    "alignment pair {pair_index} has an out-of-range atom or mapping span"
                ));
            }
            match pair.mode {
                AlignmentMode::FixedPose if pair.mapping_count != 0 => {
                    return resource_limit(format!(
                        "fixed-pose alignment pair {pair_index} must not contain a mapping"
                    ));
                }
                AlignmentMode::MappedHorn if pair.mapping_count == 0 => {
                    return resource_limit(format!(
                        "mapped alignment pair {pair_index} requires an atom mapping"
                    ));
                }
                _ => {}
            }
            let mut probe_seen = HashSet::with_capacity(pair.mapping_count as usize);
            let mut reference_seen = HashSet::with_capacity(pair.mapping_count as usize);
            for mapping in &batch.mappings[pair.mapping_start as usize..mapping_end as usize] {
                if u64::from(mapping.probe_atom) >= pair.probe_atom_count
                    || u64::from(mapping.reference_atom) >= pair.reference_atom_count
                    || !mapping.weight.is_finite()
                    || mapping.weight <= 0.0
                    || !probe_seen.insert(mapping.probe_atom)
                    || !reference_seen.insert(mapping.reference_atom)
                {
                    return resource_limit(format!(
                        "alignment pair {pair_index} has an invalid or duplicate mapping"
                    ));
                }
            }
            packed_pairs.push(AlignmentPairV1 {
                probe_atom_start: pair.probe_atom_start,
                probe_atom_count: pair.probe_atom_count,
                reference_atom_start: pair.reference_atom_start,
                reference_atom_count: pair.reference_atom_count,
                mapping_start: pair.mapping_start,
                mapping_count: pair.mapping_count,
                flags: u64::from(pair.mode == AlignmentMode::MappedHorn),
                reserved: 0,
            });
        }
        let probe_count = u64::try_from(batch.probe_atoms.len()).map_err(|_| memory_overflow())?;
        let reference_count =
            u64::try_from(batch.reference_atoms.len()).map_err(|_| memory_overflow())?;
        let mapping_count = u64::try_from(batch.mappings.len()).map_err(|_| memory_overflow())?;
        let pair_count = u64::try_from(batch.pairs.len()).map_err(|_| memory_overflow())?;
        if pair_count > u64::from(u32::MAX) {
            return resource_limit("alignment pair count exceeds uint32");
        }
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(
                probe_count
                    .checked_add(reference_count)
                    .and_then(|count| count.checked_mul(60))
                    .ok_or_else(memory_overflow)?,
            )
            .and_then(|bytes| bytes.checked_add(mapping_count.max(1).checked_mul(32)?))
            .and_then(|bytes| bytes.checked_add(pair_count.checked_mul(228)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "alignment batch requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }

        let probe_positions = batch
            .probe_atoms
            .iter()
            .map(|atom| atom.position)
            .collect::<Vec<_>>();
        let probe_parameters = batch
            .probe_atoms
            .iter()
            .map(|atom| {
                [
                    atom.gaussian_exponent,
                    atom.gaussian_amplitude,
                    atom.partial_charge,
                    0.0,
                ]
            })
            .collect::<Vec<_>>();
        let reference_positions = batch
            .reference_atoms
            .iter()
            .map(|atom| atom.position)
            .collect::<Vec<_>>();
        let reference_parameters = batch
            .reference_atoms
            .iter()
            .map(|atom| {
                [
                    atom.gaussian_exponent,
                    atom.gaussian_amplitude,
                    atom.partial_charge,
                    0.0,
                ]
            })
            .collect::<Vec<_>>();
        let mut packed_mappings = batch
            .mappings
            .iter()
            .map(|mapping| AtomMappingV1 {
                probe_atom: mapping.probe_atom,
                reference_atom: mapping.reference_atom,
                weight: mapping.weight,
                reserved: 0,
            })
            .collect::<Vec<_>>();
        if packed_mappings.is_empty() {
            packed_mappings.push(AtomMappingV1::default());
        }
        let input_buffers = [
            buffer_with_slice(&self.device, &probe_positions),
            buffer_with_slice(&self.device, &probe_parameters),
            buffer_with_slice(&self.device, &reference_positions),
            buffer_with_slice(&self.device, &reference_parameters),
            buffer_with_slice(&self.device, &packed_mappings),
            buffer_with_slice(&self.device, &packed_pairs),
        ];
        let transform_buffer =
            buffer_with_slice(&self.device, &vec![[[0.0_f32; 4]; 4]; batch.pairs.len()]);
        let primary_buffer =
            buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; batch.pairs.len()]);
        let secondary_buffer =
            buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; batch.pairs.len()]);
        let status_buffer =
            buffer_with_slice(&self.device, &vec![0x8000_0000_u32; batch.pairs.len()]);
        let thread_width = self.alignment_score_pipeline.thread_execution_width().min(
            self.alignment_score_pipeline
                .max_total_threads_per_threadgroup(),
        );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal alignment pipeline advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.alignment_score_pipeline);
            for (index, buffer) in input_buffers.iter().enumerate() {
                encoder.set_buffer(index as u64, Some(buffer), 0);
            }
            for (index, buffer) in [
                &transform_buffer,
                &primary_buffer,
                &secondary_buffer,
                &status_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer((index + 6) as u64, Some(buffer), 0);
            }
            encoder.dispatch_threads(
                MTLSize {
                    width: pair_count,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalAlignmentDispatch {
            transforms: read_buffer(&transform_buffer, batch.pairs.len(), "alignment transform")?,
            primary_scores: read_buffer(
                &primary_buffer,
                batch.pairs.len(),
                "alignment primary score",
            )?,
            secondary_scores: read_buffer(
                &secondary_buffer,
                batch.pairs.len(),
                "alignment secondary score",
            )?,
            statuses: read_buffer(&status_buffer, batch.pairs.len(), "alignment status")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn evaluate_mmff_profiled(
        &self,
        positions: &[[f32; 4]],
        parameters: &MmffParameters,
        max_memory_bytes: u64,
    ) -> Result<MetalMmffDispatch, MetalRuntimeError> {
        validate_mmff_parameters(parameters)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let atom_count = parameters.atom_count;
        if positions.is_empty() || !positions.len().is_multiple_of(atom_count as usize) {
            return resource_limit("MMFF positions must contain complete non-empty conformers");
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "MMFF positions must be finite".into(),
            ));
        }
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("MMFF conformer count exceeds uint32".into())
            })?;
        let (batch, packed_terms, term_count) = pack_mmff_terms(parameters, conformer_count)?;
        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        // Unified-memory peak includes the caller coordinates, mutable Metal
        // coordinates, gradient buffer plus returned gradient Vec, both
        // breakdown views, and caller/packed/Metal representations of terms.
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(item_count.checked_mul(64).ok_or_else(memory_overflow)?)
            .and_then(|bytes| bytes.checked_add(u64::from(conformer_count).checked_mul(64)?))
            .and_then(|bytes| bytes.checked_add(term_count.checked_mul(144)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "MMFF evaluation requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }

        let position_buffer = buffer_with_slice(&self.device, positions);
        let term_buffers = packed_terms
            .each_ref()
            .map(|terms| buffer_with_slice(&self.device, terms));
        let breakdown_buffer = buffer_with_slice(
            &self.device,
            &vec![[0.0_f32; 4]; conformer_count as usize * 2],
        );
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; positions.len()]);
        let mut gpu_time_seconds = 0.0;
        for (pipeline, output) in [
            (&self.mmff_energy_pipeline, &breakdown_buffer),
            (&self.mmff_gradient_pipeline, &gradient_buffer),
        ] {
            let thread_width = pipeline
                .thread_execution_width()
                .min(pipeline.max_total_threads_per_threadgroup());
            if thread_width == 0 {
                return Err(MetalRuntimeError::KernelUnavailable(
                    "Metal MMFF pipeline advertises zero thread width".into(),
                ));
            }
            gpu_time_seconds += autoreleasepool(|| {
                let command = self.queue.new_command_buffer();
                let encoder = command.new_compute_command_encoder();
                encoder.set_compute_pipeline_state(pipeline);
                encoder.set_buffer(0, Some(&position_buffer), 0);
                encoder.set_bytes(
                    1,
                    size_of_val(&batch) as u64,
                    (&batch as *const MmffBatchV1).cast(),
                );
                for (index, buffer) in term_buffers.iter().enumerate() {
                    encoder.set_buffer((index + 2) as u64, Some(buffer), 0);
                }
                encoder.set_buffer(9, Some(output), 0);
                encoder.dispatch_threads(
                    MTLSize {
                        width: u64::from(conformer_count),
                        height: 1,
                        depth: 1,
                    },
                    MTLSize {
                        width: thread_width,
                        height: 1,
                        depth: 1,
                    },
                );
                encoder.end_encoding();
                command.commit();
                command.wait_until_completed();
                completed_gpu_time(command)
            })?;
        }
        Ok(MetalMmffDispatch {
            breakdown_vectors: read_buffer(
                &breakdown_buffer,
                conformer_count as usize * 2,
                "MMFF energy breakdown",
            )?,
            gradients: read_buffer(&gradient_buffer, positions.len(), "MMFF gradient")?,
            gpu_time_seconds,
        })
    }

    pub(crate) fn contract_rm1_pair_fock_profiled(
        &self,
        orbital_count: u32,
        density: &[f32],
        pairs: &[Rm1FockPair],
        max_memory_bytes: u64,
    ) -> Result<MetalRm1FockDispatch, MetalRuntimeError> {
        let matrix_len = usize::try_from(orbital_count)
            .ok()
            .and_then(|count| count.checked_mul(count))
            .ok_or_else(memory_overflow)?;
        if orbital_count == 0
            || orbital_count > 256
            || density.len() != matrix_len
            || density.iter().any(|value| !value.is_finite())
        {
            return resource_limit(
                "RM1 Fock contraction requires a finite square density matrix through 256 orbitals",
            );
        }
        let mut descriptors = Vec::with_capacity(pairs.len().max(1));
        let mut repulsion = Vec::with_capacity(pairs.len().max(1) * 256);
        for (pair_index, pair) in pairs.iter().enumerate() {
            if pair.repulsion_ev.len() != 256
                || pair.left_orbital_count == 0
                || pair.left_orbital_count > 4
                || pair.right_orbital_count == 0
                || pair.right_orbital_count > 4
                || pair.left_orbital_start + pair.left_orbital_count > orbital_count as usize
                || pair.right_orbital_start + pair.right_orbital_count > orbital_count as usize
                || pair.repulsion_ev.iter().any(|value| !value.is_finite())
            {
                return resource_limit(format!(
                    "RM1 Fock pair {pair_index} has an invalid orbital span or tensor"
                ));
            }
            descriptors.push(Rm1FockPairV1 {
                left_start: pair.left_orbital_start as u32,
                left_count: pair.left_orbital_count as u32,
                right_start: pair.right_orbital_start as u32,
                right_count: pair.right_orbital_count as u32,
                tensor_start: repulsion.len() as u32,
                reserved: 0,
            });
            repulsion.extend(pair.repulsion_ev.iter().map(|value| *value as f32));
        }
        let pair_count = u32::try_from(pairs.len()).map_err(|_| memory_overflow())?;
        if descriptors.is_empty() {
            descriptors.push(Rm1FockPairV1 {
                left_start: 0,
                left_count: 1,
                right_start: 0,
                right_count: 1,
                tensor_start: 0,
                reserved: 0,
            });
            repulsion.resize(256, 0.0);
        }
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(
                (matrix_len as u64)
                    .checked_mul(12)
                    .ok_or_else(memory_overflow)?,
            )
            .and_then(|bytes| bytes.checked_add((descriptors.len() as u64).checked_mul(24)?))
            .and_then(|bytes| bytes.checked_add((repulsion.len() as u64).checked_mul(4)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "RM1 Fock contraction requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let density_buffer = buffer_with_slice(&self.device, density);
        let pair_buffer = buffer_with_slice(&self.device, &descriptors);
        let repulsion_buffer = buffer_with_slice(&self.device, &repulsion);
        let output_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; matrix_len]);
        let thread_width = self
            .rm1_fock_pipeline
            .thread_execution_width()
            .min(self.rm1_fock_pipeline.max_total_threads_per_threadgroup());
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal RM1 Fock pipeline advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.rm1_fock_pipeline);
            encoder.set_buffer(0, Some(&density_buffer), 0);
            encoder.set_buffer(1, Some(&pair_buffer), 0);
            encoder.set_buffer(2, Some(&repulsion_buffer), 0);
            encoder.set_bytes(
                3,
                size_of_val(&orbital_count) as u64,
                (&orbital_count as *const u32).cast(),
            );
            encoder.set_bytes(
                4,
                size_of_val(&pair_count) as u64,
                (&pair_count as *const u32).cast(),
            );
            encoder.set_buffer(5, Some(&output_buffer), 0);
            encoder.dispatch_threads(
                MTLSize {
                    width: matrix_len as u64,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalRm1FockDispatch {
            contribution_ev: read_buffer(&output_buffer, matrix_len, "RM1 Fock contribution")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn symmetric_eigen_profiled(
        &self,
        matrix: &[f32],
        order: u32,
        max_memory_bytes: u64,
    ) -> Result<MetalSymmetricEigenDispatch, MetalRuntimeError> {
        let matrix_len = usize::try_from(order)
            .ok()
            .and_then(|value| value.checked_mul(value))
            .ok_or_else(memory_overflow)?;
        if order == 0
            || order > 32
            || matrix.len() != matrix_len
            || matrix.iter().any(|value| !value.is_finite())
        {
            return resource_limit(
                "Metal symmetric eigensolver requires a finite square matrix through order 32",
            );
        }
        let required_bytes = MEMORY_HEADROOM_BYTES + 1024 * 4 * 3 + 32 * 4 + 8;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "Metal symmetric eigensolver requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let mut padded = vec![0.0_f32; 1024];
        for row in 0..order as usize {
            for column in 0..order as usize {
                padded[row * 32 + column] = matrix[row * order as usize + column];
            }
        }
        let matrix_buffer = buffer_with_slice(&self.device, &padded);
        let order_buffer = buffer_with_slice(&self.device, &[order]);
        let eigenvalue_buffer = buffer_with_slice(&self.device, &[0.0_f32; 32]);
        let eigenvector_buffer = buffer_with_slice(&self.device, &[0.0_f32; 1024]);
        let status_buffer = buffer_with_slice(&self.device, &[u32::MAX]);
        let matrix_count = 1_u32;
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.rm1_eigen_pipeline);
            encoder.set_buffer(0, Some(&matrix_buffer), 0);
            encoder.set_buffer(1, Some(&order_buffer), 0);
            encoder.set_bytes(
                2,
                size_of_val(&matrix_count) as u64,
                (&matrix_count as *const u32).cast(),
            );
            encoder.set_buffer(3, Some(&eigenvalue_buffer), 0);
            encoder.set_buffer(4, Some(&eigenvector_buffer), 0);
            encoder.set_buffer(5, Some(&status_buffer), 0);
            encoder.dispatch_thread_groups(
                MTLSize {
                    width: 1,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: 32,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        let padded_vectors =
            read_buffer::<f32>(&eigenvector_buffer, 1024, "RM1 symmetric eigenvector")?;
        let mut eigenvectors = vec![0.0; matrix_len];
        for row in 0..order as usize {
            for column in 0..order as usize {
                eigenvectors[row * order as usize + column] = padded_vectors[row * 32 + column];
            }
        }
        let mut eigenvalues = read_buffer(&eigenvalue_buffer, 32, "RM1 eigenvalue")?;
        eigenvalues.truncate(order as usize);
        Ok(MetalSymmetricEigenDispatch {
            eigenvalues,
            eigenvectors,
            status: read_buffer::<u32>(&status_buffer, 1, "RM1 eigensolver status")?[0],
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn evaluate_pm6_h4_hh_profiled(
        &self,
        batch: MetalPm6CorrectionBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalPm6H4HhDispatch, MetalRuntimeError> {
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(
                u64::try_from(batch.atoms.len())
                    .map_err(|_| memory_overflow())?
                    .checked_mul(std::mem::size_of::<Pm6CorrectionAtomV1>() as u64)
                    .ok_or_else(memory_overflow)?,
            )
            .and_then(|bytes| {
                bytes.checked_add(u64::try_from(batch.molecules.len()).ok()?.checked_mul(
                    (std::mem::size_of::<Pm6CorrectionMoleculeV1>()
                        + std::mem::size_of::<[f32; 2]>()) as u64,
                )?)
            })
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "PM6 H4/HH correction requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let atoms = batch
            .atoms
            .iter()
            .map(|atom| {
                let radius = pm6_h4_covalent_radius(atom.atomic_number).ok_or_else(|| {
                    MetalRuntimeError::Dispatch(format!(
                        "PM6 H4/HH correction does not support atomic number {}",
                        atom.atomic_number
                    ))
                })?;
                Ok(Pm6CorrectionAtomV1 {
                    position_radius: [
                        atom.position_angstrom[0] as f32,
                        atom.position_angstrom[1] as f32,
                        atom.position_angstrom[2] as f32,
                        radius as f32,
                    ],
                    identity: [u32::from(atom.atomic_number), 0, 0, 0],
                })
            })
            .collect::<Result<Vec<_>, MetalRuntimeError>>()?;
        let molecules = batch
            .molecules
            .iter()
            .map(|molecule| {
                Ok(Pm6CorrectionMoleculeV1 {
                    span: [
                        u32::try_from(molecule.atom_start).map_err(|_| memory_overflow())?,
                        u32::try_from(molecule.atom_count).map_err(|_| memory_overflow())?,
                        0,
                        0,
                    ],
                })
            })
            .collect::<Result<Vec<_>, MetalRuntimeError>>()?;
        let atom_buffer = buffer_with_slice(&self.device, &atoms);
        let molecule_buffer = buffer_with_slice(&self.device, &molecules);
        let output_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 2]; molecules.len()]);
        let molecule_count = u32::try_from(molecules.len()).map_err(|_| memory_overflow())?;
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.pm6_h4_hh_pipeline);
            encoder.set_buffer(0, Some(&atom_buffer), 0);
            encoder.set_buffer(1, Some(&molecule_buffer), 0);
            encoder.set_bytes(
                2,
                size_of_val(&molecule_count) as u64,
                (&molecule_count as *const u32).cast(),
            );
            encoder.set_buffer(3, Some(&output_buffer), 0);
            let thread_width = self
                .pm6_h4_hh_pipeline
                .thread_execution_width()
                .min(u64::from(molecule_count))
                .max(1);
            encoder.dispatch_threads(
                MTLSize {
                    width: u64::from(molecule_count),
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalPm6H4HhDispatch {
            corrections_ev: read_buffer(&output_buffer, molecules.len(), "PM6 H4/HH correction")?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn prepare_rm1_pairs_profiled(
        &self,
        molecule: &SemiempiricalMolecule,
        max_memory_bytes: u64,
    ) -> Result<MetalRm1PairRotationDispatch, MetalRuntimeError> {
        let pair_count = molecule
            .atoms
            .len()
            .saturating_mul(molecule.atoms.len().saturating_sub(1))
            / 2;
        if pair_count == 0 {
            return Ok(MetalRm1PairRotationDispatch {
                repulsion_ev: Vec::new(),
                left_core_attraction_ev: Vec::new(),
                right_core_attraction_ev: Vec::new(),
                gpu_time_seconds: 0.0,
            });
        }
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(
                u64::try_from(pair_count)
                    .map_err(|_| memory_overflow())?
                    .checked_mul(48 + 64 + 256 * 4 + 2 * 16 * 4)
                    .ok_or_else(memory_overflow)?,
            )
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "RM1 pair rotation requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let mut descriptors = Vec::with_capacity(pair_count);
        let mut pair_parameters = Vec::with_capacity(pair_count);
        for left_index in 0..molecule.atoms.len() {
            for right_index in (left_index + 1)..molecule.atoms.len() {
                let left_atom = &molecule.atoms[left_index];
                let right_atom = &molecule.atoms[right_index];
                let left = semiempirical_parameters(molecule.method, left_atom.atomic_number)
                    .ok_or_else(|| {
                        MetalRuntimeError::Dispatch(
                            "RM1 pair has an unsupported left element".into(),
                        )
                    })?;
                let right = semiempirical_parameters(molecule.method, right_atom.atomic_number)
                    .ok_or_else(|| {
                        MetalRuntimeError::Dispatch(
                            "RM1 pair has an unsupported right element".into(),
                        )
                    })?;
                let delta = [
                    right_atom.position_angstrom[0] - left_atom.position_angstrom[0],
                    right_atom.position_angstrom[1] - left_atom.position_angstrom[1],
                    right_atom.position_angstrom[2] - left_atom.position_angstrom[2],
                ];
                let left_multipole = rm1_multipole_parameters(left);
                let right_multipole = rm1_multipole_parameters(right);
                let model = match (left.orbital_count == 1, right.orbital_count == 1) {
                    (true, true) => 0,
                    (false, false) => 2,
                    _ => 1,
                };
                let heavy_is_left = left.orbital_count > 1;
                pair_parameters.push(Rm1PairParametersV1 {
                    left0: [
                        left_multipole.dipole_separation_bohr as f32,
                        left_multipole.quadrupole_separation_bohr as f32,
                        left_multipole.rho_monopole_bohr as f32,
                        left_multipole.rho_dipole_bohr as f32,
                    ],
                    left1: [left_multipole.rho_quadrupole_bohr as f32, 0.0, 0.0, 0.0],
                    right0: [
                        right_multipole.dipole_separation_bohr as f32,
                        right_multipole.quadrupole_separation_bohr as f32,
                        right_multipole.rho_monopole_bohr as f32,
                        right_multipole.rho_dipole_bohr as f32,
                    ],
                    right1: [right_multipole.rho_quadrupole_bohr as f32, 0.0, 0.0, 0.0],
                });
                descriptors.push(Rm1PairRotationV1 {
                    spans: [
                        u32::try_from(molecule.orbital_offsets[left_index])
                            .map_err(|_| memory_overflow())?,
                        u32::from(left.orbital_count),
                        u32::try_from(molecule.orbital_offsets[right_index])
                            .map_err(|_| memory_overflow())?,
                        u32::from(right.orbital_count),
                    ],
                    model: [
                        model,
                        u32::from(heavy_is_left),
                        u32::from(left.valence_electrons),
                        u32::from(right.valence_electrons),
                    ],
                    delta: [delta[0] as f32, delta[1] as f32, delta[2] as f32, 0.0],
                });
            }
        }
        let descriptor_buffer = buffer_with_slice(&self.device, &descriptors);
        let parameter_buffer = buffer_with_slice(&self.device, &pair_parameters);
        let repulsion_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; pair_count * 256]);
        let left_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; pair_count * 16]);
        let right_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; pair_count * 16]);
        let pair_count_u32 = u32::try_from(pair_count).map_err(|_| memory_overflow())?;
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.rm1_pair_rotate_pipeline);
            encoder.set_buffer(0, Some(&descriptor_buffer), 0);
            encoder.set_buffer(1, Some(&parameter_buffer), 0);
            encoder.set_bytes(
                2,
                size_of_val(&pair_count_u32) as u64,
                (&pair_count_u32 as *const u32).cast(),
            );
            encoder.set_buffer(3, Some(&repulsion_buffer), 0);
            encoder.set_buffer(4, Some(&left_buffer), 0);
            encoder.set_buffer(5, Some(&right_buffer), 0);
            let thread_width = self
                .rm1_pair_rotate_pipeline
                .thread_execution_width()
                .min(pair_count as u64)
                .max(1);
            encoder.dispatch_threads(
                MTLSize {
                    width: pair_count as u64,
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalRm1PairRotationDispatch {
            repulsion_ev: read_buffer(&repulsion_buffer, pair_count * 256, "RM1 pair tensor")?,
            left_core_attraction_ev: read_buffer(
                &left_buffer,
                pair_count * 16,
                "RM1 left core attraction",
            )?,
            right_core_attraction_ev: read_buffer(
                &right_buffer,
                pair_count * 16,
                "RM1 right core attraction",
            )?,
            gpu_time_seconds: gpu_time,
        })
    }

    pub(crate) fn optimize_mmff_profiled(
        &self,
        positions: &[[f32; 4]],
        parameters: &MmffParameters,
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalMmffOptimizationDispatch, MetalRuntimeError> {
        validate_mmff_parameters(parameters)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let options = options
            .validate()
            .map_err(|error| MetalRuntimeError::ResourceLimit(error.to_string()))?;
        let atom_count = parameters.atom_count;
        if positions.is_empty() || !positions.len().is_multiple_of(atom_count as usize) {
            return resource_limit("MMFF optimization requires complete non-empty conformers");
        }
        if positions.iter().flatten().any(|value| !value.is_finite()) {
            return Err(MetalRuntimeError::Dispatch(
                "MMFF optimization positions must be finite".into(),
            ));
        }
        let conformer_count =
            u32::try_from(positions.len() / atom_count as usize).map_err(|_| {
                MetalRuntimeError::ResourceLimit("MMFF conformer count exceeds uint32".into())
            })?;
        let (batch, packed_terms, term_count) = pack_mmff_terms(parameters, conformer_count)?;
        let item_count = u64::try_from(positions.len()).map_err(|_| memory_overflow())?;
        let use_bfgs = atom_count <= 32;
        let history_items = if use_bfgs {
            1
        } else {
            item_count
                .checked_mul(u64::from(options.history_size))
                .ok_or_else(memory_overflow)?
        };
        let scalar_history_items = if use_bfgs {
            1
        } else {
            u64::from(conformer_count)
                .checked_mul(u64::from(options.history_size))
                .ok_or_else(memory_overflow)?
        };
        let coordinate_count = u64::from(atom_count)
            .checked_mul(3)
            .ok_or_else(memory_overflow)?;
        let hessian_items = if use_bfgs {
            u64::from(conformer_count)
                .checked_mul(coordinate_count)
                .and_then(|value| value.checked_mul(coordinate_count))
                .ok_or_else(memory_overflow)?
        } else {
            1
        };
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(item_count.checked_mul(112).ok_or_else(memory_overflow)?)
            .and_then(|bytes| bytes.checked_add(history_items.checked_mul(32)?))
            .and_then(|bytes| bytes.checked_add(scalar_history_items.checked_mul(8)?))
            .and_then(|bytes| bytes.checked_add(hessian_items.checked_mul(8)?))
            .and_then(|bytes| bytes.checked_add(u64::from(conformer_count).checked_mul(48)?))
            .and_then(|bytes| bytes.checked_add(term_count.checked_mul(144)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "MMFF optimization requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let item_len = usize::try_from(item_count).map_err(|_| memory_overflow())?;
        let history_len = usize::try_from(history_items).map_err(|_| memory_overflow())?;
        let scalar_history_len =
            usize::try_from(scalar_history_items).map_err(|_| memory_overflow())?;
        let hessian_len = usize::try_from(hessian_items).map_err(|_| memory_overflow())?;
        let conformer_len = conformer_count as usize;
        let position_buffer = buffer_with_slice(&self.device, positions);
        let term_buffers = packed_terms
            .each_ref()
            .map(|terms| buffer_with_slice(&self.device, terms));
        let gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let direction_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_position_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let old_gradient_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; item_len]);
        let history_step_buffer = buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let history_delta_buffer =
            buffer_with_slice(&self.device, &vec![[0.0_f32; 4]; history_len]);
        let inverse_curvature_buffer =
            buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let alpha_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; scalar_history_len]);
        let hessian_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; hessian_len]);
        let energy_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let gradient_max_buffer = buffer_with_slice(&self.device, &vec![0.0_f32; conformer_len]);
        let iteration_buffer = buffer_with_slice(&self.device, &vec![0_u32; conformer_len]);
        let status_buffer = buffer_with_slice(&self.device, &vec![3_u32; conformer_len]);
        let optimizer_buffer = buffer_with_slice(&self.device, &vec![2_u32; conformer_len]);
        let config = MmffOptimizeConfigV1 {
            batch,
            max_iterations: options.max_iterations,
            history_size: u32::from(options.history_size),
            max_line_search_steps: u32::from(options.max_line_search_steps),
            bfgs_max_atoms: 32,
            gradient_tolerance: options.gradient_tolerance,
            relative_step_tolerance: options.relative_step_tolerance,
            armijo_coefficient: options.armijo_coefficient,
            max_step_factor: options.max_step_factor,
        };
        let thread_width = self.mmff_optimize_pipeline.thread_execution_width().min(
            self.mmff_optimize_pipeline
                .max_total_threads_per_threadgroup(),
        );
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal MMFF optimizer advertises zero thread width".into(),
            ));
        }
        let gpu_time = autoreleasepool(|| {
            let command = self.queue.new_command_buffer();
            let encoder = command.new_compute_command_encoder();
            encoder.set_compute_pipeline_state(&self.mmff_optimize_pipeline);
            encoder.set_buffer(0, Some(&position_buffer), 0);
            encoder.set_bytes(
                1,
                size_of_val(&config) as u64,
                (&config as *const MmffOptimizeConfigV1).cast(),
            );
            for (index, buffer) in term_buffers.iter().enumerate() {
                encoder.set_buffer((index + 2) as u64, Some(buffer), 0);
            }
            for (index, buffer) in [
                &gradient_buffer,
                &direction_buffer,
                &old_position_buffer,
                &old_gradient_buffer,
                &history_step_buffer,
                &history_delta_buffer,
                &inverse_curvature_buffer,
                &alpha_buffer,
                &hessian_buffer,
                &energy_buffer,
                &gradient_max_buffer,
                &iteration_buffer,
                &status_buffer,
                &optimizer_buffer,
            ]
            .into_iter()
            .enumerate()
            {
                encoder.set_buffer((index + 9) as u64, Some(buffer), 0);
            }
            encoder.dispatch_threads(
                MTLSize {
                    width: u64::from(conformer_count),
                    height: 1,
                    depth: 1,
                },
                MTLSize {
                    width: thread_width,
                    height: 1,
                    depth: 1,
                },
            );
            encoder.end_encoding();
            command.commit();
            command.wait_until_completed();
            completed_gpu_time(command)
        })?;
        Ok(MetalMmffOptimizationDispatch {
            positions: read_buffer(&position_buffer, item_len, "MMFF optimized position")?,
            energies: read_buffer(&energy_buffer, conformer_len, "MMFF optimized energy")?,
            scaled_gradient_maxima: read_buffer(
                &gradient_max_buffer,
                conformer_len,
                "MMFF optimized gradient maximum",
            )?,
            iterations: read_buffer(&iteration_buffer, conformer_len, "MMFF optimizer iteration")?,
            statuses: read_buffer(&status_buffer, conformer_len, "MMFF optimizer status")?,
            optimizers: read_buffer(&optimizer_buffer, conformer_len, "MMFF optimizer kind")?,
            gpu_time_seconds: gpu_time,
        })
    }

    fn dispatch_tiles(
        &self,
        record_count: usize,
        cutoff: SimilarityCutoff,
        requested_tile: usize,
        pipeline: &ComputePipelineStateRef,
        bind: impl Fn(&ComputeCommandEncoderRef),
    ) -> Result<f64, MetalRuntimeError> {
        let tile_size = requested_tile.min(MAX_TILE_RECORDS);
        let thread_width = pipeline
            .thread_execution_width()
            .min(pipeline.max_total_threads_per_threadgroup());
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal pipeline advertises a zero thread width".into(),
            ));
        }
        let mut gpu_time_seconds = 0.0;
        for row_start in (0..record_count).step_by(tile_size) {
            let row_count = tile_size.min(record_count - row_start);
            for column_start in (0..record_count).step_by(tile_size) {
                let tile = TanimotoTileV1 {
                    record_count: record_count as u64,
                    row_start: row_start as u64,
                    row_count: row_count as u64,
                    column_start: column_start as u64,
                    column_count: tile_size.min(record_count - column_start) as u64,
                    cutoff_numerator: u64::from(cutoff.numerator),
                    cutoff_denominator: u64::from(cutoff.denominator),
                };
                gpu_time_seconds += autoreleasepool(|| {
                    let command = self.queue.new_command_buffer();
                    let encoder = command.new_compute_command_encoder();
                    encoder.set_compute_pipeline_state(pipeline);
                    bind(encoder);
                    encoder.set_bytes(
                        1,
                        size_of_val(&tile) as u64,
                        (&tile as *const TanimotoTileV1).cast(),
                    );
                    encoder.dispatch_threads(
                        MTLSize {
                            width: row_count as u64,
                            height: 1,
                            depth: 1,
                        },
                        MTLSize {
                            width: thread_width,
                            height: 1,
                            depth: 1,
                        },
                    );
                    encoder.end_encoding();
                    command.commit();
                    command.wait_until_completed();
                    completed_gpu_time(command)
                })?;
            }
        }
        Ok(gpu_time_seconds)
    }
}

fn validate_alignment_atoms(
    label: &str,
    atoms: &[burrete_compute_core::AlignmentAtom],
) -> Result<(), MetalRuntimeError> {
    if atoms.is_empty() {
        return resource_limit(format!("alignment {label} atom list must not be empty"));
    }
    if atoms.iter().any(|atom| {
        atom.position[..3].iter().any(|value| !value.is_finite())
            || !atom.gaussian_exponent.is_finite()
            || atom.gaussian_exponent <= 0.0
            || !atom.gaussian_amplitude.is_finite()
            || atom.gaussian_amplitude <= 0.0
            || !atom.partial_charge.is_finite()
    }) {
        return resource_limit(format!(
            "alignment {label} atoms require finite coordinates, positive Gaussian parameters, and finite charges"
        ));
    }
    Ok(())
}

fn pack_mmff_terms(
    parameters: &MmffParameters,
    conformer_count: u32,
) -> Result<(MmffBatchV1, [Vec<MmffTermV1>; 7], u64), MetalRuntimeError> {
    let count = |value: usize| {
        u32::try_from(value)
            .map_err(|_| MetalRuntimeError::ResourceLimit("MMFF term count exceeds uint32".into()))
    };
    let counts = [
        count(parameters.bonds.len())?,
        count(parameters.angles.len())?,
        count(parameters.stretch_bends.len())?,
        count(parameters.out_of_planes.len())?,
        count(parameters.torsions.len())?,
        count(parameters.van_der_waals.len())?,
        count(parameters.electrostatics.len())?,
    ];
    let term_count = counts
        .iter()
        .try_fold(0_u64, |total, count| {
            total.checked_add(u64::from(*count).max(1))
        })
        .ok_or_else(memory_overflow)?;
    let mut groups = [
        parameters
            .bonds
            .iter()
            .map(|term| MmffTermV1 {
                atoms: [term.atoms[0], term.atoms[1], 0, 0],
                parameters0: [term.force_constant, term.equilibrium_distance, 0.0, 0.0],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
        parameters
            .angles
            .iter()
            .map(|term| MmffTermV1 {
                atoms: [term.atoms[0], term.atoms[1], term.atoms[2], 0],
                parameters0: [
                    term.force_constant,
                    term.equilibrium_degrees,
                    u8::from(term.linear) as f32,
                    0.0,
                ],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
        parameters
            .stretch_bends
            .iter()
            .map(|term| MmffTermV1 {
                atoms: [term.atoms[0], term.atoms[1], term.atoms[2], 0],
                parameters0: [
                    term.force_ij,
                    term.force_kj,
                    term.equilibrium_ij,
                    term.equilibrium_kj,
                ],
                parameters1: [term.equilibrium_degrees, 0.0, 0.0, 0.0],
            })
            .collect::<Vec<_>>(),
        parameters
            .out_of_planes
            .iter()
            .map(|term| MmffTermV1 {
                atoms: term.atoms,
                parameters0: [term.force_constant, 0.0, 0.0, 0.0],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
        parameters
            .torsions
            .iter()
            .map(|term| MmffTermV1 {
                atoms: term.atoms,
                parameters0: [term.v1, term.v2, term.v3, 0.0],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
        parameters
            .van_der_waals
            .iter()
            .map(|term| MmffTermV1 {
                atoms: [term.atoms[0], term.atoms[1], 0, 0],
                parameters0: [term.r_star, term.epsilon, 0.0, 0.0],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
        parameters
            .electrostatics
            .iter()
            .map(|term| MmffTermV1 {
                atoms: [term.atoms[0], term.atoms[1], 0, 0],
                parameters0: [
                    term.charge_product,
                    u8::from(term.is_one_four) as f32,
                    0.0,
                    0.0,
                ],
                parameters1: [0.0; 4],
            })
            .collect::<Vec<_>>(),
    ];
    for group in &mut groups {
        if group.is_empty() {
            group.push(MmffTermV1::default());
        }
    }
    Ok((
        MmffBatchV1 {
            atom_count: parameters.atom_count,
            conformer_count,
            bond_count: counts[0],
            angle_count: counts[1],
            stretch_bend_count: counts[2],
            out_of_plane_count: counts[3],
            torsion_count: counts[4],
            van_der_waals_count: counts[5],
            electrostatic_count: counts[6],
            reserved0: 0,
            reserved1: 0,
            reserved2: 0,
        },
        groups,
        term_count,
    ))
}

fn completed_gpu_time(command: &metal::CommandBufferRef) -> Result<f64, MetalRuntimeError> {
    if command.status() != MTLCommandBufferStatus::Completed {
        return Err(MetalRuntimeError::Dispatch(format!(
            "Metal command buffer ended with {:?}",
            command.status()
        )));
    }
    let gpu_start = command_gpu_timestamp(command, "GPUStartTime")?;
    let gpu_end = command_gpu_timestamp(command, "GPUEndTime")?;
    if !gpu_start.is_finite() || !gpu_end.is_finite() || gpu_start < 0.0 || gpu_end < gpu_start {
        return Err(MetalRuntimeError::Dispatch(
            "Metal command buffer returned invalid GPU timing evidence".into(),
        ));
    }
    Ok(gpu_end - gpu_start)
}

fn command_gpu_timestamp(
    command: &metal::CommandBufferRef,
    selector: &str,
) -> Result<f64, MetalRuntimeError> {
    unsafe { command.send_message(Sel::register(selector), ()) }.map_err(|error| {
        MetalRuntimeError::Dispatch(format!(
            "Metal command buffer cannot read {selector}: {error}"
        ))
    })
}

fn pipeline(
    device: &Device,
    library: &metal::LibraryRef,
    name: &str,
) -> Result<ComputePipelineState, MetalRuntimeError> {
    let function = library.get_function(name, None).map_err(|error| {
        MetalRuntimeError::KernelUnavailable(format!("Metal entrypoint {name} is missing: {error}"))
    })?;
    device
        .new_compute_pipeline_state_with_function(&function)
        .map_err(|error| {
            MetalRuntimeError::KernelUnavailable(format!(
                "Metal entrypoint {name} cannot create a pipeline: {error}"
            ))
        })
}

fn buffer_with_slice<T>(device: &Device, values: &[T]) -> Buffer {
    device.new_buffer_with_data(
        values.as_ptr().cast::<c_void>(),
        size_of_val(values) as u64,
        MTLResourceOptions::StorageModeShared,
    )
}

fn read_buffer<T: Copy>(
    buffer: &BufferRef,
    count: usize,
    label: &str,
) -> Result<Vec<T>, MetalRuntimeError> {
    let expected = count
        .checked_mul(std::mem::size_of::<T>())
        .ok_or_else(|| MetalRuntimeError::ResourceLimit(format!("{label} buffer overflow")))?;
    if buffer.length() != expected as u64 || buffer.contents().is_null() {
        return Err(MetalRuntimeError::Dispatch(format!(
            "Metal {label} buffer has an invalid mapped length"
        )));
    }
    Ok(unsafe { std::slice::from_raw_parts(buffer.contents().cast::<T>(), count) }.to_vec())
}

fn prefix_offsets(
    degrees: &[u64],
    record_count: usize,
    max_edges: u64,
) -> Result<Vec<u64>, MetalRuntimeError> {
    let mut offsets = Vec::with_capacity(record_count + 1);
    offsets.push(0_u64);
    for degree in degrees {
        if *degree >= record_count as u64 {
            return Err(MetalRuntimeError::Dispatch(
                "Metal degree exceeds the loop-free graph bound".into(),
            ));
        }
        offsets.push(
            offsets
                .last()
                .unwrap()
                .checked_add(*degree)
                .ok_or_else(|| {
                    MetalRuntimeError::ResourceLimit("CSR directed entry count overflowed".into())
                })?,
        );
    }
    let directed = *offsets.last().unwrap();
    if !directed.is_multiple_of(2) {
        return Err(MetalRuntimeError::Dispatch(
            "Metal degree sum is not symmetric".into(),
        ));
    }
    let edges = directed / 2;
    if edges > max_edges {
        return resource_limit(format!(
            "Metal graph exceeds the undirected edge budget {max_edges} (observed {edges})"
        ));
    }
    Ok(offsets)
}

fn admit_memory(
    record_count: usize,
    directed_entries: u64,
    limit: u64,
) -> Result<(), MetalRuntimeError> {
    let records = record_count as u64;
    let required = MEMORY_HEADROOM_BYTES
        .checked_add(
            records
                .checked_mul(256 * 2 + 16 + 16 + 16 + 8)
                .ok_or_else(memory_overflow)?,
        )
        .and_then(|total| total.checked_add(16))
        .and_then(|total| total.checked_add(directed_entries.checked_mul(16)?))
        .ok_or_else(memory_overflow)?;
    if required > limit {
        return resource_limit(format!(
            "Metal graph requires {required} accounted bytes; limit is {limit}"
        ));
    }
    Ok(())
}

fn admit_query_memory(record_count: usize, limit: u64) -> Result<(), MetalRuntimeError> {
    let records = record_count as u64;
    // Rust input + shared fingerprint buffer, shared/raw query outputs, final
    // u64 CPU counts, the query value and one parameter block.
    let required = MEMORY_HEADROOM_BYTES
        .checked_add(
            records
                .checked_mul(256 * 2 + 8 * 2 + 16)
                .ok_or_else(memory_overflow)?,
        )
        .and_then(|total| total.checked_add(256 + 24))
        .ok_or_else(memory_overflow)?;
    if required > limit {
        return resource_limit(format!(
            "Metal Tanimoto query requires {required} accounted bytes; limit is {limit}"
        ));
    }
    Ok(())
}

fn memory_overflow() -> MetalRuntimeError {
    MetalRuntimeError::ResourceLimit("Metal working-set accounting overflowed".into())
}

fn resource_limit<T>(message: impl Into<String>) -> Result<T, MetalRuntimeError> {
    Err(MetalRuntimeError::ResourceLimit(message.into()))
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroUsize;

    use burrete_compute_core::{
        evaluate_distance_constraints, initialize_conformer_positions, optimize_distance_geometry,
        DistanceConstraint, DistanceGeometryOptimizationOptions, FINGERPRINT_WORDS,
    };
    use burrete_compute_protocol::{ResourceLimits, MIN_COMPUTE_MEMORY_BYTES};
    use metal::CompileOptions;

    use super::*;

    #[test]
    fn tile_abi_matches_the_checked_in_kernel_contract() {
        assert_eq!(std::mem::size_of::<TanimotoTileV1>(), 56);
        assert_eq!(std::mem::align_of::<TanimotoTileV1>(), 8);
        assert_eq!(std::mem::offset_of!(TanimotoTileV1, cutoff_denominator), 48);
        assert_eq!(std::mem::size_of::<TanimotoQueryBatchV1>(), 24);
        assert_eq!(std::mem::align_of::<TanimotoQueryBatchV1>(), 8);
        assert_eq!(std::mem::offset_of!(TanimotoQueryBatchV1, row_count), 16);
        assert_eq!(std::mem::size_of::<TanimotoQueryCountsV1>(), 8);
        assert_eq!(std::mem::align_of::<TanimotoQueryCountsV1>(), 8);
        assert_eq!(std::mem::size_of::<ConformerInitializeBatchV1>(), 16);
        assert_eq!(std::mem::align_of::<ConformerInitializeBatchV1>(), 8);
        assert_eq!(
            std::mem::offset_of!(ConformerInitializeBatchV1, output_atom_offset),
            8
        );
        assert_eq!(std::mem::size_of::<ConformerDistanceBatchV1>(), 16);
        assert_eq!(std::mem::align_of::<ConformerDistanceBatchV1>(), 4);
        assert_eq!(
            std::mem::offset_of!(ConformerDistanceBatchV1, constraint_count),
            8
        );
        assert_eq!(std::mem::size_of::<ConformerOptimizeConfigV1>(), 48);
        assert_eq!(std::mem::align_of::<ConformerOptimizeConfigV1>(), 4);
        assert_eq!(
            std::mem::offset_of!(ConformerOptimizeConfigV1, gradient_tolerance),
            32
        );
        assert_eq!(
            std::mem::offset_of!(ConformerOptimizeConfigV1, max_step_factor),
            44
        );
    }

    #[test]
    fn memory_admission_counts_directed_output_twice() {
        let base = MEMORY_HEADROOM_BYTES + (256 * 2 + 16 + 16 + 16 + 8) + 16;
        assert!(admit_memory(1, 2, base + 32).is_ok());
        assert!(admit_memory(1, 2, base + 31).is_err());
    }

    #[test]
    fn query_memory_admission_counts_all_resident_views() {
        let base = MEMORY_HEADROOM_BYTES + 256 + 24;
        let bytes_per_record = 256 * 2 + 8 * 2 + 16;
        assert!(admit_query_memory(1, base + bytes_per_record).is_ok());
        assert!(admit_query_memory(1, base + bytes_per_record - 1).is_err());
    }

    #[test]
    #[ignore = "manual real-GPU smoke; production loads only a verified precompiled metallib"]
    fn dispatches_the_known_answer_graph_on_the_real_gpu() {
        let device = Device::system_default().expect("Metal device");
        let compile_options = CompileOptions::new();
        let source = [
            include_str!("../../../../compute/metal/tanimoto.v2.metal"),
            include_str!("../../../../compute/metal/conformer-initialize.v1.metal"),
            include_str!("../../../../compute/metal/conformer-distance.v1.metal"),
            include_str!("../../../../compute/metal/conformer-optimize.v1.metal"),
        ]
        .join("\n");
        let library = device
            .new_library_with_source(&source, &compile_options)
            .expect("test-only Metal compilation");
        let host = MetalHost::from_library(device, &library).expect("test Metal host");
        let mut left = [0_u64; FINGERPRINT_WORDS];
        left[0] = 0b11;
        let mut right = [0_u64; FINGERPRINT_WORDS];
        right[0] = 0b01;
        let fingerprints = [
            Fingerprint2048::from_words(left),
            Fingerprint2048::from_words(right),
            Fingerprint2048::ZERO,
        ];
        let limits = ResourceLimits {
            max_edges: 3,
            max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
            max_dispatch_ms: 2_000,
        };
        let graph_options = GraphBuildOptions::from_resource_limits(
            NonZeroUsize::new(2).expect("nonzero tile"),
            &limits,
        )
        .expect("graph options");
        let graph = host
            .build_graph(
                &fingerprints,
                SimilarityCutoff {
                    numerator: 1,
                    denominator: 2,
                },
                graph_options,
            )
            .expect("real Metal graph");
        assert_eq!(graph.row_offsets(), &[0, 1, 2, 2]);
        assert_eq!(graph.column_indices(), &[1, 0]);
        let query_options =
            TanimotoQueryOptions::from_resource_limits(&limits).expect("query options");
        let counts = host
            .score_query(&fingerprints[0], &fingerprints, query_options)
            .expect("real Metal query");
        assert_eq!(
            counts,
            vec![
                TanimotoCounts {
                    intersection: 2,
                    union: 2,
                },
                TanimotoCounts {
                    intersection: 1,
                    union: 2,
                },
                TanimotoCounts {
                    intersection: 0,
                    union: 2,
                },
            ]
        );
    }

    #[test]
    #[ignore = "manual source-compiled real-GPU parity smoke"]
    fn dispatches_conformer_initialization_on_the_real_gpu() {
        let device = Device::system_default().expect("Metal device");
        assert!(device.has_unified_memory(), "Apple unified memory required");
        let library = device
            .new_library_with_source(
                include_str!("../../../../compute/metal/conformer-initialize.v1.metal"),
                &CompileOptions::new(),
            )
            .expect("compile conformer initializer");
        let pipeline = pipeline(&device, &library, "burrete_conformer_initialize_v1")
            .expect("conformer initializer pipeline");
        let seeds = [[1_u32, 2, 3, 4], [5_u32, 6, 7, 8]];
        let atom_count = 3_u32;
        let batch = ConformerInitializeBatchV1 {
            atom_count,
            conformer_count: seeds.len() as u32,
            output_atom_offset: 0,
        };
        let seed_buffer = buffer_with_slice(&device, &seeds);
        let output_buffer = buffer_with_slice(&device, &[[0.0_f32; 4]; 6]);
        let queue = device.new_command_queue();
        let command = queue.new_command_buffer();
        let encoder = command.new_compute_command_encoder();
        encoder.set_compute_pipeline_state(&pipeline);
        encoder.set_buffer(0, Some(&seed_buffer), 0);
        encoder.set_bytes(
            1,
            size_of_val(&batch) as u64,
            (&batch as *const ConformerInitializeBatchV1).cast(),
        );
        encoder.set_buffer(2, Some(&output_buffer), 0);
        encoder.dispatch_threads(
            MTLSize {
                width: 6,
                height: 1,
                depth: 1,
            },
            MTLSize {
                width: pipeline.thread_execution_width(),
                height: 1,
                depth: 1,
            },
        );
        encoder.end_encoding();
        command.commit();
        command.wait_until_completed();
        completed_gpu_time(command).expect("real GPU completion evidence");

        let observed = read_buffer::<[f32; 4]>(&output_buffer, 6, "conformer position")
            .expect("read conformer positions");
        let expected = seeds
            .into_iter()
            .flat_map(|seed| initialize_conformer_positions(seed, atom_count))
            .collect::<Vec<_>>();
        assert_eq!(observed, expected);
    }

    #[test]
    #[ignore = "manual source-compiled real-GPU distance parity smoke"]
    fn dispatches_distance_objective_on_the_real_gpu() {
        let device = Device::system_default().expect("Metal device");
        assert!(device.has_unified_memory(), "Apple unified memory required");
        let source = [
            include_str!("../../../../compute/metal/tanimoto.v2.metal"),
            include_str!("../../../../compute/metal/conformer-initialize.v1.metal"),
            include_str!("../../../../compute/metal/conformer-distance.v1.metal"),
            include_str!("../../../../compute/metal/conformer-optimize.v1.metal"),
        ]
        .join("\n");
        let library = device
            .new_library_with_source(&source, &CompileOptions::new())
            .expect("compile native compute kernels");
        let host = MetalHost::from_library(device, &library).expect("load Metal pipelines");
        let positions = [[0.0; 4], [2.0, 0.5, 0.0, 0.0]];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 4.0,
            weight: 0.75,
        }];
        let expected =
            evaluate_distance_constraints(&positions, &constraints).expect("CPU distance oracle");
        let observed = host
            .evaluate_distance_constraints_profiled(
                &positions,
                2,
                &constraints,
                MIN_COMPUTE_MEMORY_BYTES,
            )
            .expect("real Metal distance objective");

        let close = |left: &[f32], right: &[f32]| {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| (left - right).abs() <= 1.0e-6)
        };
        assert!(close(&observed.atom_energies, &expected.atom_energies));
        assert!(close(
            observed.gradients.as_flattened(),
            expected.gradients.as_flattened(),
        ));
        assert!(observed.gpu_time_seconds >= 0.0);
    }

    #[test]
    #[ignore = "manual source-compiled real-GPU L-BFGS parity smoke"]
    fn optimizes_distance_geometry_on_the_real_gpu() {
        let device = Device::system_default().expect("Metal device");
        assert!(device.has_unified_memory(), "Apple unified memory required");
        let source = [
            include_str!("../../../../compute/metal/tanimoto.v2.metal"),
            include_str!("../../../../compute/metal/conformer-initialize.v1.metal"),
            include_str!("../../../../compute/metal/conformer-distance.v1.metal"),
            include_str!("../../../../compute/metal/conformer-optimize.v1.metal"),
        ]
        .join("\n");
        let library = device
            .new_library_with_source(&source, &CompileOptions::new())
            .expect("compile native compute kernels");
        let host = MetalHost::from_library(device, &library).expect("load Metal pipelines");
        let positions = [
            [0.0; 4],
            [4.0, 1.0, 0.5, 0.0],
            [0.0; 4],
            [3.0, -1.0, 0.25, 0.0],
        ];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 2.0,
            weight: 1.0,
        }];
        let options = DistanceGeometryOptimizationOptions::default();
        let expected = positions
            .chunks_exact(2)
            .map(|conformer| {
                optimize_distance_geometry(conformer, &constraints, options)
                    .expect("CPU L-BFGS oracle")
            })
            .collect::<Vec<_>>();
        let observed = host
            .optimize_distance_geometry_profiled(
                &positions,
                2,
                &constraints,
                options,
                MIN_COMPUTE_MEMORY_BYTES,
            )
            .expect("real Metal L-BFGS");

        assert_eq!(observed.statuses, vec![0, 0]);
        for (index, expected) in expected.iter().enumerate() {
            assert!((observed.energies[index] - expected.energy).abs() <= 1.0e-5);
            assert!(observed.scaled_gradient_maxima[index] <= 1.0e-4);
            let start = index * 2;
            for (actual, expected) in observed.positions[start..start + 2]
                .iter()
                .flatten()
                .zip(expected.positions.iter().flatten())
            {
                assert!((actual - expected).abs() <= 1.0e-4);
            }
        }
        assert!(observed.gpu_time_seconds >= 0.0);
    }
}
