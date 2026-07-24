//! Deterministic CPU reference primitives for native molecular compute.
//!
//! This implementation is derived independently from Burrete's published
//! mathematical and behavioral contracts. It does not copy or adapt source
//! code from `mlxmolkit` or another clustering package. The CPU path is the
//! parity oracle for native Metal neighbor generation.

use std::{cmp::Reverse, collections::BinaryHeap};

mod alignment;
mod conformer_engine;
mod conformer_extract;
mod conformer_initialize;
mod conformer_pack;
mod conformer_schedule;
mod conformer_stereo;
mod distance_geometry;
mod distance_optimizer;
mod etk_geometry;
mod mmff;
mod mmff_extract;
mod semiempirical;
mod tmap;
mod umap;

pub use alignment::{
    align_and_score, AlignmentAtom, AlignmentError, AlignmentMode, AlignmentResult,
    AlignmentScores, AtomMapping, RigidTransform,
};
pub use conformer_engine::{
    ConformerDistanceEngine, ConformerDistanceMolecule, ConformerEngineError,
};
pub use conformer_extract::{ConformerExtractError, ExtractedConformerParameters};
pub use conformer_initialize::initialize_conformer_positions;
pub use conformer_pack::{
    ConformerEnginePackArrays, ConformerEnginePackBinary, ConformerEnginePackBuilder,
    ConformerPackError, ConformerPackedArraySpan,
};
pub use conformer_schedule::{
    plan_conformer_batches, ConformerBatch, ConformerBatchPlan, ConformerMoleculeWork,
    ConformerScheduleError, ConformerSchedulingOptions, ConformerSpan, ConformerWorkIdentity,
};
pub use conformer_stereo::{
    validate_conformer_stereo, validate_stereo_constraints, ChiralVolumeConstraint,
    ConformerStereoError, TetrahedralConstraint, STEREO_FAILURE_CHIRAL_VOLUME,
    STEREO_FAILURE_NONFINITE_POSITION, STEREO_FAILURE_TETRAHEDRAL_GEOMETRY,
};
pub use distance_geometry::{
    evaluate_distance_constraints, DistanceConstraint, DistanceConstraintEvaluation,
    DistanceGeometryError,
};
pub use distance_optimizer::{
    optimize_distance_geometry, optimize_etk_geometry, optimize_mmff, DistanceGeometryOptimization,
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, MmffOptimization,
    MmffOptimizerKind,
};
pub use etk_geometry::{
    evaluate_etk_geometry, validate_etk_geometry_constraints, EtkDistanceConstraint,
    EtkGeometryError, EtkGeometryEvaluation, EtkGeometryTerms, EtkImproperConstraint,
    EtkTorsionConstraint,
};
pub use mmff::{
    evaluate_mmff, evaluate_mmff_energy, validate_mmff_parameters, MmffAngleTerm, MmffBondTerm,
    MmffElectrostaticTerm, MmffEnergyBreakdown, MmffError, MmffEvaluation, MmffOutOfPlaneTerm,
    MmffParameters, MmffStretchBendTerm, MmffTorsionTerm, MmffVanDerWaalsTerm, MmffVariant,
};
pub use mmff_extract::{decode_native_mmff_parameters, MmffExtractError, NativeMmffParameters};
pub use semiempirical::{
    contract_pm6_pair_fock, contract_rm1_pair_fock, evaluate_pm6, evaluate_pm6_with_accelerators,
    evaluate_rm1, evaluate_rm1_with_accelerators, evaluate_rm1_with_pair_contractor,
    evaluate_rm1_with_prepared_pairs_and_accelerators, evaluate_semiempirical,
    pm6_d3_dispersion_energy, pm6_d_d_local_pair_integrals, pm6_d_d_pair_integrals,
    pm6_d_hydrogen_pair_integrals, pm6_d_multipole_parameters, pm6_d_sp_local_pair_integrals,
    pm6_d_sp_pair_integrals, pm6_fock_pairs, pm6_full_parameters, pm6_h4_covalent_radius,
    pm6_h4_energy, pm6_hh_repulsion_energy, pm6_local_d_overlap, pm6_one_center_d_fock,
    pm6_one_center_w_integrals, pm6_rotate_dd_overlap, pm6_rotate_dp_overlap,
    pm6_rotate_ds_overlap, pm6_slater_condon_parameter, pm6_wigner_d_matrix, rm1_fock_pairs,
    rm1_multipole_parameters, rm1_nuclear_repulsion_energy, rm1_parameters,
    rm1_rotated_pair_integrals, rm1_sp_overlap, rm1_two_center_integrals,
    semiempirical_nuclear_repulsion_energy, semiempirical_parameters, solve_closed_shell_scf,
    solve_closed_shell_scf_with_eigensolver, solve_closed_shell_scf_with_initial_density,
    solve_closed_shell_scf_with_initial_density_and_eigensolver, symmetric_eigendecomposition,
    Pm6DDLocalPairIntegrals, Pm6DDPairIntegrals, Pm6DHydrogenPairIntegrals,
    Pm6DMultipoleParameters, Pm6DSpLocalPairIntegrals, Pm6DSpPairIntegrals, Pm6FockPair,
    Pm6FullElementParameters, Pm6LocalDOverlap, Rm1Evaluation, Rm1FockPair, Rm1MultipoleParameters,
    Rm1OverlapMatrix, Rm1RotatedPairIntegrals, Rm1TwoCenterIntegrals, SemiempiricalAtom,
    SemiempiricalElementParameters, SemiempiricalError, SemiempiricalMethod, SemiempiricalMolecule,
    SemiempiricalScfOptions, SemiempiricalScfResult, SemiempiricalScfStatus,
};
pub use tmap::{build_tmap_layout, TmapError, TmapLayout};
pub use umap::{
    build_tanimoto_umap_graph, fit_umap_curve, ChemicalSpaceMethod, TanimotoUmapGraph, UmapError,
    UmapOptions,
};

