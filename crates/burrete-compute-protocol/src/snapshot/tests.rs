use super::*;
use crate::{
    ClusterV1Parameters, ComputeJobSchemaVersion, ExecutionPartition, ExecutionPlanVersion,
    ExecutionPolicy, FallbackReasonCode, FingerprintAlgorithm, FingerprintInputOrder,
    FingerprintSettings, FrozenSourceIdentity, GridSourceReference, MolecularSnapshotVersion,
    PackedFileDescriptor, RdkitBaselineVersion, RepresentativePolicy, ResourceLimits,
    ResultPackVersion, SchedulingPolicy, SelectedGridScope, SimilarityCutoff, SimilaritySettings,
};

const JOB_ID: Uuid = Uuid::from_u128(1);
const SNAPSHOT_ID: Uuid = Uuid::from_u128(2);
const RUNTIME: &str = "compute-runtime-1.0.0";
const RECORD_COUNT: u64 = 2;

#[test]
fn validates_a_fully_queued_snapshot() {
    assert_eq!(
        queued_snapshot(BackendPolicy::ReferenceCpu).validate(),
        Ok(())
    );
}

#[test]
fn validates_a_fully_succeeded_snapshot() {
    assert_eq!(
        succeeded_snapshot(BackendPolicy::ReferenceCpu).validate(),
        Ok(())
    );
}

#[test]
fn rejects_succeeded_cpu_trace_under_gpu_required() {
    let mut snapshot = succeeded_snapshot(BackendPolicy::GpuRequired);
    let stage = &mut snapshot.stages[2];
    stage.effective_backend = Backend::ReferenceCpu;
    stage.engine = engine(Backend::ReferenceCpu);
    stage.device = None;
    stage.kernel_id = None;
    stage.gpu_time_ms = None;
    stage.fallback = Some(FallbackDecision {
        code: FallbackReasonCode::CapabilityUnavailable,
        reason: "GPU became unavailable.".into(),
    });
    assert!(snapshot.validate().is_err());
}

#[test]
fn validates_an_ordinary_queued_to_preparing_successor() {
    let previous = queued_snapshot(BackendPolicy::ReferenceCpu);
    let mut current = previous.clone();
    current.revision += 1;
    current.state = JobState::Preparing;
    current.updated_at_ms = 110;
    current.stages[0] = running_stage(&current.plan.stages[0], 0, 101, 110);
    current.attempts = vec![attempt(
        &current.stages[0],
        AttemptState::Running,
        1,
        101,
        110,
        None,
        None,
    )];
    assert_eq!(current.validate_successor(&previous), Ok(()));
}

#[test]
fn allows_only_idempotent_interrupted_retry() {
    let previous = interrupted_snapshot(true);
    let current = retry_snapshot(&previous);
    assert_eq!(current.validate_successor(&previous), Ok(()));

    let non_idempotent = interrupted_snapshot(false);
    let rejected = retry_snapshot(&non_idempotent);
    assert!(rejected.validate_successor(&non_idempotent).is_err());
}

#[test]
fn partial_success_requires_a_non_empty_valid_result() {
    let mut snapshot = succeeded_snapshot(BackendPolicy::ReferenceCpu);
    snapshot.state = JobState::SucceededWithFailures;
    snapshot.outcome = Some(JobOutcomeSummary {
        successful_records: 0,
        failed_records: RECORD_COUNT,
    });
    assert!(snapshot.validate().is_err());
    snapshot.outcome = Some(JobOutcomeSummary {
        successful_records: 1,
        failed_records: 1,
    });
    assert_eq!(snapshot.validate(), Ok(()));
}

