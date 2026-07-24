use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use burrete_compute_core::{
    build_tanimoto_graph, ConformerEnginePackArrays, NativeMmffParameters, SymmetricCsr,
};
use burrete_compute_metal::{MetalRuntimeError, MetalTanimotoKnnExecution, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    Backend, BackendPolicy, CapabilityEntry, CapabilityLimits, CapabilityMaturity,
    CapabilityReason, CapabilityReasonCode, CapabilityReportSchemaVersion, ClusterV1SubmitRequest,
    ComputeAvailability, ComputeCapabilityReport, ComputeErrorCode, ComputeFailure,
    ComputeSubmitRequest, ConformerV1SubmitRequest, EngineIdentity, FallbackDecision,
    FallbackReasonCode, JobOutcomeSummary, JobRevisionEvent, JobSnapshot, JobState, OwnerSurface,
    PlatformIdentity, Precision, ProtocolRange, RuntimeIdentity, WorkflowTemplateId,
    MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::compute::{
    alignment_workflow::{
        apply_grid_alignment_result, durable_alignment_request,
        execute_snapshot_alignment_with_run_id, GridAlignmentRequest, GridAlignmentResult,
    },
    analysis_snapshot::load_analysis_source_rows,
    artifact_publisher::{
        artifact_manifest_sha256, materialize_analysis_artifact, materialize_cluster_artifact,
        materialize_conformer_artifact, reconcile_artifact_root, AnalysisArtifactPayload,
        AnalysisPublicationStep, ClusterPublicationStep, ConformerPublicationStep,
    },
    chemical_space::{
        cluster_chemical_space_from_fingerprints, execute_chemical_space,
        ChemicalSpaceClusterRequest, ChemicalSpaceClusterResult, ChemicalSpaceRequest,
        ChemicalSpaceResult,
    },
    cluster_executor::{
        finish_clustering, graph_options, valid_fingerprints, validate_computation,
        ClusterComputation, ClusterExecutionStep,
    },
    cluster_plan::{ClusterV1AdmissionError, SimilarityBackendAdmission},
    conformer_executor::{
        execute_conformer_distance_geometry_with_service, ConformerDistanceComputation,
    },
    conformer_ipc::{decode_conformer_chunk_result, ConformerChunkResult},
    conformer_plan::{
        derive_conformer_v1_preflight, ConformerBackendAdmission, ConformerMoleculeIdentity,
        ConformerV1AdmissionError,
    },
    conformer_reference_validator::validate_conformer_reference,
    conformer_session::{
        CompletedConformerExtraction, ConformerExtractionSession, ConformerSubmissionStep,
        MAX_CONFORMER_RESULT_ENVELOPE_BYTES,
    },
    conformer_stereo_executor::{execute_conformer_stereo_validation, ConformerStereoComputation},
    engine_catalog::VerifiedEngineCatalog,
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::{
        CompletedFingerprintBatch, FingerprintChunkResult, FingerprintExecutionStep,
        FingerprintSession,
    },
    job_factory::{
        build_queued_analysis_v1_job, build_queued_cluster_v1_job, build_queued_conformer_v1_job,
        QueuedAnalysisV1JobInput, QueuedClusterV1JobInput, QueuedConformerV1JobInput,
    },
    job_lifecycle::{
        fail_stage, finish_cancellation, finish_publish_stage, finish_stage, start_stage,
        StageFinishMetrics, StageStartEvidence,
    },
    representative_export::{export_cluster_representatives, ClusterRepresentativeExportResult},
    semiempirical_workflow::{
        apply_grid_semiempirical_result, durable_semiempirical_request,
        execute_snapshot_semiempirical_with_run_id, GridSemiempiricalRequest,
        GridSemiempiricalResult,
    },
    service::ComputeServiceClient,
    similarity_search::{
        execute_similarity_search, SimilaritySearchBackend, SimilaritySearchRequest,
        SimilaritySearchResult,
    },
    snapshot_repository::SnapshotRepository,
    store::{validate_owner_window_label, ComputeStore},
};
use crate::preview::{
    grid_analysis::{
        apply_cluster_analysis_run, apply_conformer_analysis_run, GridClusterAnalysisApplyInput,
        GridClusterAssignmentInput, GridConformerAnalysisApplyInput, GridConformerAssignmentInput,
    },
    grid_snapshot::FrozenGridSnapshot,
    grid_store::GridSnapshotLease,
};
use crate::windows::runtime_document_id;

#[derive(Clone, Debug)]
pub(crate) struct ComputeCoordinator {
    state: Arc<CoordinatorState>,
}

#[derive(Debug)]
enum CoordinatorState {
    Ready(Box<ReadyCoordinator>),
    Unavailable(String),
}

#[derive(Debug)]
struct ReadyCoordinator {
    store: ComputeStore,
    snapshots: SnapshotRepository,
    engines: VerifiedEngineCatalog,
    native_metal: NativeMetalState,
    compute_service: Option<ComputeServiceClient>,
    fingerprint_sessions: Mutex<BTreeMap<Uuid, FingerprintSession>>,
    conformer_submissions: Mutex<BTreeMap<Uuid, PendingConformerSubmission>>,
    prepared_clusters: Mutex<BTreeMap<Uuid, CompletedFingerprintBatch>>,
    chemical_space_knn: Mutex<BTreeMap<(Uuid, usize), MetalTanimotoKnnExecution>>,
    prepared_conformers: Mutex<BTreeMap<Uuid, PreparedConformerBatch>>,
    computed_conformers: Mutex<BTreeMap<Uuid, ComputedConformerBatch>>,
    computed_clusters: Mutex<BTreeMap<Uuid, ClusterComputation>>,
}

#[derive(Debug)]
struct PendingConformerSubmission {
    request: ConformerV1SubmitRequest,
    frozen: FrozenGridSnapshot,
    publication_attempt_id: Uuid,
    job_id: Uuid,
    pinned_runtime: RuntimeIdentity,
    distance_admission: ConformerBackendAdmission,
    stereo_admission: ConformerBackendAdmission,
    created_at_ms: u64,
    session: ConformerExtractionSession,
}

#[derive(Debug)]
#[allow(
    dead_code,
    reason = "prepared conformer arrays are consumed by the staged adaptive executor"
)]
struct PreparedConformerBatch {
    arrays: ConformerEnginePackArrays,
    identities: Vec<ConformerMoleculeIdentity>,
    errors: Vec<Option<String>>,
    mmff_parameters: Vec<Option<NativeMmffParameters>>,
    mmff_errors: Vec<Option<String>>,
    input_positions: Vec<Option<Vec<[f32; 4]>>>,
}

