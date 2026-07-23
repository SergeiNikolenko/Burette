use std::{num::NonZeroUsize, time::Instant};

use burrete_compute_core::{
    build_tanimoto_umap_graph, ChemicalSpaceMethod as NativeChemicalSpaceMethod, Fingerprint2048,
    TanimotoKnnOptions, UmapOptions,
};
use burrete_compute_metal::{MetalTanimotoKnnExecution, MetalTanimotoRuntime};
use serde::{Deserialize, Serialize};

use super::{
    cluster_executor::valid_fingerprints,
    coordinator::NativeMetalState,
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::CompletedFingerprintBatch,
};

const MAX_NEIGHBORS: usize = 64;
const DEFAULT_MAX_MEMORY_BYTES: u64 = 4 * 1_024 * 1_024 * 1_024;

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
    pub(crate) dimensions: u32,
    pub(crate) method: ChemicalSpaceMethod,
    pub(crate) neighbors: usize,
    pub(crate) successful_records: usize,
    pub(crate) failed_records: usize,
    pub(crate) backend: &'static str,
    pub(crate) tanimoto_gpu_time_ms: u64,
    pub(crate) embedding_gpu_time_ms: u64,
    pub(crate) host_time_ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChemicalSpaceExecution {
    pub(crate) result: ChemicalSpaceResult,
    pub(crate) knn: MetalTanimotoKnnExecution,
}

impl ChemicalSpaceRequest {
    pub(crate) const fn requested_neighbors(&self) -> usize {
        self.neighbors
    }
}

pub(crate) fn execute_chemical_space(
    batch: &CompletedFingerprintBatch,
    native_metal: &NativeMetalState,
    request: ChemicalSpaceRequest,
    cached_knn: Option<&MetalTanimotoKnnExecution>,
) -> ComputeResult<ChemicalSpaceExecution> {
    let (fingerprints, valid_ordinals) = valid_fingerprints(batch)?;
    let runtime = match native_metal {
        NativeMetalState::Available(runtime) => runtime,
        NativeMetalState::Unavailable { message, .. } => {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "Chemical-space Metal runtime is unavailable: {message}"
            )))
        }
    };
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
        runtime,
        request,
        cached_knn,
    )
}

pub(crate) fn execute_chemical_space_from_fingerprints_with_knn(
    fingerprints: &[Fingerprint2048],
    source_record_ids: &[u64],
    failed_records: usize,
    runtime: &MetalTanimotoRuntime,
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
    let (knn, tanimoto_gpu_time_ms) = if let Some(knn) = reused_knn {
        (knn, 0)
    } else {
        let knn = runtime
            .build_tanimoto_knn_profiled(fingerprints, knn_options)
            .map_err(metal_error)?;
        let gpu_time_ms = knn.gpu_time_ms;
        (knn, gpu_time_ms)
    };
    let graph = build_tanimoto_umap_graph(
        fingerprints.len(),
        neighbor_count,
        &knn.source_indices,
        &knn.similarities,
        umap_options,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let embedding = runtime
        .optimize_embedding_profiled(
            &graph,
            umap_options,
            request.method.into(),
            request.max_memory_bytes,
        )
        .map_err(metal_error)?;
    let positions = embedding
        .positions
        .into_iter()
        .map(|position| [position[0], position[1], position[2]])
        .collect();
    Ok(ChemicalSpaceExecution {
        result: ChemicalSpaceResult {
            source_record_ids: source_record_ids.to_vec(),
            positions,
            dimensions: embedding.component_count,
            method: request.method,
            neighbors,
            successful_records: fingerprints.len(),
            failed_records,
            backend: "nativeMetal",
            tanimoto_gpu_time_ms,
            embedding_gpu_time_ms: embedding.gpu_time_ms,
            host_time_ms: started.elapsed().as_secs_f64() * 1_000.0,
        },
        knn,
    })
}

const fn default_max_memory_bytes() -> u64 {
    DEFAULT_MAX_MEMORY_BYTES
}

fn metal_error(error: burrete_compute_metal::MetalRuntimeError) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!(
        "native Metal chemical-space execution failed: {error}"
    ))
}