use std::{cmp::Ordering, fmt, mem::size_of, num::NonZeroUsize};

use burrete_compute_protocol::{
    ProtocolError, ResourceLimits, SimilarityCutoff, MAX_COMPUTE_MEMORY_BYTES,
    MAX_UNDIRECTED_SIMILARITY_EDGES,
};

pub const FINGERPRINT_BITS: usize = 2_048;
pub const FINGERPRINT_WORDS: usize = FINGERPRINT_BITS / u64::BITS as usize;
pub const FINGERPRINT_METAL_WORDS: usize = FINGERPRINT_BITS / u32::BITS as usize;
pub const FINGERPRINT_BYTES: usize = FINGERPRINT_BITS / u8::BITS as usize;
const MEMORY_ACCOUNTING_HEADROOM_BYTES: u64 = 64 * 1024;

/// One fixed-width Morgan fingerprint in increasing bit/word order.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Fingerprint2048 {
    words: [u64; FINGERPRINT_WORDS],
}

impl Fingerprint2048 {
    pub const ZERO: Self = Self {
        words: [0; FINGERPRINT_WORDS],
    };

    pub const fn from_words(words: [u64; FINGERPRINT_WORDS]) -> Self {
        Self { words }
    }

    pub const fn words(&self) -> &[u64; FINGERPRINT_WORDS] {
        &self.words
    }

    /// Decodes the canonical EnginePack little-endian `u64[32]` row.
    pub fn from_le_bytes(bytes: [u8; FINGERPRINT_BYTES]) -> Self {
        let mut words = [0_u64; FINGERPRINT_WORDS];
        for (word, chunk) in words.iter_mut().zip(bytes.chunks_exact(8)) {
            *word = u64::from_le_bytes(chunk.try_into().expect("fixed eight-byte chunk"));
        }
        Self { words }
    }

    /// Encodes the canonical EnginePack little-endian `u64[32]` row.
    pub fn to_le_bytes(self) -> [u8; FINGERPRINT_BYTES] {
        let mut bytes = [0_u8; FINGERPRINT_BYTES];
        for (chunk, word) in bytes.chunks_exact_mut(8).zip(self.words) {
            chunk.copy_from_slice(&word.to_le_bytes());
        }
        bytes
    }

    /// Returns the Metal `uint32[64]` view of the canonical row.
    ///
    /// Each canonical `u64` is split low word first, then high word. On the
    /// supported little-endian Apple Silicon runtime this is byte-identical to
    /// the persisted row and can be uploaded without repacking.
    pub fn to_metal_words(self) -> [u32; FINGERPRINT_METAL_WORDS] {
        let mut words = [0_u32; FINGERPRINT_METAL_WORDS];
        for (index, word) in self.words.into_iter().enumerate() {
            words[index * 2] = word as u32;
            words[index * 2 + 1] = (word >> 32) as u32;
        }
        words
    }

    pub fn tanimoto_counts(&self, other: &Self) -> TanimotoCounts {
        let mut intersection = 0_u64;
        let mut union = 0_u64;
        for (left, right) in self.words.iter().zip(other.words.iter()) {
            intersection += u64::from((left & right).count_ones());
            union += u64::from((left | right).count_ones());
        }
        TanimotoCounts {
            intersection,
            union,
        }
    }
}

