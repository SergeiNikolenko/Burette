use burrete_compute_protocol::{
    ClusterV1SubmitRequest, ComputeJobSnapshotSchemaVersion, ConformerV1SubmitRequest,
    ExecutionPlan, JobProgress, JobSnapshot, JobState, MolecularSnapshotRef, OwnerSurface,
    RuntimeIdentity, StageSnapshot, StageState, WorkflowTemplateId, CLUSTER_STAGE_IDS,
    CONFORMER_STAGE_IDS,
};
use uuid::Uuid;

use super::cluster_plan::{
    admit_cluster_v1_plan, ClusterV1AdmissionError, ClusterV1EngineIdentities,
    SimilarityBackendAdmission,
};
use super::conformer_plan::{
    admit_conformer_v1_plan, ConformerBackendAdmission, ConformerV1AdmissionError,
    ConformerV1Preflight,
};

/// Opaque proof that the snapshot repository bound a normalized request to
/// the published manifest and its capability-rooted files.
///
/// The only production constructor is called by the snapshot repository after
/// it has verified the published capability and rebound the exact request.
/// Accepting a bare `MolecularSnapshotRef` at submission would permit
/// same-count provenance swaps.
#[derive(Clone, Debug)]
pub(crate) struct VerifiedClusterV1Source {
    request: ClusterV1SubmitRequest,
    frozen_source: MolecularSnapshotRef,
}

#[derive(Clone, Debug)]
#[allow(
    dead_code,
    reason = "constructed by conformer coordinator activation in the next staged increment"
)]
pub(crate) struct VerifiedConformerV1Source {
    request: ConformerV1SubmitRequest,
    frozen_source: MolecularSnapshotRef,
}

impl VerifiedConformerV1Source {
    #[allow(
        dead_code,
        reason = "called by conformer snapshot binding before coordinator activation"
    )]
    pub(super) fn from_verified_repository(
        request: ConformerV1SubmitRequest,
        frozen_source: MolecularSnapshotRef,
    ) -> Self {
        Self {
            request,
            frozen_source,
        }
    }
}

