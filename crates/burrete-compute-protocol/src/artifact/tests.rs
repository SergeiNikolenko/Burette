use super::*;
use crate::{
    AttemptSnapshot, AttemptState, ClusterV1Parameters, ClusterV1SubmitRequest,
    ComputeJobSchemaVersion, ComputeJobSnapshotSchemaVersion, ExecutionPartition, ExecutionPlan,
    ExecutionPlanVersion, ExecutionPolicy, FingerprintAlgorithm, FingerprintInputOrder,
    FingerprintSettings, FrozenSourceIdentity, GridScope, GridSourceReference, JobOutcomeSummary,
    JobProgress, MolecularSnapshotVersion, OwnerSurface, PackedFileDescriptor, PlannedStage,
    RdkitBaselineVersion, RepresentativePolicy, ResourceLimits, SchedulingPolicy,
    SelectedGridScope, SimilarityCutoff, SimilaritySettings, StageSnapshot,
};

const JOB_ID: Uuid = Uuid::from_u128(1);
const SNAPSHOT_ID: Uuid = Uuid::from_u128(2);
const ARTIFACT_ID: Uuid = Uuid::from_u128(3);
const RESULT_PACK_ID: Uuid = Uuid::from_u128(4);
const RUNTIME_VERSION: &str = "compute-runtime-1.0.0";
const RECORD_COUNT: u64 = 2;
const EMPTY_JSON_SHA256: &str = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

#[test]
fn validates_and_binds_complete_provenance_to_a_successful_job() {
    let job = successful_job(BackendPolicy::GpuRequired);
    let manifest = manifest_for(&job);
    assert_eq!(job.validate(), Ok(()));
    assert_eq!(manifest.validate(), Ok(()));
    assert_eq!(manifest.validate_against_job(&job), Ok(()));

    let mut unknown = serde_json::to_value(&manifest).expect("serialize artifact manifest");
    unknown["unexpected"] = serde_json::json!(true);
    assert!(serde_json::from_value::<ArtifactManifest>(unknown).is_err());

    let mut wrong_plan = manifest.clone();
    wrong_plan.accepted_plan_sha256 = hash('9');
    assert_eq!(wrong_plan.validate(), Ok(()));
    assert!(wrong_plan.validate_against_job(&job).is_err());

    let mut wrong_runtime = manifest.clone();
    wrong_runtime.runtime.version = "compute-runtime-2.0.0".into();
    assert_eq!(wrong_runtime.validate(), Ok(()));
    assert!(wrong_runtime.validate_against_job(&job).is_err());

    let mut wrong_result = manifest.clone();
    wrong_result.result_pack.result_pack_id = Uuid::from_u128(99);
    assert_eq!(wrong_result.validate(), Ok(()));
    assert!(wrong_result.validate_against_job(&job).is_err());

    let mut cpu_trace = manifest.clone();
    let numeric = &mut cpu_trace.stages[2];
    numeric.effective_backend = Backend::ReferenceCpu;
    numeric.engine = engine(Backend::ReferenceCpu);
    numeric.device = None;
    numeric.kernel_id = None;
    numeric.gpu_time_ms = None;
    numeric.fallback = Some(crate::FallbackDecision {
        code: crate::FallbackReasonCode::CapabilityUnavailable,
        reason: "GPU became unavailable.".into(),
    });
    assert_eq!(cpu_trace.validate(), Ok(()));
    assert!(cpu_trace.validate_against_job(&job).is_err());
}

#[test]
fn rejects_noncanonical_files_hashes_and_unsafe_numbers() {
    let job = successful_job(BackendPolicy::ReferenceCpu);
    let manifest = manifest_for(&job);

    let mut escaped = manifest.clone();
    escaped.files[0].relative_path = "../manifest.json".into();
    assert!(escaped.validate().is_err());

    let mut uppercase_hash = manifest.clone();
    uppercase_hash.files[0].sha256 = "A".repeat(64);
    assert!(uppercase_hash.validate().is_err());

    let mut duplicate = manifest.clone();
    duplicate.files.push(duplicate.files[0].clone());
    assert!(duplicate.validate().is_err());

    let mut unsafe_time = manifest;
    unsafe_time.created_at_ms = 9_007_199_254_740_992;
    assert!(unsafe_time.validate().is_err());
}

#[test]
fn artifact_creation_is_bound_to_the_publish_boundary() {
    let job = successful_job(BackendPolicy::ReferenceCpu);
    let mut manifest = manifest_for(&job);
    manifest.created_at_ms = job.created_at_ms;
    assert!(manifest.validate_against_job(&job).is_err());

    manifest.created_at_ms = job.finished_at_ms.expect("job finish");
    assert!(manifest.validate_against_job(&job).is_err());
}