impl Default for Fingerprint2048 {
    fn default() -> Self {
        Self::ZERO
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TanimotoCounts {
    pub intersection: u64,
    pub union: u64,
}

impl TanimotoCounts {
    pub fn matches_cutoff(self, cutoff: SimilarityCutoff) -> Result<bool, ProtocolError> {
        cutoff.matches_counts(self.intersection, self.union)
    }

    /// Exact ordering of Tanimoto ratios without floating-point conversion.
    /// A zero-union pair follows the existing Burrete/upstream convention and
    /// has similarity zero.
    pub fn compare_similarity(self, other: Self) -> Ordering {
        let (left_numerator, left_denominator) = self.ratio_terms();
        let (right_numerator, right_denominator) = other.ratio_terms();
        (u128::from(left_numerator) * u128::from(right_denominator))
            .cmp(&(u128::from(right_numerator) * u128::from(left_denominator)))
    }

    pub fn similarity(self) -> f64 {
        let (numerator, denominator) = self.ratio_terms();
        numerator as f64 / denominator as f64
    }

    fn ratio_terms(self) -> (u64, u64) {
        if self.union == 0 {
            (0, 1)
        } else {
            (self.intersection, self.union)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TanimotoQueryOptions {
    max_memory_bytes: u64,
}

impl TanimotoQueryOptions {
    pub fn new(max_memory_bytes: u64) -> Result<Self, ClusterCoreError> {
        if !(1..=MAX_COMPUTE_MEMORY_BYTES).contains(&max_memory_bytes) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_memory_bytes must be in 1..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        Ok(Self { max_memory_bytes })
    }

    pub fn from_resource_limits(limits: &ResourceLimits) -> Result<Self, ClusterCoreError> {
        limits
            .validate()
            .map_err(|error| ClusterCoreError::InvalidOptions(error.to_string()))?;
        Self::new(limits.max_memory_bytes)
    }

    pub const fn max_memory_bytes(self) -> u64 {
        self.max_memory_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TanimotoKnnOptions {
    neighbor_count: NonZeroUsize,
    max_memory_bytes: u64,
}

impl TanimotoKnnOptions {
    pub fn try_new(
        neighbor_count: NonZeroUsize,
        max_memory_bytes: u64,
    ) -> Result<Self, ClusterCoreError> {
        if !(1..=MAX_COMPUTE_MEMORY_BYTES).contains(&max_memory_bytes) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_memory_bytes must be in 1..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        Ok(Self {
            neighbor_count,
            max_memory_bytes,
        })
    }

    pub fn from_resource_limits(
        neighbor_count: NonZeroUsize,
        limits: &ResourceLimits,
    ) -> Result<Self, ClusterCoreError> {
        limits
            .validate()
            .map_err(|error| ClusterCoreError::InvalidOptions(error.to_string()))?;
        Self::try_new(neighbor_count, limits.max_memory_bytes)
    }

    pub const fn neighbor_count(self) -> NonZeroUsize {
        self.neighbor_count
    }

    pub const fn max_memory_bytes(self) -> u64 {
        self.max_memory_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GraphBuildOptions {
    tile_size: NonZeroUsize,
    max_undirected_edges: u64,
    max_memory_bytes: u64,
}

impl GraphBuildOptions {
    pub fn try_new(
        tile_size: NonZeroUsize,
        max_undirected_edges: u64,
        max_memory_bytes: u64,
    ) -> Result<Self, ClusterCoreError> {
        if !(1..=MAX_UNDIRECTED_SIMILARITY_EDGES).contains(&max_undirected_edges) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_undirected_edges must be in 1..={MAX_UNDIRECTED_SIMILARITY_EDGES}"
            )));
        }
        if !(1..=MAX_COMPUTE_MEMORY_BYTES).contains(&max_memory_bytes) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_memory_bytes must be in 1..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        Ok(Self {
            tile_size,
            max_undirected_edges,
            max_memory_bytes,
        })
    }

    /// Authoritative production constructor from the validated job contract.
    pub fn from_resource_limits(
        tile_size: NonZeroUsize,
        limits: &ResourceLimits,
    ) -> Result<Self, ClusterCoreError> {
        limits
            .validate()
            .map_err(|error| ClusterCoreError::InvalidOptions(error.to_string()))?;
        Self::try_new(tile_size, limits.max_edges, limits.max_memory_bytes)
    }

    pub const fn tile_size(&self) -> NonZeroUsize {
        self.tile_size
    }

    pub const fn max_undirected_edges(&self) -> u64 {
        self.max_undirected_edges
    }

    pub const fn max_memory_bytes(&self) -> u64 {
        self.max_memory_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ButinaOptions {
    max_undirected_edges: u64,
    max_memory_bytes: u64,
}

impl ButinaOptions {
    pub fn try_new(
        max_undirected_edges: u64,
        max_memory_bytes: u64,
    ) -> Result<Self, ClusterCoreError> {
        if !(1..=MAX_UNDIRECTED_SIMILARITY_EDGES).contains(&max_undirected_edges) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_undirected_edges must be in 1..={MAX_UNDIRECTED_SIMILARITY_EDGES}"
            )));
        }
        if !(1..=MAX_COMPUTE_MEMORY_BYTES).contains(&max_memory_bytes) {
            return Err(ClusterCoreError::InvalidOptions(format!(
                "max_memory_bytes must be in 1..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        Ok(Self {
            max_undirected_edges,
            max_memory_bytes,
        })
    }

    /// Authoritative production constructor from the validated job contract.
    pub fn from_resource_limits(limits: &ResourceLimits) -> Result<Self, ClusterCoreError> {
        limits
            .validate()
            .map_err(|error| ClusterCoreError::InvalidOptions(error.to_string()))?;
        Self::try_new(limits.max_edges, limits.max_memory_bytes)
    }

    pub const fn max_undirected_edges(&self) -> u64 {
        self.max_undirected_edges
    }

    pub const fn max_memory_bytes(&self) -> u64 {
        self.max_memory_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClusterCoreError {
    InvalidOptions(String),
    InvalidCutoff(String),
    EdgeBudgetExceeded {
        limit: u64,
        observed_at_least: u64,
    },
    MemoryBudgetExceeded {
        required_bytes: u64,
        limit_bytes: u64,
    },
    AllocationFailed {
        buffer: &'static str,
        requested_elements: u64,
    },
    CsrOverflow,
    InvalidCsr(&'static str),
}

impl fmt::Display for ClusterCoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOptions(message) => {
                write!(formatter, "invalid clustering options: {message}")
            }
            Self::InvalidCutoff(message) => write!(formatter, "invalid similarity cutoff: {message}"),
            Self::EdgeBudgetExceeded {
                limit,
                observed_at_least,
            } => write!(
                formatter,
                "Tanimoto graph exceeds the undirected edge budget {limit} (observed at least {observed_at_least})"
            ),
            Self::MemoryBudgetExceeded {
                required_bytes,
                limit_bytes,
            } => write!(
                formatter,
                "compute operation requires {required_bytes} accounted working-set bytes; limit is {limit_bytes}"
            ),
            Self::AllocationFailed {
                buffer,
                requested_elements,
            } => write!(
                formatter,
                "failed to reserve {requested_elements} elements for {buffer}"
            ),
            Self::CsrOverflow => formatter.write_str("CSR size exceeds integer or address limits"),
            Self::InvalidCsr(message) => write!(formatter, "invalid symmetric CSR: {message}"),
        }
    }
}

impl std::error::Error for ClusterCoreError {}

/// Validated, loop-free symmetric CSR with sorted, unique neighbors per row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SymmetricCsr {
    row_offsets: Vec<u64>,
    column_indices: Vec<u64>,
}

/// Exact directed k-nearest-neighbor graph in source-row order.
///
/// Neighbors are sorted by decreasing exact Tanimoto ratio, then by increasing
/// source index. `neighbors_per_vertex` is `min(requested_k, vertex_count - 1)`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TanimotoKnn {
    vertex_count: usize,
    neighbors_per_vertex: usize,
    source_indices: Vec<u64>,
    counts: Vec<TanimotoCounts>,
}

impl TanimotoKnn {
    pub const fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    pub const fn neighbors_per_vertex(&self) -> usize {
        self.neighbors_per_vertex
    }

    pub fn source_indices(&self) -> &[u64] {
        &self.source_indices
    }

    pub fn counts(&self) -> &[TanimotoCounts] {
        &self.counts
    }

    pub fn neighbors(
        &self,
        vertex: usize,
    ) -> Option<impl Iterator<Item = (u64, TanimotoCounts)> + '_> {
        if vertex >= self.vertex_count {
            return None;
        }
        let start = vertex * self.neighbors_per_vertex;
        let end = start + self.neighbors_per_vertex;
        Some(
            self.source_indices[start..end]
                .iter()
                .copied()
                .zip(self.counts[start..end].iter().copied()),
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RankedTanimotoNeighbor {
    source_index: u64,
    counts: TanimotoCounts,
}

impl Ord for RankedTanimotoNeighbor {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .counts
            .compare_similarity(self.counts)
            .then_with(|| self.source_index.cmp(&other.source_index))
    }
}

impl PartialOrd for RankedTanimotoNeighbor {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl SymmetricCsr {
    pub fn try_new(
        row_offsets: Vec<u64>,
        column_indices: Vec<u64>,
    ) -> Result<Self, ClusterCoreError> {
        validate_csr(&row_offsets, &column_indices)?;
        Ok(Self {
            row_offsets,
            column_indices,
        })
    }

    pub fn vertex_count(&self) -> usize {
        self.row_offsets.len() - 1
    }

    pub fn undirected_edge_count(&self) -> u64 {
        self.column_indices.len() as u64 / 2
    }

    pub fn row_offsets(&self) -> &[u64] {
        &self.row_offsets
    }

    pub fn column_indices(&self) -> &[u64] {
        &self.column_indices
    }

    pub fn neighbors(&self, vertex: usize) -> Option<&[u64]> {
        (vertex < self.vertex_count()).then(|| self.neighbors_unchecked(vertex))
    }

    fn neighbors_unchecked(&self, vertex: usize) -> &[u64] {
        let start = self.row_offsets[vertex] as usize;
        let end = self.row_offsets[vertex + 1] as usize;
        &self.column_indices[start..end]
    }
}

/// Builds the exact threshold graph without materializing an `N x N` matrix.
///
/// Memory admission uses a conservative logical working-set account: matching
/// pairs, CSR columns/offsets, construction degrees/cursors, and the subsequent
/// Butina alive/degrees/output buffers are all counted concurrently, plus fixed
/// headroom. It intentionally does not claim to predict allocator metadata,
/// capacity rounding, borrowed fingerprints, or process RSS exactly.
pub fn build_tanimoto_graph(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    options: GraphBuildOptions,
) -> Result<SymmetricCsr, ClusterCoreError> {
    let cutoff = cutoff
        .normalized()
        .map_err(|error| ClusterCoreError::InvalidCutoff(error.to_string()))?;
    let edge_count = count_matching_pairs(fingerprints, cutoff, options)?;
    let required_bytes = accounted_working_set_bytes(fingerprints.len(), edge_count)?;
    if required_bytes > options.max_memory_bytes {
        return Err(ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: options.max_memory_bytes,
        });
    }
    let pairs = collect_matching_pairs(fingerprints, cutoff, options.tile_size, edge_count)?;
    csr_from_pairs(fingerprints.len(), &pairs)
}

/// Scores one query against a fingerprint library in source order using the
/// exact integer counts that also define the Metal ABI. No dense pair matrix is
/// materialized; output memory is `O(N)`.
pub fn score_tanimoto_query(
    query: &Fingerprint2048,
    fingerprints: &[Fingerprint2048],
    options: TanimotoQueryOptions,
) -> Result<Vec<TanimotoCounts>, ClusterCoreError> {
    let required_bytes = accounted_tanimoto_query_bytes(fingerprints.len())?;
    if required_bytes > options.max_memory_bytes {
        return Err(ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: options.max_memory_bytes,
        });
    }
    let mut counts = Vec::new();
    try_reserve_exact(
        &mut counts,
        fingerprints.len(),
        "Tanimoto query-count output",
    )?;
    counts.extend(
        fingerprints
            .iter()
            .map(|fingerprint| query.tanimoto_counts(fingerprint)),
    );
    Ok(counts)
}

/// Builds the exact Tanimoto top-k graph without materializing an `N x N`
/// matrix. The bounded per-row heap keeps only the requested best candidates.
pub fn build_tanimoto_knn(
    fingerprints: &[Fingerprint2048],
    options: TanimotoKnnOptions,
) -> Result<TanimotoKnn, ClusterCoreError> {
    let vertex_count = fingerprints.len();
    let neighbors_per_vertex = options
        .neighbor_count
        .get()
        .min(vertex_count.saturating_sub(1));
    let required_bytes = accounted_tanimoto_knn_bytes(vertex_count, neighbors_per_vertex)?;
    if required_bytes > options.max_memory_bytes {
        return Err(ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: options.max_memory_bytes,
        });
    }

    let entry_count = vertex_count
        .checked_mul(neighbors_per_vertex)
        .ok_or(ClusterCoreError::CsrOverflow)?;
    let mut source_indices = Vec::new();
    try_reserve_exact(
        &mut source_indices,
        entry_count,
        "Tanimoto kNN index output",
    )?;
    let mut counts = Vec::new();
    try_reserve_exact(&mut counts, entry_count, "Tanimoto kNN count output")?;
    let mut row = BinaryHeap::new();
    row.try_reserve(neighbors_per_vertex)
        .map_err(|_| ClusterCoreError::AllocationFailed {
            buffer: "Tanimoto kNN row heap",
            requested_elements: neighbors_per_vertex as u64,
        })?;

    for (source_index, fingerprint) in fingerprints.iter().enumerate() {
        row.clear();
        for (candidate_index, candidate) in fingerprints.iter().enumerate() {
            if candidate_index == source_index {
                continue;
            }
            let neighbor = RankedTanimotoNeighbor {
                source_index: candidate_index as u64,
                counts: fingerprint.tanimoto_counts(candidate),
            };
            if row.len() < neighbors_per_vertex {
                row.push(neighbor);
            } else if row.peek().is_some_and(|worst| neighbor < *worst) {
                row.pop();
                row.push(neighbor);
            }
        }
        let mut ranked = row.drain().collect::<Vec<_>>();
        ranked.sort_unstable_by(|left, right| {
            right
                .counts
                .compare_similarity(left.counts)
                .then_with(|| left.source_index.cmp(&right.source_index))
        });
        source_indices.extend(ranked.iter().map(|neighbor| neighbor.source_index));
        counts.extend(ranked.iter().map(|neighbor| neighbor.counts));
    }

    Ok(TanimotoKnn {
        vertex_count,
        neighbors_per_vertex,
        source_indices,
        counts,
    })
}

pub fn accounted_tanimoto_knn_bytes(
    vertex_count: usize,
    neighbors_per_vertex: usize,
) -> Result<u64, ClusterCoreError> {
    let vertices = u64::try_from(vertex_count).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let neighbors =
        u64::try_from(neighbors_per_vertex).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let entries = vertices
        .checked_mul(neighbors)
        .ok_or(ClusterCoreError::CsrOverflow)?;
    [
        checked_buffer_bytes::<u64>(entries)?,
        checked_buffer_bytes::<TanimotoCounts>(entries)?,
        checked_buffer_bytes::<RankedTanimotoNeighbor>(neighbors)?,
    ]
    .into_iter()
    .try_fold(MEMORY_ACCOUNTING_HEADROOM_BYTES, |total, bytes| {
        total
            .checked_add(bytes)
            .ok_or(ClusterCoreError::CsrOverflow)
    })
}

pub fn accounted_tanimoto_query_bytes(record_count: usize) -> Result<u64, ClusterCoreError> {
    MEMORY_ACCOUNTING_HEADROOM_BYTES
        .checked_add(checked_buffer_bytes::<TanimotoCounts>(record_count as u64)?)
        .ok_or(ClusterCoreError::CsrOverflow)
}

/// Dynamic-count Butina clustering. Every cluster stores its representative
/// first, followed by its ascending live neighbors at selection time. The
/// budget accounts for the resident CSR and all logical Butina buffers before
/// allocating any Butina state.
pub fn butina_clusters(
    graph: &SymmetricCsr,
    options: ButinaOptions,
) -> Result<Vec<Vec<u64>>, ClusterCoreError> {
    let edge_count = graph.undirected_edge_count();
    if edge_count > options.max_undirected_edges {
        return Err(ClusterCoreError::EdgeBudgetExceeded {
            limit: options.max_undirected_edges,
            observed_at_least: edge_count,
        });
    }
    let vertex_count = graph.vertex_count();
    let required_bytes = accounted_butina_working_set_bytes(graph)?;
    if required_bytes > options.max_memory_bytes {
        return Err(ClusterCoreError::MemoryBudgetExceeded {
            required_bytes,
            limit_bytes: options.max_memory_bytes,
        });
    }
    let mut alive = Vec::new();
    try_reserve_exact(&mut alive, vertex_count, "Butina alive mask")?;
    alive.resize(vertex_count, true);
    let mut live_degrees = Vec::new();
    try_reserve_exact(&mut live_degrees, vertex_count, "Butina live-degree buffer")?;
    live_degrees.extend(
        graph
            .row_offsets
            .windows(2)
            .map(|window| window[1] - window[0]),
    );
    let priority_capacity = vertex_count
        .checked_add(graph.column_indices.len())
        .ok_or(ClusterCoreError::CsrOverflow)?;
    let mut representatives = BinaryHeap::new();
    representatives
        .try_reserve(priority_capacity)
        .map_err(|_| ClusterCoreError::AllocationFailed {
            buffer: "Butina representative priority queue",
            requested_elements: u64::try_from(priority_capacity).unwrap_or(u64::MAX),
        })?;
    representatives.extend(
        live_degrees
            .iter()
            .enumerate()
            .map(|(vertex, &degree)| (degree, Reverse(vertex))),
    );
    let mut remaining = vertex_count;
    let mut clusters = Vec::new();
    try_reserve_exact(&mut clusters, vertex_count, "Butina cluster list")?;

    while remaining > 0 {
        let representative = loop {
            let (degree, Reverse(vertex)) = representatives
                .pop()
                .expect("remaining vertices include one priority entry");
            if alive[vertex] && live_degrees[vertex] == degree {
                break vertex;
            }
        };

        let removed_capacity = usize::try_from(live_degrees[representative])
            .ok()
            .and_then(|degree| degree.checked_add(1))
            .ok_or(ClusterCoreError::CsrOverflow)?;
        let mut removed = Vec::new();
        try_reserve_exact(&mut removed, removed_capacity, "Butina cluster members")?;
        removed.push(representative as u64);
        removed.extend(
            graph
                .neighbors_unchecked(representative)
                .iter()
                .copied()
                .filter(|neighbor| alive[*neighbor as usize]),
        );

        for &vertex in &removed {
            alive[vertex as usize] = false;
        }
        remaining -= removed.len();

        for &vertex in &removed {
            for &neighbor in graph.neighbors_unchecked(vertex as usize) {
                let neighbor = neighbor as usize;
                if alive[neighbor] {
                    live_degrees[neighbor] -= 1;
                    representatives.push((live_degrees[neighbor], Reverse(neighbor)));
                }
            }
        }

        clusters.push(removed);
    }

    Ok(clusters)
}

fn count_matching_pairs(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    options: GraphBuildOptions,
) -> Result<u64, ClusterCoreError> {
    let mut edge_count = 0_u64;
    visit_matching_pairs(fingerprints, cutoff, options.tile_size, |_, _| {
        edge_count = edge_count
            .checked_add(1)
            .ok_or(ClusterCoreError::CsrOverflow)?;
        if edge_count > options.max_undirected_edges {
            return Err(ClusterCoreError::EdgeBudgetExceeded {
                limit: options.max_undirected_edges,
                observed_at_least: edge_count,
            });
        }
        Ok(())
    })?;
    Ok(edge_count)
}

fn collect_matching_pairs(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    tile_size: NonZeroUsize,
    edge_count: u64,
) -> Result<Vec<(usize, usize)>, ClusterCoreError> {
    let capacity = usize::try_from(edge_count).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let mut pairs = Vec::new();
    try_reserve_exact(&mut pairs, capacity, "matching-pair buffer")?;
    visit_matching_pairs(fingerprints, cutoff, tile_size, |left, right| {
        pairs.push((left, right));
        Ok(())
    })?;
    debug_assert_eq!(pairs.len(), capacity);
    Ok(pairs)
}

fn visit_matching_pairs(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    tile_size: NonZeroUsize,
    mut visit: impl FnMut(usize, usize) -> Result<(), ClusterCoreError>,
) -> Result<(), ClusterCoreError> {
    let tile_size = tile_size.get();

    for row_start in (0..fingerprints.len()).step_by(tile_size) {
        let row_end = row_start.saturating_add(tile_size).min(fingerprints.len());
        for column_start in (row_start..fingerprints.len()).step_by(tile_size) {
            let column_end = column_start
                .saturating_add(tile_size)
                .min(fingerprints.len());
            for left in row_start..row_end {
                let right_start = if column_start == row_start {
                    left + 1
                } else {
                    column_start
                };
                for right in right_start..column_end {
                    let counts = fingerprints[left].tanimoto_counts(&fingerprints[right]);
                    if exact_match(counts, cutoff) {
                        visit(left, right)?;
                    }
                }
            }
        }
    }

    Ok(())
}

fn exact_match(counts: TanimotoCounts, cutoff: SimilarityCutoff) -> bool {
    if counts.union == 0 {
        return cutoff.numerator == 0;
    }
    u128::from(counts.intersection) * u128::from(cutoff.denominator)
        >= u128::from(counts.union) * u128::from(cutoff.numerator)
}

fn csr_from_pairs(
    vertex_count: usize,
    pairs: &[(usize, usize)],
) -> Result<SymmetricCsr, ClusterCoreError> {
    let mut degrees = Vec::new();
    try_reserve_exact(&mut degrees, vertex_count, "CSR degree buffer")?;
    degrees.resize(vertex_count, 0_u64);
    for &(left, right) in pairs {
        degrees[left] = degrees[left]
            .checked_add(1)
            .ok_or(ClusterCoreError::CsrOverflow)?;
        degrees[right] = degrees[right]
            .checked_add(1)
            .ok_or(ClusterCoreError::CsrOverflow)?;
    }

    let row_offsets = prefix_offsets(&degrees)?;
    let entry_count = usize::try_from(*row_offsets.last().expect("offsets include zero"))
        .map_err(|_| ClusterCoreError::CsrOverflow)?;
    let mut column_indices = Vec::new();
    try_reserve_exact(&mut column_indices, entry_count, "CSR column buffer")?;
    column_indices.resize(entry_count, 0_u64);
    let mut cursors = Vec::new();
    try_reserve_exact(&mut cursors, vertex_count, "CSR cursor buffer")?;
    cursors.extend_from_slice(&row_offsets[..vertex_count]);

    for &(left, right) in pairs {
        let left_cursor =
            usize::try_from(cursors[left]).map_err(|_| ClusterCoreError::CsrOverflow)?;
        let right_cursor =
            usize::try_from(cursors[right]).map_err(|_| ClusterCoreError::CsrOverflow)?;
        column_indices[left_cursor] = right as u64;
        column_indices[right_cursor] = left as u64;
        cursors[left] += 1;
        cursors[right] += 1;
    }

    for window in row_offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        column_indices[start..end].sort_unstable();
    }

    Ok(SymmetricCsr {
        row_offsets,
        column_indices,
    })
}

fn prefix_offsets(degrees: &[u64]) -> Result<Vec<u64>, ClusterCoreError> {
    let capacity = degrees
        .len()
        .checked_add(1)
        .ok_or(ClusterCoreError::CsrOverflow)?;
    let mut offsets = Vec::new();
    try_reserve_exact(&mut offsets, capacity, "CSR row-offset buffer")?;
    offsets.push(0_u64);
    for degree in degrees {
        offsets.push(
            offsets
                .last()
                .expect("offsets include zero")
                .checked_add(*degree)
                .ok_or(ClusterCoreError::CsrOverflow)?,
        );
    }
    Ok(offsets)
}

fn accounted_working_set_bytes(
    vertex_count: usize,
    undirected_edge_count: u64,
) -> Result<u64, ClusterCoreError> {
    let vertices = u64::try_from(vertex_count).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let offsets = vertices
        .checked_add(1)
        .ok_or(ClusterCoreError::CsrOverflow)?;
    let directed_entries = undirected_edge_count
        .checked_mul(2)
        .ok_or(ClusterCoreError::CsrOverflow)?;

    let accounted_buffers = [
        checked_buffer_bytes::<(usize, usize)>(undirected_edge_count)?,
        checked_buffer_bytes::<u64>(vertices)?, // construction degrees
        checked_buffer_bytes::<u64>(offsets)?,
        checked_buffer_bytes::<u64>(directed_entries)?,
        checked_buffer_bytes::<u64>(vertices)?, // construction cursors
        checked_buffer_bytes::<bool>(vertices)?,
        checked_buffer_bytes::<u64>(vertices)?, // Butina live degrees
        checked_buffer_bytes::<u64>(vertices)?, // all cluster members
        checked_buffer_bytes::<Vec<u64>>(vertices)?, // worst-case singleton headers
    ];

    accounted_buffers
        .into_iter()
        .try_fold(MEMORY_ACCOUNTING_HEADROOM_BYTES, |total, bytes| {
            total
                .checked_add(bytes)
                .ok_or(ClusterCoreError::CsrOverflow)
        })
}

fn accounted_butina_working_set_bytes(graph: &SymmetricCsr) -> Result<u64, ClusterCoreError> {
    let vertices =
        u64::try_from(graph.vertex_count()).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let offsets = vertices
        .checked_add(1)
        .ok_or(ClusterCoreError::CsrOverflow)?;
    let directed_entries =
        u64::try_from(graph.column_indices.len()).map_err(|_| ClusterCoreError::CsrOverflow)?;
    let accounted_buffers = [
        checked_buffer_bytes::<u64>(offsets)?,
        checked_buffer_bytes::<u64>(directed_entries)?,
        checked_buffer_bytes::<bool>(vertices)?,
        checked_buffer_bytes::<u64>(vertices)?, // live degrees
        checked_buffer_bytes::<(u64, Reverse<usize>)>(
            vertices
                .checked_add(directed_entries)
                .ok_or(ClusterCoreError::CsrOverflow)?,
        )?, // representative priority queue including lazy stale entries
        checked_buffer_bytes::<u64>(vertices)?, // all cluster members
        checked_buffer_bytes::<Vec<u64>>(vertices)?, // worst-case singleton headers
    ];

    accounted_buffers
        .into_iter()
        .try_fold(MEMORY_ACCOUNTING_HEADROOM_BYTES, |total, bytes| {
            total
                .checked_add(bytes)
                .ok_or(ClusterCoreError::CsrOverflow)
        })
}

fn checked_buffer_bytes<T>(elements: u64) -> Result<u64, ClusterCoreError> {
    let width = u64::try_from(size_of::<T>()).map_err(|_| ClusterCoreError::CsrOverflow)?;
    elements
        .checked_mul(width)
        .ok_or(ClusterCoreError::CsrOverflow)
}

fn try_reserve_exact<T>(
    buffer: &mut Vec<T>,
    additional: usize,
    name: &'static str,
) -> Result<(), ClusterCoreError> {
    buffer
        .try_reserve_exact(additional)
        .map_err(|_| ClusterCoreError::AllocationFailed {
            buffer: name,
            requested_elements: u64::try_from(additional).unwrap_or(u64::MAX),
        })
}

fn validate_csr(row_offsets: &[u64], column_indices: &[u64]) -> Result<(), ClusterCoreError> {
    if row_offsets.is_empty() || row_offsets[0] != 0 {
        return Err(ClusterCoreError::InvalidCsr(
            "row offsets must begin with zero",
        ));
    }
    if row_offsets.windows(2).any(|window| window[0] > window[1]) {
        return Err(ClusterCoreError::InvalidCsr(
            "row offsets must be nondecreasing",
        ));
    }
    if row_offsets.last().copied() != Some(column_indices.len() as u64) {
        return Err(ClusterCoreError::InvalidCsr(
            "final row offset must equal the column-index count",
        ));
    }

    let vertex_count = row_offsets.len() - 1;
    for row in 0..vertex_count {
        let start = row_offsets[row] as usize;
        let end = row_offsets[row + 1] as usize;
        let neighbors = &column_indices[start..end];
        if neighbors.windows(2).any(|window| window[0] >= window[1]) {
            return Err(ClusterCoreError::InvalidCsr(
                "neighbors must be strictly increasing",
            ));
        }
        for &neighbor in neighbors {
            if neighbor >= vertex_count as u64 || neighbor == row as u64 {
                return Err(ClusterCoreError::InvalidCsr(
                    "neighbors must be in range and cannot be self edges",
                ));
            }
            let neighbor = neighbor as usize;
            let reverse_start = row_offsets[neighbor] as usize;
            let reverse_end = row_offsets[neighbor + 1] as usize;
            if column_indices[reverse_start..reverse_end]
                .binary_search(&(row as u64))
                .is_err()
            {
                return Err(ClusterCoreError::InvalidCsr(
                    "every edge must have a reverse edge",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