#[derive(Debug)]
#[allow(dead_code, reason = "consumed by the next ETK/stereo execution stage")]
struct ComputedConformerBatch {
    engine_arrays: ConformerEnginePackArrays,
    distance: ConformerDistanceComputation,
    stereo: Option<ConformerStereoComputation>,
    identities: Vec<ConformerMoleculeIdentity>,
    errors: Vec<Option<String>>,
    mmff_errors: Vec<Option<String>>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerDistanceExecutionStep {
    pub(crate) job: JobSnapshot,
    pub(crate) conformer_count: usize,
    pub(crate) failed_source_records: usize,
    pub(crate) ready_for_stereo: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerStereoExecutionStep {
    pub(crate) job: JobSnapshot,
    pub(crate) conformer_count: usize,
    pub(crate) passed_count: usize,
    pub(crate) failed_count: usize,
    pub(crate) ready_for_validation: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConformerReferenceValidationStep {
    pub(crate) job: JobSnapshot,
    pub(crate) conformer_count: usize,
    pub(crate) passed_count: usize,
    pub(crate) failed_count: usize,
    pub(crate) ready_for_publication: bool,
}

#[derive(Debug)]
pub(crate) enum NativeMetalState {
    Available(MetalTanimotoRuntime),
    Unavailable {
        code: CapabilityReasonCode,
        message: String,
    },
}

impl ComputeCoordinator {
    pub(crate) fn execute_chemical_space(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
        request: ChemicalSpaceRequest,
    ) -> ComputeResult<ChemicalSpaceResult> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let job = ready.store.get_job(owner, job_id)?;
        if job.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: job.revision,
            });
        }
        let prepared = ready
            .prepared_clusters
            .lock()
            .map_err(|_| poisoned("prepared cluster registry"))?;
        let batch = prepared
            .get(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "prepared chemical-space fingerprints",
                id: job_id.to_string(),
            })?;
        if batch.grid_lease.namespaced_document_id()
            != runtime_document_id(owner, &job.request.source().document_id)
        {
            return Err(ComputeCoordinatorError::Forbidden(
                "prepared chemical space does not belong to this Grid window".into(),
            ));
        }
        let cache_key = (job_id, request.requested_neighbors());
        let cached_knn = ready
            .chemical_space_knn
            .lock()
            .map_err(|_| poisoned("chemical-space neighbor cache"))?
            .get(&cache_key)
            .cloned();
        let execution =
            execute_chemical_space(batch, &ready.native_metal, request, cached_knn.as_ref())?;
        if cached_knn.is_none() {
            ready
                .chemical_space_knn
                .lock()
                .map_err(|_| poisoned("chemical-space neighbor cache"))?
                .insert(cache_key, execution.knn.clone());
        }
        Ok(execution.result)
    }

    pub(crate) fn cluster_chemical_space(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
        request: ChemicalSpaceClusterRequest,
    ) -> ComputeResult<ChemicalSpaceClusterResult> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let job = ready.store.get_job(owner, job_id)?;
        if job.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: job.revision,
            });
        }
        let prepared = ready
            .prepared_clusters
            .lock()
            .map_err(|_| poisoned("prepared cluster registry"))?;
        let batch = prepared
            .get(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "prepared chemical-space fingerprints",
                id: job_id.to_string(),
            })?;
        if batch.grid_lease.namespaced_document_id()
            != runtime_document_id(owner, &job.request.source().document_id)
        {
            return Err(ComputeCoordinatorError::Forbidden(
                "prepared chemical space does not belong to this Grid window".into(),
            ));
        }
        let (fingerprints, valid_ordinals) = valid_fingerprints(batch)?;
        let source_record_ids = valid_ordinals
            .iter()
            .map(|ordinal| batch.identities[*ordinal as usize].source_record_id)
            .collect::<Vec<_>>();
        let runtime = match &ready.native_metal {
            NativeMetalState::Available(runtime) => runtime,
            NativeMetalState::Unavailable { message, .. } => {
                return Err(ComputeCoordinatorError::Unavailable(format!(
                    "Chemical-space Metal runtime is unavailable: {message}"
                )))
            }
        };
        cluster_chemical_space_from_fingerprints(
            &fingerprints,
            &source_record_ids,
            runtime,
            request,
        )
    }

    pub(crate) fn evaluate_grid_semiempirical(
        &self,
        owner: &str,
        request: &GridSemiempiricalRequest,
        source_lease: GridSnapshotLease,
    ) -> ComputeResult<GridSemiempiricalResult> {
        validate_owner_window_label(owner)?;
        if request.document_id.trim().is_empty()
            || source_lease.namespaced_document_id()
                != runtime_document_id(owner, request.document_id.trim())
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid semi-empirical lease does not belong to the requested document".into(),
            ));
        }
        let durable_request = durable_semiempirical_request(request)?;
        let queued = self.submit_analysis_v1(owner, durable_request.into(), &source_lease)?;
        self.execute_semiempirical_v1(owner, request, source_lease, queued)
    }

    pub(crate) fn align_grid_poses(
        &self,
        owner: &str,
        request: &GridAlignmentRequest,
        source_lease: GridSnapshotLease,
    ) -> ComputeResult<GridAlignmentResult> {
        validate_owner_window_label(owner)?;
        if request.document_id.trim().is_empty()
            || source_lease.namespaced_document_id()
                != runtime_document_id(owner, request.document_id.trim())
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid alignment lease does not belong to the requested document".into(),
            ));
        }
        let durable_request = durable_alignment_request(request)?;
        let queued = self.submit_analysis_v1(owner, durable_request.into(), &source_lease)?;
        self.execute_alignment_v1(owner, request, source_lease, queued)
    }

    fn submit_analysis_v1(
        &self,
        owner: &str,
        request: ComputeSubmitRequest,
        source_lease: &GridSnapshotLease,
    ) -> ComputeResult<JobSnapshot> {
        let request = request.normalized()?;
        let ready = self.ready()?;
        let (numeric_admission, pinned_runtime) = ready
            .native_metal
            .submission_binding(request.backend_policy(), ready.engines.reference_runtime())?;
        let snapshot_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        let publication_attempt_id = Uuid::new_v4();
        let publication_created_at_ms = now_ms();
        let frozen = ready.snapshots.publish_grid_source(
            &ready.store,
            source_lease.database_path_for_freeze(),
            &request.source().scope,
            snapshot_id,
            job_id,
            publication_attempt_id,
            publication_created_at_ms,
        )?;
        let result = (|| {
            let source = ready.snapshots.bind_analysis_source(request, frozen)?;
            let snapshot = build_queued_analysis_v1_job(QueuedAnalysisV1JobInput {
                job_id,
                owner_surface: OwnerSurface::Desktop,
                source,
                pinned_runtime,
                engines: ready.engines.identities().clone(),
                numeric_admission,
                created_at_ms: publication_created_at_ms.saturating_add(1),
            })?;
            ready
                .store
                .insert_prepared_job(owner, &snapshot, publication_attempt_id)?;
            Ok(snapshot)
        })();
        if result.is_err() {
            ready.snapshots.rollback_uncommitted_publication(
                &ready.store,
                snapshot_id,
                job_id,
                publication_attempt_id,
            )?;
        }
        result
    }

    fn execute_semiempirical_v1(
        &self,
        owner: &str,
        request: &GridSemiempiricalRequest,
        source_lease: GridSnapshotLease,
        queued: JobSnapshot,
    ) -> ComputeResult<GridSemiempiricalResult> {
        let ready = self.ready()?;
        let freeze_running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            now_ms(),
            "Verifying frozen semiempirical scope",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, queued.revision, &freeze_running)?;
        let freeze_succeeded = finish_stage(
            &freeze_running,
            0,
            JobState::Preparing,
            now_ms(),
            "Frozen semiempirical scope verified",
            StageFinishMetrics {
                transferred_bytes: queued.frozen_source.manifest.byte_length,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, freeze_running.revision, &freeze_succeeded)?;
        let prepare_running = start_stage(
            &freeze_succeeded,
            1,
            JobState::Preparing,
            now_ms(),
            "Preparing semiempirical Hamiltonians",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, freeze_succeeded.revision, &prepare_running)?;
        let prepare_started = Instant::now();
        let source_rows = match ready
            .snapshots
            .open_verified_source(&queued.frozen_source)
            .and_then(|snapshot| load_analysis_source_rows(&snapshot))
        {
            Ok(rows) => rows,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &prepare_running,
                    1,
                    ComputeErrorCode::SourceRevisionMismatch,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: prepare_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let native = prepare_running.stages[2].effective_backend == Backend::NativeMetal;
        let prepare_succeeded = finish_stage(
            &prepare_running,
            1,
            if native {
                JobState::WaitingGpu
            } else {
                JobState::Running
            },
            now_ms(),
            "Semiempirical inputs prepared",
            StageFinishMetrics::default(),
        )?;
        ready
            .store
            .apply_successor(owner, prepare_running.revision, &prepare_succeeded)?;
        let runtime = if native {
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => Some(runtime),
                NativeMetalState::Unavailable { message, .. } => {
                    return Err(ComputeCoordinatorError::Unavailable(format!(
                        "The admitted Metal runtime became unavailable: {message}"
                    )))
                }
            }
        } else {
            None
        };
        let numeric_running = start_stage(
            &prepare_succeeded,
            2,
            JobState::Running,
            now_ms(),
            "Running SCF, corrections, energies, and charges",
            runtime.map_or_else(StageStartEvidence::default, |runtime| StageStartEvidence {
                device: Some(runtime.device_identity().name.clone()),
                kernel_id: Some("burrete.compute.semiempirical.v1:scf-corrections".into()),
            }),
        )?;
        ready
            .store
            .apply_successor(owner, prepare_succeeded.revision, &numeric_running)?;
        let numeric_started = Instant::now();
        let result = execute_snapshot_semiempirical_with_run_id(
            runtime,
            if native {
                ready.compute_service.as_ref()
            } else {
                None
            },
            source_rows,
            request,
            queued.job_id,
        );
        let host_time_ms = numeric_started.elapsed().as_secs_f64() * 1_000.0;
        let mut result = match result {
            Ok(result) => result,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &numeric_running,
                    2,
                    ComputeErrorCode::NumericalFailure,
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let successful_records =
            result.rows.iter().filter(|row| row.error.is_none()).count() as u64;
        let failed_records = result.rows.len() as u64 - successful_records;
        if successful_records == 0 {
            let error = ComputeCoordinatorError::Validation(
                "semiempirical evaluation produced no successful molecule results".into(),
            );
            persist_failed_stage(
                &ready.store,
                owner,
                &numeric_running,
                2,
                ComputeErrorCode::NumericalFailure,
                &error,
                StageFinishMetrics {
                    host_time_ms,
                    ..StageFinishMetrics::default()
                },
            )?;
            return Err(error);
        }
        let numeric_succeeded = finish_stage(
            &numeric_running,
            2,
            JobState::Validating,
            now_ms(),
            "Semiempirical evaluation completed",
            StageFinishMetrics {
                host_time_ms,
                gpu_time_ms: native.then_some(result.gpu_time_ms as f64),
                transferred_bytes: result
                    .rows
                    .iter()
                    .filter_map(|row| row.atomic_charges.as_ref())
                    .map(|charges| charges.len() as u64 * 8)
                    .sum(),
            },
        )?;
        ready
            .store
            .apply_successor(owner, numeric_running.revision, &numeric_succeeded)?;
        let validation_running = start_stage(
            &numeric_succeeded,
            3,
            JobState::Validating,
            now_ms(),
            "Validating semiempirical result bounds",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, numeric_succeeded.revision, &validation_running)?;
        let validation_succeeded = finish_stage(
            &validation_running,
            3,
            JobState::Publishing,
            now_ms(),
            "Semiempirical results validated",
            StageFinishMetrics::default(),
        )?;
        ready
            .store
            .apply_successor(owner, validation_running.revision, &validation_succeeded)?;
        let mut charge_starts = Vec::with_capacity(result.rows.len() + 1);
        let mut atomic_charges = Vec::new();
        charge_starts.push(0);
        for row in &result.rows {
            if let Some(charges) = &row.atomic_charges {
                atomic_charges.extend_from_slice(charges);
            }
            charge_starts.push(atomic_charges.len() as u64);
        }
        let payload = AnalysisArtifactPayload::Semiempirical {
            source_record_ids: result.rows.iter().map(|row| row.source_index).collect(),
            electronic_energies: result
                .rows
                .iter()
                .map(|row| row.electronic_energy_ev.unwrap_or(f64::NAN))
                .collect(),
            nuclear_energies: result
                .rows
                .iter()
                .map(|row| row.nuclear_energy_ev.unwrap_or(f64::NAN))
                .collect(),
            total_energies: result
                .rows
                .iter()
                .map(|row| row.total_energy_ev.unwrap_or(f64::NAN))
                .collect(),
            converged: result
                .rows
                .iter()
                .map(|row| u8::from(row.converged))
                .collect(),
            iterations: result
                .rows
                .iter()
                .map(|row| row.iterations.unwrap_or_default() as u32)
                .collect(),
            charge_starts,
            atomic_charges,
        };
        let publication = self.publish_analysis_payload(
            owner,
            ready,
            validation_succeeded,
            payload,
            successful_records,
            failed_records,
        )?;
        result.artifact_id = Some(publication.artifact_id);
        result.artifact_manifest_sha256 = Some(publication.artifact_manifest_sha256.clone());
        result.report_path = Some(publication.report_path.clone());
        match apply_grid_semiempirical_result(
            source_lease.database_path_for_freeze(),
            &result,
            publication.artifact_id,
            &publication.artifact_manifest_sha256,
        ) {
            Ok(()) => result.grid_applied = true,
            Err(error) => result.grid_warning = Some(error.to_string()),
        }
        Ok(result)
    }

    fn execute_alignment_v1(
        &self,
        owner: &str,
        request: &GridAlignmentRequest,
        source_lease: GridSnapshotLease,
        queued: JobSnapshot,
    ) -> ComputeResult<GridAlignmentResult> {
        let ready = self.ready()?;
        let freeze_running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            now_ms(),
            "Verifying frozen alignment scope",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, queued.revision, &freeze_running)?;
        let freeze_succeeded = finish_stage(
            &freeze_running,
            0,
            JobState::Preparing,
            now_ms(),
            "Frozen alignment scope verified",
            StageFinishMetrics {
                transferred_bytes: queued.frozen_source.manifest.byte_length,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, freeze_running.revision, &freeze_succeeded)?;
        let prepare_running = start_stage(
            &freeze_succeeded,
            1,
            JobState::Preparing,
            now_ms(),
            "Preparing mapped atom and bond graphs",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, freeze_succeeded.revision, &prepare_running)?;
        let prepare_started = Instant::now();
        let source_rows = match ready
            .snapshots
            .open_verified_source(&queued.frozen_source)
            .and_then(|snapshot| load_analysis_source_rows(&snapshot))
        {
            Ok(rows) => rows,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &prepare_running,
                    1,
                    ComputeErrorCode::SourceRevisionMismatch,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: prepare_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let prepare_succeeded = finish_stage(
            &prepare_running,
            1,
            JobState::WaitingGpu,
            now_ms(),
            "Mapped alignment inputs prepared",
            StageFinishMetrics::default(),
        )?;
        ready
            .store
            .apply_successor(owner, prepare_running.revision, &prepare_succeeded)?;
        let runtime = match &ready.native_metal {
            NativeMetalState::Available(runtime) => runtime,
            NativeMetalState::Unavailable { message, .. } => {
                return Err(ComputeCoordinatorError::Unavailable(format!(
                    "Native Metal alignment is unavailable: {message}"
                )))
            }
        };
        let numeric_running = start_stage(
            &prepare_succeeded,
            2,
            JobState::Running,
            now_ms(),
            "Aligning and scoring poses on Metal",
            StageStartEvidence {
                device: Some(runtime.device_identity().name.clone()),
                kernel_id: Some("burrete.compute.alignment.v1:mapped-horn".into()),
            },
        )?;
        ready
            .store
            .apply_successor(owner, prepare_succeeded.revision, &numeric_running)?;
        let numeric_started = Instant::now();
        let result = execute_snapshot_alignment_with_run_id(
            runtime,
            ready.compute_service.as_ref(),
            source_rows,
            request,
            queued.job_id,
        );
        let host_time_ms = numeric_started.elapsed().as_secs_f64() * 1_000.0;
        let mut result = match result {
            Ok(result) => result,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &numeric_running,
                    2,
                    ComputeErrorCode::NumericalFailure,
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let numeric_succeeded = finish_stage(
            &numeric_running,
            2,
            JobState::Validating,
            now_ms(),
            "Metal alignment and scoring completed",
            StageFinishMetrics {
                host_time_ms,
                gpu_time_ms: Some(result.gpu_time_ms as f64),
                transferred_bytes: result.aligned_sdf.len() as u64,
            },
        )?;
        ready
            .store
            .apply_successor(owner, numeric_running.revision, &numeric_succeeded)?;
        let validation_running = start_stage(
            &numeric_succeeded,
            3,
            JobState::Validating,
            now_ms(),
            "Validating CPU and Metal alignment parity",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, numeric_succeeded.revision, &validation_running)?;
        let validation_succeeded = finish_stage(
            &validation_running,
            3,
            JobState::Publishing,
            now_ms(),
            "Alignment parity validated",
            StageFinishMetrics::default(),
        )?;
        ready
            .store
            .apply_successor(owner, validation_running.revision, &validation_succeeded)?;
        let publication = self.publish_alignment_v1(owner, ready, validation_succeeded, &result)?;
        result.artifact_id = Some(publication.artifact_id);
        result.artifact_manifest_sha256 = Some(publication.artifact_manifest_sha256.clone());
        result.report_path = Some(publication.report_path.clone());
        match apply_grid_alignment_result(
            source_lease.database_path_for_freeze(),
            &result,
            runtime,
            publication.artifact_id,
            &publication.artifact_manifest_sha256,
        ) {
            Ok(()) => result.grid_applied = true,
            Err(error) => result.grid_warning = Some(error.to_string()),
        }
        Ok(result)
    }

    fn publish_alignment_v1(
        &self,
        owner: &str,
        ready: &ReadyCoordinator,
        before_publish: JobSnapshot,
        result: &GridAlignmentResult,
    ) -> ComputeResult<AnalysisPublicationStep> {
        let payload = AnalysisArtifactPayload::Alignment {
            source_record_ids: result
                .scores
                .iter()
                .map(|score| score.source_index)
                .collect(),
            is_references: result
                .scores
                .iter()
                .map(|score| u8::from(score.is_reference))
                .collect(),
            rmsd_values: result.scores.iter().map(|score| score.rmsd).collect(),
            shape_tanimoto_scores: result
                .scores
                .iter()
                .map(|score| score.shape_tanimoto)
                .collect(),
            electrostatic_carbo_scores: result
                .scores
                .iter()
                .map(|score| score.electrostatic_carbo.unwrap_or(f32::NAN))
                .collect(),
            combined_similarities: result
                .scores
                .iter()
                .map(|score| score.combined_similarity)
                .collect(),
            transforms: result.transforms.clone(),
            aligned_sdf: result.aligned_sdf.clone(),
        };
        self.publish_analysis_payload(
            owner,
            ready,
            before_publish,
            payload,
            result.scores.len() as u64,
            0,
        )
    }

    fn publish_analysis_payload(
        &self,
        owner: &str,
        ready: &ReadyCoordinator,
        before_publish: JobSnapshot,
        payload: AnalysisArtifactPayload,
        successful_records: u64,
        failed_records: u64,
    ) -> ComputeResult<AnalysisPublicationStep> {
        let stage_index = before_publish.stages.len().checked_sub(1).ok_or_else(|| {
            ComputeCoordinatorError::Protocol("analysis job has no publish stage".into())
        })?;
        let publish_running = start_stage(
            &before_publish,
            stage_index,
            JobState::Publishing,
            now_ms(),
            "Publishing verified analysis ResultPack",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, before_publish.revision, &publish_running)?;
        let publish_started = Instant::now();
        let materialized = match materialize_analysis_artifact(
            &ready.store,
            &publish_running,
            payload,
            now_ms().max(publish_running.updated_at_ms),
        ) {
            Ok(materialized) => materialized,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    stage_index,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let publication = (|| {
            let successful_job = finish_publish_stage(
                &publish_running,
                materialized.created_at_ms,
                materialized.artifact_id,
                materialized.result_pack.clone(),
                JobOutcomeSummary {
                    successful_records,
                    failed_records,
                },
                StageFinishMetrics {
                    host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                    transferred_bytes: materialized.byte_count,
                    ..StageFinishMetrics::default()
                },
            )?;
            let manifest = materialized.manifest_for_job(&successful_job)?;
            let manifest_sha256 = artifact_manifest_sha256(&manifest)?;
            Ok((successful_job, manifest, manifest_sha256))
        })();
        let (successful_job, manifest, manifest_sha256) = match publication {
            Ok(publication) => publication,
            Err(error) => {
                let cleanup = materialized.cleanup();
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    stage_index,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                cleanup?;
                return Err(error);
            }
        };
        if let Err(error) = ready.store.commit_published_artifact(
            owner,
            publish_running.revision,
            &successful_job,
            &manifest,
            &materialized.relative_directory,
        ) {
            let cleanup = materialized.cleanup();
            persist_failed_stage(
                &ready.store,
                owner,
                &publish_running,
                stage_index,
                ComputeErrorCode::ArtifactCorrupt,
                &error,
                StageFinishMetrics {
                    host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                    ..StageFinishMetrics::default()
                },
            )?;
            cleanup?;
            return Err(error);
        }
        Ok(AnalysisPublicationStep {
            artifact_id: materialized.artifact_id,
            artifact_manifest_sha256: manifest_sha256,
            report_path: materialized.report_path().to_string_lossy().into_owned(),
        })
    }

    #[cfg(test)]
    pub(crate) fn initialize(
        compute_root: PathBuf,
        metal_runtime_root: Option<PathBuf>,
        viewer_runtime_root: Option<PathBuf>,
    ) -> Self {
        Self::initialize_inner(compute_root, metal_runtime_root, viewer_runtime_root, None)
    }

    pub(crate) fn initialize_with_service(
        compute_root: PathBuf,
        metal_runtime_root: Option<PathBuf>,
        viewer_runtime_root: Option<PathBuf>,
        service_executable: Option<PathBuf>,
    ) -> Self {
        Self::initialize_inner(
            compute_root,
            metal_runtime_root,
            viewer_runtime_root,
            Some(service_executable),
        )
    }

    fn initialize_inner(
        compute_root: PathBuf,
        metal_runtime_root: Option<PathBuf>,
        viewer_runtime_root: Option<PathBuf>,
        service_mode: Option<Option<PathBuf>>,
    ) -> Self {
        let state = match ComputeStore::initialize(compute_root) {
            Ok(store) => match SnapshotRepository::initialize(&store) {
                Ok(snapshots) => match reconcile_artifact_root(&store)
                    .and_then(|()| store.recover_active_jobs(now_ms()))
                {
                    Ok(_) => match initialize_runtime_catalog(viewer_runtime_root) {
                        Ok((helper_sha256, engines)) => {
                            let (native_metal, compute_service) = match service_mode {
                                None => (
                                    NativeMetalState::probe(metal_runtime_root, &helper_sha256),
                                    None,
                                ),
                                Some(service_executable) => initialize_compute_service(
                                    service_executable,
                                    metal_runtime_root,
                                ),
                            };
                            CoordinatorState::Ready(Box::new(ReadyCoordinator {
                                store,
                                snapshots,
                                engines,
                                native_metal,
                                compute_service,
                                fingerprint_sessions: Mutex::new(BTreeMap::new()),
                                conformer_submissions: Mutex::new(BTreeMap::new()),
                                prepared_clusters: Mutex::new(BTreeMap::new()),
                                chemical_space_knn: Mutex::new(BTreeMap::new()),
                                prepared_conformers: Mutex::new(BTreeMap::new()),
                                computed_conformers: Mutex::new(BTreeMap::new()),
                                computed_clusters: Mutex::new(BTreeMap::new()),
                            }))
                        }
                        Err(error) => CoordinatorState::Unavailable(error),
                    },
                    Err(error) => CoordinatorState::Unavailable(error.to_string()),
                },
                Err(error) => CoordinatorState::Unavailable(error.to_string()),
            },
            Err(error) => CoordinatorState::Unavailable(error.to_string()),
        };
        Self {
            state: Arc::new(state),
        }
    }

    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self {
            state: Arc::new(CoordinatorState::Unavailable(message.into())),
        }
    }

    pub(crate) fn capability_report(&self) -> ComputeResult<ComputeCapabilityReport> {
        let report = match self.state.as_ref() {
            CoordinatorState::Ready(ready) => match ready.snapshots.health_check() {
                Ok(()) => match &ready.compute_service {
                    Some(service) => service.capabilities().unwrap_or_else(|error| {
                        unavailable_report(
                            CapabilityReasonCode::RuntimeIntegrityError,
                            format!("The native compute service is unavailable: {error}"),
                        )
                    }),
                    None => match &ready.native_metal {
                        NativeMetalState::Available(runtime) => available_report(runtime),
                        NativeMetalState::Unavailable { code, message } => {
                            unavailable_report(*code, message.clone())
                        }
                    },
                },
                Err(error) => unavailable_report(
                    CapabilityReasonCode::RuntimeIntegrityError,
                    format!("The durable compute snapshot repository is unavailable: {error}"),
                ),
            },
            CoordinatorState::Unavailable(message) => unavailable_report(
                CapabilityReasonCode::RuntimeIntegrityError,
                format!("The durable compute coordinator is unavailable: {message}"),
            ),
        };
        report.validate()?;
        Ok(report)
    }

    pub(crate) fn submit_cluster_v1(
        &self,
        owner: &str,
        request: &ClusterV1SubmitRequest,
        source_lease: GridSnapshotLease,
    ) -> ComputeResult<JobSnapshot> {
        validate_owner_window_label(owner)?;
        let request = request.clone().normalized()?;
        if source_lease.namespaced_document_id()
            != runtime_document_id(owner, &request.source.document_id)
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid snapshot lease does not belong to the submitted document".into(),
            ));
        }
        let ready = self.ready()?;
        let (similarity_admission, pinned_runtime) = ready.native_metal.submission_binding(
            request.execution_policy.backend_policy,
            ready.engines.reference_runtime(),
        )?;
        let snapshot_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        let publication_attempt_id = Uuid::new_v4();
        let publication_created_at_ms = now_ms();
        let job_created_at_ms = publication_created_at_ms.checked_add(4).ok_or_else(|| {
            ComputeCoordinatorError::Validation("compute submission timestamp overflowed".into())
        })?;
        let frozen = ready.snapshots.publish_grid_source(
            &ready.store,
            source_lease.database_path_for_freeze(),
            &request.source.scope,
            snapshot_id,
            job_id,
            publication_attempt_id,
            publication_created_at_ms,
        )?;
        let result = (|| {
            let source = ready.snapshots.bind_cluster_source(request, frozen)?;
            let snapshot = build_queued_cluster_v1_job(QueuedClusterV1JobInput {
                job_id,
                owner_surface: OwnerSurface::Desktop,
                source,
                pinned_runtime,
                engines: ready.engines.identities().clone(),
                similarity_admission,
                created_at_ms: job_created_at_ms,
            })
            .map_err(admission_error)?;
            ready
                .store
                .insert_prepared_job(owner, &snapshot, publication_attempt_id)?;
            Ok(snapshot)
        })();
        match result {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                if let Err(cleanup) = ready.snapshots.rollback_uncommitted_publication(
                    &ready.store,
                    snapshot_id,
                    job_id,
                    publication_attempt_id,
                ) {
                    return Err(ComputeCoordinatorError::Protocol(format!(
                        "cluster.v1 admission failed ({error}) and snapshot rollback failed ({cleanup})"
                    )));
                }
                Err(error)
            }
        }
    }

    pub(crate) fn begin_conformer_v1_submission(
        &self,
        owner: &str,
        request: &ConformerV1SubmitRequest,
        source_lease: GridSnapshotLease,
    ) -> ComputeResult<ConformerSubmissionStep> {
        validate_owner_window_label(owner)?;
        let request = request.clone().normalized()?;
        if source_lease.namespaced_document_id()
            != runtime_document_id(owner, &request.source.document_id)
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid snapshot lease does not belong to the conformer source".into(),
            ));
        }
        let ready = self.ready()?;
        let (distance_admission, stereo_admission, pinned_runtime) =
            ready.native_metal.conformer_submission_binding(
                request.execution_policy.backend_policy,
                ready.engines.reference_runtime(),
            )?;
        let snapshot_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        let publication_attempt_id = Uuid::new_v4();
        let publication_created_at_ms = now_ms();
        let job_created_at_ms = publication_created_at_ms.checked_add(4).ok_or_else(|| {
            ComputeCoordinatorError::Validation("compute submission timestamp overflowed".into())
        })?;
        let frozen = ready.snapshots.publish_grid_source(
            &ready.store,
            source_lease.database_path_for_freeze(),
            &request.source.scope,
            snapshot_id,
            job_id,
            publication_attempt_id,
            publication_created_at_ms,
        )?;
        let started = (|| {
            let verified = ready.snapshots.open_verified_source(&frozen.reference)?;
            let (session, first_chunk) =
                ConformerExtractionSession::start(owner, &request, verified)?;
            let session_id = session.session_id();
            let pending = PendingConformerSubmission {
                request,
                frozen,
                publication_attempt_id,
                job_id,
                pinned_runtime,
                distance_admission,
                stereo_admission,
                created_at_ms: job_created_at_ms,
                session,
            };
            let mut submissions = ready
                .conformer_submissions
                .lock()
                .map_err(|_| poisoned("conformer submission registry"))?;
            if submissions.insert(session_id, pending).is_some() {
                return Err(ComputeCoordinatorError::Protocol(
                    "duplicate conformer extraction session ID".into(),
                ));
            }
            Ok(ConformerSubmissionStep {
                session_id,
                conformer_chunk: Some(first_chunk),
                job: None,
                ready_for_execution: false,
            })
        })();
        if started.is_err() {
            ready.snapshots.rollback_uncommitted_publication(
                &ready.store,
                snapshot_id,
                job_id,
                publication_attempt_id,
            )?;
        }
        started
    }

    pub(crate) fn submit_conformer_extraction_chunk(
        &self,
        owner: &str,
        envelope: &[u8],
    ) -> ComputeResult<ConformerSubmissionStep> {
        validate_owner_window_label(owner)?;
        let result = decode_conformer_chunk_result(envelope, MAX_CONFORMER_RESULT_ENVELOPE_BYTES)?;
        self.accept_conformer_extraction_chunk(owner, result)
    }

    fn accept_conformer_extraction_chunk(
        &self,
        owner: &str,
        result: ConformerChunkResult,
    ) -> ComputeResult<ConformerSubmissionStep> {
        let ready = self.ready()?;
        let session_id = result.session_id;
        let mut pending = {
            let mut submissions = ready
                .conformer_submissions
                .lock()
                .map_err(|_| poisoned("conformer submission registry"))?;
            let submission =
                submissions
                    .get(&session_id)
                    .ok_or_else(|| ComputeCoordinatorError::NotFound {
                        entity: "conformer extraction session",
                        id: session_id.to_string(),
                    })?;
            if submission.session.owner() != owner {
                return Err(ComputeCoordinatorError::Forbidden(
                    "conformer extraction session belongs to another window".into(),
                ));
            }
            submissions
                .remove(&session_id)
                .expect("submission was checked while holding the registry lock")
        };
        let next = match pending.session.accept_chunk(result) {
            Ok(next) => next,
            Err(error) => {
                ready
                    .conformer_submissions
                    .lock()
                    .map_err(|_| poisoned("conformer submission registry"))?
                    .insert(session_id, pending);
                return Err(error);
            }
        };
        if let Some(chunk) = next {
            ready
                .conformer_submissions
                .lock()
                .map_err(|_| poisoned("conformer submission registry"))?
                .insert(session_id, pending);
            return Ok(ConformerSubmissionStep {
                session_id,
                conformer_chunk: Some(chunk),
                job: None,
                ready_for_execution: false,
            });
        }

        let PendingConformerSubmission {
            request,
            frozen,
            publication_attempt_id,
            job_id,
            pinned_runtime,
            distance_admission,
            stereo_admission,
            created_at_ms,
            session,
        } = pending;
        let completed = session.finish()?;
        let snapshot_id = frozen.reference.snapshot_id;
        let result = self.finish_conformer_submission(
            ready,
            owner,
            request,
            frozen,
            publication_attempt_id,
            job_id,
            pinned_runtime,
            distance_admission,
            stereo_admission,
            created_at_ms,
            completed,
        );
        if result.is_err() {
            ready.snapshots.rollback_uncommitted_publication(
                &ready.store,
                snapshot_id,
                job_id,
                publication_attempt_id,
            )?;
        }
        result.map(|job| ConformerSubmissionStep {
            session_id,
            conformer_chunk: None,
            job: Some(job),
            ready_for_execution: true,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn finish_conformer_submission(
        &self,
        ready: &ReadyCoordinator,
        owner: &str,
        request: ConformerV1SubmitRequest,
        frozen: FrozenGridSnapshot,
        publication_attempt_id: Uuid,
        job_id: Uuid,
        pinned_runtime: RuntimeIdentity,
        distance_admission: ConformerBackendAdmission,
        stereo_admission: ConformerBackendAdmission,
        created_at_ms: u64,
        completed: CompletedConformerExtraction,
    ) -> ComputeResult<JobSnapshot> {
        let CompletedConformerExtraction {
            arrays,
            identities,
            errors,
            mmff_parameters,
            mmff_errors,
            input_positions,
            verified,
        } = completed;
        if verified.reference() != &frozen.reference {
            return Err(ComputeCoordinatorError::Protocol(
                "conformer extraction source differs from its frozen snapshot".into(),
            ));
        }
        let preflight = derive_conformer_v1_preflight(
            &request,
            &arrays,
            &identities,
            frozen
                .reference
                .frozen_source
                .ordered_record_molecule_identity_sha256
                .clone(),
        )
        .map_err(conformer_admission_error)?;
        let source = ready.snapshots.bind_conformer_source(request, frozen)?;
        let snapshot = build_queued_conformer_v1_job(QueuedConformerV1JobInput {
            job_id,
            owner_surface: OwnerSurface::Desktop,
            source,
            preflight,
            pinned_runtime,
            engines: ready.engines.conformer_identities().clone(),
            distance_admission,
            stereo_admission,
            created_at_ms,
        })
        .map_err(conformer_admission_error)?;
        let mut prepared = ready
            .prepared_conformers
            .lock()
            .map_err(|_| poisoned("prepared conformer registry"))?;
        if prepared.contains_key(&job_id) {
            return Err(ComputeCoordinatorError::Protocol(
                "duplicate prepared conformer job ID".into(),
            ));
        }
        ready
            .store
            .insert_prepared_job(owner, &snapshot, publication_attempt_id)?;
        prepared.insert(
            job_id,
            PreparedConformerBatch {
                arrays,
                identities,
                errors,
                mmff_parameters,
                mmff_errors,
                input_positions,
            },
        );
        Ok(snapshot)
    }

    pub(crate) fn get_job(&self, owner: &str, job_id: Uuid) -> ComputeResult<JobSnapshot> {
        self.store()?.get_job(owner, job_id)
    }

    pub(crate) fn execute_conformer_distance_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<ConformerDistanceExecutionStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let queued = ready.store.get_job(owner, job_id)?;
        if queued.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: queued.revision,
            });
        }
        queued.request.as_conformer()?;
        {
            let prepared = ready
                .prepared_conformers
                .lock()
                .map_err(|_| poisoned("prepared conformer registry"))?;
            if !prepared.contains_key(&job_id) {
                return Err(ComputeCoordinatorError::NotFound {
                    entity: "prepared conformer",
                    id: job_id.to_string(),
                });
            }
        }

        let freeze_running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            now_ms(),
            "Verifying frozen conformer source",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, queued.revision, &freeze_running)?;
        let freeze_succeeded = finish_stage(
            &freeze_running,
            0,
            JobState::Preparing,
            now_ms(),
            "Frozen conformer source verified",
            StageFinishMetrics::default(),
        )?;
        ready
            .store
            .apply_successor(owner, freeze_running.revision, &freeze_succeeded)?;
        let input_geometry = freeze_succeeded
            .request
            .as_conformer()?
            .parameters
            .initialization
            == burrete_compute_protocol::ConformerInitialization::InputGeometry;
        let constraints_running = start_stage(
            &freeze_succeeded,
            1,
            JobState::Preparing,
            now_ms(),
            if input_geometry {
                "Binding verified RDKit MMFF parameters and input coordinates"
            } else {
                "Binding verified RDKit conformer constraints"
            },
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, freeze_succeeded.revision, &constraints_running)?;
        let engine_pack_bytes = {
            let prepared = ready
                .prepared_conformers
                .lock()
                .map_err(|_| poisoned("prepared conformer registry"))?;
            prepared
                .get(&job_id)
                .expect("prepared conformer checked above")
                .arrays
                .payload_bytes()
                .map_err(|error| ComputeCoordinatorError::Protocol(error.to_string()))?
        };
        let numeric_state = if constraints_running.stages[2].effective_backend.is_gpu() {
            JobState::WaitingGpu
        } else {
            JobState::Running
        };
        let constraints_succeeded = finish_stage(
            &constraints_running,
            1,
            numeric_state,
            now_ms(),
            if input_geometry {
                "RDKit MMFF parameters and input coordinates ready"
            } else {
                "RDKit conformer constraints ready"
            },
            StageFinishMetrics {
                transferred_bytes: engine_pack_bytes,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, constraints_running.revision, &constraints_succeeded)?;
        let gpu_stage = constraints_succeeded.stages[2].effective_backend == Backend::NativeMetal;
        let start_evidence = if gpu_stage {
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => StageStartEvidence {
                    device: Some(runtime.device_identity().name.clone()),
                    kernel_id: Some(if input_geometry {
                        "burrete.compute.mmff-input-geometry.v1:bfgs+lbfgs+retry.v1".into()
                    } else {
                        "burrete.compute.conformer.v1:initialize+dg-lbfgs+etk-lbfgs+stereo-retry.v1"
                            .into()
                    }),
                },
                NativeMetalState::Unavailable { message, .. } => {
                    return Err(ComputeCoordinatorError::Unavailable(format!(
                        "the admitted Metal runtime became unavailable: {message}"
                    )))
                }
            }
        } else {
            StageStartEvidence::default()
        };
        let distance_running = start_stage(
            &constraints_succeeded,
            2,
            JobState::Running,
            now_ms(),
            if input_geometry {
                "Optimizing supplied input geometries"
            } else {
                "Generating adaptive conformer batches"
            },
            start_evidence,
        )?;
        ready
            .store
            .apply_successor(owner, constraints_succeeded.revision, &distance_running)?;
        let prepared = ready
            .prepared_conformers
            .lock()
            .map_err(|_| poisoned("prepared conformer registry"))?
            .remove(&job_id)
            .expect("prepared conformer checked above");
        let engine_arrays = prepared.arrays.clone();
        let request = distance_running.request.as_conformer()?;
        let started = Instant::now();
        let result = execute_conformer_distance_geometry_with_service(
            job_id,
            request,
            prepared.arrays,
            &prepared.identities,
            &prepared.mmff_parameters,
            &prepared.input_positions,
            distance_running.stages[2].effective_backend,
            distance_running.stages[3].effective_backend,
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => Some(runtime),
                NativeMetalState::Unavailable { .. } => None,
            },
            ready.compute_service.as_ref(),
        );
        let host_time_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let distance = match result {
            Ok(distance) => distance,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &distance_running,
                    2,
                    if gpu_stage {
                        ComputeErrorCode::GpuExecutionFailed
                    } else {
                        ComputeErrorCode::NumericalFailure
                    },
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let conformer_count = distance.conformer_count();
        let failed_source_records = prepared
            .errors
            .iter()
            .filter(|error| error.is_some())
            .count();
        let distance_succeeded = finish_stage(
            &distance_running,
            2,
            JobState::Running,
            now_ms(),
            if input_geometry {
                "MMFF-optimized input geometries ready for final validation"
            } else {
                "Stereo-retried conformer candidates ready for final validation"
            },
            StageFinishMetrics {
                host_time_ms,
                gpu_time_ms: distance.gpu_time_ms.map(|value| value as f64),
                transferred_bytes: distance.positions.len() as u64 * 3 * 4,
            },
        )?;
        ready
            .store
            .apply_successor(owner, distance_running.revision, &distance_succeeded)?;
        let computed = ComputedConformerBatch {
            engine_arrays,
            distance,
            stereo: None,
            identities: prepared.identities,
            errors: prepared.errors,
            mmff_errors: prepared.mmff_errors,
        };
        if ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .insert(job_id, computed)
            .is_some()
        {
            return Err(ComputeCoordinatorError::Protocol(
                "computed conformer result already exists for this job".into(),
            ));
        }
        Ok(ConformerDistanceExecutionStep {
            job: distance_succeeded,
            conformer_count,
            failed_source_records,
            ready_for_stereo: true,
        })
    }

    pub(crate) fn execute_conformer_stereo_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<ConformerStereoExecutionStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let distance_succeeded = ready.store.get_job(owner, job_id)?;
        if distance_succeeded.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: distance_succeeded.revision,
            });
        }
        let request = distance_succeeded.request.as_conformer()?;
        let backend = distance_succeeded.stages[3].effective_backend;
        let gpu_stage = backend == Backend::NativeMetal;
        let start_evidence = if gpu_stage {
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => StageStartEvidence {
                    device: Some(runtime.device_identity().name.clone()),
                    kernel_id: Some("burrete.compute.conformer-stereo.v1".into()),
                },
                NativeMetalState::Unavailable { message, .. } => {
                    return Err(ComputeCoordinatorError::Unavailable(format!(
                        "the admitted Metal runtime became unavailable: {message}"
                    )))
                }
            }
        } else {
            StageStartEvidence::default()
        };
        let stereo_running = start_stage(
            &distance_succeeded,
            3,
            JobState::Running,
            now_ms(),
            "Validating conformer stereochemistry",
            start_evidence,
        )?;
        ready
            .store
            .apply_successor(owner, distance_succeeded.revision, &stereo_running)?;
        let mut computed = ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .remove(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "computed conformer",
                id: job_id.to_string(),
            })?;
        if computed.stereo.is_some() {
            return Err(ComputeCoordinatorError::Protocol(
                "conformer stereo validation already exists for this job".into(),
            ));
        }
        let started = Instant::now();
        let result = execute_conformer_stereo_validation(
            &computed.distance,
            backend,
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => Some(runtime),
                NativeMetalState::Unavailable { .. } => None,
            },
            request.limits.max_memory_bytes,
        );
        let host_time_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let stereo = match result {
            Ok(stereo) => stereo,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &stereo_running,
                    3,
                    if gpu_stage {
                        ComputeErrorCode::GpuExecutionFailed
                    } else {
                        ComputeErrorCode::NumericalFailure
                    },
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let conformer_count = stereo.failure_flags.len();
        let passed_count = stereo.passed_count;
        let stereo_succeeded = finish_stage(
            &stereo_running,
            3,
            JobState::Validating,
            now_ms(),
            "Conformer stereochemistry validated",
            StageFinishMetrics {
                host_time_ms,
                gpu_time_ms: stereo.gpu_time_ms.map(|value| value as f64),
                transferred_bytes: conformer_count as u64 * 4,
            },
        )?;
        ready
            .store
            .apply_successor(owner, stereo_running.revision, &stereo_succeeded)?;
        computed.stereo = Some(stereo);
        ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .insert(job_id, computed);
        Ok(ConformerStereoExecutionStep {
            job: stereo_succeeded,
            conformer_count,
            passed_count,
            failed_count: conformer_count - passed_count,
            ready_for_validation: true,
        })
    }

    pub(crate) fn validate_conformer_reference_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<ConformerReferenceValidationStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let stereo_succeeded = ready.store.get_job(owner, job_id)?;
        if stereo_succeeded.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: stereo_succeeded.revision,
            });
        }
        let validation_running = start_stage(
            &stereo_succeeded,
            4,
            JobState::Validating,
            now_ms(),
            "Comparing conformers with the CPU numerical reference",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, stereo_succeeded.revision, &validation_running)?;
        let computed = ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .remove(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "computed conformer",
                id: job_id.to_string(),
            })?;
        let stereo = computed.stereo.as_ref().ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "conformer reference validation requires stereo results".into(),
            )
        })?;
        let started = Instant::now();
        let validation = validate_conformer_reference(&computed.distance, stereo);
        let host_time_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let validation = match validation {
            Ok(validation) => validation,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &validation_running,
                    4,
                    ComputeErrorCode::ValidationMismatch,
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let validation_succeeded = finish_stage(
            &validation_running,
            4,
            JobState::Publishing,
            now_ms(),
            "Conformer CPU reference validation passed",
            StageFinishMetrics {
                host_time_ms,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, validation_running.revision, &validation_succeeded)?;
        ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .insert(job_id, computed);
        Ok(ConformerReferenceValidationStep {
            job: validation_succeeded,
            conformer_count: validation.conformer_count,
            passed_count: validation.passed_count,
            failed_count: validation.failed_count,
            ready_for_publication: true,
        })
    }

    pub(crate) fn publish_conformer_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
        grid_lease: GridSnapshotLease,
    ) -> ComputeResult<ConformerPublicationStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let validated = ready.store.get_job(owner, job_id)?;
        if validated.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: validated.revision,
            });
        }
        if grid_lease.namespaced_document_id()
            != runtime_document_id(owner, &validated.request.source().document_id)
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid lease does not belong to the conformer job".into(),
            ));
        }
        let publish_running = start_stage(
            &validated,
            5,
            JobState::Publishing,
            now_ms(),
            "Publishing verified conformer result packs",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, validated.revision, &publish_running)?;
        let computed = ready
            .computed_conformers
            .lock()
            .map_err(|_| poisoned("computed conformer registry"))?
            .remove(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "computed conformer",
                id: job_id.to_string(),
            })?;
        let stereo = computed.stereo.as_ref().ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "conformer publication requires stereo results".into(),
            )
        })?;
        let publish_started = Instant::now();
        let created_at_ms = now_ms().max(publish_running.updated_at_ms);
        let materialized = match materialize_conformer_artifact(
            &ready.store,
            &publish_running,
            &computed.engine_arrays,
            &computed.distance,
            stereo,
            created_at_ms,
        ) {
            Ok(artifact) => artifact,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    5,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let mut successful_sources = vec![false; computed.errors.len()];
        for (conformer, failure) in stereo.failure_flags.iter().enumerate() {
            if *failure == 0 {
                let record = computed.distance.conformer_molecule_indices[conformer] as usize;
                successful_sources[record] = true;
            }
        }
        for (successful, error) in successful_sources.iter_mut().zip(&computed.errors) {
            *successful &= error.is_none();
        }
        let successful_records = successful_sources.iter().filter(|value| **value).count() as u64;
        let total_records = validated.frozen_source.frozen_source.record_count;
        let failed_records = total_records
            .checked_sub(successful_records)
            .ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "conformer outcome record count underflowed".into(),
                )
            })?;
        let publication = (|| {
            let successful_job = finish_publish_stage(
                &publish_running,
                materialized.created_at_ms,
                materialized.artifact_id,
                materialized.result_pack.clone(),
                JobOutcomeSummary {
                    successful_records,
                    failed_records,
                },
                StageFinishMetrics {
                    host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                    transferred_bytes: materialized.byte_count,
                    ..StageFinishMetrics::default()
                },
            )?;
            let manifest = materialized.manifest_for_job(&successful_job)?;
            let manifest_sha256 = artifact_manifest_sha256(&manifest)?;
            Ok((successful_job, manifest, manifest_sha256))
        })();
        let (successful_job, manifest, manifest_sha256) = match publication {
            Ok(publication) => publication,
            Err(error) => {
                let cleanup = materialized.cleanup();
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    5,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                        ..StageFinishMetrics::default()
                    },
                )?;
                cleanup?;
                return Err(error);
            }
        };
        if let Err(error) = ready.store.commit_published_artifact(
            owner,
            publish_running.revision,
            &successful_job,
            &manifest,
            &materialized.relative_directory,
        ) {
            let cleanup = materialized.cleanup();
            persist_failed_stage(
                &ready.store,
                owner,
                &publish_running,
                5,
                ComputeErrorCode::ArtifactCorrupt,
                &error,
                StageFinishMetrics {
                    host_time_ms: publish_started.elapsed().as_secs_f64() * 1_000.0,
                    ..StageFinishMetrics::default()
                },
            )?;
            cleanup?;
            return Err(error);
        }
        let mut assignments = computed
            .identities
            .iter()
            .enumerate()
            .map(|(record, identity)| GridConformerAssignmentInput {
                source_index: identity.source_record_id,
                molecule_content_sha256: identity.molecule_content_sha256.clone(),
                conformer_count: 0,
                passed_count: 0,
                best_etk_energy: None,
                best_mmff_energy: None,
                error: computed.errors[record].clone(),
                mmff_error: computed.mmff_errors[record].clone(),
            })
            .collect::<Vec<_>>();
        for conformer in 0..computed.distance.conformer_count() {
            let record = computed.distance.conformer_molecule_indices[conformer] as usize;
            assignments[record].conformer_count += 1;
            if stereo.failure_flags[conformer] == 0 {
                assignments[record].passed_count += 1;
                let energy = f64::from(computed.distance.etk_energies[conformer]);
                assignments[record].best_etk_energy = Some(
                    assignments[record]
                        .best_etk_energy
                        .map_or(energy, |current| current.min(energy)),
                );
                if matches!(computed.distance.mmff_statuses[conformer], 0 | 1) {
                    let energy = f64::from(computed.distance.mmff_energies[conformer]);
                    assignments[record].best_mmff_energy = Some(
                        assignments[record]
                            .best_mmff_energy
                            .map_or(energy, |current| current.min(energy)),
                    );
                }
            }
        }
        let grid_input = GridConformerAnalysisApplyInput {
            run_id: successful_job.job_id,
            document_fingerprint_sha256: successful_job
                .frozen_source
                .frozen_source
                .document_fingerprint_sha256
                .clone(),
            source_revision: successful_job.frozen_source.frozen_source.source_revision,
            snapshot_id: successful_job.frozen_source.snapshot_id,
            snapshot_sha256: successful_job.frozen_source.snapshot_sha256.clone(),
            normalized_settings_sha256: successful_job.normalized_request_sha256.clone(),
            provenance: serde_json::json!({
                "jobId": successful_job.job_id,
                "artifactId": materialized.artifact_id,
                "artifactManifestSha256": manifest_sha256,
                "runtime": successful_job.pinned_runtime,
                "distanceStage": successful_job.stages[2],
                "stereoStage": successful_job.stages[3],
                "referenceStage": successful_job.stages[4],
                "conformerVariant": successful_job.request.as_conformer()?.parameters.variant,
                "initialization": successful_job.request.as_conformer()?.parameters.initialization,
                "mmffVariant": successful_job.request.as_conformer()?.parameters.mmff_variant,
            }),
            created_at_ms: materialized.created_at_ms,
            artifact_id: materialized.artifact_id,
            artifact_manifest_sha256: manifest_sha256.clone(),
            initialization: successful_job
                .request
                .as_conformer()?
                .parameters
                .initialization,
            mmff_variant: successful_job
                .request
                .as_conformer()?
                .parameters
                .mmff_variant,
            assignments,
        };
        let (grid_applied, grid_warning) = match apply_conformer_analysis_run(
            grid_lease.database_path_for_freeze(),
            &grid_input,
        ) {
            Ok(()) => (true, None),
            Err(error) => (false, Some(error.chars().take(1_900).collect())),
        };
        Ok(ConformerPublicationStep {
            job: successful_job,
            artifact_id: materialized.artifact_id,
            artifact_manifest_sha256: manifest_sha256,
            grid_applied,
            grid_warning,
            primary_open_path: materialized
                .conformer_xyz_path()
                .to_string_lossy()
                .into_owned(),
            report_path: materialized.report_path().to_string_lossy().into_owned(),
        })
    }

    pub(crate) fn begin_cluster_v1_execution(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
        source_lease: GridSnapshotLease,
    ) -> ComputeResult<FingerprintExecutionStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let queued = ready.store.get_job(owner, job_id)?;
        if queued.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: queued.revision,
            });
        }
        if source_lease.namespaced_document_id()
            != runtime_document_id(owner, &queued.request.source().document_id)
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid lease does not belong to the queued compute job".into(),
            ));
        }
        let verified = ready
            .snapshots
            .open_verified_source(&queued.frozen_source)?;
        let (session, first_chunk) =
            FingerprintSession::start(owner, &queued, source_lease, verified)?;
        let at_ms = now_ms();
        let freeze_running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            at_ms,
            "Verifying frozen Grid source",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, queued.revision, &freeze_running)?;
        let freeze_succeeded = finish_stage(
            &freeze_running,
            0,
            JobState::Preparing,
            at_ms,
            "Frozen Grid source verified",
            StageFinishMetrics {
                host_time_ms: 0.0,
                transferred_bytes: queued.frozen_source.manifest.byte_length,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, freeze_running.revision, &freeze_succeeded)?;
        let fingerprints_running = start_stage(
            &freeze_succeeded,
            1,
            JobState::Preparing,
            at_ms,
            "Calculating RDKit Morgan fingerprints",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, freeze_succeeded.revision, &fingerprints_running)?;
        let mut sessions = ready
            .fingerprint_sessions
            .lock()
            .map_err(|_| poisoned("fingerprint session registry"))?;
        if sessions.insert(job_id, session).is_some() {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: fingerprints_running.revision,
            });
        }
        Ok(FingerprintExecutionStep {
            job: fingerprints_running,
            fingerprint_chunk: Some(first_chunk),
            ready_for_compute: false,
        })
    }

    pub(crate) fn submit_fingerprint_chunk(
        &self,
        owner: &str,
        result: FingerprintChunkResult,
    ) -> ComputeResult<FingerprintExecutionStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let job_id = result.job_id;
        let mut session = {
            let mut sessions = ready
                .fingerprint_sessions
                .lock()
                .map_err(|_| poisoned("fingerprint session registry"))?;
            let session =
                sessions
                    .get(&job_id)
                    .ok_or_else(|| ComputeCoordinatorError::NotFound {
                        entity: "fingerprint session",
                        id: job_id.to_string(),
                    })?;
            if session.owner() != owner || session.session_id() != result.session_id {
                return Err(ComputeCoordinatorError::Forbidden(
                    "fingerprint result does not belong to this window session".into(),
                ));
            }
            sessions
                .remove(&job_id)
                .expect("session was checked while holding the registry lock")
        };
        let next = match session.accept_chunk(result) {
            Ok(next) => next,
            Err(error) => {
                ready
                    .fingerprint_sessions
                    .lock()
                    .map_err(|_| poisoned("fingerprint session registry"))?
                    .insert(job_id, session);
                return Err(error);
            }
        };
        if let Some(chunk) = next {
            let mut sessions = ready
                .fingerprint_sessions
                .lock()
                .map_err(|_| poisoned("fingerprint session registry"))?;
            let job = ready.store.get_job(owner, job_id)?;
            if job.state == JobState::CancelRequested || job.state == JobState::Cancelled {
                return Err(ComputeCoordinatorError::Validation(
                    "fingerprint job was cancelled".into(),
                ));
            }
            sessions.insert(job_id, session);
            return Ok(FingerprintExecutionStep {
                job,
                fingerprint_chunk: Some(chunk),
                ready_for_compute: false,
            });
        }

        let batch = session.finish()?;
        let running = ready.store.get_job(owner, job_id)?;
        let fingerprint_stage = &running.stages[1];
        let started_at_ms = fingerprint_stage.started_at_ms.ok_or_else(|| {
            ComputeCoordinatorError::Protocol("fingerprint stage has no start time".into())
        })?;
        let at_ms = now_ms().max(running.updated_at_ms);
        let failed = batch.errors.iter().filter(|error| error.is_some()).count();
        let message = if failed == 0 {
            "RDKit Morgan fingerprints ready".to_string()
        } else {
            format!("RDKit Morgan fingerprints ready ({failed} records failed)")
        };
        let next_state = if running.stages[2].effective_backend.is_gpu() {
            JobState::WaitingGpu
        } else {
            JobState::Running
        };
        let fingerprint_bytes = u64::try_from(batch.fingerprints.len())
            .ok()
            .and_then(|count| count.checked_mul(burrete_compute_core::FINGERPRINT_BYTES as u64))
            .ok_or_else(|| {
                ComputeCoordinatorError::Protocol("fingerprint byte count overflowed".into())
            })?;
        let succeeded = finish_stage(
            &running,
            1,
            next_state,
            at_ms,
            &message,
            StageFinishMetrics {
                host_time_ms: (at_ms - started_at_ms) as f64,
                transferred_bytes: fingerprint_bytes,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, running.revision, &succeeded)?;
        let mut prepared = ready
            .prepared_clusters
            .lock()
            .map_err(|_| poisoned("prepared cluster registry"))?;
        if prepared.insert(job_id, batch).is_some() {
            return Err(ComputeCoordinatorError::Protocol(
                "prepared cluster result already exists for this job".into(),
            ));
        }
        Ok(FingerprintExecutionStep {
            job: succeeded,
            fingerprint_chunk: None,
            ready_for_compute: true,
        })
    }

    pub(crate) fn list_jobs(&self, owner: &str, limit: usize) -> ComputeResult<Vec<JobSnapshot>> {
        self.store()?.list_jobs(owner, limit)
    }

    pub(crate) fn execute_cluster_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<ClusterExecutionStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let before_numeric = ready.store.get_job(owner, job_id)?;
        if before_numeric.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: before_numeric.revision,
            });
        }
        {
            let prepared = ready
                .prepared_clusters
                .lock()
                .map_err(|_| poisoned("prepared cluster registry"))?;
            let batch = prepared
                .get(&job_id)
                .ok_or_else(|| ComputeCoordinatorError::NotFound {
                    entity: "prepared cluster",
                    id: job_id.to_string(),
                })?;
            if batch.grid_lease.namespaced_document_id()
                != runtime_document_id(owner, &before_numeric.request.source().document_id)
            {
                return Err(ComputeCoordinatorError::Forbidden(
                    "prepared cluster does not belong to this Grid window".into(),
                ));
            }
        }

        let gpu_stage = before_numeric.stages[2].effective_backend == Backend::NativeMetal;
        let start_evidence = if gpu_stage {
            match &ready.native_metal {
                NativeMetalState::Available(runtime) => StageStartEvidence {
                    device: Some(runtime.device_identity().name.clone()),
                    kernel_id: Some("burrete.compute.tanimoto.v2:neighbor-graph.v1".into()),
                },
                NativeMetalState::Unavailable { message, .. } => {
                    return Err(ComputeCoordinatorError::Unavailable(format!(
                        "the admitted Metal runtime became unavailable: {message}"
                    )))
                }
            }
        } else {
            StageStartEvidence::default()
        };
        let numeric_running = start_stage(
            &before_numeric,
            2,
            JobState::Running,
            now_ms(),
            "Building the blockwise Tanimoto neighbor graph",
            start_evidence,
        )?;
        ready
            .store
            .apply_successor(owner, before_numeric.revision, &numeric_running)?;
        let batch = ready
            .prepared_clusters
            .lock()
            .map_err(|_| poisoned("prepared cluster registry"))?
            .remove(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "prepared cluster",
                id: job_id.to_string(),
            })?;

        let numeric_started = Instant::now();
        let numeric_result = (|| {
            let (valid, valid_ordinals) = valid_fingerprints(&batch)?;
            let options = graph_options(&numeric_running)?;
            let cutoff = numeric_running
                .request
                .as_cluster()?
                .parameters
                .similarity
                .cutoff;
            let (graph, gpu_time_ms) = match numeric_running.stages[2].effective_backend {
                Backend::NativeMetal => match &ready.native_metal {
                    NativeMetalState::Available(runtime) => {
                        if let Some(service) = &ready.compute_service {
                            let (graph, gpu_time_ms) = service
                                .build_tanimoto_graph(job_id, &valid, cutoff, options)
                                .map_err(|error| {
                                    ComputeCoordinatorError::Unavailable(format!(
                                        "native Metal compute service execution failed: {error}"
                                    ))
                                })?;
                            (graph, Some(gpu_time_ms as f64))
                        } else {
                            let execution = runtime
                                .build_graph_profiled(&valid, cutoff, options)
                                .map_err(metal_execution_error)?;
                            (execution.graph, Some(execution.gpu_time_ms as f64))
                        }
                    }
                    NativeMetalState::Unavailable { message, .. } => {
                        return Err(ComputeCoordinatorError::Unavailable(message.clone()))
                    }
                },
                Backend::ReferenceCpu => (
                    build_tanimoto_graph(&valid, cutoff, options)
                        .map_err(|error| ComputeCoordinatorError::Validation(error.to_string()))?,
                    None,
                ),
                backend => {
                    return Err(ComputeCoordinatorError::Protocol(format!(
                        "unsupported numeric backend in an admitted cluster job: {backend:?}"
                    )))
                }
            };
            Ok((graph, valid_ordinals, gpu_time_ms))
        })();
        let numeric_host_ms = numeric_started.elapsed().as_secs_f64() * 1_000.0;
        let (graph, valid_ordinals, gpu_time_ms) = match numeric_result {
            Ok(result) => result,
            Err(error) => {
                let code = if gpu_stage {
                    ComputeErrorCode::GpuExecutionFailed
                } else {
                    ComputeErrorCode::NumericalFailure
                };
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &numeric_running,
                    2,
                    code,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: numeric_host_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let numeric_bytes = graph_bytes(&graph, batch.fingerprints.len())?;
        let numeric_succeeded = finish_stage(
            &numeric_running,
            2,
            JobState::Running,
            now_ms(),
            "Tanimoto neighbor graph ready",
            StageFinishMetrics {
                host_time_ms: numeric_host_ms,
                gpu_time_ms,
                transferred_bytes: numeric_bytes,
            },
        )?;
        ready
            .store
            .apply_successor(owner, numeric_running.revision, &numeric_succeeded)?;

        let butina_running = start_stage(
            &numeric_succeeded,
            3,
            JobState::Running,
            now_ms(),
            "Selecting deterministic Butina clusters",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, numeric_succeeded.revision, &butina_running)?;
        let butina_started = Instant::now();
        let clustered = finish_clustering(batch, valid_ordinals, graph, &butina_running);
        let butina_host_ms = butina_started.elapsed().as_secs_f64() * 1_000.0;
        let (computation, counts) = match clustered {
            Ok(result) => result,
            Err(error) => {
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &butina_running,
                    3,
                    ComputeErrorCode::NumericalFailure,
                    &error,
                    StageFinishMetrics {
                        host_time_ms: butina_host_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let butina_succeeded = finish_stage(
            &butina_running,
            3,
            JobState::Validating,
            now_ms(),
            "Deterministic Butina clusters ready",
            StageFinishMetrics {
                host_time_ms: butina_host_ms,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, butina_running.revision, &butina_succeeded)?;

        let validation_running = start_stage(
            &butina_succeeded,
            4,
            JobState::Validating,
            now_ms(),
            "Validating cluster identities and assignments",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, butina_succeeded.revision, &validation_running)?;
        let validation_started = Instant::now();
        let validation = validate_computation(
            &computation,
            validation_running.frozen_source.frozen_source.record_count,
        );
        let validation_host_ms = validation_started.elapsed().as_secs_f64() * 1_000.0;
        if let Err(error) = validation {
            persist_failed_stage(
                &ready.store,
                owner,
                &validation_running,
                4,
                ComputeErrorCode::ValidationMismatch,
                &error,
                StageFinishMetrics {
                    host_time_ms: validation_host_ms,
                    ..StageFinishMetrics::default()
                },
            )?;
            return Err(error);
        }
        let validation_succeeded = finish_stage(
            &validation_running,
            4,
            JobState::Publishing,
            now_ms(),
            "Cluster result validation passed",
            StageFinishMetrics {
                host_time_ms: validation_host_ms,
                ..StageFinishMetrics::default()
            },
        )?;
        ready
            .store
            .apply_successor(owner, validation_running.revision, &validation_succeeded)?;
        let mut computed = ready
            .computed_clusters
            .lock()
            .map_err(|_| poisoned("computed cluster registry"))?;
        let durable = ready.store.get_job(owner, job_id)?;
        if durable.revision != validation_succeeded.revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision: validation_succeeded.revision,
                actual_revision: durable.revision,
            });
        }
        if computed.insert(job_id, computation).is_some() {
            return Err(ComputeCoordinatorError::Protocol(
                "computed cluster result already exists for this job".into(),
            ));
        }
        Ok(ClusterExecutionStep {
            job: validation_succeeded,
            successful_records: counts.successful_records,
            failed_records: counts.failed_records,
            cluster_count: counts.cluster_count,
            ready_for_publish: true,
        })
    }

    pub(crate) fn publish_cluster_v1(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<ClusterPublicationStep> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let before_publish = ready.store.get_job(owner, job_id)?;
        if before_publish.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: before_publish.revision,
            });
        }
        {
            let computed = ready
                .computed_clusters
                .lock()
                .map_err(|_| poisoned("computed cluster registry"))?;
            let computation =
                computed
                    .get(&job_id)
                    .ok_or_else(|| ComputeCoordinatorError::NotFound {
                        entity: "computed cluster",
                        id: job_id.to_string(),
                    })?;
            if computation.grid_lease.namespaced_document_id()
                != runtime_document_id(owner, &before_publish.request.source().document_id)
            {
                return Err(ComputeCoordinatorError::Forbidden(
                    "computed cluster does not belong to this Grid window".into(),
                ));
            }
        }
        let publish_running = start_stage(
            &before_publish,
            5,
            JobState::Publishing,
            now_ms(),
            "Publishing verified cluster result packs",
            StageStartEvidence::default(),
        )?;
        ready
            .store
            .apply_successor(owner, before_publish.revision, &publish_running)?;
        let computation = ready
            .computed_clusters
            .lock()
            .map_err(|_| poisoned("computed cluster registry"))?
            .remove(&job_id)
            .ok_or_else(|| ComputeCoordinatorError::NotFound {
                entity: "computed cluster",
                id: job_id.to_string(),
            })?;

        let publish_started = Instant::now();
        let created_at_ms = now_ms().max(publish_running.updated_at_ms);
        let materialized = match materialize_cluster_artifact(
            &ready.store,
            &publish_running,
            &computation,
            created_at_ms,
        ) {
            Ok(artifact) => artifact,
            Err(error) => {
                let host_time_ms = publish_started.elapsed().as_secs_f64() * 1_000.0;
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    5,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                return Err(error);
            }
        };
        let publication = (|| {
            let failed_records = computation
                .errors
                .iter()
                .filter(|error| error.is_some())
                .count() as u64;
            let total_records = before_publish.frozen_source.frozen_source.record_count;
            let successful_records =
                total_records.checked_sub(failed_records).ok_or_else(|| {
                    ComputeCoordinatorError::Protocol(
                        "published outcome record count underflowed".into(),
                    )
                })?;
            let publish_host_ms = publish_started.elapsed().as_secs_f64() * 1_000.0;
            let successful_job = finish_publish_stage(
                &publish_running,
                materialized.created_at_ms,
                materialized.artifact_id,
                materialized.result_pack.clone(),
                JobOutcomeSummary {
                    successful_records,
                    failed_records,
                },
                StageFinishMetrics {
                    host_time_ms: publish_host_ms,
                    transferred_bytes: materialized.byte_count,
                    ..StageFinishMetrics::default()
                },
            )?;
            let manifest = materialized.manifest_for_job(&successful_job)?;
            let manifest_sha256 = artifact_manifest_sha256(&manifest)?;
            Ok((successful_job, manifest, manifest_sha256))
        })();
        let (successful_job, manifest, manifest_sha256) = match publication {
            Ok(publication) => publication,
            Err(error) => {
                let cleanup = materialized.cleanup();
                let host_time_ms = publish_started.elapsed().as_secs_f64() * 1_000.0;
                persist_failed_stage(
                    &ready.store,
                    owner,
                    &publish_running,
                    5,
                    ComputeErrorCode::ArtifactCorrupt,
                    &error,
                    StageFinishMetrics {
                        host_time_ms,
                        ..StageFinishMetrics::default()
                    },
                )?;
                if let Err(cleanup_error) = cleanup {
                    return Err(ComputeCoordinatorError::Filesystem(format!(
                        "artifact publication failed ({error}) and cleanup failed ({cleanup_error})"
                    )));
                }
                return Err(error);
            }
        };
        if let Err(error) = ready.store.commit_published_artifact(
            owner,
            publish_running.revision,
            &successful_job,
            &manifest,
            &materialized.relative_directory,
        ) {
            let cleanup = materialized.cleanup();
            if let Err(cleanup_error) = cleanup {
                return Err(ComputeCoordinatorError::Filesystem(format!(
                    "artifact commit failed ({error}) and cleanup failed ({cleanup_error})"
                )));
            }
            let host_time_ms = publish_started.elapsed().as_secs_f64() * 1_000.0;
            persist_failed_stage(
                &ready.store,
                owner,
                &publish_running,
                5,
                ComputeErrorCode::ArtifactCorrupt,
                &error,
                StageFinishMetrics {
                    host_time_ms,
                    ..StageFinishMetrics::default()
                },
            )?;
            return Err(error);
        }

        let assignments = computation
            .identities
            .iter()
            .enumerate()
            .map(|(ordinal, identity)| GridClusterAssignmentInput {
                source_index: identity.source_record_id,
                molecule_content_sha256: identity.molecule_content_sha256.clone(),
                cluster_id: computation.cluster_ids[ordinal],
                representative: computation.representatives[ordinal],
                error: computation.errors[ordinal].clone(),
            })
            .collect();
        let cluster_request = successful_job.request.as_cluster()?;
        let grid_input = GridClusterAnalysisApplyInput {
            run_id: successful_job.job_id,
            document_fingerprint_sha256: successful_job
                .frozen_source
                .frozen_source
                .document_fingerprint_sha256
                .clone(),
            source_revision: successful_job.frozen_source.frozen_source.source_revision,
            snapshot_id: successful_job.frozen_source.snapshot_id,
            snapshot_sha256: successful_job.frozen_source.snapshot_sha256.clone(),
            normalized_settings_sha256: successful_job.normalized_request_sha256.clone(),
            representative_policy: cluster_request.parameters.representative_policy,
            provenance: serde_json::json!({
                "jobId": successful_job.job_id,
                "artifactId": materialized.artifact_id,
                "artifactManifestSha256": manifest_sha256,
                "runtime": successful_job.pinned_runtime,
                "numericStage": successful_job.stages[2],
                "cutoff": cluster_request.parameters.similarity.cutoff,
            }),
            created_at_ms: materialized.created_at_ms,
            artifact_id: materialized.artifact_id,
            artifact_manifest_sha256: manifest_sha256.clone(),
            assignments,
        };
        let grid_result = apply_cluster_analysis_run(
            computation.grid_lease.database_path_for_freeze(),
            &grid_input,
        );
        let (grid_applied, grid_warning) = match grid_result {
            Ok(()) => (true, None),
            Err(error) => (false, Some(error.chars().take(1_900).collect::<String>())),
        };
        Ok(ClusterPublicationStep {
            job: successful_job,
            artifact_id: materialized.artifact_id,
            artifact_manifest_sha256: manifest_sha256,
            grid_applied,
            grid_warning,
            report_path: materialized.report_path().to_string_lossy().into_owned(),
        })
    }

    pub(crate) fn cancel_job(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<JobRevisionEvent> {
        let ready = self.ready()?;
        ready
            .store
            .request_cancel(owner, job_id, expected_revision, now_ms())?;
        let requested = ready.store.get_job(owner, job_id)?;
        let cancelled = finish_cancellation(&requested, now_ms())?;
        let event = ready
            .store
            .apply_successor(owner, requested.revision, &cancelled)?;
        discard_cancelled_job_state(ready, job_id)?;
        Ok(event)
    }

    pub(crate) fn get_artifact_manifest(
        &self,
        owner: &str,
        artifact_id: Uuid,
    ) -> ComputeResult<burrete_compute_protocol::ArtifactManifest> {
        self.store()?.get_artifact_manifest(owner, artifact_id)
    }

    pub(crate) fn export_cluster_representatives(
        &self,
        owner: &str,
        job_id: Uuid,
        output_directory: PathBuf,
        collection_name: &str,
    ) -> ComputeResult<ClusterRepresentativeExportResult> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let job = ready.store.get_job(owner, job_id)?;
        if job.workflow_template != WorkflowTemplateId::ClusterV1
            || !matches!(
                job.state,
                JobState::Succeeded | JobState::SucceededWithFailures
            )
        {
            return Err(ComputeCoordinatorError::Validation(
                "representative export requires a successful cluster.v1 job".into(),
            ));
        }
        let result_pack = job.result_pack.as_ref().ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "successful clustering job lacks its ResultPack reference".into(),
            )
        })?;
        let mut artifact = None;
        for artifact_id in &job.artifact_ids {
            let candidate = ready.store.get_artifact_manifest(owner, *artifact_id)?;
            if &candidate.result_pack == result_pack && artifact.replace(candidate).is_some() {
                return Err(ComputeCoordinatorError::Protocol(
                    "clustering job has multiple artifacts for the same ResultPack".into(),
                ));
            }
        }
        let artifact = artifact.ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "clustering job has no published artifact for its ResultPack".into(),
            )
        })?;
        export_cluster_representatives(
            &ready.store,
            &ready.snapshots,
            &job,
            &artifact,
            &output_directory,
            collection_name,
            now_ms(),
        )
    }

    pub(crate) fn find_similar(
        &self,
        owner: &str,
        source_job_id: Uuid,
        grid_lease: GridSnapshotLease,
        request: SimilaritySearchRequest,
    ) -> ComputeResult<SimilaritySearchResult> {
        validate_owner_window_label(owner)?;
        let ready = self.ready()?;
        let job = ready.store.get_job(owner, source_job_id)?;
        if grid_lease.namespaced_document_id()
            != runtime_document_id(owner, &job.request.source().document_id)
        {
            return Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
                "The Grid lease does not belong to the similarity source job".into(),
            ));
        }
        let result_pack = job.result_pack.as_ref().ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "similarity source job lacks its ResultPack reference".into(),
            )
        })?;
        let mut artifact = None;
        for artifact_id in &job.artifact_ids {
            let candidate = ready.store.get_artifact_manifest(owner, *artifact_id)?;
            if &candidate.result_pack == result_pack && artifact.replace(candidate).is_some() {
                return Err(ComputeCoordinatorError::Protocol(
                    "similarity source job has multiple artifacts for the same ResultPack".into(),
                ));
            }
        }
        let artifact = artifact.ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "similarity source job has no published artifact for its ResultPack".into(),
            )
        })?;
        let backend = match (job.request.backend_policy(), &ready.native_metal) {
            (BackendPolicy::ReferenceCpu, _) => SimilaritySearchBackend::ReferenceCpu {
                engine: &ready.engines.identities().reference_cpu,
                fallback_reason: None,
            },
            (
                BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred,
                NativeMetalState::Available(runtime),
            ) => SimilaritySearchBackend::NativeMetal(runtime),
            (BackendPolicy::GpuRequired, NativeMetalState::Unavailable { message, .. }) => {
                return Err(ComputeCoordinatorError::Unavailable(format!(
                    "GPU-required similarity search cannot start: {message}"
                )))
            }
            (BackendPolicy::GpuPreferred, NativeMetalState::Unavailable { message, .. }) => {
                SimilaritySearchBackend::ReferenceCpu {
                    engine: &ready.engines.identities().reference_cpu,
                    fallback_reason: Some(message.clone()),
                }
            }
        };
        execute_similarity_search(
            &ready.store,
            &ready.snapshots,
            &job,
            &artifact,
            &grid_lease,
            request,
            backend,
            now_ms(),
        )
    }

    pub(crate) fn purge_job(&self, owner: &str, job_id: Uuid) -> ComputeResult<()> {
        self.store()?.purge_job(owner, job_id)
    }

    fn store(&self) -> ComputeResult<ComputeStore> {
        match self.state.as_ref() {
            CoordinatorState::Ready(ready) => Ok(ready.store.clone()),
            CoordinatorState::Unavailable(message) => {
                Err(ComputeCoordinatorError::Unavailable(message.clone()))
            }
        }
    }

    fn ready(&self) -> ComputeResult<&ReadyCoordinator> {
        match self.state.as_ref() {
            CoordinatorState::Ready(ready) => Ok(ready),
            CoordinatorState::Unavailable(message) => {
                Err(ComputeCoordinatorError::Unavailable(message.clone()))
            }
        }
    }
}

