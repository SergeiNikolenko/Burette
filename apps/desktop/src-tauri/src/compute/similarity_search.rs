use std::{mem::size_of, time::Instant};

use burrete_compute_core::{score_tanimoto_query, TanimotoCounts, TanimotoQueryOptions};
use burrete_compute_metal::{MetalRuntimeError, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    ArtifactManifest, Backend, BackendPolicy, EngineIdentity, JobSnapshot, JobState,
    SimilarityCutoff, WorkflowTemplateId, MAX_JSON_SAFE_INTEGER,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    similarity_artifact::load_similarity_library,
    snapshot_repository::SnapshotRepository,
    store::ComputeStore,
};
use crate::preview::{
    grid_analysis::{
        apply_similarity_analysis_run, GridSimilarityAnalysisApplyInput, GridSimilarityMatchInput,
    },
    grid_store::GridSnapshotLease,
};

const MAX_SEARCH_MATCHES: u32 = 500;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SimilaritySearchRequest {
    pub(crate) query_source_index: u64,
    pub(crate) top_k: u32,
    pub(crate) minimum_similarity: SimilarityCutoff,
}

impl SimilaritySearchRequest {
    fn normalized(mut self) -> ComputeResult<Self> {
        if self.query_source_index > MAX_JSON_SAFE_INTEGER {
            return Err(validation(
                "similarity query source index exceeds the JSON-safe integer limit",
            ));
        }
        if self.top_k == 0 || self.top_k > MAX_SEARCH_MATCHES {
            return Err(validation(format!(
                "similarity search topK must be in 1..={MAX_SEARCH_MATCHES}"
            )));
        }
        self.minimum_similarity = self.minimum_similarity.normalized()?;
        Ok(self)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimilaritySearchMatch {
    pub(crate) rank: u64,
    pub(crate) source_record_id: u64,
    pub(crate) intersection: u64,
    pub(crate) union: u64,
    pub(crate) similarity: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimilaritySearchResult {
    pub(crate) run_id: Uuid,
    pub(crate) source_job_id: Uuid,
    pub(crate) source_artifact_id: Uuid,
    pub(crate) query_source_index: u64,
    pub(crate) library_record_count: u64,
    pub(crate) valid_record_count: u64,
    pub(crate) qualified_match_count: u64,
    pub(crate) matches: Vec<SimilaritySearchMatch>,
    pub(crate) backend: Backend,
    pub(crate) fallback_reason: Option<String>,
    pub(crate) gpu_time_ms: Option<u64>,
    pub(crate) host_time_ms: f64,
    pub(crate) grid_applied: bool,
    pub(crate) grid_warning: Option<String>,
}

pub(crate) enum SimilaritySearchBackend<'a> {
    NativeMetal(&'a MetalTanimotoRuntime),
    ReferenceCpu {
        engine: &'a EngineIdentity,
        fallback_reason: Option<String>,
    },
}

#[derive(Clone, Copy)]
struct Candidate {
    source_ordinal: usize,
    counts: TanimotoCounts,
}

pub(crate) fn execute_similarity_search(
    store: &ComputeStore,
    snapshots: &SnapshotRepository,
    job: &JobSnapshot,
    artifact: &ArtifactManifest,
    grid_lease: &GridSnapshotLease,
    request: SimilaritySearchRequest,
    backend: SimilaritySearchBackend<'_>,
    created_at_ms: u64,
) -> ComputeResult<SimilaritySearchResult> {
    let started = Instant::now();
    let request = request.normalized()?;
    job.validate()?;
    artifact.validate_against_job(job)?;
    if job.workflow_template != WorkflowTemplateId::ClusterV1
        || !matches!(
            job.state,
            JobState::Succeeded | JobState::SucceededWithFailures
        )
    {
        return Err(validation(
            "similarity search requires a successful cluster.v1 source job",
        ));
    }
    if created_at_ms == 0 {
        return Err(validation("similarity search time must be positive"));
    }
    let source_request = job.request.as_cluster()?;
    let memory_limit = match backend {
        SimilaritySearchBackend::NativeMetal(runtime) => source_request
            .limits
            .max_memory_bytes
            .min(runtime.limits().max_memory_bytes),
        SimilaritySearchBackend::ReferenceCpu { .. } => source_request.limits.max_memory_bytes,
    };
    let gpu_backend = matches!(backend, SimilaritySearchBackend::NativeMetal(_));
    let library = load_similarity_library(
        store,
        snapshots,
        job,
        artifact,
        request.query_source_index,
        memory_limit,
        gpu_backend,
        size_of::<Candidate>(),
    )?;
    let options = TanimotoQueryOptions::new(library.scoring_memory_limit)
        .map_err(|error| validation(error.to_string()))?;
    let (counts, effective_backend, fallback_reason, gpu_time_ms, execution_provenance) =
        match backend {
            SimilaritySearchBackend::NativeMetal(runtime) => {
                let execution = runtime
                    .score_query_profiled(&library.query, &library.fingerprints, options)
                    .map_err(metal_error)?;
                (
                    execution.counts,
                    Backend::NativeMetal,
                    None,
                    Some(execution.gpu_time_ms),
                    serde_json::json!({
                        "runtime": runtime.runtime_identity(),
                        "device": runtime.device_identity(),
                        "kernelId": "burrete.compute.tanimoto.v2:query-counts.v1",
                    }),
                )
            }
            SimilaritySearchBackend::ReferenceCpu {
                engine,
                fallback_reason,
            } => (
                score_tanimoto_query(&library.query, &library.fingerprints, options)
                    .map_err(|error| validation(error.to_string()))?,
                Backend::ReferenceCpu,
                fallback_reason.clone(),
                None,
                serde_json::json!({ "engine": engine }),
            ),
        };
    if counts.len() != library.valid_ordinals.len() {
        return Err(protocol(
            "Tanimoto query output differs from the valid fingerprint count",
        ));
    }

    let query_valid_ordinal = library
        .valid_ordinals
        .iter()
        .position(|ordinal| *ordinal == library.query_ordinal)
        .ok_or_else(|| protocol("valid query fingerprint is absent from the valid ordinal map"))?;
    let mut candidates = Vec::new();
    candidates
        .try_reserve_exact(library.valid_count.saturating_sub(1))
        .map_err(|_| unavailable("cannot allocate similarity candidate ranking"))?;
    for (valid_ordinal, counts) in counts.into_iter().enumerate() {
        if valid_ordinal == query_valid_ordinal
            || !counts.matches_cutoff(request.minimum_similarity)?
        {
            continue;
        }
        candidates.push(Candidate {
            source_ordinal: library.valid_ordinals[valid_ordinal],
            counts,
        });
    }
    candidates.sort_by(|left, right| {
        right.counts.compare_similarity(left.counts).then_with(|| {
            library.identities[left.source_ordinal]
                .source_record_id
                .cmp(&library.identities[right.source_ordinal].source_record_id)
        })
    });
    let qualified_match_count = u64::try_from(candidates.len())
        .map_err(|_| protocol("qualified similarity match count overflowed"))?;
    candidates.truncate(request.top_k as usize);
    let matches = candidates
        .iter()
        .enumerate()
        .map(|(position, candidate)| SimilaritySearchMatch {
            rank: position as u64 + 1,
            source_record_id: library.identities[candidate.source_ordinal].source_record_id,
            intersection: candidate.counts.intersection,
            union: candidate.counts.union,
            similarity: candidate.counts.similarity(),
        })
        .collect::<Vec<_>>();

    let run_id = Uuid::new_v4();
    let settings = SimilaritySettingsIdentity {
        schema_version: "burrete.similarity-search-settings.v1",
        run_id,
        source_job_id: job.job_id,
        source_artifact_id: artifact.artifact_id,
        source_artifact_manifest_sha256: &library.artifact_manifest_sha256,
        query_source_index: request.query_source_index,
        top_k: request.top_k,
        minimum_similarity: request.minimum_similarity,
        requested_backend: source_request.execution_policy.backend_policy,
        effective_backend,
    };
    let normalized_settings_sha256 = sha256_json(&settings)?;
    let host_time_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let provenance = serde_json::json!({
        "operation": "similaritySearch.v1",
        "sourceJobId": job.job_id,
        "sourceArtifactId": artifact.artifact_id,
        "sourceArtifactManifestSha256": library.artifact_manifest_sha256.clone(),
        "sourceResultPack": library.result_pack.clone(),
        "querySourceIndex": request.query_source_index,
        "topK": request.top_k,
        "minimumSimilarity": request.minimum_similarity,
        "requestedBackend": source_request.execution_policy.backend_policy,
        "effectiveBackend": effective_backend,
        "fallbackReason": fallback_reason.clone(),
        "gpuTimeMs": gpu_time_ms,
        "hostTimeMs": host_time_ms,
        "execution": execution_provenance,
    });
    let grid_matches = matches
        .iter()
        .map(|matched| {
            let source_ordinal = library
                .identities
                .binary_search_by_key(&matched.source_record_id, |identity| {
                    identity.source_record_id
                })
                .expect("ranked source identity came from the same sorted snapshot");
            GridSimilarityMatchInput {
                source_index: matched.source_record_id,
                molecule_content_sha256: encode_hex(
                    library.identities[source_ordinal].molecule_content_sha256,
                ),
                rank: matched.rank,
                intersection: matched.intersection,
                union: matched.union,
            }
        })
        .collect();
    let grid_input = GridSimilarityAnalysisApplyInput {
        run_id,
        document_fingerprint_sha256: job
            .frozen_source
            .frozen_source
            .document_fingerprint_sha256
            .clone(),
        source_revision: job.frozen_source.frozen_source.source_revision,
        snapshot_id: job.frozen_source.snapshot_id,
        snapshot_sha256: job.frozen_source.snapshot_sha256.clone(),
        normalized_settings_sha256,
        representative_policy: source_request.parameters.representative_policy,
        provenance,
        created_at_ms,
        artifact_id: artifact.artifact_id,
        artifact_manifest_sha256: library.artifact_manifest_sha256.clone(),
        query_source_index: request.query_source_index,
        query_molecule_content_sha256: encode_hex(
            library.identities[library.query_ordinal].molecule_content_sha256,
        ),
        matches: grid_matches,
    };
    let (grid_applied, grid_warning) =
        match apply_similarity_analysis_run(grid_lease.database_path_for_freeze(), &grid_input) {
            Ok(()) => (true, None),
            Err(error) => (false, Some(error.chars().take(1_900).collect())),
        };

    Ok(SimilaritySearchResult {
        run_id,
        source_job_id: job.job_id,
        source_artifact_id: artifact.artifact_id,
        query_source_index: request.query_source_index,
        library_record_count: library.record_count,
        valid_record_count: library.valid_count as u64,
        qualified_match_count,
        matches,
        backend: effective_backend,
        fallback_reason,
        gpu_time_ms,
        host_time_ms,
        grid_applied,
        grid_warning,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimilaritySettingsIdentity<'a> {
    schema_version: &'static str,
    run_id: Uuid,
    source_job_id: Uuid,
    source_artifact_id: Uuid,
    source_artifact_manifest_sha256: &'a str,
    query_source_index: u64,
    top_k: u32,
    minimum_similarity: SimilarityCutoff,
    requested_backend: BackendPolicy,
    effective_backend: Backend,
}

fn metal_error(error: MetalRuntimeError) -> ComputeCoordinatorError {
    match error {
        MetalRuntimeError::ResourceLimit(message) => validation(message),
        other => unavailable(format!("native Metal similarity search failed: {other}")),
    }
}

fn sha256_json(value: &impl Serialize) -> ComputeResult<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(encode_hex(Sha256::digest(bytes)))
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    use std::fmt::Write as _;

    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn validation(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Validation(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute::similarity_artifact::RecordIdentity;

    #[test]
    fn exact_ranking_uses_source_identity_as_the_tie_breaker() {
        let identities = [
            RecordIdentity {
                source_record_id: 20,
                molecule_content_sha256: [0; 32],
            },
            RecordIdentity {
                source_record_id: 10,
                molecule_content_sha256: [0; 32],
            },
            RecordIdentity {
                source_record_id: 30,
                molecule_content_sha256: [0; 32],
            },
        ];
        let mut candidates = [
            Candidate {
                source_ordinal: 0,
                counts: TanimotoCounts {
                    intersection: 1,
                    union: 2,
                },
            },
            Candidate {
                source_ordinal: 1,
                counts: TanimotoCounts {
                    intersection: 2,
                    union: 4,
                },
            },
            Candidate {
                source_ordinal: 2,
                counts: TanimotoCounts {
                    intersection: 3,
                    union: 4,
                },
            },
        ];
        candidates.sort_by(|left, right| {
            right.counts.compare_similarity(left.counts).then_with(|| {
                identities[left.source_ordinal]
                    .source_record_id
                    .cmp(&identities[right.source_ordinal].source_record_id)
            })
        });
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| identities[candidate.source_ordinal].source_record_id)
                .collect::<Vec<_>>(),
            vec![30, 10, 20]
        );
    }

    #[test]
    fn request_normalization_bounds_top_k_and_reduces_cutoff() {
        let request = SimilaritySearchRequest {
            query_source_index: 4,
            top_k: 50,
            minimum_similarity: SimilarityCutoff {
                numerator: 700,
                denominator: 1_000,
            },
        }
        .normalized()
        .expect("normalized request");
        assert_eq!(
            request.minimum_similarity,
            SimilarityCutoff {
                numerator: 7,
                denominator: 10,
            }
        );
        assert!(SimilaritySearchRequest {
            top_k: 501,
            ..request
        }
        .normalized()
        .is_err());
    }
}