impl VerifiedClusterV1Source {
    pub(super) fn from_verified_repository(
        request: ClusterV1SubmitRequest,
        frozen_source: MolecularSnapshotRef,
    ) -> Self {
        Self {
            request,
            frozen_source,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct QueuedClusterV1JobInput {
    pub(crate) job_id: Uuid,
    pub(crate) owner_surface: OwnerSurface,
    pub(crate) source: VerifiedClusterV1Source,
    /// Runtime identity returned by the verified runtime installation boundary.
    pub(crate) pinned_runtime: RuntimeIdentity,
    /// Engine identities returned by verified engine manifests.
    pub(crate) engines: ClusterV1EngineIdentities,
    pub(crate) similarity_admission: SimilarityBackendAdmission,
    pub(crate) created_at_ms: u64,
}

pub(crate) fn build_queued_cluster_v1_job(
    input: QueuedClusterV1JobInput,
) -> Result<JobSnapshot, ClusterV1AdmissionError> {
    let VerifiedClusterV1Source {
        request,
        frozen_source,
    } = input.source;
    let request = request.normalized()?;
    frozen_source.validate()?;
    input.pinned_runtime.validate()?;

    let admitted = admit_cluster_v1_plan(
        &request,
        frozen_source.frozen_source.record_count,
        &input.engines,
        input.similarity_admission,
    )?;
    let normalized_request_sha256 = request.canonical_sha256()?;
    let accepted_plan_sha256 = admitted.plan.canonical_sha256()?;
    let stages = queued_stages(&admitted.plan);
    let snapshot = JobSnapshot {
        schema_version: ComputeJobSnapshotSchemaVersion::V1,
        job_id: input.job_id,
        revision: 1,
        owner_surface: input.owner_surface,
        workflow_template: WorkflowTemplateId::ClusterV1,
        state: JobState::Queued,
        request: request.into(),
        normalized_request_sha256,
        frozen_source,
        progress: JobProgress {
            completed_units: 0,
            total_units: CLUSTER_STAGE_IDS.len() as u64,
            message: "Queued".into(),
        },
        plan: admitted.plan,
        accepted_plan_sha256,
        stages,
        attempts: Vec::new(),
        artifact_ids: Vec::new(),
        result_pack: None,
        outcome: None,
        pinned_runtime: input.pinned_runtime,
        error: None,
        created_at_ms: input.created_at_ms,
        updated_at_ms: input.created_at_ms,
        finished_at_ms: None,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

#[derive(Clone, Debug)]
#[allow(
    dead_code,
    reason = "constructed by conformer coordinator activation in the next staged increment"
)]
pub(crate) struct QueuedConformerV1JobInput {
    pub(crate) job_id: Uuid,
    pub(crate) owner_surface: OwnerSurface,
    pub(crate) source: VerifiedConformerV1Source,
    pub(crate) preflight: ConformerV1Preflight,
    pub(crate) pinned_runtime: RuntimeIdentity,
    pub(crate) engines: ClusterV1EngineIdentities,
    pub(crate) distance_admission: ConformerBackendAdmission,
    pub(crate) stereo_admission: ConformerBackendAdmission,
    pub(crate) created_at_ms: u64,
}

#[allow(
    dead_code,
    reason = "called by conformer coordinator activation in the next staged increment"
)]
pub(crate) fn build_queued_conformer_v1_job(
    input: QueuedConformerV1JobInput,
) -> Result<JobSnapshot, ConformerV1AdmissionError> {
    let VerifiedConformerV1Source {
        request,
        frozen_source,
    } = input.source;
    let request = request.normalized()?;
    frozen_source.validate()?;
    input.pinned_runtime.validate()?;

    let admitted = admit_conformer_v1_plan(
        &request,
        frozen_source.frozen_source.record_count,
        input.preflight,
        &input.engines,
        input.distance_admission,
        input.stereo_admission,
    )?;
    let normalized_request_sha256 = request.canonical_sha256()?;
    let accepted_plan_sha256 = admitted.plan.canonical_sha256()?;
    let stages = queued_stages(&admitted.plan);
    let snapshot = JobSnapshot {
        schema_version: ComputeJobSnapshotSchemaVersion::V1,
        job_id: input.job_id,
        revision: 1,
        owner_surface: input.owner_surface,
        workflow_template: WorkflowTemplateId::ConformerV1,
        state: JobState::Queued,
        request: request.into(),
        normalized_request_sha256,
        frozen_source,
        progress: JobProgress {
            completed_units: 0,
            total_units: CONFORMER_STAGE_IDS.len() as u64,
            message: "Queued".into(),
        },
        plan: admitted.plan,
        accepted_plan_sha256,
        stages,
        attempts: Vec::new(),
        artifact_ids: Vec::new(),
        result_pack: None,
        outcome: None,
        pinned_runtime: input.pinned_runtime,
        error: None,
        created_at_ms: input.created_at_ms,
        updated_at_ms: input.created_at_ms,
        finished_at_ms: None,
    };
    snapshot.validate()?;
    Ok(snapshot)
}

fn queued_stages(plan: &ExecutionPlan) -> Vec<StageSnapshot> {
    plan.stages
        .iter()
        .enumerate()
        .map(|(ordinal, stage)| StageSnapshot {
            stage_id: stage.stage_id.clone(),
            ordinal: ordinal as u16,
            kind: stage.kind,
            idempotent: stage.idempotent,
            state: StageState::Queued,
            progress: JobProgress {
                completed_units: 0,
                total_units: 1,
                message: "Queued".into(),
            },
            requested_backend: stage.requested_backend,
            effective_backend: stage.effective_backend,
            engine: stage.engine.clone(),
            device: None,
            precision: stage.precision,
            kernel_id: None,
            gpu_time_ms: None,
            host_time_ms: None,
            transferred_bytes: 0,
            fallback: stage.fallback.clone(),
            error: None,
            started_at_ms: None,
            updated_at_ms: None,
            finished_at_ms: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute::cluster_plan::{ClusterV1EngineIdentities, SimilarityBackendAdmission};
    use burrete_compute_protocol::{
        Backend, BackendPolicy, ClusterV1Parameters, ComputeJobSchemaVersion,
        ConformerResourceLimits, ConformerV1Parameters, ConformerVariant, EngineIdentity,
        ExecutionPolicy, FallbackDecision, FallbackReasonCode, FingerprintAlgorithm,
        FingerprintInputOrder, FingerprintSettings, FrozenSourceIdentity, GridScope,
        GridSourceReference, MolecularSnapshotVersion, PackedFileDescriptor, RdkitBaselineVersion,
        RepresentativePolicy, ResourceLimits, RuntimeIdentity, SchedulingPolicy, SelectedGridScope,
        SimilarityCutoff, SimilaritySettings, MIN_COMPUTE_MEMORY_BYTES,
    };

    #[test]
    fn builds_valid_revision_one_queued_snapshot_with_canonical_hashes() {
        let snapshot = build_queued_cluster_v1_job(input(BackendPolicy::GpuRequired))
            .expect("build queued cluster job");

        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.state, JobState::Queued);
        assert_eq!(snapshot.stages.len(), CLUSTER_STAGE_IDS.len());
        assert_eq!(
            snapshot.normalized_request_sha256,
            snapshot
                .request
                .canonical_sha256()
                .expect("canonical request hash")
        );
        assert_eq!(
            snapshot.accepted_plan_sha256,
            snapshot
                .plan
                .canonical_sha256()
                .expect("canonical plan hash")
        );
        assert_eq!(snapshot.validate(), Ok(()));
    }

    #[test]
    fn normalizes_request_before_hashing_and_persistence() {
        let mut input = input(BackendPolicy::ReferenceCpu);
        input.source.request.source.scope = GridScope::Selected(SelectedGridScope {
            source_indexes: vec![2, 0, 2, 1],
        });
        input.similarity_admission = SimilarityBackendAdmission::ReferenceCpu;

        let snapshot = build_queued_cluster_v1_job(input).expect("normalize queued request");
        assert_eq!(
            snapshot.request.source().scope,
            GridScope::Selected(SelectedGridScope {
                source_indexes: vec![0, 1, 2]
            })
        );
    }

    #[test]
    fn queued_job_never_claims_device_kernel_or_timing_evidence() {
        let snapshot = build_queued_cluster_v1_job(input(BackendPolicy::GpuRequired))
            .expect("build queued GPU job");
        assert_eq!(
            snapshot.plan.stages[2].effective_backend,
            Backend::NativeMetal
        );
        assert!(snapshot.stages.iter().all(|stage| {
            stage.device.is_none()
                && stage.kernel_id.is_none()
                && stage.gpu_time_ms.is_none()
                && stage.host_time_ms.is_none()
                && stage.transferred_bytes == 0
                && stage.started_at_ms.is_none()
                && stage.updated_at_ms.is_none()
                && stage.finished_at_ms.is_none()
        }));
    }

    #[test]
    fn preserves_caller_supplied_runtime_and_engine_identities() {
        let input = input(BackendPolicy::GpuRequired);
        let expected_runtime = input.pinned_runtime.clone();
        let expected_metal = match &input.similarity_admission {
            SimilarityBackendAdmission::NativeMetal(engine) => engine.clone(),
            _ => panic!("test input requires native Metal"),
        };
        let snapshot = build_queued_cluster_v1_job(input).expect("build queued GPU job");

        assert_eq!(snapshot.pinned_runtime, expected_runtime);
        assert_eq!(snapshot.plan.stages[2].engine, expected_metal);
    }

    #[test]
    fn rejects_invalid_runtime_identity_instead_of_synthesizing_one() {
        let mut input = input(BackendPolicy::GpuRequired);
        input.pinned_runtime.metallib_sha256 = Some("not-a-hash".into());
        assert!(matches!(
            build_queued_cluster_v1_job(input),
            Err(ClusterV1AdmissionError::Contract(_))
        ));
    }

    #[test]
    fn rejects_nil_job_id_and_nonpositive_creation_time() {
        let mut nil_id = input(BackendPolicy::GpuRequired);
        nil_id.job_id = Uuid::nil();
        assert!(matches!(
            build_queued_cluster_v1_job(nil_id),
            Err(ClusterV1AdmissionError::Contract(_))
        ));

        let mut zero_time = input(BackendPolicy::GpuRequired);
        zero_time.created_at_ms = 0;
        assert!(matches!(
            build_queued_cluster_v1_job(zero_time),
            Err(ClusterV1AdmissionError::Contract(_))
        ));
    }

    #[test]
    fn builds_durable_conformer_snapshot_with_honest_mixed_backends() {
        let fallback = FallbackDecision {
            code: FallbackReasonCode::CapabilityUnavailable,
            reason: "Verified stereo-validation Metal kernel is not installed.".into(),
        };
        let snapshot = build_queued_conformer_v1_job(QueuedConformerV1JobInput {
            job_id: Uuid::from_u128(0x300),
            owner_surface: OwnerSurface::Desktop,
            source: VerifiedConformerV1Source {
                request: conformer_request(BackendPolicy::GpuPreferred),
                frozen_source: frozen_source(),
            },
            preflight: ConformerV1Preflight {
                record_count: 3,
                valid_record_count: 3,
                total_atom_count: 12,
                total_distance_constraint_count: 24,
                engine_pack_bytes: 4_096,
                result_pack_bytes: 4_096,
                numeric_peak_bytes: 1024 * 1024,
            },
            pinned_runtime: RuntimeIdentity {
                version: "test-only-runtime-1.0.0".into(),
                manifest_sha256: test_only_hash('a'),
                helper_sha256: test_only_hash('b'),
                metallib_sha256: Some(test_only_hash('c')),
            },
            engines: ClusterV1EngineIdentities {
                coordinator: test_engine("burrete-coordinator", '1'),
                rdkit: test_engine("rdkit", '2'),
                reference_cpu: test_engine("burrete-reference-cpu", '3'),
            },
            distance_admission: ConformerBackendAdmission::NativeMetal(test_engine(
                "burrete-native-metal",
                '4',
            )),
            stereo_admission: ConformerBackendAdmission::GpuUnavailable(fallback.clone()),
            created_at_ms: 100,
        })
        .expect("build queued conformer job");

        assert_eq!(snapshot.workflow_template, WorkflowTemplateId::ConformerV1);
        assert_eq!(snapshot.stages.len(), CONFORMER_STAGE_IDS.len());
        assert_eq!(
            snapshot.plan.stages[2].effective_backend,
            Backend::NativeMetal
        );
        assert_eq!(
            snapshot.plan.stages[3].effective_backend,
            Backend::ReferenceCpu
        );
        assert_eq!(snapshot.plan.stages[3].fallback, Some(fallback));
        assert_eq!(snapshot.validate(), Ok(()));
        assert_eq!(
            snapshot.normalized_request_sha256,
            snapshot.request.canonical_sha256().expect("request hash")
        );
        let encoded = serde_json::to_string(&snapshot).expect("encode durable conformer snapshot");
        let decoded: JobSnapshot =
            serde_json::from_str(&encoded).expect("decode durable conformer snapshot");
        assert_eq!(decoded, snapshot);
        assert_eq!(decoded.validate(), Ok(()));
    }

    fn input(policy: BackendPolicy) -> QueuedClusterV1JobInput {
        QueuedClusterV1JobInput {
            job_id: Uuid::from_u128(0x100),
            owner_surface: OwnerSurface::Desktop,
            source: VerifiedClusterV1Source {
                request: request(policy),
                frozen_source: frozen_source(),
            },
            pinned_runtime: RuntimeIdentity {
                version: "test-only-runtime-1.0.0".into(),
                manifest_sha256: test_only_hash('a'),
                helper_sha256: test_only_hash('b'),
                metallib_sha256: Some(test_only_hash('c')),
            },
            engines: ClusterV1EngineIdentities {
                coordinator: test_engine("burrete-coordinator", '1'),
                rdkit: test_engine("rdkit", '2'),
                reference_cpu: test_engine("burrete-reference-cpu", '3'),
            },
            similarity_admission: match policy {
                BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => {
                    SimilarityBackendAdmission::NativeMetal(test_engine(
                        "burrete-native-metal",
                        '4',
                    ))
                }
                BackendPolicy::ReferenceCpu => SimilarityBackendAdmission::ReferenceCpu,
            },
            created_at_ms: 100,
        }
    }

    fn request(policy: BackendPolicy) -> ClusterV1SubmitRequest {
        ClusterV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ClusterV1,
            source: GridSourceReference {
                document_id: "test-grid-document".into(),
                scope: GridScope::Selected(SelectedGridScope {
                    source_indexes: vec![2, 0, 1],
                }),
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
                        numerator: 8,
                        denominator: 10,
                    },
                },
                representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Interactive,
            },
            limits: ResourceLimits {
                max_edges: 1_000,
                max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
                max_dispatch_ms: 100,
            },
        }
    }

    fn conformer_request(policy: BackendPolicy) -> ConformerV1SubmitRequest {
        ConformerV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ConformerV1,
            source: GridSourceReference {
                document_id: "test-grid-document".into(),
                scope: GridScope::Selected(SelectedGridScope {
                    source_indexes: vec![2, 0, 1],
                }),
            },
            parameters: ConformerV1Parameters {
                variant: ConformerVariant::EtkdgV3,
                conformers_per_molecule: 4,
                max_attempts_per_conformer: 8,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: policy,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ConformerResourceLimits {
                max_memory_bytes: MIN_COMPUTE_MEMORY_BYTES,
                max_dispatch_ms: 100,
                max_conformers_per_batch: 64,
            },
        }
    }

    fn frozen_source() -> MolecularSnapshotRef {
        MolecularSnapshotRef {
            schema_version: MolecularSnapshotVersion::V1,
            snapshot_id: Uuid::from_u128(0x200),
            snapshot_sha256: test_only_hash('5'),
            frozen_source: FrozenSourceIdentity {
                document_fingerprint_sha256: test_only_hash('6'),
                source_revision: 1,
                record_count: 3,
                ordered_record_molecule_identity_sha256: test_only_hash('7'),
            },
            manifest: PackedFileDescriptor {
                relative_path: "snapshot/manifest.json".into(),
                sha256: test_only_hash('8'),
                byte_length: 128,
                media_type: "application/json".into(),
            },
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
