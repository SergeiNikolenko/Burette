use std::{num::NonZeroUsize, path::Path, sync::Arc};

use burrete_compute_core::{
    build_tanimoto_graph, evaluate_distance_constraints, evaluate_etk_geometry, evaluate_mmff,
    initialize_conformer_positions, optimize_distance_geometry, score_tanimoto_query,
    validate_conformer_stereo, ChiralVolumeConstraint, DistanceConstraint,
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, EtkDistanceConstraint,
    EtkGeometryTerms, EtkImproperConstraint, EtkTorsionConstraint, Fingerprint2048,
    GraphBuildOptions, MmffAngleTerm, MmffBondTerm, MmffElectrostaticTerm, MmffEnergyBreakdown,
    MmffOptimizerKind, MmffOutOfPlaneTerm, MmffParameters, MmffStretchBendTerm, MmffTorsionTerm,
    MmffVanDerWaalsTerm, MmffVariant, SymmetricCsr, TanimotoCounts, TanimotoQueryOptions,
    TetrahedralConstraint, FINGERPRINT_WORDS,
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

#[derive(Clone, Debug, PartialEq)]
pub struct MetalDistanceEmbedding {
    pub positions: Vec<[f32; 4]>,
    pub energies: Vec<f32>,
    pub scaled_gradient_maxima: Vec<f32>,
    pub iterations: Vec<u32>,
    pub statuses: Vec<DistanceGeometryOptimizationStatus>,
    /// Sum of initialization and optimization command-buffer GPU intervals.
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalStereoValidation {
    pub failure_flags: Vec<u32>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalEtkEvaluation {
    pub atom_energies: Vec<f32>,
    pub gradients: Vec<[f32; 4]>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalMmffEvaluation {
    pub breakdowns: Vec<MmffEnergyBreakdown>,
    pub gradients: Vec<[f32; 4]>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalMmffOptimization {
    pub positions: Vec<[f32; 4]>,
    pub energies: Vec<f32>,
    pub scaled_gradient_maxima: Vec<f32>,
    pub iterations: Vec<u32>,
    pub statuses: Vec<DistanceGeometryOptimizationStatus>,
    pub optimizers: Vec<MmffOptimizerKind>,
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
        if dispatch
            .positions
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
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

    /// Initializes and optimizes one molecule's conformer ensemble entirely on
    /// the verified Metal runtime. Constraints remain shared across conformers.
    pub fn embed_distance_bounds_profiled(
        &self,
        seed_words: &[[u32; 4]],
        atom_count: u32,
        constraints: &[DistanceConstraint],
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceEmbedding, MetalRuntimeError> {
        let initialized =
            self.initialize_conformers_profiled(seed_words, atom_count, max_memory_bytes)?;
        let optimized = self.optimize_distance_geometry_profiled(
            &initialized.positions,
            atom_count,
            constraints,
            options,
            max_memory_bytes,
        )?;
        let gpu_time_ms = initialized
            .gpu_time_ms
            .checked_add(optimized.gpu_time_ms)
            .ok_or_else(|| MetalRuntimeError::Dispatch("Metal GPU time overflowed u64".into()))?;
        Ok(MetalDistanceEmbedding {
            positions: optimized.positions,
            energies: optimized.energies,
            scaled_gradient_maxima: optimized.scaled_gradient_maxima,
            iterations: optimized.iterations,
            statuses: optimized.statuses,
            gpu_time_ms,
        })
    }

    pub fn validate_stereo_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        chiral: &[ChiralVolumeConstraint],
        tetrahedral: &[TetrahedralConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalStereoValidation, MetalRuntimeError> {
        let dispatch = self.host.validate_stereo_profiled(
            positions,
            atom_count,
            chiral,
            tetrahedral,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        Ok(MetalStereoValidation {
            failure_flags: dispatch.failure_flags,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn evaluate_etk_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        torsions: &[EtkTorsionConstraint],
        impropers: &[EtkImproperConstraint],
        distances: &[EtkDistanceConstraint],
        max_memory_bytes: u64,
    ) -> Result<MetalEtkEvaluation, MetalRuntimeError> {
        let dispatch = self.host.evaluate_etk_profiled(
            positions,
            atom_count,
            torsions,
            impropers,
            distances,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch
            .atom_energies
            .iter()
            .any(|value| !value.is_finite())
            || dispatch
                .gradients
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal ETK evaluator returned non-finite output".into(),
            ));
        }
        Ok(MetalEtkEvaluation {
            atom_energies: dispatch.atom_energies,
            gradients: dispatch.gradients,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn optimize_etk_profiled(
        &self,
        positions: &[[f32; 4]],
        atom_count: u32,
        terms: EtkGeometryTerms<'_>,
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalDistanceOptimization, MetalRuntimeError> {
        let dispatch = self.host.optimize_etk_profiled(
            positions,
            atom_count,
            terms,
            options,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch
            .positions
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
            || dispatch.energies.iter().any(|value| !value.is_finite())
            || dispatch
                .scaled_gradient_maxima
                .iter()
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal ETK optimizer returned invalid numeric output".into(),
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

    pub fn evaluate_mmff_profiled(
        &self,
        positions: &[[f32; 4]],
        parameters: &MmffParameters,
        max_memory_bytes: u64,
    ) -> Result<MetalMmffEvaluation, MetalRuntimeError> {
        let dispatch = self.host.evaluate_mmff_profiled(
            positions,
            parameters,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if !dispatch.breakdown_vectors.len().is_multiple_of(2)
            || dispatch
                .breakdown_vectors
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
            || dispatch
                .gradients
                .iter()
                .flatten()
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal MMFF evaluator returned invalid numeric output".into(),
            ));
        }
        let breakdowns = dispatch
            .breakdown_vectors
            .chunks_exact(2)
            .map(|vectors| MmffEnergyBreakdown {
                bond_stretch: f64::from(vectors[0][0]),
                angle_bend: f64::from(vectors[0][1]),
                stretch_bend: f64::from(vectors[0][2]),
                out_of_plane: f64::from(vectors[0][3]),
                torsion: f64::from(vectors[1][0]),
                van_der_waals: f64::from(vectors[1][1]),
                electrostatic: f64::from(vectors[1][2]),
            })
            .collect();
        Ok(MetalMmffEvaluation {
            breakdowns,
            gradients: dispatch.gradients,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn optimize_mmff_profiled(
        &self,
        positions: &[[f32; 4]],
        parameters: &MmffParameters,
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalMmffOptimization, MetalRuntimeError> {
        let dispatch = self.host.optimize_mmff_profiled(
            positions,
            parameters,
            options,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch
            .positions
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
            || dispatch.energies.iter().any(|value| !value.is_finite())
            || dispatch
                .scaled_gradient_maxima
                .iter()
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal MMFF optimizer returned invalid numeric output".into(),
            ));
        }
        let statuses = dispatch
            .statuses
            .into_iter()
            .map(distance_optimization_status)
            .collect::<Result<Vec<_>, _>>()?;
        let optimizers = dispatch
            .optimizers
            .into_iter()
            .map(mmff_optimizer_kind)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(MetalMmffOptimization {
            positions: dispatch.positions,
            energies: dispatch.energies,
            scaled_gradient_maxima: dispatch.scaled_gradient_maxima,
            iterations: dispatch.iterations,
            statuses,
            optimizers,
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
        let observed_distance = self.host.evaluate_distance_constraints_profiled(
            &distance_positions,
            2,
            &constraints,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if !float_slices_close(
            &observed_distance.atom_energies,
            &expected_distance.atom_energies,
            1.0e-5,
        ) || !float_slices_close(
            observed_distance.gradients.as_flattened(),
            expected_distance.gradients.as_flattened(),
            1.0e-5,
        ) {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup distance objective differs from the CPU reference".into(),
            ));
        }
        let optimization_positions = [[0.0; 4], [4.0, 1.0, 0.5, 0.0]];
        let optimization_options = DistanceGeometryOptimizationOptions::default();
        let expected_optimization =
            optimize_distance_geometry(&optimization_positions, &constraints, optimization_options)
                .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_optimization = self.host.optimize_distance_geometry_profiled(
            &optimization_positions,
            2,
            &constraints,
            optimization_options,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if observed_optimization.statuses
            != [distance_optimization_status_code(
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
        let stereo_positions = [
            [1.0, 1.0, 1.0, 0.0],
            [1.0, -1.0, -1.0, 0.0],
            [-1.0, 1.0, -1.0, 0.0],
            [-1.0, -1.0, 1.0, 0.0],
        ];
        let chiral = [ChiralVolumeConstraint {
            atoms: [0, 1, 2, 3],
            lower: -17.0,
            upper: -15.0,
        }];
        let tetrahedral = [TetrahedralConstraint {
            atoms: [0, 0, 1, 2, 3],
            in_fused_small_ring: false,
        }];
        let expected_stereo =
            validate_conformer_stereo(&stereo_positions, &chiral, &tetrahedral)
                .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_stereo = self.host.validate_stereo_profiled(
            &stereo_positions,
            4,
            &chiral,
            &tetrahedral,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if observed_stereo.failure_flags != [expected_stereo] {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup stereo validation differs from the CPU reference".into(),
            ));
        }
        let etk_positions = [
            [0.1, 0.2, -0.3, 0.0],
            [1.2, -0.1, 0.4, 0.0],
            [2.0, 0.8, -0.2, 0.0],
            [2.7, 1.1, 0.9, 0.0],
        ];
        let torsions = [EtkTorsionConstraint {
            atoms: [0, 1, 2, 3],
            coefficients: [0.7, 0.3, 0.2, 0.0, 0.1, 0.0],
            signs: [1, -1, 1, 0, -1, 0],
        }];
        let impropers = [EtkImproperConstraint {
            atoms: [3, 2, 1, 0],
            weight: 0.4,
        }];
        let distances = [EtkDistanceConstraint {
            atoms: [0, 3],
            lower: 0.5,
            upper: 1.5,
            weight: 0.8,
        }];
        let expected_etk = evaluate_etk_geometry(&etk_positions, &torsions, &impropers, &distances)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_etk = self.host.evaluate_etk_profiled(
            &etk_positions,
            4,
            &torsions,
            &impropers,
            &distances,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        let observed_etk_energy = observed_etk.atom_energies.iter().sum::<f32>();
        if !float_slices_close(&[observed_etk_energy], &[expected_etk.energy], 2.0e-5)
            || !float_slices_close(
                observed_etk.gradients.as_flattened(),
                expected_etk.gradients.as_flattened(),
                2.0e-5,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup ETK energy/gradient differs from the CPU reference".into(),
            ));
        }
        let optimized_etk = self.host.optimize_etk_profiled(
            &etk_positions,
            4,
            EtkGeometryTerms {
                torsions: &torsions,
                impropers: &impropers,
                distances: &distances,
            },
            DistanceGeometryOptimizationOptions::default(),
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        let optimized_reference =
            evaluate_etk_geometry(&optimized_etk.positions, &torsions, &impropers, &distances)
                .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        if optimized_etk.statuses[0] > 1
            || optimized_etk.energies[0] > expected_etk.energy
            || !float_slices_close(
                &optimized_etk.energies,
                &[optimized_reference.energy],
                2.0e-4,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup ETK optimization failed its CPU energy check".into(),
            ));
        }
        let mmff_parameters = MmffParameters {
            variant: MmffVariant::Mmff94,
            atom_count: 4,
            bonds: vec![MmffBondTerm {
                atoms: [0, 1],
                force_constant: 4.0,
                equilibrium_distance: 1.2,
            }],
            angles: vec![MmffAngleTerm {
                atoms: [0, 1, 2],
                force_constant: 0.8,
                equilibrium_degrees: 109.5,
                linear: false,
            }],
            stretch_bends: vec![MmffStretchBendTerm {
                atoms: [0, 1, 2],
                force_ij: 0.2,
                force_kj: 0.3,
                equilibrium_ij: 1.2,
                equilibrium_kj: 1.3,
                equilibrium_degrees: 109.5,
            }],
            out_of_planes: vec![MmffOutOfPlaneTerm {
                atoms: [0, 1, 2, 3],
                force_constant: 0.5,
            }],
            torsions: vec![MmffTorsionTerm {
                atoms: [0, 1, 2, 3],
                v1: 0.2,
                v2: 0.4,
                v3: 0.6,
            }],
            van_der_waals: vec![MmffVanDerWaalsTerm {
                atoms: [0, 3],
                r_star: 3.5,
                epsilon: 0.08,
            }],
            electrostatics: vec![MmffElectrostaticTerm {
                atoms: [0, 3],
                charge_product: -0.12,
                is_one_four: true,
            }],
        };
        let mmff_positions = [
            [0.0, 0.0, 0.0, 0.0],
            [1.4, 0.0, 0.0, 0.0],
            [1.8, 1.1, 0.0, 0.0],
            [2.4, 1.1, 0.7, 0.0],
        ];
        let expected_mmff = evaluate_mmff(&mmff_parameters, &mmff_positions)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_mmff = self.host.evaluate_mmff_profiled(
            &mmff_positions,
            &mmff_parameters,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        let observed_energy = observed_mmff
            .breakdown_vectors
            .iter()
            .flatten()
            .copied()
            .collect::<Vec<_>>();
        let expected_energy = [
            expected_mmff.energy.bond_stretch as f32,
            expected_mmff.energy.angle_bend as f32,
            expected_mmff.energy.stretch_bend as f32,
            expected_mmff.energy.out_of_plane as f32,
            expected_mmff.energy.torsion as f32,
            expected_mmff.energy.van_der_waals as f32,
            expected_mmff.energy.electrostatic as f32,
            0.0,
        ];
        if !float_slices_close(&observed_energy, &expected_energy, 2.0e-3)
            || !float_slices_close(
                observed_mmff.gradients.as_flattened(),
                expected_mmff.gradients.as_flattened(),
                0.1,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup MMFF energy/gradient differs from the CPU reference".into(),
            ));
        }
        let optimization_parameters = MmffParameters {
            variant: MmffVariant::Mmff94,
            atom_count: 2,
            bonds: vec![MmffBondTerm {
                atoms: [0, 1],
                force_constant: 4.0,
                equilibrium_distance: 1.5,
            }],
            angles: Vec::new(),
            stretch_bends: Vec::new(),
            out_of_planes: Vec::new(),
            torsions: Vec::new(),
            van_der_waals: Vec::new(),
            electrostatics: Vec::new(),
        };
        let optimization_positions = [[0.0, 0.0, 0.0, 0.0], [1.8, 0.0, 0.0, 0.0]];
        let initial_energy = evaluate_mmff(&optimization_parameters, &optimization_positions)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?
            .energy
            .total() as f32;
        let optimized_mmff = self.host.optimize_mmff_profiled(
            &optimization_positions,
            &optimization_parameters,
            DistanceGeometryOptimizationOptions::default(),
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        let optimized_reference = evaluate_mmff(&optimization_parameters, &optimized_mmff.positions)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?
            .energy
            .total() as f32;
        if optimized_mmff.statuses[0] > 1
            || optimized_mmff.optimizers != [0]
            || optimized_mmff.energies[0] >= initial_energy
            || !float_slices_close(&optimized_mmff.energies, &[optimized_reference], 2.0e-3)
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup MMFF optimization failed its CPU energy check".into(),
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

fn mmff_optimizer_kind(optimizer: u32) -> Result<MmffOptimizerKind, MetalRuntimeError> {
    match optimizer {
        0 => Ok(MmffOptimizerKind::Bfgs),
        1 => Ok(MmffOptimizerKind::Lbfgs),
        _ => Err(MetalRuntimeError::Dispatch(format!(
            "Metal MMFF optimizer returned unknown optimizer kind {optimizer}"
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
        let embedded = runtime
            .embed_distance_bounds_profiled(
                &[[1, 2, 3, 4], [5, 6, 7, 8]],
                2,
                &[DistanceConstraint {
                    left_atom: 0,
                    right_atom: 1,
                    lower_squared: 1.0,
                    upper_squared: 2.0,
                    weight: 1.0,
                }],
                DistanceGeometryOptimizationOptions::default(),
                MIN_COMPUTE_MEMORY_BYTES,
            )
            .expect("packaged Metal ensemble embedding");
        assert_eq!(embedded.positions.len(), 4);
        assert_eq!(embedded.energies.len(), 2);
        assert!(embedded.statuses.iter().all(|status| matches!(
            status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
                | DistanceGeometryOptimizationStatus::ConvergedStep
        )));
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