#[test]
fn validates_each_durable_stage_boundary() {
    let expected = [
        JobState::Preparing,
        JobState::Preparing,
        JobState::Running,
        JobState::Running,
        JobState::Validating,
        JobState::Publishing,
    ];
    for (stage_index, state) in expected.into_iter().enumerate() {
        assert_eq!(
            boundary_snapshot(BackendPolicy::ReferenceCpu, stage_index, false, state).validate(),
            Ok(()),
            "queued boundary for stage {stage_index}"
        );
        assert_eq!(
            boundary_snapshot(BackendPolicy::ReferenceCpu, stage_index, true, state).validate(),
            Ok(()),
            "running boundary for stage {stage_index}"
        );
    }
    assert_eq!(
        boundary_snapshot(BackendPolicy::GpuRequired, 2, false, JobState::WaitingGpu).validate(),
        Ok(())
    );
    assert_eq!(
        boundary_snapshot(BackendPolicy::GpuRequired, 2, true, JobState::Running).validate(),
        Ok(())
    );
}

#[test]
fn rejects_atomic_attempt_termination_and_retry() {
    let previous = boundary_snapshot(BackendPolicy::ReferenceCpu, 3, true, JobState::Running);
    let mut current = previous.clone();
    current.revision += 1;
    current.updated_at_ms = 220;
    let stage_id = current.stages[3].stage_id.clone();
    let failure = failure(&stage_id, ComputeErrorCode::WorkerCrashed, true);
    let prior_attempt = current.attempts.last_mut().expect("running attempt");
    prior_attempt.state = AttemptState::Interrupted;
    prior_attempt.heartbeat_at_ms = 205;
    prior_attempt.finished_at_ms = Some(205);
    prior_attempt.error = Some(failure);
    let mut retry = attempt(
        &current.stages[3],
        AttemptState::Running,
        2,
        206,
        220,
        None,
        Some("retryable interruption"),
    );
    retry.attempt_id = Uuid::from_u128(999);
    current.attempts.push(retry);
    current.stages[3].started_at_ms = previous.stages[3].started_at_ms;
    current.stages[3].updated_at_ms = Some(220);
    assert_eq!(current.validate(), Ok(()));
    assert!(current.validate_successor(&previous).is_err());
}

#[test]
fn rejects_multiple_retry_attempts_in_one_successor() {
    let previous = retry_snapshot(&interrupted_snapshot(true));
    let mut current = previous.clone();
    current.revision += 1;
    current.state = JobState::Preparing;
    current.updated_at_ms = 140;
    current.stages[0] = running_stage(&current.plan.stages[0], 0, 101, 140);

    let stage_id = current.stages[0].stage_id.clone();
    let failure = failure(&stage_id, ComputeErrorCode::WorkerCrashed, true);
    let mut second = attempt(
        &current.stages[0],
        AttemptState::Interrupted,
        2,
        121,
        130,
        Some(failure),
        Some("first durable retry"),
    );
    second.attempt_id = Uuid::from_u128(998);
    let mut third = attempt(
        &current.stages[0],
        AttemptState::Running,
        3,
        131,
        140,
        None,
        Some("second durable retry"),
    );
    third.attempt_id = Uuid::from_u128(999);
    current.attempts.extend([second, third]);

    assert_eq!(current.validate(), Ok(()));
    let mut detached_history = current.clone();
    detached_history.stages[0].started_at_ms = Some(131);
    assert!(detached_history.validate().is_err());
    assert!(current.validate_successor(&previous).is_err());
}

#[test]
fn rejects_retry_history_for_a_non_idempotent_stage() {
    let mut snapshot = boundary_snapshot(BackendPolicy::ReferenceCpu, 3, true, JobState::Running);
    snapshot.plan.stages[3].idempotent = false;
    snapshot.accepted_plan_sha256 = snapshot
        .plan
        .canonical_sha256()
        .expect("canonical non-idempotent plan hash");
    snapshot.stages[3].idempotent = false;
    let stage_id = snapshot.stages[3].stage_id.clone();
    let failure = failure(&stage_id, ComputeErrorCode::WorkerCrashed, true);
    let first = snapshot.attempts.last_mut().expect("running attempt");
    first.state = AttemptState::Interrupted;
    first.finished_at_ms = Some(first.heartbeat_at_ms);
    first.error = Some(failure);
    let mut retry = attempt(
        &snapshot.stages[3],
        AttemptState::Running,
        2,
        first.heartbeat_at_ms,
        snapshot.updated_at_ms,
        None,
        Some("retryable interruption"),
    );
    retry.attempt_id = Uuid::from_u128(999);
    snapshot.attempts.push(retry);
    assert!(snapshot.validate().is_err());
}

