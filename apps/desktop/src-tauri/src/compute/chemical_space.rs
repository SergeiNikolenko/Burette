use std::{num::NonZeroUsize, time::Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use burette_compute_core::{
    build_tanimoto_graph, build_tanimoto_knn, build_tanimoto_umap_graph, build_tmap_layout,
    butina_clusters, optimize_embedding, ChemicalSpaceMethod as NativeChemicalSpaceMethod,
    Fingerprint2048, GraphBuildOptions, TanimotoKnnOptions, UmapOptions, FINGERPRINT_BYTES,
};
use burette_compute_metal::{MetalTanimotoKnnExecution, MetalTanimotoRuntime};
use burette_compute_protocol::{SimilarityCutoff, MAX_UNDIRECTED_SIMILARITY_EDGES};
use serde::{Deserialize, Serialize};

use super::{
    cluster_executor::valid_fingerprints,
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::CompletedFingerprintBatch,
};

const MAX_NEIGHBORS: usize = 64;
const DEFAULT_MAX_MEMORY_BYTES: u64 = 4 * 1_024 * 1_024 * 1_024;
/// Applied cap on the sparse neighbour edges surfaced for activity cliffs. The
/// protocol's `MAX_UNDIRECTED_SIMILARITY_EDGES` bounds the dense similarity
/// graph, not this per-embedding kNN payload, so we keep only the highest-
/// similarity pairs (exactly what cliffs need) and cap the serialised result.
const MAX_NEIGHBOR_EDGES: usize = 200_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChemicalSpaceMethod {
    Umap,
    Tsne,
    Pacmap,
    Localmap,
    Trimap,
    Dreams,
    Cne,
    Mmae,
    Tmap,
}

impl From<ChemicalSpaceMethod> for NativeChemicalSpaceMethod {
    fn from(value: ChemicalSpaceMethod) -> Self {
        match value {
            ChemicalSpaceMethod::Umap => Self::Umap,
            ChemicalSpaceMethod::Tsne => Self::Tsne,
            ChemicalSpaceMethod::Pacmap => Self::Pacmap,
            ChemicalSpaceMethod::Localmap => Self::Localmap,
            ChemicalSpaceMethod::Trimap => Self::Trimap,
            ChemicalSpaceMethod::Dreams => Self::Dreams,
            ChemicalSpaceMethod::Cne => Self::Cne,
            ChemicalSpaceMethod::Mmae => Self::Mmae,
            ChemicalSpaceMethod::Tmap => Self::Tmap,
        }
    }
}

/// Numeric backend that executes one chemical-space request.
#[derive(Clone, Copy, Debug)]
pub(crate) enum ChemicalSpaceBackend<'a> {
    NativeMetal(&'a MetalTanimotoRuntime),
    ReferenceCpu,
}

impl ChemicalSpaceBackend<'_> {
    const fn label(self) -> &'static str {
        match self {
            Self::NativeMetal(_) => "nativeMetal",
            Self::ReferenceCpu => "referenceCpu",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChemicalSpaceRequest {
    method: ChemicalSpaceMethod,
    dimensions: u32,
    neighbors: usize,
    epochs: u32,
    min_dist: f32,
    spread: f32,
    learning_rate: f32,
    negative_sample_rate: u32,
    random_seed: u64,
    #[serde(default = "default_max_memory_bytes")]
    max_memory_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChemicalSpaceResult {
    pub(crate) source_record_ids: Vec<u64>,
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) tree_edges: Vec<[u32; 2]>,
    pub(crate) neighbor_edges: Vec<[u32; 2]>,
    pub(crate) neighbor_similarities: Vec<f32>,
    pub(crate) dimensions: u32,
    pub(crate) method: ChemicalSpaceMethod,
    pub(crate) neighbors: usize,
    pub(crate) successful_records: usize,
    pub(crate) failed_records: usize,
    pub(crate) backend: &'static str,
    pub(crate) tanimoto_gpu_time_ms: u64,
    pub(crate) embedding_gpu_time_ms: u64,
    /// Wall time of the neighbor search; zero when a cached graph was reused.
    pub(crate) tanimoto_host_time_ms: f64,
    /// Wall time of the embedding optimizer; zero for TMAP.
    pub(crate) embedding_host_time_ms: f64,
    pub(crate) layout_host_time_ms: f64,
    pub(crate) host_time_ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChemicalSpaceExecution {
    pub(crate) result: ChemicalSpaceResult,
    pub(crate) knn: MetalTanimotoKnnExecution,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChemicalSpaceClusterRequest {
    cutoff: f32,
    #[serde(default = "default_max_memory_bytes")]
    max_memory_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChemicalSpaceClusterResult {
    pub(crate) source_record_ids: Vec<u64>,
    pub(crate) cluster_ids: Vec<u64>,
    pub(crate) representative_source_record_ids: Vec<u64>,
    pub(crate) cluster_count: usize,
    pub(crate) backend: &'static str,
    pub(crate) similarity_gpu_time_ms: u64,
    pub(crate) similarity_host_time_ms: f64,
}

impl ChemicalSpaceRequest {
    pub(crate) const fn requested_neighbors(&self) -> usize {
        self.neighbors
    }
}

/// Wire shape of a serialized kNN graph, shared by the browser-dev backend and
/// the learned-representation flow: the Python model worker emits this exact
/// payload, and both consumers decode it into a [`MetalTanimotoKnnExecution`].
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChemicalSpaceKnnCachePayload {
    pub(crate) neighbors_per_vertex: usize,
    pub(crate) source_indices_base64: String,
    pub(crate) similarities_base64: String,
}

pub(crate) fn encode_knn_cache_payload(
    knn: &MetalTanimotoKnnExecution,
) -> ChemicalSpaceKnnCachePayload {
    let mut source_indices = Vec::with_capacity(knn.source_indices.len() * 4);
    for value in &knn.source_indices {
        source_indices.extend_from_slice(&value.to_le_bytes());
    }
    let mut similarities = Vec::with_capacity(knn.similarities.len() * 4);
    for value in &knn.similarities {
        similarities.extend_from_slice(&value.to_le_bytes());
    }
    ChemicalSpaceKnnCachePayload {
        neighbors_per_vertex: knn.neighbors_per_vertex,
        source_indices_base64: STANDARD.encode(source_indices),
        similarities_base64: STANDARD.encode(similarities),
    }
}

pub(crate) fn decode_knn_cache_payload(
    cache: &ChemicalSpaceKnnCachePayload,
    record_count: usize,
) -> Result<MetalTanimotoKnnExecution, String> {
    let expected_values = record_count
        .checked_mul(cache.neighbors_per_vertex)
        .ok_or("native chemical-space neighbor cache size overflowed")?;
    let source_indices = STANDARD
        .decode(&cache.source_indices_base64)
        .map_err(|_| "native chemical-space neighbor indexes are not valid base64")?;
    let similarities = STANDARD
        .decode(&cache.similarities_base64)
        .map_err(|_| "native chemical-space neighbor similarities are not valid base64")?;
    if source_indices.len() != expected_values * 4 || similarities.len() != expected_values * 4 {
        return Err("native chemical-space neighbor cache has an invalid shape".into());
    }
    Ok(MetalTanimotoKnnExecution {
        source_indices: source_indices
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| u32::from_le_bytes(*bytes))
            .collect(),
        similarities: similarities
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect(),
        neighbors_per_vertex: cache.neighbors_per_vertex,
        gpu_time_ms: 0,
    })
}

/// Embeds a learned representation whose neighbourhood graph was produced by
/// the Python model worker. The vertices carry no real fingerprints, so the
/// supplied kNN must match the effective neighbor count exactly — a mismatch
/// must fail instead of silently recomputing Tanimoto over placeholder bits.
pub(crate) fn execute_learned_chemical_space_from_knn(
    source_record_ids: &[u64],
    failed_records: usize,
    backend: ChemicalSpaceBackend<'_>,
    request: ChemicalSpaceRequest,
    knn: &MetalTanimotoKnnExecution,
) -> ComputeResult<ChemicalSpaceResult> {
    let count = source_record_ids.len();
    if count < 2 {
        return Err(ComputeCoordinatorError::Validation(
            "Chemical space requires at least two represented molecules".into(),
        ));
    }
    let clamped_neighbors = request.neighbors.min(count - 1);
    if knn.neighbors_per_vertex != clamped_neighbors
        || knn.source_indices.len() != count * clamped_neighbors
        || knn.similarities.len() != count * clamped_neighbors
    {
        return Err(ComputeCoordinatorError::Validation(
            "The learned neighbor graph does not match the requested neighbor count".into(),
        ));
    }
    let fingerprints = vec![Fingerprint2048::from_le_bytes([0u8; FINGERPRINT_BYTES]); count];
    Ok(execute_chemical_space_from_fingerprints_with_knn(
        &fingerprints,
        source_record_ids,
        failed_records,
        backend,
        request,
        Some(knn),
    )?
    .result)
}

pub(crate) fn execute_chemical_space(
    batch: &CompletedFingerprintBatch,
    backend: ChemicalSpaceBackend<'_>,
    request: ChemicalSpaceRequest,
    cached_knn: Option<&MetalTanimotoKnnExecution>,
) -> ComputeResult<ChemicalSpaceExecution> {
    let (fingerprints, valid_ordinals) = valid_fingerprints(batch)?;
    let source_record_ids = valid_ordinals
        .iter()
        .map(|ordinal| {
            usize::try_from(*ordinal)
                .ok()
                .and_then(|ordinal| batch.identities.get(ordinal))
                .map(|identity| identity.source_record_id)
                .ok_or_else(|| {
                    ComputeCoordinatorError::Protocol(
                        "Chemical-space fingerprint ordinal is outside its source identity map"
                            .into(),
                    )
                })
        })
        .collect::<ComputeResult<Vec<_>>>()?;
    execute_chemical_space_from_fingerprints_with_knn(
        &fingerprints,
        &source_record_ids,
        batch.errors.iter().filter(|error| error.is_some()).count(),
        backend,
        request,
        cached_knn,
    )
}

pub(crate) fn execute_chemical_space_from_fingerprints_with_knn(
    fingerprints: &[Fingerprint2048],
    source_record_ids: &[u64],
    failed_records: usize,
    backend: ChemicalSpaceBackend<'_>,
    request: ChemicalSpaceRequest,
    cached_knn: Option<&MetalTanimotoKnnExecution>,
) -> ComputeResult<ChemicalSpaceExecution> {
    let started = Instant::now();
    if fingerprints.len() < 2 {
        return Err(ComputeCoordinatorError::Validation(
            "Chemical space requires at least two valid molecular fingerprints".into(),
        ));
    }
    if fingerprints.len() != source_record_ids.len() {
        return Err(ComputeCoordinatorError::Protocol(
            "Chemical-space fingerprints differ from their source identity count".into(),
        ));
    }
    if request.neighbors == 0 || request.neighbors > MAX_NEIGHBORS {
        return Err(ComputeCoordinatorError::Validation(format!(
            "Chemical-space neighbors must be in 1..={MAX_NEIGHBORS}"
        )));
    }
    let neighbors = request.neighbors.min(fingerprints.len() - 1);
    let neighbor_count = NonZeroUsize::new(neighbors).ok_or_else(|| {
        ComputeCoordinatorError::Validation("Chemical space neighbor count must be positive".into())
    })?;
    let knn_options = TanimotoKnnOptions::try_new(neighbor_count, request.max_memory_bytes)
        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let umap_options = UmapOptions::try_new(
        request.dimensions,
        request.epochs,
        request.min_dist,
        request.spread,
        request.learning_rate,
        request.negative_sample_rate,
        request.random_seed,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let reused_knn = cached_knn
        .filter(|knn| {
            knn.neighbors_per_vertex == neighbors
                && knn.source_indices.len() == fingerprints.len() * neighbors
                && knn.similarities.len() == fingerprints.len() * neighbors
        })
        .cloned();
    let knn_started = Instant::now();
    let (knn, tanimoto_gpu_time_ms) = if let Some(knn) = reused_knn {
        (knn, 0)
    } else {
        let knn = match backend {
            ChemicalSpaceBackend::NativeMetal(runtime) => runtime
                .build_tanimoto_knn_profiled(fingerprints, knn_options)
                .map_err(metal_error)?,
            ChemicalSpaceBackend::ReferenceCpu => reference_knn(fingerprints, knn_options)?,
        };
        let gpu_time_ms = knn.gpu_time_ms;
        (knn, gpu_time_ms)
    };
    let tanimoto_host_time_ms = knn_started.elapsed().as_secs_f64() * 1_000.0;
    let embedding_started = Instant::now();
    let (positions, dimensions, tree_edges, embedding_gpu_time_ms, layout_host_time_ms) =
        if request.method == ChemicalSpaceMethod::Tmap {
            let layout_started = Instant::now();
            let layout = build_tmap_layout(
                fingerprints.len(),
                neighbor_count,
                &knn.source_indices,
                &knn.similarities,
                request.dimensions,
            )
            .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
            let layout_host_time_ms = layout_started.elapsed().as_secs_f64() * 1_000.0;
            let (positions, tree_edges) = layout.into_parts();
            (
                positions,
                request.dimensions,
                tree_edges,
                0,
                layout_host_time_ms,
            )
        } else {
            let graph = build_tanimoto_umap_graph(
                fingerprints.len(),
                neighbor_count,
                &knn.source_indices,
                &knn.similarities,
                umap_options,
            )
            .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
            let (positions, gpu_time_ms) = match backend {
                ChemicalSpaceBackend::NativeMetal(runtime) => {
                    let embedding = runtime
                        .optimize_embedding_profiled(
                            &graph,
                            umap_options,
                            request.method.into(),
                            request.max_memory_bytes,
                        )
                        .map_err(metal_error)?;
                    (embedding.positions, embedding.gpu_time_ms)
                }
                ChemicalSpaceBackend::ReferenceCpu => (
                    optimize_embedding(&graph, umap_options, request.method.into())
                        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?,
                    0,
                ),
            };
            let positions = positions
                .into_iter()
                .map(|position| [position[0], position[1], position[2]])
                .collect();
            (
                positions,
                umap_options.n_components(),
                Vec::new(),
                gpu_time_ms,
                0.0,
            )
        };
    let embedding_host_time_ms = if request.method == ChemicalSpaceMethod::Tmap {
        0.0
    } else {
        embedding_started.elapsed().as_secs_f64() * 1_000.0
    };
    let (neighbor_edges, neighbor_similarities) = undirected_neighbor_edges(
        fingerprints.len(),
        knn.neighbors_per_vertex,
        &knn.source_indices,
        &knn.similarities,
    );
    Ok(ChemicalSpaceExecution {
        result: ChemicalSpaceResult {
            source_record_ids: source_record_ids.to_vec(),
            positions,
            tree_edges,
            neighbor_edges,
            neighbor_similarities,
            dimensions,
            method: request.method,
            neighbors,
            successful_records: fingerprints.len(),
            failed_records,
            backend: backend.label(),
            tanimoto_gpu_time_ms,
            embedding_gpu_time_ms,
            tanimoto_host_time_ms,
            embedding_host_time_ms,
            layout_host_time_ms,
            host_time_ms: started.elapsed().as_secs_f64() * 1_000.0,
        },
        knn,
    })
}

pub(crate) fn cluster_chemical_space_from_fingerprints(
    fingerprints: &[Fingerprint2048],
    source_record_ids: &[u64],
    backend: ChemicalSpaceBackend<'_>,
    request: ChemicalSpaceClusterRequest,
) -> ComputeResult<ChemicalSpaceClusterResult> {
    if fingerprints.len() < 2 || fingerprints.len() != source_record_ids.len() {
        return Err(ComputeCoordinatorError::Validation(
            "Chemical-space clustering requires aligned fingerprints for at least two molecules"
                .into(),
        ));
    }
    if !request.cutoff.is_finite() || !(0.0..=1.0).contains(&request.cutoff) {
        return Err(ComputeCoordinatorError::Validation(
            "Chemical-space clustering cutoff must be between zero and one".into(),
        ));
    }
    let denominator = 10_000_u32;
    let numerator = (request.cutoff * denominator as f32).round() as u32;
    let cutoff = SimilarityCutoff {
        numerator,
        denominator,
    };
    let tile_size = NonZeroUsize::new(fingerprints.len().clamp(1, 512))
        .expect("clamped graph tile size is positive");
    let graph_options = GraphBuildOptions::try_new(
        tile_size,
        MAX_UNDIRECTED_SIMILARITY_EDGES,
        request.max_memory_bytes,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let similarity_started = Instant::now();
    let (graph, similarity_gpu_time_ms) = match backend {
        ChemicalSpaceBackend::NativeMetal(runtime) => {
            let execution = runtime
                .build_graph_profiled(fingerprints, cutoff, graph_options)
                .map_err(metal_error)?;
            (execution.graph, execution.gpu_time_ms)
        }
        ChemicalSpaceBackend::ReferenceCpu => (
            build_tanimoto_graph(fingerprints, cutoff, graph_options)
                .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?,
            0,
        ),
    };
    let similarity_host_time_ms = similarity_started.elapsed().as_secs_f64() * 1_000.0;
    let butina_options = burette_compute_core::ButinaOptions::try_new(
        MAX_UNDIRECTED_SIMILARITY_EDGES,
        request.max_memory_bytes,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let clusters = butina_clusters(&graph, butina_options)
        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let mut cluster_ids = vec![u64::MAX; fingerprints.len()];
    let mut representatives = Vec::with_capacity(clusters.len());
    for (cluster_id, members) in clusters.iter().enumerate() {
        if let Some(representative) = members.first() {
            representatives.push(source_record_ids[*representative as usize]);
        }
        for member in members {
            cluster_ids[*member as usize] = cluster_id as u64;
        }
    }
    if cluster_ids.contains(&u64::MAX) {
        return Err(ComputeCoordinatorError::Protocol(
            "Butina did not assign every chemical-space molecule".into(),
        ));
    }
    Ok(ChemicalSpaceClusterResult {
        source_record_ids: source_record_ids.to_vec(),
        cluster_ids,
        representative_source_record_ids: representatives,
        cluster_count: clusters.len(),
        backend: backend.label(),
        similarity_gpu_time_ms,
        similarity_host_time_ms,
    })
}

/// Exact CPU Tanimoto kNN in the same row-major layout the Metal top-K returns.
fn reference_knn(
    fingerprints: &[Fingerprint2048],
    options: TanimotoKnnOptions,
) -> ComputeResult<MetalTanimotoKnnExecution> {
    let knn = build_tanimoto_knn(fingerprints, options)
        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let source_indices = knn
        .source_indices()
        .iter()
        .map(|&index| u32::try_from(index))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            ComputeCoordinatorError::Validation(
                "Chemical-space neighbor index exceeds the UInt32 row limit".into(),
            )
        })?;
    Ok(MetalTanimotoKnnExecution {
        source_indices,
        similarities: knn
            .counts()
            .iter()
            .map(|counts| counts.similarity() as f32)
            .collect(),
        neighbors_per_vertex: knn.neighbors_per_vertex(),
        gpu_time_ms: 0,
    })
}

/// Collapse the directed Metal kNN adjacency into a deduplicated, undirected
/// sparse edge list with the highest Tanimoto similarity seen for each pair.
/// This is the graph activity-cliff discovery rides on; it never materialises a
/// dense N×N matrix and is bounded by [`MAX_UNDIRECTED_SIMILARITY_EDGES`].
fn undirected_neighbor_edges(
    vertex_count: usize,
    neighbors_per_vertex: usize,
    source_indices: &[u32],
    similarities: &[f32],
) -> (Vec<[u32; 2]>, Vec<f32>) {
    use std::collections::BTreeMap;
    let mut best: BTreeMap<(u32, u32), f32> = BTreeMap::new();
    for vertex in 0..vertex_count {
        let base = vertex * neighbors_per_vertex;
        for offset in 0..neighbors_per_vertex {
            let index = base + offset;
            let Some(&neighbor) = source_indices.get(index) else {
                continue;
            };
            if neighbor as usize == vertex {
                continue;
            }
            let similarity = similarities.get(index).copied().unwrap_or(0.0);
            let left = vertex as u32;
            let key = if left < neighbor {
                (left, neighbor)
            } else {
                (neighbor, left)
            };
            best.entry(key)
                .and_modify(|current| {
                    if similarity > *current {
                        *current = similarity;
                    }
                })
                .or_insert(similarity);
        }
    }
    let mut pairs: Vec<((u32, u32), f32)> = best.into_iter().collect();
    let edge_limit = MAX_NEIGHBOR_EDGES;
    if pairs.len() > edge_limit {
        pairs.sort_by(|left, right| right.1.total_cmp(&left.1));
        pairs.truncate(edge_limit);
    }
    let mut edges = Vec::with_capacity(pairs.len());
    let mut sims = Vec::with_capacity(pairs.len());
    for ((left, right), similarity) in pairs {
        edges.push([left, right]);
        sims.push(similarity);
    }
    (edges, sims)
}

const fn default_max_memory_bytes() -> u64 {
    DEFAULT_MAX_MEMORY_BYTES
}

fn metal_error(error: burette_compute_metal::MetalRuntimeError) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!(
        "native Metal chemical-space execution failed: {error}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use burette_compute_core::FINGERPRINT_WORDS;

    const EMBEDDING_METHODS: [ChemicalSpaceMethod; 8] = [
        ChemicalSpaceMethod::Umap,
        ChemicalSpaceMethod::Tsne,
        ChemicalSpaceMethod::Pacmap,
        ChemicalSpaceMethod::Localmap,
        ChemicalSpaceMethod::Trimap,
        ChemicalSpaceMethod::Dreams,
        ChemicalSpaceMethod::Cne,
        ChemicalSpaceMethod::Mmae,
    ];

    /// Two families of fingerprints that share a family-specific core.
    fn two_family_fingerprints() -> Vec<Fingerprint2048> {
        (0_u64..24)
            .map(|index| {
                let mut words = [0_u64; FINGERPRINT_WORDS];
                words[(index / 12) as usize] = u64::MAX;
                words[2 + index as usize] = index.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
                Fingerprint2048::from_words(words)
            })
            .collect()
    }

    fn request(method: ChemicalSpaceMethod, dimensions: u32, epochs: u32) -> ChemicalSpaceRequest {
        ChemicalSpaceRequest {
            method,
            dimensions,
            neighbors: 6,
            epochs,
            min_dist: 0.1,
            spread: 1.0,
            learning_rate: 1.0,
            negative_sample_rate: 5,
            random_seed: 42,
            max_memory_bytes: DEFAULT_MAX_MEMORY_BYTES,
        }
    }

    fn run(
        backend: ChemicalSpaceBackend<'_>,
        fingerprints: &[Fingerprint2048],
        request: ChemicalSpaceRequest,
    ) -> ChemicalSpaceExecution {
        let ids = (0..fingerprints.len() as u64).collect::<Vec<_>>();
        execute_chemical_space_from_fingerprints_with_knn(
            fingerprints,
            &ids,
            0,
            backend,
            request,
            None,
        )
        .expect("chemical-space execution")
    }

    #[test]
    fn reference_cpu_embeds_tmaps_and_clusters_without_metal() {
        let fingerprints = two_family_fingerprints();
        for method in EMBEDDING_METHODS
            .into_iter()
            .chain([ChemicalSpaceMethod::Tmap])
        {
            let execution = run(
                ChemicalSpaceBackend::ReferenceCpu,
                &fingerprints,
                request(method, 2, 100),
            );
            let result = &execution.result;
            assert_eq!(result.backend, "referenceCpu");
            assert_eq!(result.positions.len(), fingerprints.len());
            assert_eq!(
                (result.tanimoto_gpu_time_ms, result.embedding_gpu_time_ms),
                (0, 0)
            );
            assert!(result
                .positions
                .iter()
                .flatten()
                .all(|value| value.is_finite()));
            // Each family's neighbors stay inside the family.
            for (vertex, neighbors) in execution.knn.source_indices.chunks(6).enumerate() {
                assert!(neighbors
                    .iter()
                    .all(|&neighbor| neighbor / 12 == vertex as u32 / 12));
            }
        }
        let ids = (0..fingerprints.len() as u64).collect::<Vec<_>>();
        let clusters = cluster_chemical_space_from_fingerprints(
            &fingerprints,
            &ids,
            ChemicalSpaceBackend::ReferenceCpu,
            ChemicalSpaceClusterRequest {
                cutoff: 0.3,
                max_memory_bytes: DEFAULT_MAX_MEMORY_BYTES,
            },
        )
        .expect("CPU chemical-space clustering");
        assert_eq!(clusters.backend, "referenceCpu");
        assert_eq!(clusters.cluster_count, 2);
        assert_eq!(&clusters.cluster_ids[..12], &[clusters.cluster_ids[0]; 12]);
        assert_eq!(&clusters.cluster_ids[12..], &[clusters.cluster_ids[12]; 12]);
    }

    /// Compares the CPU reference with the Metal kernels.
    ///
    /// The kNN must match in rank order; similarities may differ by the Metal
    /// float division (a few ULPs, about 6e-8 each near 1). Those ULPs move
    /// fuzzy-graph weights across the epoch-sampling and pruning thresholds,
    /// so the optimizers are compared on one shared graph. After one epoch the
    /// two agree to a few ULPs; SGD then amplifies Metal fast-math `powr`,
    /// `sqrt` and division differences (measured on an M2 Pro: at most 1e-5 of
    /// the embedding extent after 10 epochs, 5e-3 after 20 for MMAE), so the
    /// bound is relative to the extent over a short schedule.
    #[test]
    #[cfg(target_os = "macos")]
    #[ignore = "manual real-GPU parity; set BURETTE_METAL_RUNTIME_ROOT"]
    fn reference_cpu_matches_the_metal_chemical_space_kernels() {
        let root = std::env::var_os("BURETTE_METAL_RUNTIME_ROOT")
            .map(std::path::PathBuf::from)
            .expect("BURETTE_METAL_RUNTIME_ROOT must name a packaged runtime");
        let runtime =
            MetalTanimotoRuntime::load(&root, &"0".repeat(64)).expect("load Metal runtime");
        let fingerprints = two_family_fingerprints();
        let neighbors = NonZeroUsize::new(6).expect("nonzero k");
        let knn_options =
            TanimotoKnnOptions::try_new(neighbors, DEFAULT_MAX_MEMORY_BYTES).expect("kNN options");
        let metal_knn = runtime
            .build_tanimoto_knn_profiled(&fingerprints, knn_options)
            .expect("Metal kNN");
        let cpu_knn = reference_knn(&fingerprints, knn_options).expect("CPU kNN");
        assert_eq!(metal_knn.source_indices, cpu_knn.source_indices);
        for (left, right) in metal_knn.similarities.iter().zip(&cpu_knn.similarities) {
            assert!(
                (left - right).abs() <= 1.0e-6,
                "similarity {left} vs {right}"
            );
        }
        for dimensions in [2, 3] {
            let options =
                UmapOptions::try_new(dimensions, 10, 0.1, 1.0, 1.0, 5, 42).expect("options");
            let graph = build_tanimoto_umap_graph(
                fingerprints.len(),
                neighbors,
                &metal_knn.source_indices,
                &metal_knn.similarities,
                options,
            )
            .expect("shared fuzzy graph");
            for method in EMBEDDING_METHODS {
                let metal = runtime
                    .optimize_embedding_profiled(
                        &graph,
                        options,
                        method.into(),
                        DEFAULT_MAX_MEMORY_BYTES,
                    )
                    .expect("Metal embedding")
                    .positions;
                let cpu =
                    optimize_embedding(&graph, options, method.into()).expect("CPU embedding");
                let deviation = metal
                    .iter()
                    .flatten()
                    .zip(cpu.iter().flatten())
                    .map(|(left, right)| (left - right).abs())
                    .fold(0.0_f32, f32::max);
                let extent = metal
                    .iter()
                    .flatten()
                    .fold(1.0_f32, |extent, value| extent.max(value.abs()));
                eprintln!(
                    "{method:?} {dimensions}D max |metal - cpu| = {deviation:e} (extent {extent})"
                );
                assert!(
                    deviation <= 1.0e-4 * extent,
                    "{method:?} {dimensions}D deviates by {deviation} at extent {extent}"
                );
            }
        }
    }
}
