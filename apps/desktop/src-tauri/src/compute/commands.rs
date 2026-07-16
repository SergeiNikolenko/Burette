use burrete_compute_protocol::{
    ArtifactManifest, ClusterV1SubmitRequest, ComputeCapabilityReport, ConformerV1SubmitRequest,
    JobRevisionEvent, JobSnapshot, MAX_JSON_SAFE_INTEGER,
};
use serde::Serialize;
use tauri::{Runtime, State, WebviewWindow};
use uuid::Uuid;

use crate::compute::{
    artifact_publisher::{ClusterPublicationStep, ConformerPublicationStep},
    cluster_executor::ClusterExecutionStep,
    conformer_session::ConformerSubmissionStep,
    coordinator::{
        ComputeCoordinator, ConformerDistanceExecutionStep, ConformerReferenceValidationStep,
        ConformerStereoExecutionStep,
    },
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::{FingerprintChunkResult, FingerprintExecutionStep},
    representative_export::ClusterRepresentativeExportResult,
    similarity_search::{SimilaritySearchRequest, SimilaritySearchResult},
    store::validate_owner_window_label,
};
use crate::{preview::grid_store::GridRuntimeRegistry, windows::runtime_document_id};

const DEFAULT_JOB_LIST_LIMIT: usize = 50;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputeCommandError {
    code: String,
    message: String,
    current_revision: Option<u64>,
}

impl From<ComputeCoordinatorError> for ComputeCommandError {
    fn from(error: ComputeCoordinatorError) -> Self {
        Self {
            code: error.code().into(),
            message: error.to_string(),
            current_revision: error.current_revision(),
        }
    }
}

#[tauri::command]
pub(crate) async fn compute_capabilities<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
) -> Result<ComputeCapabilityReport, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || {
        validate_owner_window_label(&owner)?;
        coordinator.capability_report()
    })
    .await
}

#[tauri::command]
pub(crate) async fn compute_submit_job<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    request: ClusterV1SubmitRequest,
) -> Result<JobSnapshot, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let request = request
        .normalized()
        .map_err(ComputeCoordinatorError::from)
        .map_err(ComputeCommandError::from)?;
    let namespaced_document_id = runtime_document_id(&owner, &request.source.document_id);
    let source_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The selected Grid source cannot be frozen: {error}"
            )))
        })?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.submit_cluster_v1(&owner, &request, source_lease)).await
}

#[tauri::command]
pub(crate) async fn compute_begin_conformer_submission<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    request: ConformerV1SubmitRequest,
) -> Result<ConformerSubmissionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let request = request
        .normalized()
        .map_err(ComputeCoordinatorError::from)
        .map_err(ComputeCommandError::from)?;
    let namespaced_document_id = runtime_document_id(&owner, &request.source.document_id);
    let source_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The conformer Grid source cannot be frozen: {error}"
            )))
        })?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.begin_conformer_v1_submission(&owner, &request, source_lease))
        .await
}

#[tauri::command]
pub(crate) async fn compute_submit_conformer_chunk<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    request: tauri::ipc::Request<'_>,
) -> Result<ConformerSubmissionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let envelope = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(ComputeCoordinatorError::Validation(
                "conformer extraction results require a raw binary IPC body".into(),
            )
            .into())
        }
    };
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.submit_conformer_extraction_chunk(&owner, &envelope)).await
}

#[tauri::command]
pub(crate) async fn compute_execute_conformer_distance<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ConformerDistanceExecutionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || {
        coordinator.execute_conformer_distance_v1(&owner, job_id, expected_revision)
    })
    .await
}

#[tauri::command]
pub(crate) async fn compute_execute_conformer_stereo<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ConformerStereoExecutionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.execute_conformer_stereo_v1(&owner, job_id, expected_revision))
        .await
}

#[tauri::command]
pub(crate) async fn compute_validate_conformer_reference<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ConformerReferenceValidationStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || {
        coordinator.validate_conformer_reference_v1(&owner, job_id, expected_revision)
    })
    .await
}

#[tauri::command]
pub(crate) async fn compute_publish_conformer<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ConformerPublicationStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.publish_conformer_v1(&owner, job_id, expected_revision)).await
}

#[tauri::command]
pub(crate) async fn compute_get_job<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
) -> Result<JobSnapshot, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.get_job(&owner, job_id)).await
}

