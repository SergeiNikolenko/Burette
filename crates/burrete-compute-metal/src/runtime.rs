use std::{num::NonZeroUsize, path::Path, sync::Arc};

use burrete_compute_core::{
    build_tanimoto_graph, evaluate_distance_constraints, initialize_conformer_positions,
    optimize_distance_geometry, score_tanimoto_query, DistanceConstraint,
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, Fingerprint2048,
    GraphBuildOptions, SymmetricCsr, TanimotoCounts, TanimotoQueryOptions, FINGERPRINT_WORDS,
};
use burrete_compute_protocol::{
    CapabilityLimits, GpuDeviceIdentity, ResourceLimits, RuntimeIdentity, SimilarityCutoff,
    MAX_COMPUTE_MEMORY_BYTES, MAX_CONTROL_FRAME_BYTES, MAX_UNDIRECTED_SIMILARITY_EDGES,
    MIN_COMPUTE_MEMORY_BYTES,
};

use crate::{
    package::{verify_runtime_package, MetalRuntimeError},
    platform::MetalHost,
};

const MAX_DISPATCH_MS: u32 = 2_000;

#[derive(Clone)]
pub struct MetalComputeRuntime {
    host: Arc<MetalHost>,
    runtime_identity: RuntimeIdentity,
    device_identity: GpuDeviceIdentity,
    limits: CapabilityLimits,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetalGraphExecution {
    pub graph: SymmetricCsr,
    /// Sum of Metal's completed-command-buffer GPUStartTime/GPUEndTime
    /// intervals. This excludes CPU encoding and synchronization time.
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalQueryExecution {
    pub counts: Vec<TanimotoCounts>,
    /// Sum of Metal's completed-command-buffer GPUStartTime/GPUEndTime
    /// intervals. This excludes CPU encoding and synchronization time.
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalConformerInitialization {
    pub positions: Vec<[f32; 4]>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalDistanceEvaluation {
    pub atom_energies: Vec<f32>,
    pub gradients: Vec<[f32; 4]>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalDistanceOptimization {
    pub positions: Vec<[f32; 4]>,
    pub energies: Vec<f32>,
    pub scaled_gradient_maxima: Vec<f32>,
    pub iterations: Vec<u32>,
    pub statuses: Vec<DistanceGeometryOptimizationStatus>,
    pub gpu_time_ms: u64,
}

impl std::fmt::Debug for MetalComputeRuntime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MetalComputeRuntime")
            .field("runtime_identity", &self.runtime_identity)
            .field("device_identity", &self.device_identity)
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl MetalComputeRuntime {
    pub fn load(runtime_root: &Path, helper_sha256: &str) -> Result<Self, MetalRuntimeError> {
        validate_sha256(helper_sha256)?;
        let package = verify_runtime_package(runtime_root)?;
        let host = MetalHost::load(&package.metallib_bytes)?;
        let max_memory_bytes = host
            .recommended_max_working_set_size()
            .min(MAX_COMPUTE_MEMORY_BYTES);
        if max_memory_bytes < MIN_COMPUTE_MEMORY_BYTES {
            return Err(MetalRuntimeError::MetalUnavailable(format!(
                "Metal device working-set limit {max_memory_bytes} is below the supported minimum"
            )));
        }
        let runtime = Self {
            runtime_identity: RuntimeIdentity {
                version: package.runtime_version,
                manifest_sha256: package.metadata_sha256,
                helper_sha256: helper_sha256.into(),
                metallib_sha256: Some(package.metallib_sha256),
            },
            device_identity: host.device_identity(),
            limits: CapabilityLimits {
                max_control_frame_bytes: MAX_CONTROL_FRAME_BYTES as u64,
                max_edges: MAX_UNDIRECTED_SIMILARITY_EDGES,
                max_memory_bytes,
                max_dispatch_ms: MAX_DISPATCH_MS,
            },
            host: Arc::new(host),
        };
        runtime.run_startup_known_answer_test()?;
        Ok(runtime)
    }

    pub fn runtime_identity(&self) -> &RuntimeIdentity {
        &self.runtime_identity
    }

    pub fn device_identity(&self) -> &GpuDeviceIdentity {
        &self.device_identity
    }

    pub fn limits(&self) -> &CapabilityLimits {
        &self.limits
    }

    pub fn build_graph(
        &self,
        fingerprints: &[Fingerprint2048],
        cutoff: SimilarityCutoff,
        options: GraphBuildOptions,
    ) -> Result<SymmetricCsr, MetalRuntimeError> {
        self.host.build_graph(fingerprints, cutoff, options)
    }

    pub fn build_graph_profiled(
        &self,
        fingerprints: &[Fingerprint2048],
        cutoff: SimilarityCutoff,
        options: GraphBuildOptions,
    ) -> Result<MetalGraphExecution, MetalRuntimeError> {
        let (graph, gpu_time_seconds) =
            self.host
                .build_graph_profiled(fingerprints, cutoff, options)?;
        Ok(MetalGraphExecution {
            graph,
            gpu_time_ms: gpu_time_ms(gpu_time_seconds)?,
        })
    }

    pub fn score_query(
        &self,
        query: &Fingerprint2048,
        fingerprints: &[Fingerprint2048],
        options: TanimotoQueryOptions,
    ) -> Result<Vec<TanimotoCounts>, MetalRuntimeError> {
        self.host.score_query(query, fingerprints, options)
    }

    pub fn score_query_profiled(
        &self,
        query: &Fingerprint2048,
        fingerprints: &[Fingerprint2048],
        options: TanimotoQueryOptions,
    ) -> Result<MetalQueryExecution, MetalRuntimeError> {
        let (counts, gpu_time_seconds) =
            self.host
                .score_query_profiled(query, fingerprints, options)?;
        Ok(MetalQueryExecution {
            counts,
            gpu_time_ms: gpu_time_ms(gpu_time_seconds)?,
        })
    }

    pub fn initialize_conformers_profiled(
        &self,
        seed_words: &[[u32; 4]],
        atom_count: u32,
        max_memory_bytes: u64,
    ) -> Result<MetalConformerInitialization, MetalRuntimeError> {
        let (positions, gpu_time_seconds) = self.host.initialize_conformers_profiled(
            seed_words,
            atom_count,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        Ok(MetalConformerInitialization {
            positions,
            gpu_time_ms: gpu_time_ms(gpu_time_seconds)?,
        })
    }

    pub fn evaluate_distance_constraints_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        constraints: &[DistanceConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceEvaluation, MetalRuntimeError> {
        let dispatch = self.host.evaluate_distance_constraints_profiled(
                positions,
                atom_count,
                constraints,
                max_memory_bytes.min(self.limits.max_memory_bytes),
            )?;
        Ok(MetalDistanceEvaluation {
            atom_energies: dispatch.atom_energies,
            gradients: dispatch.gradients,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn optimize_distance_geometry_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        constraints: &[DistanceConstraint],
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimization, MetalRuntimeError> {
        let dispatch = self.host.optimize_distance_geometry_profiled(
            positions,
            atom_count,
            constraints,
            options,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.positions.iter().flatten().any(|value| !value.is_finite())
            || dispatch.energies.iter().any(|value| !value.is_finite())
            || dispatch
                .scaled_gradient_maxima
                .iter()
                .any(|value| !value.is_finite())
            || dispatch
                .iterations
                .iter()
                .any(|iterations| *iterations > options.max_iterations)
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal distance optimizer returned invalid numeric output".into(),
            ));
        }
        let statuses = dispatch
            .statuses
            .into_iter()
            .map(distance_optimization_status)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(MetalDistanceOptimization {
            positions: dispatch.positions,
            energies: dispatch.energies,
            scaled_gradient_maxima: dispatch.scaled_gradient_maxima,
            iterations: dispatch.iterations,
            statuses,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    fn run_startup_known_answer_test(&self) -> Result<(), MetalRuntimeError> {
        let mut left = [0_u64; FINGERPRINT_WORDS];
        left[0] = 0b11;
        let mut neighbor = [0_u64; FINGERPRINT_WORDS];
        neighbor[0] = 0b01;
        let mut isolated = [0_u64; FINGERPRINT_WORDS];
        isolated[1] = 1;
        let fingerprints = [
            Fingerprint2048::from_words(left),
            Fingerprint2048::from_words(neighbor),
            Fingerprint2048::from_words(isolated),
        ];
        let cutoff = SimilarityCutoff {
            numerator: 1,
            denominator: 2,
        };
        let limits = ResourceLimits {
            max_edges: 3,
            max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
            max_dispatch_ms: MAX_DISPATCH_MS,
        };
        let options = GraphBuildOptions::from_resource_limits(
            NonZeroUsize::new(2).expect("nonzero startup tile"),
            &limits,
        )
        .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let expected = build_tanimoto_graph(&fingerprints, cutoff, options)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed = self.host.build_graph(&fingerprints, cutoff, options)?;
        if observed != expected {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup known-answer graph differs from the CPU reference".into(),
            ));
        }
        let query_options = TanimotoQueryOptions::from_resource_limits(&limits)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let expected_counts = score_tanimoto_query(&fingerprints[0], &fingerprints, query_options)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_counts =
            self.host
                .score_query(&fingerprints[0], &fingerprints, query_options)?;
        if observed_counts != expected_counts {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup known-answer query differs from the CPU reference".into(),
            ));
        }
        let seeds = [[1, 2, 3, 4], [5, 6, 7, 8]];
        let atom_count = 3;
        let expected_positions = seeds
            .into_iter()
            .flat_map(|seed| initialize_conformer_positions(seed, atom_count))
            .collect::<Vec<_>>();
        let observed_positions = self
            .host
            .initialize_conformers_profiled(&seeds, atom_count, MIN_COMPUTE_MEMORY_BYTES)?
            .0;
        if observed_positions != expected_positions {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup conformer initialization differs from the CPU reference".into(),
            ));
        }
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 0.5,
            upper_squared: 1.0,
            weight: 0.75,
        }];
        let distance_positions = [[0.0; 4], [2.0, 0.5, 0.0, 0.0]];
        let expected_distance = evaluate_distance_constraints(&distance_positions, &constraints)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_distance = self
            .host
            .evaluate_distance_constraints_profiled(
                &distance_positions,
                2,
                &constraints,
                MIN_COMPUTE_MEMORY_BYTES,
            )?;
        if !float_slices_close(
            &observed_distance.atom_energies,
            &expected_distance.atom_energies,
            1.0e-5,
        )
            || !float_slices_close(
                observed_distance.gradients.as_flattened(),
                expected_distance.gradients.as_flattened(),
                1.0e-5,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup distance objective differs from the CPU reference".into(),
            ));
        }
        let optimization_positions = [[0.0; 4], [4.0, 1.0, 0.5, 0.0]];
        let optimization_options = DistanceGeometryOptimizationOptions::default();
        let expected_optimization = optimize_distance_geometry(
            &optimization_positions,
            &constraints,
            optimization_options,
        )
        .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_optimization = self.host.optimize_distance_geometry_profiled(
            &optimization_positions,
            2,
            &constraints,
            optimization_options,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if observed_optimization.statuses != [distance_optimization_status_code(
            expected_optimization.status,
        )]
            || !float_slices_close(
                observed_optimization.positions.as_flattened(),
                expected_optimization.positions.as_flattened(),
                1.0e-4,
            )
            || !float_slices_close(
                &observed_optimization.energies,
                &[expected_optimization.energy],
                1.0e-5,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup distance optimization differs from the CPU reference".into(),
            ));
        }
        Ok(())
    }
}