impl NativeMetalState {
    fn probe(runtime_root: Option<PathBuf>, helper_sha256: &str) -> Self {
        let Some(runtime_root) = runtime_root else {
            return Self::unavailable(
                CapabilityReasonCode::RuntimeMissing,
                "The bundled Burrete Metal runtime directory is unavailable.",
            );
        };
        if !runtime_root.is_dir() {
            return Self::unavailable(
                CapabilityReasonCode::RuntimeMissing,
                format!(
                    "The bundled Burrete Metal runtime is missing at {}.",
                    runtime_root.display()
                ),
            );
        }
        match MetalTanimotoRuntime::load(&runtime_root, helper_sha256) {
            Ok(runtime) => Self::Available(runtime),
            Err(error) => {
                Self::unavailable(reason_code_for_runtime_error(&error), error.to_string())
            }
        }
    }

    fn unavailable(code: CapabilityReasonCode, message: impl Into<String>) -> Self {
        Self::Unavailable {
            code,
            message: message.into(),
        }
    }

    fn submission_binding(
        &self,
        policy: BackendPolicy,
        reference_runtime: &RuntimeIdentity,
    ) -> ComputeResult<(SimilarityBackendAdmission, RuntimeIdentity)> {
        match (policy, self) {
            (BackendPolicy::ReferenceCpu, _) => Ok((
                SimilarityBackendAdmission::ReferenceCpu,
                reference_runtime.clone(),
            )),
            (
                BackendPolicy::GpuRequired | BackendPolicy::GpuPreferred,
                Self::Available(runtime),
            ) => Ok((
                SimilarityBackendAdmission::NativeMetal(EngineIdentity {
                    engine_id: "burrete-native-metal".into(),
                    version: runtime.runtime_identity().version.clone(),
                    manifest_sha256: runtime.runtime_identity().manifest_sha256.clone(),
                }),
                runtime.runtime_identity().clone(),
            )),
            (BackendPolicy::GpuRequired, Self::Unavailable { message, .. }) => {
                Err(ComputeCoordinatorError::Unavailable(format!(
                    "gpuRequired compute admission failed: {message}"
                )))
            }
            (BackendPolicy::GpuPreferred, Self::Unavailable { code, message }) => Ok((
                SimilarityBackendAdmission::GpuUnavailable(FallbackDecision {
                    code: fallback_code(*code),
                    reason: message.clone(),
                }),
                reference_runtime.clone(),
            )),
        }
    }

