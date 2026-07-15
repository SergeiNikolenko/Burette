use std::{fs, path::PathBuf, sync::Arc};

use burrete_compute_protocol::{
    AttemptSnapshot, AttemptState, Backend, BackendPolicy, ClusterV1Parameters,
    ClusterV1SubmitRequest, ComputeJobSchemaVersion, ComputeJobSnapshotSchemaVersion,
    EngineIdentity, ExecutionPartition, ExecutionPlan, ExecutionPlanVersion, ExecutionPolicy,
    FingerprintAlgorithm, FingerprintInputOrder, FingerprintSettings, FrozenSourceIdentity,
    GridScope, GridSourceReference, JobProgress, JobSnapshot, JobState, MolecularSnapshotRef,
    MolecularSnapshotVersion, OwnerSurface, PackedFileDescriptor, PlannedStage, Precision,
    RdkitBaselineVersion, RepresentativePolicy, ResourceLimits, RuntimeIdentity, SchedulingPolicy,
    SelectedGridScope, SimilarityCutoff, SimilaritySettings, StageKind, StageSnapshot, StageState,
    WorkflowTemplateId,
};
use rusqlite::{Connection, TransactionBehavior};
use uuid::Uuid;

use super::*;

pub(super) struct TestStore {
    pub(super) root: PathBuf,
    pub(super) store: ComputeStore,
}

impl TestStore {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir()
            .canonicalize()
            .expect("canonical temporary directory")
            .join(format!("burrete-compute-store-{}", Uuid::new_v4()));
        let store = ComputeStore::initialize(root.clone()).expect("initialize compute store");
        Self { root, store }
    }

    pub(super) fn new_legacy_v1_with_job(owner: &str, snapshot: &JobSnapshot) -> Self {
        Self::new_legacy_v1_with_jobs(owner, std::slice::from_ref(snapshot))
    }

    pub(super) fn new_legacy_v1_with_jobs(owner: &str, snapshots: &[JobSnapshot]) -> Self {
        let root = std::env::temp_dir()
            .canonicalize()
            .expect("canonical temporary directory")
            .join(format!("burrete-compute-store-v1-{}", Uuid::new_v4()));
        let root_lease = Arc::new(
            crate::compute::root_lease::ComputeRootLease::acquire(&root)
                .expect("acquire legacy v1 compute root"),
        );
        let database_path = root.join("coordinator.sqlite3");
        let mut connection = Connection::open(&database_path).expect("open legacy v1 database");
        schema::configure(&connection).expect("configure legacy v1 database");
        schema::initialize_legacy_v1_fixture(&mut connection).expect("initialize legacy v1 schema");
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("begin legacy v1 fixture transaction");
        for snapshot in snapshots {
            jobs::insert_job_row(
                &transaction,
                owner_principal_for_window(owner).expect("trusted owner"),
                owner,
                snapshot,
            )
            .expect("insert legacy v1 job");
            jobs::replace_child_rows(&transaction, snapshot).expect("insert legacy v1 child rows");
            events::insert_event(&transaction, snapshot).expect("insert legacy v1 event");
        }
        transaction.commit().expect("commit legacy v1 job");
        drop(connection);
        let store = ComputeStore {
            root_lease,
            database_path: Arc::new(database_path),
        };
        Self { root, store }
    }
}

impl Drop for TestStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(super) fn insert_recovery_fixture(store: &ComputeStore, owner: &str, snapshot: &JobSnapshot) {
    snapshot.validate().expect("valid recovery fixture");
    let mut connection = store.open_connection().expect("open compute database");
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .expect("begin recovery fixture transaction");
    jobs::insert_job_row(
        &transaction,
        owner_principal_for_window(owner).expect("trusted owner"),
        owner,
        snapshot,
    )
    .expect("insert recovery job");
    jobs::insert_source_snapshot_row(&transaction, snapshot)
        .expect("insert recovery source snapshot");
    jobs::replace_child_rows(&transaction, snapshot).expect("insert recovery child rows");
    events::insert_event(&transaction, snapshot).expect("insert recovery event");
    transaction.commit().expect("commit recovery fixture");
}