#[test]
fn freezes_gpu_device_kernel_and_runtime_identity() {
    let previous = boundary_snapshot(BackendPolicy::GpuRequired, 2, true, JobState::Running);
    let mut changed_trace = previous.clone();
    changed_trace.revision += 1;
    changed_trace.updated_at_ms = 220;
    changed_trace.state = JobState::Running;
    let stage = &mut changed_trace.stages[2];
    stage.state = StageState::Succeeded;
    stage.progress.completed_units = stage.progress.total_units;
    stage.device = Some("Different Apple GPU".into());
    stage.kernel_id = Some("different.kernel".into());
    stage.gpu_time_ms = Some(2.0);
    stage.host_time_ms = Some(3.0);
    stage.updated_at_ms = Some(210);
    stage.finished_at_ms = Some(210);
    changed_trace.progress.completed_units += 1;
    let attempt = changed_trace.attempts.last_mut().expect("running attempt");
    attempt.state = AttemptState::Succeeded;
    attempt.heartbeat_at_ms = 210;
    attempt.finished_at_ms = Some(210);
    assert_eq!(changed_trace.validate(), Ok(()));
    assert!(changed_trace.validate_successor(&previous).is_err());

    let mut changed_runtime = previous.clone();
    changed_runtime.revision += 1;
    changed_runtime.updated_at_ms += 1;
    changed_runtime.pinned_runtime.helper_sha256 = hash('9');
    changed_runtime.stages[2].updated_at_ms = Some(changed_runtime.updated_at_ms);
    changed_runtime
        .attempts
        .last_mut()
        .expect("running attempt")
        .heartbeat_at_ms = changed_runtime.updated_at_ms;
    assert_eq!(changed_runtime.validate(), Ok(()));
    assert!(changed_runtime.validate_successor(&previous).is_err());
}

#[test]
fn terminal_job_error_must_equal_stage_and_attempt_evidence() {
    let mut snapshot = interrupted_snapshot(true);
    snapshot.error.as_mut().expect("job error").message = "Different error".into();
    assert!(snapshot.validate().is_err());
}

#[test]
fn interrupted_job_can_be_cancelled_without_rewriting_stage_evidence() {
    let interrupted = interrupted_snapshot(true);

    let mut direct = interrupted.clone();
    direct.revision += 1;
    direct.state = JobState::Cancelled;
    direct.updated_at_ms = 120;
    direct.finished_at_ms = Some(120);
    direct.error = Some(cancellation());
    assert_eq!(direct.validate_successor(&interrupted), Ok(()));
    assert_eq!(direct.stages[0].state, StageState::Interrupted);

    let mut requested = interrupted.clone();
    requested.revision += 1;
    requested.state = JobState::CancelRequested;
    requested.updated_at_ms = 120;
    requested.error = None;
    assert_eq!(requested.validate_successor(&interrupted), Ok(()));

    let mut completed = requested.clone();
    completed.revision += 1;
    completed.state = JobState::Cancelled;
    completed.updated_at_ms = 130;
    completed.finished_at_ms = Some(130);
    completed.error = Some(cancellation());
    assert_eq!(completed.validate_successor(&requested), Ok(()));
    assert_eq!(completed.stages[0], interrupted.stages[0]);
}