    fn conformer_submission_binding(
        &self,
        policy: BackendPolicy,
        reference_runtime: &RuntimeIdentity,
    ) -> ComputeResult<(
        ConformerBackendAdmission,
        ConformerBackendAdmission,
        RuntimeIdentity,
    )> {
        let unavailable = |code: CapabilityReasonCode, message: &str| {
            ConformerBackendAdmission::GpuUnavailable(FallbackDecision {
                code: fallback_code(code),
                reason: message.to_string(),
            })
        };
        match (policy, self) {
            (BackendPolicy::ReferenceCpu, _) => Ok((
                ConformerBackendAdmission::ReferenceCpu,
                ConformerBackendAdmission::ReferenceCpu,
                reference_runtime.clone(),
            )),
            (
                BackendPolicy::GpuPreferred | BackendPolicy::GpuRequired,
                Self::Available(runtime),
            ) => {
                let engine = EngineIdentity {
                    engine_id: "burrete-native-metal".into(),
                    version: runtime.runtime_identity().version.clone(),
                    manifest_sha256: runtime.runtime_identity().manifest_sha256.clone(),
                };
                Ok((
                    ConformerBackendAdmission::NativeMetal(engine.clone()),
                    ConformerBackendAdmission::NativeMetal(engine),
                    runtime.runtime_identity().clone(),
                ))
            }
            (BackendPolicy::GpuRequired, Self::Unavailable { message, .. }) => {
                Err(ComputeCoordinatorError::Unavailable(format!(
                    "gpuRequired conformer.v1 admission failed: {message}"
                )))
            }
            (BackendPolicy::GpuPreferred, Self::Unavailable { code, message }) => Ok((
                unavailable(*code, message),
                unavailable(*code, message),
                reference_runtime.clone(),
            )),
        }
    }
}