pub type MetalTanimotoRuntime = MetalComputeRuntime;

fn float_slices_close(left: &[f32], right: &[f32], tolerance: f32) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.is_finite() && right.is_finite() && (left - right).abs() <= tolerance
        })
}

fn gpu_time_ms(gpu_time_seconds: f64) -> Result<u64, MetalRuntimeError> {
    let gpu_time_ms = (gpu_time_seconds * 1_000.0).ceil();
    if !gpu_time_ms.is_finite() || gpu_time_ms < 0.0 || gpu_time_ms > u64::MAX as f64 {
        return Err(MetalRuntimeError::Dispatch(
            "Metal GPU timing is outside the supported range".into(),
        ));
    }
    Ok(gpu_time_ms as u64)
}

fn distance_optimization_status(
    status: u32,
) -> Result<DistanceGeometryOptimizationStatus, MetalRuntimeError> {
    match status {
        0 => Ok(DistanceGeometryOptimizationStatus::ConvergedGradient),
        1 => Ok(DistanceGeometryOptimizationStatus::ConvergedStep),
        2 => Ok(DistanceGeometryOptimizationStatus::LineSearchExhausted),
        3 => Ok(DistanceGeometryOptimizationStatus::MaxIterations),
        _ => Err(MetalRuntimeError::Dispatch(format!(
            "Metal distance optimizer returned unknown status {status}"
        ))),
    }
}

