use std::{ffi::c_void, mem::size_of_val};

use burrete_compute_core::{Fingerprint2048, GraphBuildOptions, SymmetricCsr};
use burrete_compute_protocol::{GpuDeviceIdentity, SimilarityCutoff};
use metal::{
    Buffer, BufferRef, CommandQueue, ComputeCommandEncoderRef, ComputePipelineState,
    ComputePipelineStateRef, Device, LibraryRef, MTLCommandBufferStatus, MTLResourceOptions,
    MTLSize,
};
use objc::rc::autoreleasepool;

use crate::MetalRuntimeError;

const MAX_TILE_RECORDS: usize = 1_024;
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

#[derive(Debug)]
pub(crate) struct MetalHost {
    device: Device,
    queue: CommandQueue,
    degree_pipeline: ComputePipelineState,
    fill_pipeline: ComputePipelineState,
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
        Ok(Self {
            queue: device.new_command_queue(),
            device,
            degree_pipeline,
            fill_pipeline,
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
        let cutoff = cutoff
            .normalized()
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        if fingerprints.is_empty() {
            return SymmetricCsr::try_new(vec![0], Vec::new())
                .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()));
        }
        let record_count = fingerprints.len();
        if record_count > u32::MAX as usize {
            return resource_limit("fingerprint count exceeds the Metal uint32 row limit");
        }
        admit_memory(record_count, 0, options.max_memory_bytes())?;
        let fingerprints_buffer = buffer_with_slice(&self.device, fingerprints);
        let degree_buffer = buffer_with_slice(&self.device, &vec![0_u64; record_count]);
        self.dispatch_tiles(
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
                .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()));
        }

        let entry_count = usize::try_from(directed_entries)
            .map_err(|_| MetalRuntimeError::ResourceLimit("CSR exceeds address space".into()))?;
        let offsets_buffer = buffer_with_slice(&self.device, &row_offsets);
        let cursor_buffer = buffer_with_slice(&self.device, &row_offsets[..record_count]);
        let column_buffer = buffer_with_slice(&self.device, &vec![0_u64; entry_count]);
        let status_buffer = buffer_with_slice(&self.device, &vec![0_u32; record_count]);
        self.dispatch_tiles(
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
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))
    }

    fn dispatch_tiles(
        &self,
        record_count: usize,
        cutoff: SimilarityCutoff,
        requested_tile: usize,
        pipeline: &ComputePipelineStateRef,
        bind: impl Fn(&ComputeCommandEncoderRef),
    ) -> Result<(), MetalRuntimeError> {
        let tile_size = requested_tile.min(MAX_TILE_RECORDS);
        let thread_width = pipeline
            .thread_execution_width()
            .min(pipeline.max_total_threads_per_threadgroup());
        if thread_width == 0 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal pipeline advertises a zero thread width".into(),
            ));
        }
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
                autoreleasepool(|| {
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
                    if command.status() != MTLCommandBufferStatus::Completed {
                        return Err(MetalRuntimeError::Dispatch(format!(
                            "Metal command buffer ended with {:?}",
                            command.status()
                        )));
                    }
                    Ok(())
                })?;
            }
        }
        Ok(())
    }
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

fn memory_overflow() -> MetalRuntimeError {
    MetalRuntimeError::ResourceLimit("Metal working-set accounting overflowed".into())
}

fn resource_limit<T>(message: impl Into<String>) -> Result<T, MetalRuntimeError> {
    Err(MetalRuntimeError::ResourceLimit(message.into()))
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroUsize;

    use burrete_compute_core::FINGERPRINT_WORDS;
    use burrete_compute_protocol::{ResourceLimits, MIN_COMPUTE_MEMORY_BYTES};
    use metal::CompileOptions;

    use super::*;

    #[test]
    fn tile_abi_matches_the_checked_in_kernel_contract() {
        assert_eq!(std::mem::size_of::<TanimotoTileV1>(), 56);
        assert_eq!(std::mem::align_of::<TanimotoTileV1>(), 8);
        assert_eq!(std::mem::offset_of!(TanimotoTileV1, cutoff_denominator), 48);
    }

    #[test]
    fn memory_admission_counts_directed_output_twice() {
        let base = MEMORY_HEADROOM_BYTES + (256 * 2 + 16 + 16 + 16 + 8) + 16;
        assert!(admit_memory(1, 2, base + 32).is_ok());
        assert!(admit_memory(1, 2, base + 31).is_err());
    }

    #[test]
    #[ignore = "manual real-GPU smoke; production loads only a verified precompiled metallib"]
    fn dispatches_the_known_answer_graph_on_the_real_gpu() {
        let device = Device::system_default().expect("Metal device");
        let compile_options = CompileOptions::new();
        let library = device
            .new_library_with_source(
                include_str!("../../../../compute/metal/tanimoto-neighbors.v1.metal"),
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
    }
}