fn initialize_compute_service(
    executable: Option<PathBuf>,
    runtime_root: Option<PathBuf>,
) -> (NativeMetalState, Option<ComputeServiceClient>) {
    let Some(executable) = executable else {
        return (
            NativeMetalState::unavailable(
                CapabilityReasonCode::RuntimeMissing,
                "The packaged native compute service is unavailable.",
            ),
            None,
        );
    };
    let Some(runtime_root) = runtime_root else {
        return (
            NativeMetalState::unavailable(
                CapabilityReasonCode::RuntimeMissing,
                "The bundled Burrete Metal runtime directory is unavailable.",
            ),
            None,
        );
    };
    let service = match ComputeServiceClient::launch(&executable, &runtime_root) {
        Ok(service) => service,
        Err(error) => {
            return (
                NativeMetalState::unavailable(
                    CapabilityReasonCode::RuntimeIntegrityError,
                    format!("The native compute service failed attestation: {error}"),
                ),
                None,
            )
        }
    };
    let report = match service.capabilities() {
        Ok(report) => report,
        Err(error) => {
            return (
                NativeMetalState::unavailable(
                    CapabilityReasonCode::RuntimeIntegrityError,
                    format!("The native compute service capability probe failed: {error}"),
                ),
                Some(service),
            )
        }
    };
    if report.availability != ComputeAvailability::Available {
        let reason = report.reasons.first().cloned().unwrap_or(CapabilityReason {
            code: CapabilityReasonCode::RuntimeIntegrityError,
            message: "The native compute service reported no available Metal runtime.".into(),
        });
        return (
            NativeMetalState::unavailable(reason.code, reason.message),
            Some(service),
        );
    }
    let Some(service_runtime) = report.runtime.as_ref() else {
        return (
            NativeMetalState::unavailable(
                CapabilityReasonCode::RuntimeIntegrityError,
                "The available native compute service omitted its runtime identity.",
            ),
            Some(service),
        );
    };
    let direct =
        NativeMetalState::probe(Some(runtime_root), service_runtime.helper_sha256.as_str());
    if let NativeMetalState::Available(runtime) = &direct {
        if runtime.runtime_identity() != service_runtime
            || report.device.as_ref() != Some(runtime.device_identity())
        {
            return (
                NativeMetalState::unavailable(
                    CapabilityReasonCode::RuntimeIntegrityError,
                    "Compute service and coordinator runtime attestations differ.",
                ),
                Some(service),
            );
        }
    }
    (direct, Some(service))
}