fn distance_optimization_status_code(status: DistanceGeometryOptimizationStatus) -> u32 {
    match status {
        DistanceGeometryOptimizationStatus::ConvergedGradient => 0,
        DistanceGeometryOptimizationStatus::ConvergedStep => 1,
        DistanceGeometryOptimizationStatus::LineSearchExhausted => 2,
        DistanceGeometryOptimizationStatus::MaxIterations => 3,
    }
}

fn validate_sha256(value: &str) -> Result<(), MetalRuntimeError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(MetalRuntimeError::Integrity(
            "native helper identity is not a lowercase SHA-256 digest".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    #[ignore = "manual packaged-runtime smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn loads_verified_packaged_runtime_and_dispatches_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged ComputeMetal directory");
        let runtime = MetalComputeRuntime::load(&root, &"0".repeat(64))
            .expect("verified packaged Metal runtime");
        let device = runtime.device_identity();
        eprintln!(
            "packaged Metal runtime loaded: device={}, registryId={}, unifiedMemory={}, metallibSha256={}",
            device.name,
            device.registry_id.as_deref().unwrap_or("unavailable"),
            device.unified_memory,
            runtime
                .runtime_identity()
                .metallib_sha256
                .as_deref()
                .expect("packaged runtime must pin its metallib"),
        );
    }
}
