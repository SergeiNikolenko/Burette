use std::{ffi::c_void, mem::size_of_val};

use burrete_compute_core::{
    DistanceConstraint, Fingerprint2048, GraphBuildOptions, SymmetricCsr, TanimotoCounts,
    TanimotoQueryOptions,
};
use burrete_compute_protocol::{GpuDeviceIdentity, SimilarityCutoff};
use metal::{
    Buffer, BufferRef, CommandQueue, ComputeCommandEncoderRef, ComputePipelineState,
    ComputePipelineStateRef, Device, LibraryRef, MTLCommandBufferStatus, MTLResourceOptions,
    MTLSize,
};
use objc::rc::autoreleasepool;
use objc::{runtime::Sel, Message};

use crate::MetalRuntimeError;
use crate::platform::MetalDistanceDispatch;

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

#[derive(Debug)]
pub(crate) struct MetalHost {
    device: Device,
    queue: CommandQueue,
    degree_pipeline: ComputePipelineState,
    fill_pipeline: ComputePipelineState,
    query_pipeline: ComputePipelineState,
    conformer_initialize_pipeline: ComputePipelineState,
    conformer_distance_pipeline: ComputePipelineState,
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
        Ok(Self {
            queue: device.new_command_queue(),
            device,
            degree_pipeline,
            fill_pipeline,
            query_pipeline,
            conformer_initialize_pipeline,
            conformer_distance_pipeline,
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
        let conformer_count = u32::try_from(seed_words.len())
            .map_err(|_| MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into()))?;
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
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(seed_bytes)
            .and_then(|bytes| bytes.checked_add(item_count.checked_mul(16)?))
            .ok_or_else(memory_overflow)?;
        if required_bytes > max_memory_bytes {
            return resource_limit(format!(
                "conformer initialization requires {required_bytes} accounted bytes; limit is {max_memory_bytes}"
            ));
        }
        let output_len = usize::try_from(item_count)
            .map_err(|_| MetalRuntimeError::ResourceLimit("conformer output exceeds address space".into()))?;
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
            .min(self.conformer_initialize_pipeline.max_total_threads_per_threadgroup());
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
        let conformer_count = u32::try_from(positions.len() / atom_count as usize)
            .map_err(|_| MetalRuntimeError::ResourceLimit("conformer count exceeds uint32".into()))?;
        let constraint_count = u32::try_from(constraints.len())
            .map_err(|_| MetalRuntimeError::ResourceLimit("constraint count exceeds uint32".into()))?;
        for constraint in constraints {
            if constraint.left_atom >= atom_count
                || constraint.right_atom >= atom_count
                || constraint.left_atom == constraint.right_atom
                || !constraint.lower_squared.is_finite()
                || !constraint.upper_squared.is_finite()
                || constraint.lower_squared < 0.0
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
            .checked_mul(20)
            .ok_or_else(memory_overflow)?;
        let item_bytes = item_count.checked_mul(36).ok_or_else(memory_overflow)?;
        let required_bytes = MEMORY_HEADROOM_BYTES
            .checked_add(16)
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
        let mut weights = constraints.iter().map(|term| term.weight).collect::<Vec<_>>();
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
            .min(self.conformer_distance_pipeline.max_total_threads_per_threadgroup());
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

    use burrete_compute_core::{initialize_conformer_positions, FINGERPRINT_WORDS};
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
        let library = device
            .new_library_with_source(
                include_str!("../../../../compute/metal/tanimoto.v2.metal"),
                &compile_options,
            )
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
}