fn manifest_for(job: &JobSnapshot) -> ArtifactManifest {
    let result_pack = job.result_pack.clone().expect("successful result pack");
    ArtifactManifest {
        schema_version: ArtifactManifestSchemaVersion::V1,
        artifact_id: ARTIFACT_ID,
        job_id: job.job_id,
        workflow_template: job.workflow_template,
        molecular_snapshot: job.frozen_source.clone(),
        normalized_request_sha256: job.normalized_request_sha256.clone(),
        accepted_plan_sha256: job.accepted_plan_sha256.clone(),
        runtime: runtime(),
        files: vec![ArtifactFile {
            role: "resultPackManifest".into(),
            relative_path: result_pack.manifest.relative_path.clone(),
            sha256: result_pack.manifest.sha256.clone(),
            byte_count: result_pack.manifest.byte_length,
            media_type: result_pack.manifest.media_type.clone(),
        }],
        stages: job
            .stages
            .iter()
            .map(|stage| StageProvenance {
                stage_id: stage.stage_id.clone(),
                kind: stage.kind,
                engine: stage.engine.clone(),
                requested_backend: stage.requested_backend,
                effective_backend: stage.effective_backend,
                precision: stage.precision,
                device: stage.device.clone(),
                kernel_id: stage.kernel_id.clone(),
                gpu_time_ms: stage.gpu_time_ms,
                host_time_ms: stage.host_time_ms.expect("successful host timing"),
                transferred_bytes: stage.transferred_bytes,
                fallback: stage.fallback.clone(),
            })
            .collect(),
        result_pack,
        created_at_ms: job
            .stages
            .last()
            .and_then(|stage| stage.finished_at_ms)
            .expect("successful publish finish time"),
    }
}

fn successful_job(policy: BackendPolicy) -> JobSnapshot {
    let request = request(policy);
    let normalized_request_sha256 = request.canonical_sha256().expect("canonical request hash");
    let plan = execution_plan(policy);
    let accepted_plan_sha256 = plan.canonical_sha256().expect("canonical plan hash");
    let stages: Vec<_> = plan
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, planned)| successful_stage(planned, ordinal))
        .collect();
    let attempts = stages
        .iter()
        .enumerate()
        .map(|(ordinal, stage)| AttemptSnapshot {
            attempt_id: Uuid::from_u128(100 + ordinal as u128),
            stage_id: stage.stage_id.clone(),
            attempt_number: 1,
            runtime_version: RUNTIME_VERSION.into(),
            state: AttemptState::Succeeded,
            started_at_ms: stage.started_at_ms.expect("stage start"),
            heartbeat_at_ms: stage.finished_at_ms.expect("stage finish"),
            finished_at_ms: stage.finished_at_ms,
            error: None,
            retry_reason: None,
        })
        .collect();
    JobSnapshot {
        schema_version: ComputeJobSnapshotSchemaVersion::V1,
        job_id: JOB_ID,
        revision: 20,
        owner_surface: OwnerSurface::Desktop,
        workflow_template: WorkflowTemplateId::ClusterV1,
        state: JobState::Succeeded,
        request,
        normalized_request_sha256,
        frozen_source: molecular_snapshot(),
        progress: JobProgress {
            completed_units: 6,
            total_units: 6,
            message: "Completed".into(),
        },
        plan,
        accepted_plan_sha256,
        stages,
        attempts,
        artifact_ids: vec![ARTIFACT_ID],
        result_pack: Some(result_pack()),
        outcome: Some(JobOutcomeSummary {
            successful_records: RECORD_COUNT,
            failed_records: 0,
        }),
        pinned_runtime: runtime(),
        error: None,
        created_at_ms: 100,
        updated_at_ms: 200,
        finished_at_ms: Some(200),
    }
}

