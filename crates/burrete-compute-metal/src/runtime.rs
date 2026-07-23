use std::{num::NonZeroUsize, path::Path, sync::Arc};

use burrete_compute_core::{
    align_and_score, build_tanimoto_graph, contract_pm6_pair_fock, contract_rm1_pair_fock,
    evaluate_distance_constraints, evaluate_etk_geometry, evaluate_mmff,
    initialize_conformer_positions, optimize_distance_geometry, pm6_d3_dispersion_energy,
    pm6_h4_energy, pm6_hh_repulsion_energy, pm6_one_center_d_fock, rm1_fock_pairs,
    score_tanimoto_query, symmetric_eigendecomposition, validate_conformer_stereo, AlignmentAtom,
    AlignmentMode, AlignmentScores, AtomMapping, ChiralVolumeConstraint, DistanceConstraint,
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, EtkDistanceConstraint,
    EtkGeometryTerms, EtkImproperConstraint, EtkTorsionConstraint, Fingerprint2048,
    GraphBuildOptions, MmffAngleTerm, MmffBondTerm, MmffElectrostaticTerm, MmffEnergyBreakdown,
    MmffOptimizerKind, MmffOutOfPlaneTerm, MmffParameters, MmffStretchBendTerm, MmffTorsionTerm,
    MmffVanDerWaalsTerm, MmffVariant, Pm6FockPair, RigidTransform, Rm1FockPair, SemiempiricalAtom,
    SemiempiricalMolecule, SymmetricCsr, TanimotoCounts, TanimotoKnnOptions, TanimotoQueryOptions,
    ChemicalSpaceMethod, TanimotoUmapGraph, TetrahedralConstraint, UmapOptions,
    FINGERPRINT_WORDS,
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
pub struct MetalTanimotoKnnExecution {
    pub source_indices: Vec<u32>,
    pub similarities: Vec<f32>,
    pub neighbors_per_vertex: usize,
    /// Sum of completed Metal and MPS command-buffer GPU intervals.
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalUmapExecution {
    /// `float4` storage; `z` is exactly zero for a 2D embedding.
    pub positions: Vec<[f32; 4]>,
    pub component_count: u32,
    /// Sum of completed Metal command-buffer GPU intervals.
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AlignmentPairDescriptor {
    pub probe_atom_start: u64,
    pub probe_atom_count: u64,
    pub reference_atom_start: u64,
    pub reference_atom_count: u64,
    pub mapping_start: u64,
    pub mapping_count: u64,
    pub mode: AlignmentMode,
}

#[derive(Clone, Copy, Debug)]
pub struct MetalAlignmentBatch<'a> {
    pub probe_atoms: &'a [AlignmentAtom],
    pub reference_atoms: &'a [AlignmentAtom],
    pub mappings: &'a [AtomMapping],
    pub pairs: &'a [AlignmentPairDescriptor],
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalAlignmentPairResult {
    pub transform: RigidTransform,
    pub scores: AlignmentScores,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalAlignmentExecution {
    pub pairs: Vec<MetalAlignmentPairResult>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalRm1FockContribution {
    pub contribution_ev: Vec<f32>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalPm6PairFockContribution {
    pub contribution_ev: Vec<f32>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalRm1PreparedPairs {
    pub pairs: Vec<Rm1FockPair>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalSymmetricEigen {
    pub eigenvalues: Vec<f64>,
    pub eigenvectors: Vec<f64>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Pm6CorrectionMoleculeDescriptor {
    pub atom_start: usize,
    pub atom_count: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct MetalPm6CorrectionBatch<'a> {
    pub atoms: &'a [SemiempiricalAtom],
    pub molecules: &'a [Pm6CorrectionMoleculeDescriptor],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pm6H4HhCorrection {
    pub h4_energy_ev: f64,
    pub hh_repulsion_energy_ev: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalPm6H4HhExecution {
    pub corrections: Vec<Pm6H4HhCorrection>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalPm6D3Execution {
    pub dispersion_energy_ev: Vec<f64>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct MetalPm6OneCenterFockBatch<'a> {
    pub densities: &'a [[f64; 81]],
    pub w_integrals: &'a [[f64; 243]],
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalPm6OneCenterFockExecution {
    pub contributions_ev: Vec<[f64; 81]>,
    pub gpu_time_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pm6D3H4Correction {
    pub dispersion_energy_ev: f64,
    pub h4_energy_ev: f64,
    pub hh_repulsion_energy_ev: f64,
}

impl Pm6D3H4Correction {
    pub fn total_energy_ev(self) -> f64 {
        self.dispersion_energy_ev + self.h4_energy_ev + self.hh_repulsion_energy_ev
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MetalPm6D3H4Execution {
    pub corrections: Vec<Pm6D3H4Correction>,
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

    pub fn build_tanimoto_knn_profiled(
        &self,
        fingerprints: &[Fingerprint2048],
        options: TanimotoKnnOptions,
    ) -> Result<MetalTanimotoKnnExecution, MetalRuntimeError> {
        let dispatch = self
            .host
            .build_tanimoto_knn_profiled(fingerprints, options)?;
        Ok(MetalTanimotoKnnExecution {
            source_indices: dispatch.source_indices,
            similarities: dispatch.similarities,
            neighbors_per_vertex: dispatch.neighbors_per_vertex,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn optimize_umap_profiled(
        &self,
        graph: &TanimotoUmapGraph,
        options: UmapOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalUmapExecution, MetalRuntimeError> {
        self.optimize_embedding_profiled(
            graph,
            options,
            ChemicalSpaceMethod::Umap,
            max_memory_bytes,
        )
    }

    pub fn optimize_embedding_profiled(
        &self,
        graph: &TanimotoUmapGraph,
        options: UmapOptions,
        method: ChemicalSpaceMethod,
        max_memory_bytes: u64,
    ) -> Result<MetalUmapExecution, MetalRuntimeError> {
        let dispatch = self.host.optimize_embedding_profiled(
            graph,
            options,
            method,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        Ok(MetalUmapExecution {
            positions: dispatch.positions,
            component_count: options.n_components(),
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn align_and_score_profiled(
        &self,
        batch: MetalAlignmentBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalAlignmentExecution, MetalRuntimeError> {
        let dispatch = self
            .host
            .align_and_score_profiled(batch, max_memory_bytes.min(self.limits.max_memory_bytes))?;
        if dispatch.transforms.len() != batch.pairs.len()
            || dispatch.primary_scores.len() != batch.pairs.len()
            || dispatch.secondary_scores.len() != batch.pairs.len()
            || dispatch.statuses.len() != batch.pairs.len()
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal alignment returned inconsistent array lengths".into(),
            ));
        }
        let mut pairs = Vec::with_capacity(batch.pairs.len());
        for (index, descriptor) in batch.pairs.iter().enumerate() {
            let status = dispatch.statuses[index];
            if status & 0x8000_0000 != 0 || status & !1 != 0 {
                return Err(MetalRuntimeError::Dispatch(format!(
                    "Metal alignment pair {index} returned invalid status 0x{status:08x}"
                )));
            }
            let transform_rows = dispatch.transforms[index];
            let primary = dispatch.primary_scores[index];
            let secondary = dispatch.secondary_scores[index];
            if transform_rows
                .iter()
                .flatten()
                .chain(primary.iter())
                .chain(secondary.iter())
                .any(|value| !value.is_finite())
            {
                return Err(MetalRuntimeError::Dispatch(format!(
                    "Metal alignment pair {index} returned non-finite output"
                )));
            }
            pairs.push(MetalAlignmentPairResult {
                transform: RigidTransform {
                    rotation: [
                        transform_rows[0][..3]
                            .try_into()
                            .expect("three rotation values"),
                        transform_rows[1][..3]
                            .try_into()
                            .expect("three rotation values"),
                        transform_rows[2][..3]
                            .try_into()
                            .expect("three rotation values"),
                    ],
                    translation: transform_rows[3][..3]
                        .try_into()
                        .expect("three translation values"),
                },
                scores: AlignmentScores {
                    rmsd: (descriptor.mode == AlignmentMode::MappedHorn).then_some(primary[0]),
                    shape_overlap: primary[1],
                    shape_tanimoto: primary[2],
                    shape_carbo: primary[3],
                    electrostatic_overlap: secondary[0],
                    electrostatic_carbo: secondary[1],
                    electrostatic_tanimoto: secondary[2],
                    electrostatic_available: status == 1,
                    combined_similarity: secondary[3],
                },
            });
        }
        Ok(MetalAlignmentExecution {
            pairs,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn contract_rm1_pair_fock_profiled(
        &self,
        orbital_count: usize,
        density: &[f64],
        pairs: &[Rm1FockPair],
        max_memory_bytes: u64,
    ) -> Result<MetalRm1FockContribution, MetalRuntimeError> {
        let expected = contract_rm1_pair_fock(orbital_count, density, pairs)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let density_f32 = density
            .iter()
            .map(|value| *value as f32)
            .collect::<Vec<_>>();
        let dispatch = self.host.contract_rm1_pair_fock_profiled(
            u32::try_from(orbital_count).map_err(|_| {
                MetalRuntimeError::ResourceLimit("RM1 orbital count exceeds uint32".into())
            })?,
            &density_f32,
            pairs,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        let maximum_drift = dispatch
            .contribution_ev
            .iter()
            .zip(&expected)
            .map(|(observed, expected)| (*observed - *expected as f32).abs())
            .fold(0.0_f32, f32::max);
        if dispatch.contribution_ev.len() != expected.len()
            || dispatch
                .contribution_ev
                .iter()
                .any(|value| !value.is_finite())
            || maximum_drift > 5.0e-4
        {
            return Err(MetalRuntimeError::KernelUnavailable(format!(
                "Metal RM1 pair Fock contraction differs from the float64 CPU reference: maximum drift={maximum_drift:e}"
            )));
        }
        Ok(MetalRm1FockContribution {
            contribution_ev: dispatch.contribution_ev,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn contract_pm6_pair_fock_profiled(
        &self,
        orbital_count: usize,
        density: &[f64],
        pairs: &[Pm6FockPair],
        max_memory_bytes: u64,
    ) -> Result<MetalPm6PairFockContribution, MetalRuntimeError> {
        let expected = contract_pm6_pair_fock(orbital_count, density, pairs)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let density_f32 = density
            .iter()
            .map(|value| *value as f32)
            .collect::<Vec<_>>();
        let dispatch = self.host.contract_pm6_pair_fock_profiled(
            u32::try_from(orbital_count).map_err(|_| {
                MetalRuntimeError::ResourceLimit("PM6 orbital count exceeds uint32".into())
            })?,
            &density_f32,
            pairs,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.contribution_ev.len() != expected.len()
            || dispatch
                .contribution_ev
                .iter()
                .zip(&expected)
                .any(|(observed, expected)| {
                    !observed.is_finite() || (*observed - *expected as f32).abs() > 5.0e-4
                })
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal PM6 pair Fock contraction differs from the float64 CPU reference".into(),
            ));
        }
        Ok(MetalPm6PairFockContribution {
            contribution_ev: dispatch.contribution_ev,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn evaluate_pm6_h4_hh_profiled(
        &self,
        batch: MetalPm6CorrectionBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalPm6H4HhExecution, MetalRuntimeError> {
        if batch.molecules.is_empty() || batch.molecules.len() > 256 {
            return Err(MetalRuntimeError::ResourceLimit(
                "PM6 correction batch requires 1..=256 molecules".into(),
            ));
        }
        let mut expected = Vec::with_capacity(batch.molecules.len());
        for (index, molecule) in batch.molecules.iter().enumerate() {
            let end = molecule
                .atom_start
                .checked_add(molecule.atom_count)
                .ok_or_else(|| {
                    MetalRuntimeError::ResourceLimit("PM6 correction atom span overflow".into())
                })?;
            if molecule.atom_count == 0 || molecule.atom_count > 128 || end > batch.atoms.len() {
                return Err(MetalRuntimeError::Dispatch(format!(
                    "PM6 correction molecule {index} has an invalid atom span"
                )));
            }
            let atoms = &batch.atoms[molecule.atom_start..end];
            expected.push(Pm6H4HhCorrection {
                h4_energy_ev: pm6_h4_energy(atoms)
                    .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?,
                hh_repulsion_energy_ev: pm6_hh_repulsion_energy(atoms)
                    .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?,
            });
        }
        let dispatch = self.host.evaluate_pm6_h4_hh_profiled(
            batch,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.corrections_ev.len() != expected.len() {
            return Err(MetalRuntimeError::Dispatch(
                "Metal PM6 correction returned an invalid output shape".into(),
            ));
        }
        for (index, (observed, expected)) in
            dispatch.corrections_ev.iter().zip(&expected).enumerate()
        {
            if observed.iter().any(|value| !value.is_finite())
                || (f64::from(observed[0]) - expected.h4_energy_ev).abs() > 2.0e-5
                || (f64::from(observed[1]) - expected.hh_repulsion_energy_ev).abs() > 2.0e-5
            {
                return Err(MetalRuntimeError::KernelUnavailable(format!(
                    "Metal PM6 H4/HH correction differs from the float64 CPU reference at molecule {index}"
                )));
            }
        }
        Ok(MetalPm6H4HhExecution {
            corrections: dispatch
                .corrections_ev
                .into_iter()
                .map(|value| Pm6H4HhCorrection {
                    h4_energy_ev: f64::from(value[0]),
                    hh_repulsion_energy_ev: f64::from(value[1]),
                })
                .collect(),
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn evaluate_pm6_d3_profiled(
        &self,
        batch: MetalPm6CorrectionBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalPm6D3Execution, MetalRuntimeError> {
        let expected = batch
            .molecules
            .iter()
            .enumerate()
            .map(|(index, molecule)| {
                let end = molecule
                    .atom_start
                    .checked_add(molecule.atom_count)
                    .ok_or_else(|| {
                        MetalRuntimeError::ResourceLimit("PM6 D3 atom span overflow".into())
                    })?;
                if molecule.atom_count == 0 || molecule.atom_count > 128 || end > batch.atoms.len()
                {
                    return Err(MetalRuntimeError::Dispatch(format!(
                        "PM6 D3 molecule {index} has an invalid atom span"
                    )));
                }
                pm6_d3_dispersion_energy(&batch.atoms[molecule.atom_start..end])
                    .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))
            })
            .collect::<Result<Vec<_>, MetalRuntimeError>>()?;
        if expected.is_empty() || expected.len() > 256 {
            return Err(MetalRuntimeError::ResourceLimit(
                "PM6 D3 batch requires 1..=256 molecules".into(),
            ));
        }
        let dispatch = self
            .host
            .evaluate_pm6_d3_profiled(batch, max_memory_bytes.min(self.limits.max_memory_bytes))?;
        if dispatch.dispersion_ev.len() != expected.len()
            || dispatch
                .dispersion_ev
                .iter()
                .zip(&expected)
                .any(|(observed, expected)| {
                    !observed.is_finite() || (f64::from(*observed) - expected).abs() > 2.0e-5
                })
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal PM6 D3 dispersion differs from the float64 CPU reference".into(),
            ));
        }
        Ok(MetalPm6D3Execution {
            dispersion_energy_ev: dispatch.dispersion_ev.into_iter().map(f64::from).collect(),
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn evaluate_pm6_d3h4_profiled(
        &self,
        batch: MetalPm6CorrectionBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalPm6D3H4Execution, MetalRuntimeError> {
        let d3 = self.evaluate_pm6_d3_profiled(batch, max_memory_bytes)?;
        let h4_hh = self.evaluate_pm6_h4_hh_profiled(batch, max_memory_bytes)?;
        let corrections = d3
            .dispersion_energy_ev
            .into_iter()
            .zip(h4_hh.corrections)
            .map(|(dispersion_energy_ev, correction)| Pm6D3H4Correction {
                dispersion_energy_ev,
                h4_energy_ev: correction.h4_energy_ev,
                hh_repulsion_energy_ev: correction.hh_repulsion_energy_ev,
            })
            .collect();
        Ok(MetalPm6D3H4Execution {
            corrections,
            gpu_time_ms: d3.gpu_time_ms.saturating_add(h4_hh.gpu_time_ms),
        })
    }

    pub fn evaluate_pm6_one_center_fock_profiled(
        &self,
        batch: MetalPm6OneCenterFockBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalPm6OneCenterFockExecution, MetalRuntimeError> {
        if batch.densities.is_empty()
            || batch.densities.len() > 256
            || batch.densities.len() != batch.w_integrals.len()
        {
            return Err(MetalRuntimeError::ResourceLimit(
                "PM6 one-center Fock batch requires 1..=256 paired density/W blocks".into(),
            ));
        }
        let expected = batch
            .densities
            .iter()
            .zip(batch.w_integrals)
            .map(|(density, w)| {
                pm6_one_center_d_fock(density, w)
                    .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let dispatch = self.host.evaluate_pm6_one_center_fock_profiled(
            batch,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.contributions_ev.len() != expected.len() * 81 {
            return Err(MetalRuntimeError::Dispatch(
                "Metal PM6 one-center Fock returned an invalid output shape".into(),
            ));
        }
        let mut contributions = Vec::with_capacity(expected.len());
        for (block, expected_block) in expected.iter().enumerate() {
            let observed = &dispatch.contributions_ev[block * 81..(block + 1) * 81];
            if observed
                .iter()
                .zip(expected_block)
                .any(|(observed, expected)| {
                    !observed.is_finite() || (f64::from(*observed) - expected).abs() > 2.0e-4
                })
            {
                return Err(MetalRuntimeError::KernelUnavailable(format!(
                    "Metal PM6 one-center Fock differs from the float64 CPU reference at block {block}"
                )));
            }
            contributions.push(std::array::from_fn(|index| f64::from(observed[index])));
        }
        Ok(MetalPm6OneCenterFockExecution {
            contributions_ev: contributions,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn prepare_rm1_pairs_profiled(
        &self,
        molecule: &SemiempiricalMolecule,
        max_memory_bytes: u64,
    ) -> Result<MetalRm1PreparedPairs, MetalRuntimeError> {
        let expected = rm1_fock_pairs(molecule)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let dispatch = self.host.prepare_rm1_pairs_profiled(
            molecule,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.repulsion_ev.len() != expected.len() * 256
            || dispatch.left_core_attraction_ev.len() != expected.len() * 16
            || dispatch.right_core_attraction_ev.len() != expected.len() * 16
            || dispatch
                .repulsion_ev
                .iter()
                .chain(&dispatch.left_core_attraction_ev)
                .chain(&dispatch.right_core_attraction_ev)
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(
                "Metal RM1 pair rotation returned an invalid output shape".into(),
            ));
        }
        let mut pairs = Vec::with_capacity(expected.len());
        for (index, reference) in expected.iter().enumerate() {
            let repulsion = &dispatch.repulsion_ev[index * 256..(index + 1) * 256];
            let left = &dispatch.left_core_attraction_ev[index * 16..(index + 1) * 16];
            let right = &dispatch.right_core_attraction_ev[index * 16..(index + 1) * 16];
            let parity_failed = repulsion
                .iter()
                .zip(&reference.repulsion_ev)
                .any(|(observed, expected)| (*observed as f64 - expected).abs() > 5.0e-4)
                || left
                    .iter()
                    .zip(reference.left_core_attraction_ev)
                    .any(|(observed, expected)| (*observed as f64 - expected).abs() > 5.0e-4)
                || right
                    .iter()
                    .zip(reference.right_core_attraction_ev)
                    .any(|(observed, expected)| (*observed as f64 - expected).abs() > 5.0e-4);
            if parity_failed {
                return Err(MetalRuntimeError::KernelUnavailable(format!(
                    "Metal RM1 pair rotation differs from the float64 CPU reference at pair {index}"
                )));
            }
            pairs.push(Rm1FockPair {
                left_orbital_start: reference.left_orbital_start,
                left_orbital_count: reference.left_orbital_count,
                right_orbital_start: reference.right_orbital_start,
                right_orbital_count: reference.right_orbital_count,
                repulsion_ev: repulsion.iter().map(|value| f64::from(*value)).collect(),
                left_core_attraction_ev: left
                    .iter()
                    .map(|value| f64::from(*value))
                    .collect::<Vec<_>>()
                    .try_into()
                    .expect("validated 16-value RM1 left attraction"),
                right_core_attraction_ev: right
                    .iter()
                    .map(|value| f64::from(*value))
                    .collect::<Vec<_>>()
                    .try_into()
                    .expect("validated 16-value RM1 right attraction"),
            });
        }
        Ok(MetalRm1PreparedPairs {
            pairs,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
        })
    }

    pub fn symmetric_eigen_profiled(
        &self,
        matrix: &[f64],
        order: usize,
        max_memory_bytes: u64,
    ) -> Result<MetalSymmetricEigen, MetalRuntimeError> {
        let (expected_values, _) = symmetric_eigendecomposition(matrix, order)
            .map_err(|error| MetalRuntimeError::Dispatch(error.to_string()))?;
        let diagonal_shift = (0..order)
            .map(|index| matrix[index * order + index])
            .sum::<f64>()
            / order as f64;
        let matrix_scale = matrix
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let row = index / order;
                let column = index - row * order;
                let shifted = if row == column {
                    *value - diagonal_shift
                } else {
                    *value
                };
                shifted.abs()
            })
            .fold(0.0_f64, f64::max)
            .max(f64::MIN_POSITIVE);
        let matrix_f32 = matrix
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let row = index / order;
                let column = index - row * order;
                let shifted = if row == column {
                    *value - diagonal_shift
                } else {
                    *value
                };
                (shifted / matrix_scale) as f32
            })
            .collect::<Vec<_>>();
        let dispatch = self.host.symmetric_eigen_profiled(
            &matrix_f32,
            u32::try_from(order).map_err(|_| {
                MetalRuntimeError::ResourceLimit("symmetric matrix order exceeds uint32".into())
            })?,
            max_memory_bytes.min(self.limits.max_memory_bytes),
        )?;
        if dispatch.status != 0
            || dispatch.eigenvalues.len() != order
            || dispatch.eigenvectors.len() != order * order
            || dispatch
                .eigenvalues
                .iter()
                .chain(&dispatch.eigenvectors)
                .any(|value| !value.is_finite())
        {
            return Err(MetalRuntimeError::Dispatch(format!(
                "Metal symmetric eigensolver returned invalid status {} or output shape",
                dispatch.status
            )));
        }
        let eigenvalues = dispatch
            .eigenvalues
            .iter()
            .map(|value| f64::from(*value) * matrix_scale + diagonal_shift)
            .collect::<Vec<_>>();
        let eigenvectors = dispatch
            .eigenvectors
            .iter()
            .map(|value| f64::from(*value))
            .collect::<Vec<_>>();
        let eigenvalue_drift = eigenvalues
            .iter()
            .zip(&expected_values)
            .map(|(observed, expected)| (observed - expected).abs())
            .fold(0.0_f64, f64::max);
        let mut residual_maximum = 0.0_f64;
        let mut orthogonality_maximum = 0.0_f64;
        for column in 0..order {
            for row in 0..order {
                let projected = (0..order)
                    .map(|inner| matrix[row * order + inner] * eigenvectors[inner * order + column])
                    .sum::<f64>();
                residual_maximum = residual_maximum.max(
                    (projected - eigenvalues[column] * eigenvectors[row * order + column]).abs(),
                );
            }
            for other in 0..order {
                let overlap = (0..order)
                    .map(|row| {
                        eigenvectors[row * order + column] * eigenvectors[row * order + other]
                    })
                    .sum::<f64>();
                let expected_overlap = if column == other { 1.0 } else { 0.0 };
                orthogonality_maximum =
                    orthogonality_maximum.max((overlap - expected_overlap).abs());
            }
        }
        if eigenvalue_drift > 5.0e-4 || residual_maximum > 5.0e-4 || orthogonality_maximum > 5.0e-4
        {
            return Err(MetalRuntimeError::KernelUnavailable(format!(
                "Metal symmetric eigensolver parity failed: eigenvalue={eigenvalue_drift:e}, residual={residual_maximum:e}, orthogonality={orthogonality_maximum:e}"
            )));
        }
        Ok(MetalSymmetricEigen {
            eigenvalues,
            eigenvectors,
            gpu_time_ms: gpu_time_ms(dispatch.gpu_time_seconds)?,
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
                0.005,
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
            return Err(MetalRuntimeError::KernelUnavailable(format!(
                "Metal startup MMFF optimization failed its CPU energy check: status={:?}, optimizer={:?}, initial={initial_energy}, GPU={:?}, CPU={optimized_reference}, gradient={:?}, iterations={:?}",
                optimized_mmff.statuses, optimized_mmff.optimizers, optimized_mmff.energies,
                optimized_mmff.scaled_gradient_maxima, optimized_mmff.iterations
            )));
        }
        let mut rm1_tensor = vec![0.0; 256];
        rm1_tensor[0] = 10.0;
        let rm1_pairs = [Rm1FockPair {
            left_orbital_start: 0,
            left_orbital_count: 1,
            right_orbital_start: 1,
            right_orbital_count: 1,
            repulsion_ev: rm1_tensor,
            left_core_attraction_ev: [0.0; 16],
            right_core_attraction_ev: [0.0; 16],
        }];
        let rm1_density = [1.0, 0.2, 0.2, 1.0];
        let expected_rm1 = contract_rm1_pair_fock(2, &rm1_density, &rm1_pairs)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_rm1 = self.host.contract_rm1_pair_fock_profiled(
            2,
            &[1.0, 0.2, 0.2, 1.0],
            &rm1_pairs,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if !float_slices_close(
            &observed_rm1.contribution_ev,
            &expected_rm1
                .iter()
                .map(|value| *value as f32)
                .collect::<Vec<_>>(),
            2.0e-5,
        ) {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup RM1 pair Fock contraction differs from the CPU reference".into(),
            ));
        }
        let pm6_pair = Pm6FockPair {
            left_orbital_start: 0,
            left_orbital_count: 9,
            right_orbital_start: 9,
            right_orbital_count: 1,
            repulsion_ev: (0..81).map(|index| (index + 1) as f64 * 0.03125).collect(),
            left_core_attraction_ev: vec![0.0; 81],
            right_core_attraction_ev: vec![0.0],
        };
        let mut pm6_pair_density = vec![0.0; 100];
        for orbital in 0..10 {
            pm6_pair_density[orbital * 10 + orbital] = 0.5 + orbital as f64 * 0.1;
        }
        pm6_pair_density[2 * 10 + 9] = 0.2;
        pm6_pair_density[9 * 10 + 2] = 0.2;
        let expected_pm6_pair =
            contract_pm6_pair_fock(10, &pm6_pair_density, std::slice::from_ref(&pm6_pair))
                .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_pm6_pair = self.host.contract_pm6_pair_fock_profiled(
            10,
            &pm6_pair_density
                .iter()
                .map(|value| *value as f32)
                .collect::<Vec<_>>(),
            &[pm6_pair],
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if !float_slices_close(
            &observed_pm6_pair.contribution_ev,
            &expected_pm6_pair
                .iter()
                .map(|value| *value as f32)
                .collect::<Vec<_>>(),
            5.0e-5,
        ) {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup PM6 variable-basis pair Fock contraction differs from the CPU reference"
                    .into(),
            ));
        }
        let eigen_matrix = [-1.0, 0.2, 0.2, 0.5];
        let expected_eigen = symmetric_eigendecomposition(&eigen_matrix, 2)
            .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let observed_eigen = self.host.symmetric_eigen_profiled(
            &[-1.0, 0.2, 0.2, 0.5],
            2,
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if observed_eigen.status != 0
            || !float_slices_close(
                &observed_eigen.eigenvalues,
                &expected_eigen
                    .0
                    .iter()
                    .map(|value| *value as f32)
                    .collect::<Vec<_>>(),
                2.0e-5,
            )
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup symmetric eigensolver differs from the CPU reference".into(),
            ));
        }
        let pair_probe = SemiempiricalMolecule::rm1(
            vec![
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.0, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.7, 0.2, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 6,
                    position_angstrom: [1.4, -0.3, 0.4],
                },
                SemiempiricalAtom {
                    atomic_number: 8,
                    position_angstrom: [2.2, 0.5, -0.2],
                },
            ],
            0,
        )
        .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let rotated_pairs =
            self.prepare_rm1_pairs_profiled(&pair_probe, MIN_COMPUTE_MEMORY_BYTES)?;
        if rotated_pairs.pairs.len() != 6 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup RM1 pair rotation returned an invalid pair count".into(),
            ));
        }

        let correction_atoms = [
            semiempirical_atom(8, [0.0, 0.0, 0.0]),
            semiempirical_atom(1, [-0.586, 0.756, 0.0]),
            semiempirical_atom(1, [0.957, 0.0, 0.0]),
            semiempirical_atom(8, [2.91, 0.0, 0.0]),
            semiempirical_atom(1, [3.28, 0.756, 0.0]),
            semiempirical_atom(1, [3.28, -0.756, 0.0]),
            semiempirical_atom(6, [0.0, 0.0, 0.0]),
            semiempirical_atom(1, [0.629, 0.629, 0.629]),
            semiempirical_atom(1, [-0.629, -0.629, 0.629]),
            semiempirical_atom(1, [-0.629, 0.629, -0.629]),
            semiempirical_atom(1, [0.629, -0.629, -0.629]),
            semiempirical_atom(16, [0.0, 0.0, 0.0]),
            semiempirical_atom(17, [2.1, 0.0, 0.0]),
            semiempirical_atom(35, [0.0, 2.6, 0.0]),
            semiempirical_atom(53, [0.0, 0.0, 3.1]),
        ];
        let correction_descriptors = [
            Pm6CorrectionMoleculeDescriptor {
                atom_start: 0,
                atom_count: 6,
            },
            Pm6CorrectionMoleculeDescriptor {
                atom_start: 6,
                atom_count: 5,
            },
            Pm6CorrectionMoleculeDescriptor {
                atom_start: 11,
                atom_count: 4,
            },
        ];
        let correction = self.evaluate_pm6_d3h4_profiled(
            MetalPm6CorrectionBatch {
                atoms: &correction_atoms,
                molecules: &correction_descriptors,
            },
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if correction.gpu_time_ms == 0
            || correction.corrections.len() != 3
            || (correction.corrections[2].dispersion_energy_ev + 0.741_957_085_936_019_2).abs()
                > 2.0e-5
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup PM6-D3H4 correction returned invalid profiling output".into(),
            ));
        }

        let mut pm6_density = [0.0; 81];
        for row in 0..9 {
            for column in 0..=row {
                let value = (row + 1) as f64 * 0.2 + (column + 1) as f64 * 0.03;
                pm6_density[row * 9 + column] = value;
                pm6_density[column * 9 + row] = value;
            }
        }
        let pm6_w = std::array::from_fn(|index| (index + 1) as f64 * 0.03125);
        let pm6_fock = self.evaluate_pm6_one_center_fock_profiled(
            MetalPm6OneCenterFockBatch {
                densities: &[pm6_density],
                w_integrals: &[pm6_w],
            },
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        if pm6_fock.gpu_time_ms == 0 || pm6_fock.contributions_ev.len() != 1 {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup PM6 one-center Fock returned invalid profiling output".into(),
            ));
        }

        let probe_atoms = [
            alignment_atom([0.0, 0.0, 0.0, 0.0], 0.8, 1.2, 0.3),
            alignment_atom([1.0, 0.0, 0.0, 0.0], 0.9, 1.4, -0.2),
            alignment_atom([0.0, 2.0, 0.0, 0.0], 1.0, 1.6, 0.3),
            alignment_atom([0.2, 0.4, 1.0, 0.0], 1.1, 1.8, -0.2),
        ];
        let reference_atoms = probe_atoms.map(|mut atom| {
            let [x, y, z, _] = atom.position;
            atom.position = [2.0 - y, -1.0 + x, 0.5 + z, 0.0];
            atom
        });
        let mappings = [0_u32, 1, 2, 3].map(|atom| AtomMapping {
            probe_atom: atom,
            reference_atom: atom,
            weight: 1.0,
        });
        let expected_alignment = align_and_score(
            &probe_atoms,
            &reference_atoms,
            &mappings,
            AlignmentMode::MappedHorn,
        )
        .map_err(|error| MetalRuntimeError::KernelUnavailable(error.to_string()))?;
        let descriptors = [AlignmentPairDescriptor {
            probe_atom_start: 0,
            probe_atom_count: probe_atoms.len() as u64,
            reference_atom_start: 0,
            reference_atom_count: reference_atoms.len() as u64,
            mapping_start: 0,
            mapping_count: mappings.len() as u64,
            mode: AlignmentMode::MappedHorn,
        }];
        let observed_alignment = self.host.align_and_score_profiled(
            MetalAlignmentBatch {
                probe_atoms: &probe_atoms,
                reference_atoms: &reference_atoms,
                mappings: &mappings,
                pairs: &descriptors,
            },
            MIN_COMPUTE_MEMORY_BYTES,
        )?;
        let observed_primary = observed_alignment.primary_scores[0];
        let observed_secondary = observed_alignment.secondary_scores[0];
        let expected_scores = expected_alignment.scores;
        if observed_alignment.statuses != [1]
            || !float_slices_close(
                &observed_primary,
                &[
                    expected_scores.rmsd.expect("mapped startup RMSD"),
                    expected_scores.shape_overlap,
                    expected_scores.shape_tanimoto,
                    expected_scores.shape_carbo,
                ],
                3.0e-4,
            )
            || !float_slices_close(
                &observed_secondary,
                &[
                    expected_scores.electrostatic_overlap,
                    expected_scores.electrostatic_carbo,
                    expected_scores.electrostatic_tanimoto,
                    expected_scores.combined_similarity,
                ],
                3.0e-4,
            )
            || observed_primary[0] > 3.0e-4
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal startup alignment/scoring differs from the float64 CPU reference".into(),
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

fn semiempirical_atom(atomic_number: u8, position_angstrom: [f64; 3]) -> SemiempiricalAtom {
    SemiempiricalAtom {
        atomic_number,
        position_angstrom,
    }
}

fn alignment_atom(
    position: [f32; 4],
    gaussian_exponent: f32,
    gaussian_amplitude: f32,
    partial_charge: f32,
) -> AlignmentAtom {
    AlignmentAtom {
        position,
        gaussian_exponent,
        gaussian_amplitude,
        partial_charge,
    }
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

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use burrete_compute_core::{
        build_tanimoto_knn, build_tanimoto_umap_graph, butina_clusters, ButinaOptions,
    };
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitMmffFixture {
        cases: Vec<RdkitMmffCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitMmffCase {
        name: String,
        variant: String,
        positions: Vec<[f32; 4]>,
        expected_energy_kcal_mol: f64,
        expected_optimized_energy_kcal_mol: f64,
        bmfx_base64: String,
    }

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
        let atoms = [
            alignment_atom([0.0, 0.0, 0.0, 0.0], 0.8, 1.2, 0.3),
            alignment_atom([1.5, 0.0, 0.0, 0.0], 0.9, 1.4, -0.2),
        ];
        let descriptors = [AlignmentPairDescriptor {
            probe_atom_start: 0,
            probe_atom_count: 2,
            reference_atom_start: 0,
            reference_atom_count: 2,
            mapping_start: 0,
            mapping_count: 0,
            mode: AlignmentMode::FixedPose,
        }];
        let alignment = runtime
            .align_and_score_profiled(
                MetalAlignmentBatch {
                    probe_atoms: &atoms,
                    reference_atoms: &atoms,
                    mappings: &[],
                    pairs: &descriptors,
                },
                MIN_COMPUTE_MEMORY_BYTES,
            )
            .expect("packaged Metal fixed-pose scoring");
        assert!((alignment.pairs[0].scores.shape_tanimoto - 1.0).abs() < 1.0e-5);
        assert!((alignment.pairs[0].scores.electrostatic_carbo - 1.0).abs() < 1.0e-5);
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

    #[test]
    #[ignore = "manual packaged-runtime chemical-space smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn builds_tanimoto_umap_with_the_packaged_runtime_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged ComputeMetal directory");
        let runtime = MetalComputeRuntime::load(&root, &"0".repeat(64))
            .expect("verified packaged Metal runtime");
        let fingerprints = [0b1111_u64, 0b1110, 0b1100, 0b1000].map(|first_word| {
            let mut words = [0_u64; FINGERPRINT_WORDS];
            words[0] = first_word;
            Fingerprint2048::from_words(words)
        });
        let options = TanimotoKnnOptions::try_new(
            NonZeroUsize::new(1).expect("nonzero k"),
            MIN_COMPUTE_MEMORY_BYTES,
        )
        .expect("kNN options");
        let expected = build_tanimoto_knn(&fingerprints, options).expect("CPU kNN reference");
        let observed = runtime
            .build_tanimoto_knn_profiled(&fingerprints, options)
            .expect("Metal Tanimoto kNN");

        assert_eq!(observed.neighbors_per_vertex, 1);
        assert_eq!(
            observed.source_indices,
            expected
                .source_indices()
                .iter()
                .map(|index| *index as u32)
                .collect::<Vec<_>>()
        );
        assert_eq!(observed.similarities, vec![0.75, 0.75, 2.0 / 3.0, 0.5]);
        assert!(observed.gpu_time_ms <= 2_000);

        let options_2d =
            UmapOptions::try_new(2, 20, 0.1, 1.0, 1.0, 5, 42).expect("2D UMAP options");
        let graph = build_tanimoto_umap_graph(
            fingerprints.len(),
            NonZeroUsize::new(observed.neighbors_per_vertex).expect("nonzero k"),
            &observed.source_indices,
            &observed.similarities,
            options_2d,
        )
        .expect("Tanimoto fuzzy graph");
        let embedding_2d = runtime
            .optimize_umap_profiled(&graph, options_2d, MIN_COMPUTE_MEMORY_BYTES)
            .expect("Metal UMAP 2D");
        assert_eq!(embedding_2d.positions.len(), fingerprints.len());
        assert_eq!(embedding_2d.component_count, 2);
        assert!(embedding_2d
            .positions
            .iter()
            .all(|position| position[2] == 0.0));

        for method in [
            ChemicalSpaceMethod::Tsne,
            ChemicalSpaceMethod::Pacmap,
            ChemicalSpaceMethod::Localmap,
            ChemicalSpaceMethod::Trimap,
            ChemicalSpaceMethod::Dreams,
            ChemicalSpaceMethod::Cne,
            ChemicalSpaceMethod::Mmae,
        ] {
            let embedding = runtime
                .optimize_embedding_profiled(
                    &graph,
                    options_2d,
                    method,
                    MIN_COMPUTE_MEMORY_BYTES,
                )
                .expect("Metal chemical-space objective");
            assert_eq!(embedding.positions.len(), fingerprints.len());
            assert!(embedding
                .positions
                .iter()
                .flatten()
                .all(|value| value.is_finite()));
        }

        let options_3d =
            UmapOptions::try_new(3, 20, 0.1, 1.0, 1.0, 5, 42).expect("3D UMAP options");
        let embedding_3d = runtime
            .optimize_umap_profiled(&graph, options_3d, MIN_COMPUTE_MEMORY_BYTES)
            .expect("Metal UMAP 3D");
        assert_eq!(embedding_3d.component_count, 3);
        assert!(embedding_3d
            .positions
            .iter()
            .any(|position| position[2] != 0.0));

        let wide_fingerprints = (0_u64..66)
            .map(|index| {
                let mut words = [0_u64; FINGERPRINT_WORDS];
                words[0] = index + 1;
                words[1] = index.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
                Fingerprint2048::from_words(words)
            })
            .collect::<Vec<_>>();
        let wide_options = TanimotoKnnOptions::try_new(
            NonZeroUsize::new(64).expect("nonzero k"),
            MIN_COMPUTE_MEMORY_BYTES,
        )
        .expect("wide kNN options");
        let wide_expected =
            build_tanimoto_knn(&wide_fingerprints, wide_options).expect("wide CPU kNN reference");
        let wide_observed = runtime
            .build_tanimoto_knn_profiled(&wide_fingerprints, wide_options)
            .expect("wide Metal Tanimoto kNN");
        assert_eq!(wide_observed.neighbors_per_vertex, 64);
        assert_eq!(
            wide_observed.source_indices,
            wide_expected
                .source_indices()
                .iter()
                .map(|index| *index as u32)
                .collect::<Vec<_>>()
        );
        for (observed, expected) in wide_observed
            .similarities
            .iter()
            .zip(wide_expected.counts())
        {
            assert!((observed - expected.similarity() as f32).abs() <= 1.0e-6);
        }
    }

    #[test]
    #[ignore = "manual RDKit corpus smoke; set BURRETE_METAL_RUNTIME_ROOT"]
    fn matches_pinned_rdkit_mmff_corpus_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged ComputeMetal directory");
        let runtime = MetalComputeRuntime::load(&root, &"0".repeat(64))
            .expect("verified packaged Metal runtime");
        let fixture: RdkitMmffFixture = serde_json::from_str(include_str!(
            "../../../compute/rdkit-conformer/fixtures/mmff-rdkit-2025.03.4.json"
        ))
        .expect("decode pinned RDKit MMFF corpus");
        assert_eq!(fixture.cases.len(), 24);
        for case in fixture.cases {
            let bytes = STANDARD
                .decode(&case.bmfx_base64)
                .expect("decode BMFX fixture");
            let native = burrete_compute_core::decode_native_mmff_parameters(&bytes, bytes.len())
                .unwrap_or_else(|error| panic!("{} {} BMFX: {error}", case.name, case.variant));
            let result = runtime
                .evaluate_mmff_profiled(
                    &case.positions,
                    &native.parameters,
                    MIN_COMPUTE_MEMORY_BYTES,
                )
                .unwrap_or_else(|error| {
                    panic!("{} {} Metal dispatch: {error}", case.name, case.variant)
                });
            assert_eq!(result.breakdowns.len(), 1);
            let observed = result.breakdowns[0].total();
            assert!(
                (observed - case.expected_energy_kcal_mol).abs() <= 2.0e-2,
                "{} {} Metal={observed} RDKit={}",
                case.name,
                case.variant,
                case.expected_energy_kcal_mol
            );
            let optimized = runtime
                .optimize_mmff_profiled(
                    &case.positions,
                    &native.parameters,
                    DistanceGeometryOptimizationOptions::default(),
                    MIN_COMPUTE_MEMORY_BYTES,
                )
                .unwrap_or_else(|error| {
                    panic!("{} {} Metal optimizer: {error}", case.name, case.variant)
                });
            assert_eq!(optimized.energies.len(), 1);
            assert!(matches!(
                optimized.statuses[0],
                DistanceGeometryOptimizationStatus::ConvergedGradient
                    | DistanceGeometryOptimizationStatus::ConvergedStep
            ));
            assert!(
                (f64::from(optimized.energies[0]) - case.expected_optimized_energy_kcal_mol).abs()
                    <= 2.5e-1,
                "{} {} Metal optimized={} RDKit optimized={}",
                case.name,
                case.variant,
                optimized.energies[0],
                case.expected_optimized_energy_kcal_mol
            );
        }
    }

    #[test]
    #[ignore = "manual Apple GPU scale benchmark; set BURRETE_METAL_RUNTIME_ROOT"]
    fn benchmarks_large_fingerprint_libraries_on_the_real_gpu() {
        let root = std::env::var_os("BURRETE_METAL_RUNTIME_ROOT")
            .map(PathBuf::from)
            .expect("BURRETE_METAL_RUNTIME_ROOT must name a packaged ComputeMetal directory");
        let runtime = MetalComputeRuntime::load(&root, &"0".repeat(64))
            .expect("verified packaged Metal runtime");
        let graph_count = std::env::var("BURRETE_METAL_GRAPH_BENCHMARK_COUNT")
            .ok()
            .map(|value| value.parse::<usize>().expect("numeric graph count"))
            .unwrap_or(10_000);
        assert!((2..=100_000).contains(&graph_count));
        let fingerprints = deterministic_fingerprints(100_000);
        let query_options =
            TanimotoQueryOptions::new(256 * 1024 * 1024).expect("admit 100k query output");
        let query_host_start = std::time::Instant::now();
        let query = runtime
            .score_query_profiled(&fingerprints[0], &fingerprints, query_options)
            .expect("score 100k library");
        let query_host_ms = query_host_start.elapsed().as_millis();
        assert_eq!(query.counts.len(), 100_000);
        for &index in &[0, 1, 17, 9_999, 99_999] {
            assert_eq!(
                query.counts[index],
                fingerprints[0].tanimoto_counts(&fingerprints[index])
            );
        }

        let limits = ResourceLimits {
            max_edges: 1_000_000,
            max_memory_bytes: 512 * 1024 * 1024,
            max_dispatch_ms: MAX_DISPATCH_MS,
        };
        let graph_options = GraphBuildOptions::from_resource_limits(
            NonZeroUsize::new(1_024).expect("nonzero tile"),
            &limits,
        )
        .expect("admit graph benchmark");
        let graph_host_start = std::time::Instant::now();
        let graph = runtime
            .build_graph_profiled(
                &fingerprints[..graph_count],
                SimilarityCutoff {
                    numerator: 95,
                    denominator: 100,
                },
                graph_options,
            )
            .expect("build sparse exact graph");
        let graph_host_ms = graph_host_start.elapsed().as_millis();
        assert_eq!(graph.graph.vertex_count(), graph_count);
        assert_eq!(graph.graph.undirected_edge_count(), 0);
        let cluster_host_start = std::time::Instant::now();
        let clusters = butina_clusters(
            &graph.graph,
            ButinaOptions::from_resource_limits(&limits).expect("admit Butina benchmark"),
        )
        .expect("cluster sparse exact graph");
        let cluster_host_ms = cluster_host_start.elapsed().as_millis();
        assert_eq!(clusters.len(), graph_count);
        let paired = fingerprints[..5_000]
            .iter()
            .flat_map(|fingerprint| [*fingerprint, *fingerprint])
            .collect::<Vec<_>>();
        let fill_host_start = std::time::Instant::now();
        let fill_graph = runtime
            .build_graph_profiled(
                &paired,
                SimilarityCutoff {
                    numerator: 1,
                    denominator: 1,
                },
                graph_options,
            )
            .expect("build paired exact graph");
        let fill_host_ms = fill_host_start.elapsed().as_millis();
        assert_eq!(fill_graph.graph.undirected_edge_count(), 5_000);
        let paired_clusters = butina_clusters(
            &fill_graph.graph,
            ButinaOptions::from_resource_limits(&limits).expect("admit paired Butina benchmark"),
        )
        .expect("cluster paired exact graph");
        assert_eq!(paired_clusters.len(), 5_000);

        let boundary = cutoff_boundary_fingerprints();
        let boundary_cutoff = SimilarityCutoff {
            numerator: 7,
            denominator: 10,
        };
        let boundary_graph = runtime
            .build_graph(&boundary, boundary_cutoff, graph_options)
            .expect("build cutoff-boundary graph");
        let expected_boundary = build_tanimoto_graph(&boundary, boundary_cutoff, graph_options)
            .expect("build CPU cutoff-boundary graph");
        assert_eq!(boundary_graph, expected_boundary);
        assert_eq!(boundary_graph.undirected_edge_count(), 2);

        let dense = vec![fingerprints[0]; 512];
        let dense_start = std::time::Instant::now();
        let dense_graph = runtime
            .build_graph_profiled(
                &dense,
                SimilarityCutoff {
                    numerator: 1,
                    denominator: 1,
                },
                graph_options,
            )
            .expect("build dense exact graph");
        let dense_host_ms = dense_start.elapsed().as_millis();
        assert_eq!(dense_graph.graph.undirected_edge_count(), 130_816);

        let pressure = vec![fingerprints[0]; 2_048];
        let pressure_limits = ResourceLimits {
            max_edges: 3_000_000,
            max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
            max_dispatch_ms: MAX_DISPATCH_MS,
        };
        let pressure_error = runtime
            .build_graph(
                &pressure,
                SimilarityCutoff {
                    numerator: 1,
                    denominator: 1,
                },
                GraphBuildOptions::from_resource_limits(
                    NonZeroUsize::new(1_024).expect("nonzero tile"),
                    &pressure_limits,
                )
                .expect("admit pressure count pass"),
            )
            .expect_err("dense CSR fill must be rejected by memory admission");
        assert!(pressure_error.to_string().contains("Metal graph requires"));
        eprintln!(
            "{{\"device\":\"{}\",\"queryRecords\":100000,\"queryGpuMs\":{},\"queryHostMs\":{},\"graphRecords\":{},\"graphGpuMs\":{},\"graphHostMs\":{},\"graphEdges\":0,\"butinaHostMs\":{},\"clusterCount\":{},\"fillRecords\":10000,\"fillGpuMs\":{},\"fillHostMs\":{},\"fillEdges\":5000,\"pairedClusters\":5000,\"boundaryParity\":\"passed\",\"denseRecords\":512,\"denseGpuMs\":{},\"denseHostMs\":{},\"denseEdges\":130816,\"memoryPressure\":\"rejectedBeforeFill\"}}",
            runtime.device_identity().name,
            query.gpu_time_ms,
            query_host_ms,
            graph_count,
            graph.gpu_time_ms,
            graph_host_ms,
            cluster_host_ms,
            clusters.len(),
            fill_graph.gpu_time_ms,
            fill_host_ms,
            dense_graph.gpu_time_ms,
            dense_host_ms,
        );
    }

    fn cutoff_boundary_fingerprints() -> [Fingerprint2048; 3] {
        let mut all = [0_u64; FINGERPRINT_WORDS];
        let mut seven = [0_u64; FINGERPRINT_WORDS];
        let mut six = [0_u64; FINGERPRINT_WORDS];
        all[0] = (1_u64 << 10) - 1;
        seven[0] = (1_u64 << 7) - 1;
        six[0] = (1_u64 << 6) - 1;
        [
            Fingerprint2048::from_words(all),
            Fingerprint2048::from_words(seven),
            Fingerprint2048::from_words(six),
        ]
    }

    fn deterministic_fingerprints(count: usize) -> Vec<Fingerprint2048> {
        let mut state = 0x6a09_e667_f3bc_c909_u64;
        (0..count)
            .map(|_| {
                let mut words = [0_u64; FINGERPRINT_WORDS];
                for word in &mut words {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    *word = state;
                }
                Fingerprint2048::from_words(words)
            })
            .collect()
    }
}
