use std::{num::NonZeroUsize, time::Instant};

use burrete_compute_core::{build_tanimoto_umap_graph, TanimotoKnnOptions, UmapOptions};
use serde::{Deserialize, Serialize};

use super::{
    cluster_executor::valid_fingerprints,
    coordinator::NativeMetalState,
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::CompletedFingerprintBatch,
};

const MAX_NEIGHBORS: usize = 64;
const DEFAULT_MAX_MEMORY_BYTES: u64 = 4 * 1_024 * 1_024 * 1_024;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChemicalSpaceRequest {
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
    pub(crate) neighbors: usize,
    pub(crate) successful_records: usize,
    pub(crate) failed_records: usize,
    pub(crate) backend: &'static str,
    pub(crate) tanimoto_gpu_time_ms: u64,
    pub(crate) umap_gpu_time_ms: u64,
    pub(crate) host_time_ms: f64,
}

pub(crate) fn execute_chemical_space(
    batch: &CompletedFingerprintBatch,
    native_metal: &NativeMetalState,
    request: ChemicalSpaceRequest,
) -> ComputeResult<ChemicalSpaceResult> {
    let started = Instant::now();
    let (fingerprints, valid_ordinals) = valid_fingerprints(batch)?;
    if fingerprints.len() < 2 {
        return Err(ComputeCoordinatorError::Validation(
            "Chemical space requires at least two valid molecular fingerprints".into(),
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
    let runtime = match native_metal {
        NativeMetalState::Available(runtime) => runtime,
        NativeMetalState::Unavailable { message, .. } => {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "Chemical-space Metal runtime is unavailable: {message}"
            )))
        }
    };
    let knn = runtime
        .build_tanimoto_knn_profiled(&fingerprints, knn_options)
        .map_err(metal_error)?;
    let graph = build_tanimoto_umap_graph(
        fingerprints.len(),
        neighbor_count,
        &knn.source_indices,
        &knn.similarities,
        umap_options,
    )
    .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?;
    let embedding = runtime
        .optimize_umap_profiled(&graph, umap_options, request.max_memory_bytes)
        .map_err(metal_error)?;
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
    let positions = embedding
        .positions
        .into_iter()
        .map(|position| [position[0], position[1], position[2]])
        .collect();
    Ok(ChemicalSpaceResult {
        source_record_ids,
        positions,
        dimensions: embedding.component_count,
        neighbors,
        successful_records: fingerprints.len(),
        failed_records: batch.errors.iter().filter(|error| error.is_some()).count(),
        backend: "nativeMetal",
        tanimoto_gpu_time_ms: knn.gpu_time_ms,
        umap_gpu_time_ms: embedding.gpu_time_ms,
        host_time_ms: started.elapsed().as_secs_f64() * 1_000.0,
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