#[test]
fn rejects_temporal_provenance_that_precedes_execution_evidence() {
    let mut early_job_finish = succeeded_snapshot(BackendPolicy::ReferenceCpu);
    early_job_finish.finished_at_ms = Some(140);
    assert!(early_job_finish.validate().is_err());

    let mut detached_stage = succeeded_snapshot(BackendPolicy::ReferenceCpu);
    detached_stage.stages[0].started_at_ms = Some(102);
    assert!(detached_stage.validate().is_err());
}

fn queued_snapshot(policy: BackendPolicy) -> JobSnapshot {
    let request = request(policy);
    let plan = plan(policy);
    let normalized_request_sha256 = request.canonical_sha256().expect("canonical request hash");
    let accepted_plan_sha256 = plan.canonical_sha256().expect("canonical plan hash");
    let stages = plan
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, stage)| queued_stage(stage, ordinal))
        .collect();
    JobSnapshot {
        schema_version: ComputeJobSnapshotSchemaVersion::V1,
        job_id: JOB_ID,
        revision: 1,
        owner_surface: OwnerSurface::Desktop,
        workflow_template: WorkflowTemplateId::ClusterV1,
        state: JobState::Queued,
        request,
        normalized_request_sha256,
        frozen_source: frozen_source(),
        progress: JobProgress {
            completed_units: 0,
            total_units: 6,
            message: "Queued".into(),
        },
        plan,
        accepted_plan_sha256,
        stages,
        attempts: Vec::new(),
        artifact_ids: Vec::new(),
        result_pack: None,
        outcome: None,
        pinned_runtime: runtime_identity(),
        error: None,
        created_at_ms: 100,
        updated_at_ms: 100,
        finished_at_ms: None,
    }
}

fn succeeded_snapshot(policy: BackendPolicy) -> JobSnapshot {
    let mut snapshot = queued_snapshot(policy);
    snapshot.revision = 20;
    snapshot.state = JobState::Succeeded;
    snapshot.progress = JobProgress {
        completed_units: 6,
        total_units: 6,
        message: "Completed".into(),
    };
    snapshot.updated_at_ms = 200;
    snapshot.finished_at_ms = Some(200);
    snapshot.stages = snapshot
        .plan
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, stage)| succeeded_stage(stage, ordinal, 101 + ordinal as u64 * 10))
        .collect();
    snapshot.attempts = snapshot
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, stage)| {
            let mut attempt = attempt(
                stage,
                AttemptState::Succeeded,
                1,
                stage.started_at_ms.expect("stage start"),
                stage.finished_at_ms.expect("stage finish"),
                None,
                None,
            );
            attempt.attempt_id = Uuid::from_u128(100 + ordinal as u128);
            attempt
        })
        .collect();
    snapshot.artifact_ids = vec![Uuid::from_u128(50)];
    snapshot.result_pack = Some(result_pack());
    snapshot.outcome = Some(JobOutcomeSummary {
        successful_records: RECORD_COUNT,
        failed_records: 0,
    });
    snapshot
}

fn interrupted_snapshot(idempotent: bool) -> JobSnapshot {
    let mut snapshot = queued_snapshot(BackendPolicy::ReferenceCpu);
    snapshot.revision = 2;
    snapshot.state = JobState::Interrupted;
    snapshot.updated_at_ms = 110;
    snapshot.plan.stages[0].idempotent = idempotent;
    snapshot.accepted_plan_sha256 = snapshot
        .plan
        .canonical_sha256()
        .expect("canonical interrupted plan hash");
    let failure = failure("freezeScope", ComputeErrorCode::WorkerCrashed, true);
    snapshot.stages[0] = interrupted_stage(&snapshot.plan.stages[0], 0, 101, 110, failure.clone());
    snapshot.attempts = vec![attempt(
        &snapshot.stages[0],
        AttemptState::Interrupted,
        1,
        101,
        110,
        Some(failure.clone()),
        None,
    )];
    snapshot.error = Some(failure);
    assert_eq!(snapshot.validate(), Ok(()));
    snapshot
}