pub(super) fn create_renamed_intent(store: &ComputeStore, snapshot: &JobSnapshot) -> Uuid {
    let attempt_id = Uuid::new_v4();
    let draft = SnapshotIntentDraft {
        snapshot_id: snapshot.frozen_source.snapshot_id,
        job_id: snapshot.job_id,
        attempt_id,
        reservation_bytes: 4_096,
        created_at_ms: snapshot.created_at_ms,
    };
    store
        .reserve_snapshot_intent(&draft)
        .expect("reserve snapshot intent");
    store
        .mark_snapshot_intent_writing(draft.snapshot_id, attempt_id, draft.created_at_ms + 1)
        .expect("begin snapshot write");
    store
        .mark_snapshot_intent_synced(
            draft.snapshot_id,
            attempt_id,
            1_024,
            &snapshot.frozen_source,
            draft.created_at_ms + 2,
        )
        .expect("sync snapshot intent");
    store
        .mark_snapshot_intent_renamed(draft.snapshot_id, attempt_id, draft.created_at_ms + 3)
        .expect("rename snapshot intent");
    attempt_id
}

pub(super) fn insert_prepared_fixture(store: &ComputeStore, owner: &str, snapshot: &JobSnapshot) {
    let attempt_id = create_renamed_intent(store, snapshot);
    store
        .insert_prepared_job(owner, snapshot, attempt_id)
        .expect("insert prepared job");
}

pub(super) fn boundary_snapshot(
    backend_policy: BackendPolicy,
    stage_index: usize,
    state: JobState,
) -> JobSnapshot {
    let mut snapshot = queued_snapshot_with_policy(backend_policy);
    snapshot.revision = 10 + stage_index as u64;
    snapshot.state = state;
    snapshot.updated_at_ms = 200;
    snapshot.progress.completed_units = stage_index as u64;
    snapshot.progress.message = format!("Boundary {stage_index}");
    for (ordinal, stage) in snapshot.stages.iter_mut().enumerate() {
        if ordinal >= stage_index {
            continue;
        }
        let started_at_ms = 101 + ordinal as u64 * 10;
        let finished_at_ms = started_at_ms + 2;
        stage.state = StageState::Succeeded;
        stage.progress.completed_units = stage.progress.total_units;
        stage.progress.message = "Succeeded".into();
        stage.started_at_ms = Some(started_at_ms);
        stage.updated_at_ms = Some(finished_at_ms);
        stage.finished_at_ms = Some(finished_at_ms);
        stage.host_time_ms = Some(2.0);
        stage.transferred_bytes = 64;
        if stage.effective_backend.is_gpu() {
            stage.device = Some("Apple GPU".into());
            stage.kernel_id = Some("tanimoto.v1".into());
            stage.gpu_time_ms = Some(1.0);
        }
        snapshot.attempts.push(AttemptSnapshot {
            attempt_id: Uuid::new_v4(),
            stage_id: stage.stage_id.clone(),
            attempt_number: 1,
            runtime_version: snapshot.pinned_runtime.version.clone(),
            state: AttemptState::Succeeded,
            started_at_ms,
            heartbeat_at_ms: finished_at_ms,
            finished_at_ms: Some(finished_at_ms),
            error: None,
            retry_reason: None,
        });
    }
    snapshot.validate().expect("valid active boundary");
    snapshot
}

pub(super) fn queued_snapshot() -> JobSnapshot {
    queued_snapshot_with_policy(BackendPolicy::ReferenceCpu)
}