fn initialize_runtime_catalog(
    viewer_runtime_root: Option<PathBuf>,
) -> Result<(String, VerifiedEngineCatalog), String> {
    let viewer_runtime_root = viewer_runtime_root.ok_or_else(|| {
        "The bundled Burrete ViewerWeb runtime directory is unavailable.".to_string()
    })?;
    let helper_sha256 = current_executable_sha256()?;
    let engines = VerifiedEngineCatalog::load(&viewer_runtime_root, &helper_sha256)?;
    Ok((helper_sha256, engines))
}

fn discard_cancelled_job_state(ready: &ReadyCoordinator, job_id: Uuid) -> ComputeResult<()> {
    ready
        .fingerprint_sessions
        .lock()
        .map_err(|_| poisoned("fingerprint session registry"))?
        .retain(|_, session| session.job_id() != job_id);
    ready
        .conformer_submissions
        .lock()
        .map_err(|_| poisoned("conformer submission registry"))?
        .retain(|_, submission| submission.job_id != job_id);
    ready
        .prepared_clusters
        .lock()
        .map_err(|_| poisoned("prepared cluster registry"))?
        .remove(&job_id);
    ready
        .chemical_space_knn
        .lock()
        .map_err(|_| poisoned("chemical-space neighbor cache"))?
        .retain(|(cached_job_id, _), _| *cached_job_id != job_id);
    ready
        .prepared_conformers
        .lock()
        .map_err(|_| poisoned("prepared conformer registry"))?
        .remove(&job_id);
    ready
        .computed_conformers
        .lock()
        .map_err(|_| poisoned("computed conformer registry"))?
        .remove(&job_id);
    ready
        .computed_clusters
        .lock()
        .map_err(|_| poisoned("computed cluster registry"))?
        .remove(&job_id);
    Ok(())
}