fn retry_snapshot(previous: &JobSnapshot) -> JobSnapshot {
    let mut current = previous.clone();
    current.revision += 1;
    current.state = JobState::Preparing;
    current.updated_at_ms = 120;
    current.error = None;
    current.stages[0] = queued_stage(&current.plan.stages[0], 0);
    current
}

fn boundary_snapshot(
    policy: BackendPolicy,
    stage_index: usize,
    running: bool,
    state: JobState,
) -> JobSnapshot {
    let mut snapshot = queued_snapshot(policy);
    snapshot.revision = 10 + stage_index as u64;
    snapshot.state = state;
    snapshot.updated_at_ms = 200;
    snapshot.progress.completed_units = stage_index as u64;
    snapshot.progress.message = format!("Boundary {stage_index}");
    snapshot.stages = snapshot
        .plan
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, planned)| {
            if ordinal < stage_index {
                succeeded_stage(planned, ordinal, 101 + ordinal as u64 * 10)
            } else if ordinal == stage_index && running {
                running_stage(planned, ordinal, 101 + ordinal as u64 * 10, 200)
            } else {
                queued_stage(planned, ordinal)
            }
        })
        .collect();
    snapshot.attempts = snapshot
        .stages
        .iter()
        .enumerate()
        .filter(|(ordinal, _)| *ordinal < stage_index || (*ordinal == stage_index && running))
        .map(|(ordinal, stage)| {
            let attempt_state = if ordinal < stage_index {
                AttemptState::Succeeded
            } else {
                AttemptState::Running
            };
            let mut attempt = attempt(
                stage,
                attempt_state,
                1,
                stage.started_at_ms.expect("started stage"),
                stage.updated_at_ms.expect("updated stage"),
                None,
                None,
            );
            attempt.attempt_id = Uuid::from_u128(100 + ordinal as u128);
            attempt
        })
        .collect();
    snapshot
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

