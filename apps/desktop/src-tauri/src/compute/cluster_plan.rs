use std::fmt;

use burrete_compute_protocol::{
    Backend, BackendPolicy, ClusterV1SubmitRequest, EngineIdentity, ExecutionPartition,
    ExecutionPlan, ExecutionPlanVersion, FallbackDecision, GridScope, PlannedStage, Precision,
    ProtocolError, StageKind, WorkflowTemplateId, MAX_PACK_RECORDS,
};

const MEMORY_HEADROOM_BYTES: u64 = 64 * 1024;
const U64_BYTES: u64 = 8;
const BOOL8_BYTES: u64 = 1;
const FINGERPRINT_BYTES: u64 = 2_048 / 8;
const MOLECULE_HASH_BYTES: u64 = 32;
const LOGICAL_VEC_HEADER_BYTES: u64 = 24;
const MAX_FALLBACK_REASON_BYTES: usize = 2_048;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ClusterV1AdmissionError {
    Contract(String),
    ArithmeticOverflow(&'static str),
    BackendPolicyMismatch(String),
    GpuRequiredUnavailable(String),
    MemoryLimitExceeded {
        stage_id: &'static str,
        required_bytes: u64,
        limit_bytes: u64,
    },
}

impl fmt::Display for ClusterV1AdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contract(message) | Self::BackendPolicyMismatch(message) => {
                formatter.write_str(message)
            }
            Self::ArithmeticOverflow(quantity) => {
                write!(formatter, "cluster.v1 {quantity} overflowed")
            }
            Self::GpuRequiredUnavailable(reason) => {
                write!(formatter, "gpuRequired cluster.v1 admission failed: {reason}")
            }
            Self::MemoryLimitExceeded {
                stage_id,
                required_bytes,
                limit_bytes,
            } => write!(
                formatter,
                "cluster.v1 stage {stage_id} requires {required_bytes} accounted bytes; maxMemoryBytes is {limit_bytes}"
            ),
        }
    }
}

impl std::error::Error for ClusterV1AdmissionError {}

impl From<ProtocolError> for ClusterV1AdmissionError {
    fn from(error: ProtocolError) -> Self {
        Self::Contract(error.to_string())
    }
}

/// Caller-supplied identities read from verified runtime manifests.
///
/// This layer validates the protocol shape and engine/backend binding, but it
/// deliberately does not manufacture versions or integrity hashes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClusterV1EngineIdentities {
    pub(crate) coordinator: EngineIdentity,
    pub(crate) rdkit: EngineIdentity,
    pub(crate) reference_cpu: EngineIdentity,
}

/// The caller's already-probed admission decision for the numeric stage.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SimilarityBackendAdmission {
    NativeMetal(EngineIdentity),
    GpuUnavailable(FallbackDecision),
    ReferenceCpu,
}