fn queued_snapshot_with_policy(backend_policy: BackendPolicy) -> JobSnapshot {
    let request = ClusterV1SubmitRequest {
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
            backend_policy,
            scheduling_policy: SchedulingPolicy::Interactive,
        },
        limits: ResourceLimits {
            max_edges: 1_000,
            max_memory_bytes: 16 * 1024 * 1024,
            max_dispatch_ms: 100,
        },
    };
    let similarity_backend = match backend_policy {
        BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred => Backend::NativeMetal,
        BackendPolicy::ReferenceCpu => Backend::ReferenceCpu,
    };
    let plan = ExecutionPlan {
        workflow_template: WorkflowTemplateId::ClusterV1,
        plan_version: ExecutionPlanVersion::ClusterV1,
        backend_policy,
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
    };
    let stages = plan
        .stages
        .iter()
        .enumerate()
        .map(|(ordinal, planned)| StageSnapshot {
            stage_id: planned.stage_id.clone(),
            ordinal: ordinal as u16,
            kind: planned.kind,
            idempotent: planned.idempotent,
            state: StageState::Queued,
            progress: JobProgress {
                completed_units: 0,
                total_units: 1,
                message: "Queued".into(),
            },
            requested_backend: planned.requested_backend,
            effective_backend: planned.effective_backend,
            engine: planned.engine.clone(),
            device: None,
            precision: planned.precision,
            kernel_id: None,
            gpu_time_ms: None,
            host_time_ms: None,
            transferred_bytes: 0,
            fallback: None,
            error: None,
            started_at_ms: None,
            updated_at_ms: None,
            finished_at_ms: None,
        })
        .collect();
    let snapshot = JobSnapshot {
        schema_version: ComputeJobSnapshotSchemaVersion::V1,
        job_id: Uuid::new_v4(),
        revision: 1,
        owner_surface: OwnerSurface::Desktop,
        workflow_template: WorkflowTemplateId::ClusterV1,
        state: JobState::Queued,
        normalized_request_sha256: request.canonical_sha256().expect("request hash"),
        request,
        frozen_source: MolecularSnapshotRef {
            schema_version: MolecularSnapshotVersion::V1,
            snapshot_id: Uuid::new_v4(),
            snapshot_sha256: hash('b'),
            frozen_source: FrozenSourceIdentity {
                document_fingerprint_sha256: hash('c'),
                source_revision: 1,
                record_count: 2,
                ordered_record_molecule_identity_sha256: hash('d'),
            },
            manifest: PackedFileDescriptor {
                relative_path: "snapshot/manifest.json".into(),
                sha256: hash('e'),
                byte_length: 128,
                media_type: "application/json".into(),
            },
        },
        progress: JobProgress {
            completed_units: 0,
            total_units: 6,
            message: "Queued".into(),
        },
        accepted_plan_sha256: plan.canonical_sha256().expect("plan hash"),
        plan,
        stages,
        attempts: Vec::new(),
        artifact_ids: Vec::new(),
        result_pack: None,
        outcome: None,
        pinned_runtime: RuntimeIdentity {
            version: "compute-runtime-1.0.0".into(),
            manifest_sha256: hash('f'),
            helper_sha256: hash('1'),
            metallib_sha256: hash('2'),
        },
        error: None,
        created_at_ms: 100,
        updated_at_ms: 100,
        finished_at_ms: None,
    };
    snapshot.validate().expect("valid queued snapshot");
    snapshot
}

fn planned_stage(stage_id: &str, kind: StageKind, backend: Backend) -> PlannedStage {
    let precision = if matches!(kind, StageKind::Materialize | StageKind::ArtifactIo) {
        Precision::NotApplicable
    } else {
        Precision::IntegerExact
    };
    PlannedStage {
        stage_id: stage_id.into(),
        kind,
        idempotent: true,
        requested_backend: backend,
        effective_backend: backend,
        precision,
        engine: EngineIdentity {
            engine_id: match backend {
                Backend::Coordinator => "burrete-coordinator",
                Backend::Rdkit => "rdkit",
                Backend::NativeMetal => "burrete-native-metal",
                Backend::Mlx => "burrete-mlx",
                Backend::ReferenceCpu => "burrete-reference-cpu",
            }
            .into(),
            version: "1.0.0".into(),
            manifest_sha256: hash('a'),
        },
        estimated_memory_bytes: 1_024,
        fallback: None,
        partitions: vec![ExecutionPartition {
            partition_id: "all".into(),
            chemistry_domain: "cluster.v1/all".into(),
            record_count: 2,
            estimated_memory_bytes: 1_024,
            requested_backend: backend,
            effective_backend: backend,
            fallback: None,
        }],
    }
}

fn hash(character: char) -> String {
    character.to_string().repeat(64)
}