fn plan(policy: BackendPolicy) -> ExecutionPlan {
    let similarity = match policy {
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
            planned_stage("tanimotoNeighbors", StageKind::NumericCompute, similarity),
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

fn planned_stage(stage_id: &str, kind: StageKind, backend: Backend) -> crate::PlannedStage {
    crate::PlannedStage {
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

fn queued_stage(planned: &crate::PlannedStage, ordinal: usize) -> StageSnapshot {
    stage(planned, ordinal, StageState::Queued, 0, None, None, None)
}

fn running_stage(
    planned: &crate::PlannedStage,
    ordinal: usize,
    started: u64,
    updated: u64,
) -> StageSnapshot {
    stage(
        planned,
        ordinal,
        StageState::Running,
        0,
        Some(started),
        Some(updated),
        None,
    )
}

fn succeeded_stage(planned: &crate::PlannedStage, ordinal: usize, started: u64) -> StageSnapshot {
    let finished = started + 2;
    stage(
        planned,
        ordinal,
        StageState::Succeeded,
        1,
        Some(started),
        Some(finished),
        Some(finished),
    )
}

fn interrupted_stage(
    planned: &crate::PlannedStage,
    ordinal: usize,
    started: u64,
    finished: u64,
    error: ComputeFailure,
) -> StageSnapshot {
    let mut stage = stage(
        planned,
        ordinal,
        StageState::Interrupted,
        0,
        Some(started),
        Some(finished),
        Some(finished),
    );
    stage.error = Some(error);
    stage
}

fn stage(
    planned: &crate::PlannedStage,
    ordinal: usize,
    state: StageState,
    completed: u64,
    started_at_ms: Option<u64>,
    updated_at_ms: Option<u64>,
    finished_at_ms: Option<u64>,
) -> StageSnapshot {
    let gpu = planned.kind == StageKind::NumericCompute && planned.effective_backend.is_gpu();
    StageSnapshot {
        stage_id: planned.stage_id.clone(),
        ordinal: ordinal as u16,
        kind: planned.kind,
        idempotent: planned.idempotent,
        state,
        progress: JobProgress {
            completed_units: completed,
            total_units: 1,
            message: format!("{state:?}"),
        },
        requested_backend: planned.requested_backend,
        effective_backend: planned.effective_backend,
        engine: planned.engine.clone(),
        device: (gpu && state != StageState::Queued).then(|| "Apple GPU".into()),
        precision: planned.precision,
        kernel_id: (gpu && state != StageState::Queued).then(|| "tanimoto.v1".into()),
        gpu_time_ms: (gpu && state == StageState::Succeeded).then_some(1.0),
        host_time_ms: state.is_terminal().then_some(2.0),
        transferred_bytes: if state == StageState::Queued { 0 } else { 64 },
        fallback: planned.fallback.clone(),
        error: None,
        started_at_ms,
        updated_at_ms,
        finished_at_ms,
    }
}

fn attempt(
    stage: &StageSnapshot,
    state: AttemptState,
    attempt_number: u16,
    started: u64,
    heartbeat: u64,
    error: Option<ComputeFailure>,
    retry_reason: Option<&str>,
) -> AttemptSnapshot {
    AttemptSnapshot {
        attempt_id: Uuid::from_u128(100),
        stage_id: stage.stage_id.clone(),
        attempt_number,
        runtime_version: RUNTIME.into(),
        state,
        started_at_ms: started,
        heartbeat_at_ms: heartbeat,
        finished_at_ms: (state != AttemptState::Running).then_some(heartbeat),
        error,
        retry_reason: retry_reason.map(str::to_owned),
    }
}

fn failure(stage_id: &str, code: ComputeErrorCode, retryable: bool) -> ComputeFailure {
    ComputeFailure {
        code,
        message: "Worker interrupted.".into(),
        stage_id: Some(stage_id.into()),
        molecule_stable_id: None,
        retryable,
    }
}

fn cancellation() -> ComputeFailure {
    ComputeFailure {
        code: ComputeErrorCode::Cancelled,
        message: "Cancelled by owner.".into(),
        stage_id: None,
        molecule_stable_id: None,
        retryable: false,
    }
}

fn engine(backend: Backend) -> EngineIdentity {
    EngineIdentity {
        engine_id: match backend {
            Backend::Coordinator => "burrete-coordinator",
            Backend::Rdkit => "rdkit",
            Backend::NativeMetal => "burrete-native-metal",
            Backend::ReferenceCpu => "burrete-reference-cpu",
        }
        .into(),
        version: "1.0.0".into(),
        manifest_sha256: hash('e'),
    }
}

fn runtime_identity() -> RuntimeIdentity {
    RuntimeIdentity {
        version: RUNTIME.into(),
        manifest_sha256: hash('6'),
        helper_sha256: hash('7'),
        metallib_sha256: hash('8'),
    }
}

fn frozen_source() -> MolecularSnapshotRef {
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
        manifest: manifest_file("snapshot/manifest.json"),
    }
}

fn result_pack() -> ResultPackRef {
    ResultPackRef {
        schema_version: ResultPackVersion::ClusterV1,
        result_pack_id: Uuid::from_u128(51),
        result_pack_sha256: hash('1'),
        job_id: JOB_ID,
        workflow_template: WorkflowTemplateId::ClusterV1,
        snapshot_id: SNAPSHOT_ID,
        snapshot_sha256: hash('c'),
        manifest: manifest_file("result/manifest.json"),
    }
}

fn manifest_file(path: &str) -> PackedFileDescriptor {
    PackedFileDescriptor {
        relative_path: path.into(),
        sha256: hash('2'),
        byte_length: 128,
        media_type: "application/json".into(),
    }
}

fn hash(character: char) -> String {
    character.to_string().repeat(64)
}