impl SimilarityBackendAdmission {
    fn label(&self) -> &'static str {
        match self {
            Self::NativeMetal(_) => "nativeMetal",
            Self::GpuUnavailable(_) => "gpuUnavailable",
            Self::ReferenceCpu => "referenceCpu",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ClusterV1MemoryEstimate {
    pub(crate) admitted_max_undirected_edges: u64,
    pub(crate) freeze_scope_bytes: u64,
    pub(crate) fingerprints_bytes: u64,
    pub(crate) tanimoto_neighbors_bytes: u64,
    pub(crate) butina_clusters_bytes: u64,
    pub(crate) validate_results_bytes: u64,
    pub(crate) publish_results_bytes: u64,
}

impl ClusterV1MemoryEstimate {
    fn stage_bytes(self) -> [(&'static str, u64); 6] {
        [
            ("freezeScope", self.freeze_scope_bytes),
            ("fingerprints", self.fingerprints_bytes),
            ("tanimotoNeighbors", self.tanimoto_neighbors_bytes),
            ("butinaClusters", self.butina_clusters_bytes),
            ("validateResults", self.validate_results_bytes),
            ("publishResults", self.publish_results_bytes),
        ]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AdmittedClusterV1Plan {
    pub(crate) plan: ExecutionPlan,
    pub(crate) memory: ClusterV1MemoryEstimate,
}

pub(crate) fn admit_cluster_v1_plan(
    request: &ClusterV1SubmitRequest,
    record_count: u64,
    engines: &ClusterV1EngineIdentities,
    similarity_admission: SimilarityBackendAdmission,
) -> Result<AdmittedClusterV1Plan, ClusterV1AdmissionError> {
    request.validate()?;
    if !(1..=MAX_PACK_RECORDS).contains(&record_count) {
        return Err(ClusterV1AdmissionError::Contract(format!(
            "cluster.v1 record count must be in 1..={MAX_PACK_RECORDS}"
        )));
    }
    if let GridScope::Selected(selected) = &request.source.scope {
        if selected.source_indexes.len() as u64 != record_count {
            return Err(ClusterV1AdmissionError::Contract(
                "selected request count differs from the frozen source".into(),
            ));
        }
    }
    engines.coordinator.validate()?;
    engines.rdkit.validate()?;
    engines.reference_cpu.validate()?;

    let memory = estimate_cluster_v1_memory(record_count, request.limits.max_edges)?;
    for (stage_id, required_bytes) in memory.stage_bytes() {
        if required_bytes > request.limits.max_memory_bytes {
            return Err(ClusterV1AdmissionError::MemoryLimitExceeded {
                stage_id,
                required_bytes,
                limit_bytes: request.limits.max_memory_bytes,
            });
        }
    }

    let similarity = admit_similarity_backend(
        request.execution_policy.backend_policy,
        &engines.reference_cpu,
        similarity_admission,
    )?;
    let stages = [
        stage(
            "freezeScope",
            StageKind::Materialize,
            Backend::Coordinator,
            Backend::Coordinator,
            Precision::NotApplicable,
            engines.coordinator.clone(),
            memory.freeze_scope_bytes,
            record_count,
            None,
        ),
        stage(
            "fingerprints",
            StageKind::ChemistrySemantics,
            Backend::Rdkit,
            Backend::Rdkit,
            Precision::IntegerExact,
            engines.rdkit.clone(),
            memory.fingerprints_bytes,
            record_count,
            None,
        ),
        stage(
            "tanimotoNeighbors",
            StageKind::NumericCompute,
            similarity.requested_backend,
            similarity.effective_backend,
            Precision::IntegerExact,
            similarity.engine,
            memory.tanimoto_neighbors_bytes,
            record_count,
            similarity.fallback,
        ),
        stage(
            "butinaClusters",
            StageKind::WorkflowSemantics,
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            Precision::IntegerExact,
            engines.reference_cpu.clone(),
            memory.butina_clusters_bytes,
            record_count,
            None,
        ),
        stage(
            "validateResults",
            StageKind::Validation,
            Backend::ReferenceCpu,
            Backend::ReferenceCpu,
            Precision::IntegerExact,
            engines.reference_cpu.clone(),
            memory.validate_results_bytes,
            record_count,
            None,
        ),
        stage(
            "publishResults",
            StageKind::ArtifactIo,
            Backend::Coordinator,
            Backend::Coordinator,
            Precision::NotApplicable,
            engines.coordinator.clone(),
            memory.publish_results_bytes,
            record_count,
            None,
        ),
    ];
    let plan = ExecutionPlan {
        workflow_template: WorkflowTemplateId::ClusterV1,
        plan_version: ExecutionPlanVersion::ClusterV1,
        backend_policy: request.execution_policy.backend_policy,
        stages: stages.into(),
    };
    plan.validate_against_request(request, record_count)?;
    Ok(AdmittedClusterV1Plan { plan, memory })
}

struct SimilarityStageAdmission {
    requested_backend: Backend,
    effective_backend: Backend,
    engine: EngineIdentity,
    fallback: Option<FallbackDecision>,
}

fn admit_similarity_backend(
    policy: BackendPolicy,
    reference_cpu: &EngineIdentity,
    admission: SimilarityBackendAdmission,
) -> Result<SimilarityStageAdmission, ClusterV1AdmissionError> {
    let admission_label = admission.label();
    match (policy, admission) {
        (BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred, SimilarityBackendAdmission::NativeMetal(engine)) => {
            engine.validate()?;
            Ok(SimilarityStageAdmission {
                requested_backend: Backend::NativeMetal,
                effective_backend: Backend::NativeMetal,
                engine,
                fallback: None,
            })
        }
        (BackendPolicy::GpuRequired, SimilarityBackendAdmission::GpuUnavailable(fallback)) => {
            validate_fallback_reason(&fallback)?;
            Err(ClusterV1AdmissionError::GpuRequiredUnavailable(
                fallback.reason,
            ))
        }
        (BackendPolicy::GpuPreferred, SimilarityBackendAdmission::GpuUnavailable(fallback)) => {
            validate_fallback_reason(&fallback)?;
            Ok(SimilarityStageAdmission {
                requested_backend: Backend::NativeMetal,
                effective_backend: Backend::ReferenceCpu,
                engine: reference_cpu.clone(),
                fallback: Some(fallback),
            })
        }
        (BackendPolicy::ReferenceCpu, SimilarityBackendAdmission::ReferenceCpu) => {
            Ok(SimilarityStageAdmission {
                requested_backend: Backend::ReferenceCpu,
                effective_backend: Backend::ReferenceCpu,
                engine: reference_cpu.clone(),
                fallback: None,
            })
        }
        (policy, _) => Err(ClusterV1AdmissionError::BackendPolicyMismatch(format!(
            "cluster.v1 backend policy {policy:?} is incompatible with similarity admission {admission_label}"
        ))),
    }
}

fn validate_fallback_reason(fallback: &FallbackDecision) -> Result<(), ClusterV1AdmissionError> {
    if fallback.reason.is_empty() || fallback.reason.len() > MAX_FALLBACK_REASON_BYTES {
        return Err(ClusterV1AdmissionError::Contract(format!(
            "fallback reason must contain 1..={MAX_FALLBACK_REASON_BYTES} bytes"
        )));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn stage(
    stage_id: &'static str,
    kind: StageKind,
    requested_backend: Backend,
    effective_backend: Backend,
    precision: Precision,
    engine: EngineIdentity,
    estimated_memory_bytes: u64,
    record_count: u64,
    fallback: Option<FallbackDecision>,
) -> PlannedStage {
    PlannedStage {
        stage_id: stage_id.into(),
        kind,
        idempotent: true,
        requested_backend,
        effective_backend,
        precision,
        engine,
        estimated_memory_bytes,
        fallback: fallback.clone(),
        partitions: vec![ExecutionPartition {
            partition_id: "all".into(),
            chemistry_domain: "cluster.v1/all".into(),
            record_count,
            estimated_memory_bytes,
            requested_backend,
            effective_backend,
            fallback,
        }],
    }
}

/// Estimates the largest declared logical buffers for each fixed stage.
///
/// The numeric estimate mirrors the reference graph builder's conservative
/// pair/CSR/construction/Butina account and additionally includes the packed
/// 2,048-bit fingerprint matrix. It is an admission model, not process RSS.
fn estimate_cluster_v1_memory(
    record_count: u64,
    request_max_undirected_edges: u64,
) -> Result<ClusterV1MemoryEstimate, ClusterV1AdmissionError> {
    let possible_edges = record_count
        .checked_mul(record_count.saturating_sub(1))
        .and_then(|value| value.checked_div(2))
        .ok_or(ClusterV1AdmissionError::ArithmeticOverflow(
            "possible undirected edge count",
        ))?;
    let edges = possible_edges.min(request_max_undirected_edges);

    let freeze_scope_bytes = sum_buffers(&[
        MEMORY_HEADROOM_BYTES,
        multiply(record_count, U64_BYTES, "source record IDs")?,
        multiply(record_count, MOLECULE_HASH_BYTES, "molecule hashes")?,
    ])?;
    let fingerprints_bytes = sum_buffers(&[
        freeze_scope_bytes,
        multiply(record_count, FINGERPRINT_BYTES, "fingerprints")?,
        multiply(record_count, BOOL8_BYTES, "fingerprint validity")?,
        multiply(record_count, U64_BYTES, "fingerprint error indexes")?,
    ])?;

    let offsets = record_count
        .checked_add(1)
        .ok_or(ClusterV1AdmissionError::ArithmeticOverflow("CSR row count"))?;
    let directed_edges =
        edges
            .checked_mul(2)
            .ok_or(ClusterV1AdmissionError::ArithmeticOverflow(
                "directed CSR edge count",
            ))?;
    let tanimoto_neighbors_bytes = sum_buffers(&[
        MEMORY_HEADROOM_BYTES,
        multiply(record_count, FINGERPRINT_BYTES, "resident fingerprints")?,
        multiply(edges, 2 * U64_BYTES, "matching pairs")?,
        multiply(record_count, U64_BYTES, "CSR degrees")?,
        multiply(offsets, U64_BYTES, "CSR row offsets")?,
        multiply(directed_edges, U64_BYTES, "CSR columns")?,
        multiply(record_count, U64_BYTES, "CSR cursors")?,
        multiply(record_count, BOOL8_BYTES, "Butina alive mask")?,
        multiply(record_count, U64_BYTES, "Butina live degrees")?,
        multiply(record_count, U64_BYTES, "Butina members")?,
        multiply(
            record_count,
            LOGICAL_VEC_HEADER_BYTES,
            "Butina cluster headers",
        )?,
    ])?;
    let butina_clusters_bytes = sum_buffers(&[
        MEMORY_HEADROOM_BYTES,
        multiply(offsets, U64_BYTES, "resident CSR row offsets")?,
        multiply(directed_edges, U64_BYTES, "resident CSR columns")?,
        multiply(record_count, BOOL8_BYTES, "Butina alive mask")?,
        multiply(record_count, U64_BYTES, "Butina live degrees")?,
        multiply(record_count, U64_BYTES, "Butina members")?,
        multiply(
            record_count,
            LOGICAL_VEC_HEADER_BYTES,
            "Butina cluster headers",
        )?,
    ])?;
    let result_bytes = sum_buffers(&[
        MEMORY_HEADROOM_BYTES,
        multiply(offsets, U64_BYTES, "result CSR row offsets")?,
        multiply(directed_edges, U64_BYTES, "result CSR columns")?,
        multiply(record_count, U64_BYTES, "cluster IDs")?,
        multiply(record_count, BOOL8_BYTES, "representative flags")?,
        multiply(record_count, BOOL8_BYTES, "record validity")?,
    ])?;

    Ok(ClusterV1MemoryEstimate {
        admitted_max_undirected_edges: edges,
        freeze_scope_bytes,
        fingerprints_bytes,
        tanimoto_neighbors_bytes,
        butina_clusters_bytes,
        validate_results_bytes: result_bytes,
        publish_results_bytes: result_bytes,
    })
}

fn multiply(
    count: u64,
    width: u64,
    quantity: &'static str,
) -> Result<u64, ClusterV1AdmissionError> {
    count
        .checked_mul(width)
        .ok_or(ClusterV1AdmissionError::ArithmeticOverflow(quantity))
}

fn sum_buffers(buffers: &[u64]) -> Result<u64, ClusterV1AdmissionError> {
    buffers.iter().try_fold(0_u64, |total, bytes| {
        total
            .checked_add(*bytes)
            .ok_or(ClusterV1AdmissionError::ArithmeticOverflow(
                "memory estimate",
            ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use burrete_compute_protocol::{
        AllGridScope, ClusterV1Parameters, ComputeJobSchemaVersion, ExecutionPolicy,
        FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, GridScope,
        GridSourceReference, RdkitBaselineVersion, RepresentativePolicy, ResourceLimits,
        SchedulingPolicy, SimilarityCutoff, SimilaritySettings, MAX_UNDIRECTED_SIMILARITY_EDGES,
        MIN_COMPUTE_MEMORY_BYTES,
    };

    #[test]
    fn admits_exact_fixed_backends_for_every_policy() {
        let engines = test_engines();

        let gpu = admit_cluster_v1_plan(
            &request(
                BackendPolicy::GpuRequired,
                100,
                1_000,
                MIN_COMPUTE_MEMORY_BYTES,
            ),
            100,
            &engines,
            SimilarityBackendAdmission::NativeMetal(test_engine("burrete-native-metal", '4')),
        )
        .expect("admit required GPU plan");
        assert_eq!(
            gpu.plan
                .stages
                .iter()
                .map(|stage| (stage.requested_backend, stage.effective_backend))
                .collect::<Vec<_>>(),
            vec![
                (Backend::Coordinator, Backend::Coordinator),
                (Backend::Rdkit, Backend::Rdkit),
                (Backend::NativeMetal, Backend::NativeMetal),
                (Backend::ReferenceCpu, Backend::ReferenceCpu),
                (Backend::ReferenceCpu, Backend::ReferenceCpu),
                (Backend::Coordinator, Backend::Coordinator),
            ]
        );

        let fallback = FallbackDecision {
            code: burrete_compute_protocol::FallbackReasonCode::RuntimeUnavailable,
            reason: "Verified native Metal runtime is unavailable.".into(),
        };
        let preferred = admit_cluster_v1_plan(
            &request(
                BackendPolicy::GpuPreferred,
                100,
                1_000,
                MIN_COMPUTE_MEMORY_BYTES,
            ),
            100,
            &engines,
            SimilarityBackendAdmission::GpuUnavailable(fallback.clone()),
        )
        .expect("admit declared preferred fallback");
        assert_eq!(
            preferred.plan.stages[2].requested_backend,
            Backend::NativeMetal
        );
        assert_eq!(
            preferred.plan.stages[2].effective_backend,
            Backend::ReferenceCpu
        );
        assert_eq!(preferred.plan.stages[2].fallback, Some(fallback.clone()));
        assert_eq!(
            preferred.plan.stages[2].partitions[0].fallback,
            Some(fallback)
        );

        let cpu = admit_cluster_v1_plan(
            &request(
                BackendPolicy::ReferenceCpu,
                100,
                1_000,
                MIN_COMPUTE_MEMORY_BYTES,
            ),
            100,
            &engines,
            SimilarityBackendAdmission::ReferenceCpu,
        )
        .expect("admit explicit reference CPU plan");
        assert_eq!(cpu.plan.stages[2].requested_backend, Backend::ReferenceCpu);
        assert_eq!(cpu.plan.stages[2].effective_backend, Backend::ReferenceCpu);
        assert!(cpu.plan.stages[2].fallback.is_none());
    }

    #[test]
    fn never_silently_falls_back_for_gpu_policies() {
        let unavailable = SimilarityBackendAdmission::GpuUnavailable(FallbackDecision {
            code: burrete_compute_protocol::FallbackReasonCode::CapabilityUnavailable,
            reason: "No verified Metal capability.".into(),
        });
        let required = admit_cluster_v1_plan(
            &request(BackendPolicy::GpuRequired, 2, 1, MIN_COMPUTE_MEMORY_BYTES),
            2,
            &test_engines(),
            unavailable,
        );
        assert!(matches!(
            required,
            Err(ClusterV1AdmissionError::GpuRequiredUnavailable(_))
        ));

        let silent_cpu = admit_cluster_v1_plan(
            &request(BackendPolicy::GpuPreferred, 2, 1, MIN_COMPUTE_MEMORY_BYTES),
            2,
            &test_engines(),
            SimilarityBackendAdmission::ReferenceCpu,
        );
        assert!(matches!(
            silent_cpu,
            Err(ClusterV1AdmissionError::BackendPolicyMismatch(_))
        ));
    }

    #[test]
    fn caps_admitted_edges_at_the_possible_undirected_pairs() {
        let admission = admit_cluster_v1_plan(
            &request(
                BackendPolicy::ReferenceCpu,
                2,
                1_000,
                MIN_COMPUTE_MEMORY_BYTES,
            ),
            2,
            &test_engines(),
            SimilarityBackendAdmission::ReferenceCpu,
        )
        .expect("admit two-record plan");
        assert_eq!(admission.memory.admitted_max_undirected_edges, 1);
    }

    #[test]
    fn admits_exact_memory_boundary_and_rejects_one_byte_less() {
        let record_count = 10_000;
        let max_edges = 500_000;
        let required = estimate_cluster_v1_memory(record_count, max_edges)
            .expect("estimate memory")
            .tanimoto_neighbors_bytes;
        assert!(required > MIN_COMPUTE_MEMORY_BYTES);

        let exact = admit_cluster_v1_plan(
            &request(
                BackendPolicy::ReferenceCpu,
                record_count,
                max_edges,
                required,
            ),
            record_count,
            &test_engines(),
            SimilarityBackendAdmission::ReferenceCpu,
        );
        assert!(exact.is_ok());

        let rejected = admit_cluster_v1_plan(
            &request(
                BackendPolicy::ReferenceCpu,
                record_count,
                max_edges,
                required - 1,
            ),
            record_count,
            &test_engines(),
            SimilarityBackendAdmission::ReferenceCpu,
        );
        assert_eq!(
            rejected,
            Err(ClusterV1AdmissionError::MemoryLimitExceeded {
                stage_id: "tanimotoNeighbors",
                required_bytes: required,
                limit_bytes: required - 1,
            })
        );
    }

    #[test]
    fn rejects_edge_limit_outside_the_request_contract() {
        let result = admit_cluster_v1_plan(
            &request(
                BackendPolicy::ReferenceCpu,
                2,
                MAX_UNDIRECTED_SIMILARITY_EDGES + 1,
                MIN_COMPUTE_MEMORY_BYTES,
            ),
            2,
            &test_engines(),
            SimilarityBackendAdmission::ReferenceCpu,
        );
        assert!(matches!(result, Err(ClusterV1AdmissionError::Contract(_))));
    }

    #[test]
    fn checked_estimator_rejects_arithmetic_overflow() {
        assert!(matches!(
            estimate_cluster_v1_memory(u64::MAX, 1),
            Err(ClusterV1AdmissionError::ArithmeticOverflow(_))
        ));
    }

    #[test]
    fn rejects_engine_identity_for_the_wrong_backend() {
        let mut engines = test_engines();
        engines.rdkit = test_engine("burrete-reference-cpu", '2');
        let result = admit_cluster_v1_plan(
            &request(BackendPolicy::ReferenceCpu, 2, 1, MIN_COMPUTE_MEMORY_BYTES),
            2,
            &engines,
            SimilarityBackendAdmission::ReferenceCpu,
        );
        assert!(matches!(result, Err(ClusterV1AdmissionError::Contract(_))));
    }

    fn request(
        policy: BackendPolicy,
        _record_count: u64,
        max_edges: u64,
        max_memory_bytes: u64,
    ) -> ClusterV1SubmitRequest {
        ClusterV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ClusterV1,
            source: GridSourceReference {
                document_id: "test-grid-document".into(),
                scope: GridScope::All(AllGridScope {}),
            },
            parameters: ClusterV1Parameters {
                fingerprint: FingerprintSettings {
                    algorithm: FingerprintAlgorithm::RdkitMorganBitV1,
                    rdkit_version: RdkitBaselineVersion::V2025_03_4,
                    radius: 2,
                    bit_count: 2_048,
                    use_chirality: true,
                    use_features: false,
                    sanitize: true,
                    input_order: FingerprintInputOrder::SourceRecord,
                },
                similarity: SimilaritySettings {
                    cutoff: SimilarityCutoff {
                        numerator: 4,
                        denominator: 5,
                    },
                },
                representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Interactive,
            },
            limits: ResourceLimits {
                max_edges,
                max_memory_bytes,
                max_dispatch_ms: 100,
            },
        }
    }

    fn test_engines() -> ClusterV1EngineIdentities {
        ClusterV1EngineIdentities {
            coordinator: test_engine("burrete-coordinator", '1'),
            rdkit: test_engine("rdkit", '2'),
            reference_cpu: test_engine("burrete-reference-cpu", '3'),
        }
    }

    fn test_engine(engine_id: &str, hash_digit: char) -> EngineIdentity {
        EngineIdentity {
            engine_id: engine_id.into(),
            version: "test-only-1.0.0".into(),
            manifest_sha256: test_only_hash(hash_digit),
        }
    }

    fn test_only_hash(digit: char) -> String {
        digit.to_string().repeat(64)
    }
}