fn request(policy: BackendPolicy) -> ClusterV1SubmitRequest {
    ClusterV1SubmitRequest {
        schema_version: ComputeJobSchemaVersion::V1,
        workflow_template: WorkflowTemplateId::ClusterV1,
        source: GridSourceReference {
            document_id: "grid-document".into(),
            scope: GridScope::Selected(SelectedGridScope {
                source_indexes: vec![0, 1],
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
            max_edges: 1_000,
            max_memory_bytes: 16 * 1024 * 1024,
            max_dispatch_ms: 100,
        },
    }
}

fn execution_plan(policy: BackendPolicy) -> ExecutionPlan {
    let similarity_backend = match policy {
        BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
        BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
    };
    ExecutionPlan {
        workflow_template: WorkflowTemplateId::ClusterV1,
        plan_version: ExecutionPlanVersion::ClusterV1,
        backend_policy: policy,
        stages: vec![
            planned_stage("freezeScope", StageKind::Materialize, Backend::Coordinator),
            planned_stage(
                "fingerprints",
                StageKind::ChemistrySemantics,
                Backend::Rdkit,
            ),
            planned_stage(
                "tanimotoNeighbors",
                StageKind::NumericCompute,
                similarity_backend,
            ),
            planned_stage(
                "butinaClusters",
                StageKind::WorkflowSemantics,
                Backend::ReferenceCpu,
            ),
            planned_stage(
                "validateResults",
                StageKind::Validation,
                Backend::ReferenceCpu,
            ),
            planned_stage(
                "publishResults",
                StageKind::ArtifactIo,
                Backend::Coordinator,
            ),
        ],
    }
}

fn planned_stage(stage_id: &str, kind: StageKind, backend: Backend) -> PlannedStage {
    PlannedStage {
        stage_id: stage_id.into(),
        kind,
        idempotent: true,
        requested_backend: backend,
        effective_backend: backend,
        precision: if matches!(kind, StageKind::Materialize | StageKind::ArtifactIo) {
            Precision::NotApplicable
        } else {
            Precision::IntegerExact
        },
        engine: engine(backend),
        estimated_memory_bytes: 1_024,
        fallback: None,
        partitions: vec![ExecutionPartition {
            partition_id: "all".into(),
            chemistry_domain: "cluster.v1/all".into(),
            record_count: RECORD_COUNT,
            estimated_memory_bytes: 1_024,
            requested_backend: backend,
            effective_backend: backend,
            fallback: None,
        }],
    }
}

fn successful_stage(planned: &PlannedStage, ordinal: usize) -> StageSnapshot {
    let started = 101 + ordinal as u64 * 10;
    let finished = started + 2;
    let gpu = planned.kind == StageKind::NumericCompute && planned.effective_backend.is_gpu();
    StageSnapshot {
        stage_id: planned.stage_id.clone(),
        ordinal: ordinal as u16,
        kind: planned.kind,
        idempotent: planned.idempotent,
        state: StageState::Succeeded,
        progress: JobProgress {
            completed_units: 1,
            total_units: 1,
            message: "Succeeded".into(),
        },
        requested_backend: planned.requested_backend,
        effective_backend: planned.effective_backend,
        engine: planned.engine.clone(),
        device: gpu.then(|| "Apple GPU".into()),
        precision: planned.precision,
        kernel_id: gpu.then(|| "tanimoto.v1".into()),
        gpu_time_ms: gpu.then_some(1.0),
        host_time_ms: Some(2.0),
        transferred_bytes: 64,
        fallback: planned.fallback.clone(),
        error: None,
        started_at_ms: Some(started),
        updated_at_ms: Some(finished),
        finished_at_ms: Some(finished),
    }
}

fn engine(backend: Backend) -> EngineIdentity {
    EngineIdentity {
        engine_id: match backend {
            Backend::Coordinator => "burrete-coordinator",
            Backend::Rdkit => "rdkit",
            Backend::NativeMetal => "burrete-native-metal",
            Backend::Mlx => "burrete-mlx",
            Backend::ReferenceCpu => "burrete-reference-cpu",
        }
        .into(),
        version: "1.0.0".into(),
        manifest_sha256: hash('e'),
    }
}

fn runtime() -> RuntimeIdentity {
    RuntimeIdentity {
        version: RUNTIME_VERSION.into(),
        manifest_sha256: hash('5'),
        helper_sha256: hash('6'),
        metallib_sha256: hash('7'),
    }
}

fn molecular_snapshot() -> MolecularSnapshotRef {
    MolecularSnapshotRef {
        schema_version: MolecularSnapshotVersion::V1,
        snapshot_id: SNAPSHOT_ID,
        snapshot_sha256: hash('c'),
        frozen_source: FrozenSourceIdentity {
            document_fingerprint_sha256: hash('d'),
            source_revision: 1,
            record_count: RECORD_COUNT,
            ordered_record_molecule_identity_sha256: hash('f'),
        },
        manifest: packed_file("snapshot/manifest.json", hash('8'), 128),
    }
}

fn result_pack() -> ResultPackRef {
    ResultPackRef {
        schema_version: ResultPackVersion::ClusterV1,
        result_pack_id: RESULT_PACK_ID,
        result_pack_sha256: hash('1'),
        job_id: JOB_ID,
        workflow_template: WorkflowTemplateId::ClusterV1,
        snapshot_id: SNAPSHOT_ID,
        snapshot_sha256: hash('c'),
        manifest: packed_file("result/manifest.json", EMPTY_JSON_SHA256.into(), 2),
    }
}

fn packed_file(path: &str, sha256: String, byte_length: u64) -> PackedFileDescriptor {
    PackedFileDescriptor {
        relative_path: path.into(),
        sha256,
        byte_length,
        media_type: "application/json".into(),
    }
}

fn hash(character: char) -> String {
    character.to_string().repeat(64)
}