#[tauri::command]
pub(crate) async fn compute_begin_cluster_execution<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    job_id: String,
    expected_revision: u64,
) -> Result<FingerprintExecutionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    let job = {
        let coordinator = coordinator.clone();
        let owner = owner.clone();
        run_blocking(move || coordinator.get_job(&owner, job_id)).await?
    };
    let namespaced_document_id = runtime_document_id(&owner, &job.request.source().document_id);
    let source_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The queued Grid source is no longer available for result writeback: {error}"
            )))
        })?;
    run_blocking(move || {
        coordinator.begin_cluster_v1_execution(&owner, job_id, expected_revision, source_lease)
    })
    .await
}

#[tauri::command]
pub(crate) async fn compute_submit_fingerprint_chunk<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    result: FingerprintChunkResult,
) -> Result<FingerprintExecutionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.submit_fingerprint_chunk(&owner, result)).await
}

#[tauri::command]
pub(crate) async fn compute_execute_cluster<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ClusterExecutionStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.execute_cluster_v1(&owner, job_id, expected_revision)).await
}

#[tauri::command]
pub(crate) async fn compute_publish_cluster<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<ClusterPublicationStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.publish_cluster_v1(&owner, job_id, expected_revision)).await
}

#[tauri::command]
pub(crate) async fn compute_list_jobs<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    limit: Option<usize>,
) -> Result<Vec<JobSnapshot>, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.list_jobs(&owner, limit.unwrap_or(DEFAULT_JOB_LIST_LIMIT)))
        .await
}

#[tauri::command]
pub(crate) async fn compute_cancel_job<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
) -> Result<JobRevisionEvent, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.cancel_job(&owner, job_id, expected_revision)).await
}

#[tauri::command]
pub(crate) async fn compute_get_artifact_manifest<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    artifact_id: String,
) -> Result<ArtifactManifest, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let artifact_id = parse_uuid("artifact ID", &artifact_id)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.get_artifact_manifest(&owner, artifact_id)).await
}

#[tauri::command]
pub(crate) async fn compute_export_cluster_representatives<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    output_directory: String,
    collection_name: String,
) -> Result<ClusterRepresentativeExportResult, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    let output_directory = std::path::PathBuf::from(output_directory);
    let coordinator = coordinator.inner().clone();
    run_blocking(move || {
        coordinator.export_cluster_representatives(
            &owner,
            job_id,
            output_directory,
            &collection_name,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn compute_find_similar<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    job_id: String,
    request: SimilaritySearchRequest,
) -> Result<SimilaritySearchResult, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    let coordinator = coordinator.inner().clone();
    let job = {
        let coordinator = coordinator.clone();
        let owner = owner.clone();
        run_blocking(move || coordinator.get_job(&owner, job_id)).await?
    };
    let namespaced_document_id = runtime_document_id(&owner, &job.request.source().document_id);
    let grid_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The similarity-search Grid source is unavailable: {error}"
            )))
        })?;
    run_blocking(move || coordinator.find_similar(&owner, job_id, grid_lease, request)).await
}

#[tauri::command]
pub(crate) async fn compute_purge_job<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
) -> Result<(), ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.purge_job(&owner, job_id)).await
}

fn trusted_owner<R: Runtime>(window: &WebviewWindow<R>) -> Result<String, ComputeCommandError> {
    let owner = window.label().to_owned();
    validate_owner_window_label(&owner).map_err(ComputeCommandError::from)?;
    Ok(owner)
}

fn parse_uuid(label: &str, value: &str) -> Result<Uuid, ComputeCommandError> {
    let parsed = Uuid::parse_str(value).map_err(|_| {
        ComputeCommandError::from(ComputeCoordinatorError::Validation(format!(
            "{label} must be a UUID"
        )))
    })?;
    if parsed.is_nil() {
        return Err(
            ComputeCoordinatorError::Validation(format!("{label} cannot be the nil UUID")).into(),
        );
    }
    Ok(parsed)
}

fn validate_revision(revision: u64) -> Result<(), ComputeCommandError> {
    if revision == 0 || revision > MAX_JSON_SAFE_INTEGER {
        return Err(ComputeCoordinatorError::Validation(
            "expected revision must be a positive JSON-safe integer".into(),
        )
        .into());
    }
    Ok(())
}

async fn run_blocking<T, F>(operation: F) -> Result<T, ComputeCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> ComputeResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::Unavailable(format!(
                "compute operation did not join: {error}"
            )))
        })?
        .map_err(ComputeCommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nil_ids_and_unsafe_revisions() {
        assert!(parse_uuid("job ID", &Uuid::nil().to_string()).is_err());
        assert!(validate_revision(0).is_err());
        assert!(validate_revision(MAX_JSON_SAFE_INTEGER + 1).is_err());
    }
}