fn poisoned(label: &str) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!("{label} is poisoned"))
}

fn metal_execution_error(error: MetalRuntimeError) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(format!("native Metal execution failed: {error}"))
}

fn graph_bytes(graph: &SymmetricCsr, fingerprint_count: usize) -> ComputeResult<u64> {
    let fingerprints = u64::try_from(fingerprint_count)
        .ok()
        .and_then(|count| count.checked_mul(burrete_compute_core::FINGERPRINT_BYTES as u64));
    let offsets = u64::try_from(graph.row_offsets().len())
        .ok()
        .and_then(|count| count.checked_mul(8));
    let columns = u64::try_from(graph.column_indices().len())
        .ok()
        .and_then(|count| count.checked_mul(8));
    fingerprints
        .and_then(|value| value.checked_add(offsets?))
        .and_then(|value| value.checked_add(columns?))
        .ok_or_else(|| ComputeCoordinatorError::Protocol("numeric byte count overflowed".into()))
}

fn persist_failed_stage(
    store: &ComputeStore,
    owner: &str,
    running: &JobSnapshot,
    stage_index: usize,
    code: ComputeErrorCode,
    error: &ComputeCoordinatorError,
    metrics: StageFinishMetrics,
) -> ComputeResult<()> {
    let stage_id = running
        .stages
        .get(stage_index)
        .ok_or_else(|| ComputeCoordinatorError::Protocol("failed stage index is invalid".into()))?
        .stage_id
        .clone();
    let failed = fail_stage(
        running,
        stage_index,
        now_ms(),
        ComputeFailure {
            code,
            message: bounded_failure_message(error),
            stage_id: Some(stage_id),
            molecule_stable_id: None,
            retryable: false,
        },
        metrics,
    )?;
    store.apply_successor(owner, running.revision, &failed)?;
    Ok(())
}

fn bounded_failure_message(error: &ComputeCoordinatorError) -> String {
    let message = error.to_string().replace(char::is_control, " ");
    let mut bounded = message.chars().take(1_900).collect::<String>();
    if bounded.is_empty() {
        bounded = "Compute stage failed".into();
    }
    bounded
}

fn fallback_code(code: CapabilityReasonCode) -> FallbackReasonCode {
    match code {
        CapabilityReasonCode::UnsupportedArchitecture
        | CapabilityReasonCode::UnsupportedOperatingSystem => {
            FallbackReasonCode::CapabilityUnavailable
        }
        CapabilityReasonCode::MetalUnavailable
        | CapabilityReasonCode::RuntimeMissing
        | CapabilityReasonCode::RuntimeIntegrityError
        | CapabilityReasonCode::ProtocolMismatch
        | CapabilityReasonCode::KernelUnavailable => FallbackReasonCode::RuntimeUnavailable,
    }
}

fn admission_error(error: ClusterV1AdmissionError) -> ComputeCoordinatorError {
    match error {
        ClusterV1AdmissionError::GpuRequiredUnavailable(message) => {
            ComputeCoordinatorError::Unavailable(message)
        }
        other => ComputeCoordinatorError::Validation(other.to_string()),
    }
}

fn conformer_admission_error(error: ConformerV1AdmissionError) -> ComputeCoordinatorError {
    match error {
        ConformerV1AdmissionError::GpuRequiredUnavailable { reason, .. } => {
            ComputeCoordinatorError::Unavailable(reason)
        }
        other => ComputeCoordinatorError::Validation(other.to_string()),
    }
}

fn available_report(runtime: &MetalTanimotoRuntime) -> ComputeCapabilityReport {
    ComputeCapabilityReport {
        schema_version: CapabilityReportSchemaVersion::V1,
        report_revision: 1,
        protocol: protocol_range(),
        availability: ComputeAvailability::Available,
        platform: platform_identity(),
        runtime: Some(runtime.runtime_identity().clone()),
        device: Some(runtime.device_identity().clone()),
        capabilities: vec![capability_entry(true, None)],
        limits: runtime.limits().clone(),
        reasons: Vec::new(),
        generated_at_ms: now_ms(),
    }
}

fn unavailable_report(
    reason_code: CapabilityReasonCode,
    reason_message: String,
) -> ComputeCapabilityReport {
    ComputeCapabilityReport {
        schema_version: CapabilityReportSchemaVersion::V1,
        report_revision: 1,
        protocol: protocol_range(),
        availability: ComputeAvailability::Unavailable,
        platform: platform_identity(),
        runtime: None,
        device: None,
        capabilities: vec![capability_entry(false, Some(reason_code))],
        limits: CapabilityLimits {
            max_control_frame_bytes: MAX_CONTROL_FRAME_BYTES as u64,
            max_edges: 0,
            max_memory_bytes: 0,
            max_dispatch_ms: 0,
        },
        reasons: vec![CapabilityReason {
            code: reason_code,
            message: reason_message,
        }],
        generated_at_ms: now_ms(),
    }
}

fn capability_entry(available: bool, reason_code: Option<CapabilityReasonCode>) -> CapabilityEntry {
    CapabilityEntry {
        workflow_template: WorkflowTemplateId::ClusterV1,
        method: "tanimotoNeighbors".into(),
        chemistry_domain: "cluster.v1/all".into(),
        backend: Backend::NativeMetal,
        precision: Precision::IntegerExact,
        maturity: CapabilityMaturity::Experimental,
        available,
        reason_code,
    }
}

fn protocol_range() -> ProtocolRange {
    ProtocolRange {
        min: PROTOCOL_VERSION,
        max: PROTOCOL_VERSION,
    }
}

fn platform_identity() -> PlatformIdentity {
    PlatformIdentity {
        architecture: std::env::consts::ARCH.into(),
        os_name: if std::env::consts::OS == "macos" {
            "macOS".into()
        } else {
            std::env::consts::OS.into()
        },
        os_version: macos_version(),
    }
}

fn reason_code_for_runtime_error(error: &MetalRuntimeError) -> CapabilityReasonCode {
    match error {
        MetalRuntimeError::RuntimeMissing(_) => CapabilityReasonCode::RuntimeMissing,
        MetalRuntimeError::Integrity(_) => CapabilityReasonCode::RuntimeIntegrityError,
        MetalRuntimeError::UnsupportedPlatform(_) => {
            if std::env::consts::OS == "macos" {
                CapabilityReasonCode::UnsupportedArchitecture
            } else {
                CapabilityReasonCode::UnsupportedOperatingSystem
            }
        }
        MetalRuntimeError::MetalUnavailable(_) | MetalRuntimeError::ResourceLimit(_) => {
            CapabilityReasonCode::MetalUnavailable
        }
        MetalRuntimeError::KernelUnavailable(_) | MetalRuntimeError::Dispatch(_) => {
            CapabilityReasonCode::KernelUnavailable
        }
    }
}

fn current_executable_sha256() -> Result<String, String> {
    let path = std::env::current_exe()
        .map_err(|error| format!("The Burrete executable path is unavailable: {error}"))?;
    let mut file = File::open(&path).map_err(|error| {
        format!(
            "The Burrete executable cannot be opened for runtime attestation at {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("The Burrete executable cannot be hashed: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let mut encoded = String::with_capacity(64);
    use std::fmt::Write;
    for byte in hasher.finalize() {
        write!(encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(encoded)
}

#[cfg(test)]
#[path = "coordinator_tests.rs"]
mod tests;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn macos_version() -> String {
    Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|version| version.trim().to_owned())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "unknown".into())
}
