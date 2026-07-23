use burrete_compute_protocol::{
    ArtifactManifest, ClusterV1SubmitRequest, ComputeCapabilityReport, ConformerV1SubmitRequest,
    JobRevisionEvent, JobSnapshot, MAX_JSON_SAFE_INTEGER,
};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{Manager, Runtime, State, WebviewWindow};
use uuid::Uuid;

use crate::compute::{
    alignment_workflow::{GridAlignmentRequest, GridAlignmentResult},
    artifact_publisher::{ClusterPublicationStep, ConformerPublicationStep},
    chemical_space::{ChemicalSpaceRequest, ChemicalSpaceResult},
    cluster_executor::ClusterExecutionStep,
    conformer_session::ConformerSubmissionStep,
    coordinator::{
        ComputeCoordinator, ConformerDistanceExecutionStep, ConformerReferenceValidationStep,
        ConformerStereoExecutionStep,
    },
    error::{ComputeCoordinatorError, ComputeResult},
    fingerprint_session::{FingerprintChunkResult, FingerprintExecutionStep},
    representative_export::ClusterRepresentativeExportResult,
    semiempirical_workflow::{GridSemiempiricalRequest, GridSemiempiricalResult},
    similarity_search::{SimilaritySearchRequest, SimilaritySearchResult},
    store::validate_owner_window_label,
};
use crate::{
    preview::grid_store::{build_grid_store_with_options, GridParseOptions, GridRuntimeRegistry},
    windows::runtime_document_id,
};

const DEFAULT_JOB_LIST_LIMIT: usize = 50;
const MAX_INLINE_COMPUTE_SOURCE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InlineComputeSourceRequest {
    title: String,
    extension: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InlineComputeSourceRegistration {
    document_id: String,
    source_indexes: Vec<usize>,
    record_count: usize,
}

#[tauri::command]
pub(crate) fn compute_register_inline_source<R: Runtime>(
    window: WebviewWindow<R>,
    registry: State<'_, GridRuntimeRegistry>,
    request: InlineComputeSourceRequest,
) -> Result<InlineComputeSourceRegistration, String> {
    let extension = request
        .extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "sdf" | "sd" | "smi" | "smiles") {
        return Err("Native compute accepts inline SDF or SMILES sources".into());
    }
    if request.text.trim().is_empty() {
        return Err("Native compute source is empty".into());
    }
    if request.text.len() > MAX_INLINE_COMPUTE_SOURCE_BYTES {
        return Err("Native compute source exceeds the 64 MiB inline limit".into());
    }

    let document_id = format!("inline-compute-{}", Uuid::new_v4());
    let runtime_dir = window
        .app_handle()
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("compute-inline")
        .join(&document_id);
    fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    let grid_store = match build_grid_store_with_options(
        &runtime_dir,
        &extension,
        request.text.as_bytes(),
        &GridParseOptions {
            include_single_sdf: true,
            ..GridParseOptions::default()
        },
    ) {
        Ok(Some(grid_store)) => grid_store,
        Ok(None) => {
            let _ = fs::remove_dir_all(&runtime_dir);
            return Err(format!(
                "{} does not contain a supported molecule",
                request.title
            ));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&runtime_dir);
            return Err(format!(
                "Cannot register {} for native compute: {error}",
                request.title
            ));
        }
    };

    if !grid_store.summary.index_ready {
        grid_store
            .cancel_token
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = fs::remove_dir_all(&runtime_dir);
        return Err(
            "Inline compute currently accepts at most 192 molecule records per operation".into(),
        );
    }

    let record_count = grid_store.summary.records_indexed;
    let namespaced_document_id = runtime_document_id(window.label(), &document_id);
    if let Err(error) = registry.register(
        &namespaced_document_id,
        grid_store.database_path,
        grid_store.summary.format,
        grid_store.cancel_token,
        grid_store.ingest_worker,
    ) {
        let _ = fs::remove_dir_all(&runtime_dir);
        return Err(error);
    }
    Ok(InlineComputeSourceRegistration {
        document_id,
        source_indexes: (0..record_count).collect(),
        record_count,
    })
}

#[tauri::command]
pub(crate) async fn compute_evaluate_grid_semiempirical<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    request: GridSemiempiricalRequest,
) -> Result<GridSemiempiricalResult, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let namespaced_document_id = runtime_document_id(&owner, request.document_id.trim());
    let source_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The semi-empirical Grid source is unavailable: {error}"
            )))
        })?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.evaluate_grid_semiempirical(&owner, &request, source_lease))
        .await
}

#[tauri::command]
pub(crate) async fn compute_align_grid_poses<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    registry: State<'_, GridRuntimeRegistry>,
    request: GridAlignmentRequest,
) -> Result<GridAlignmentResult, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let namespaced_document_id = runtime_document_id(&owner, request.document_id.trim());
    let source_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The alignment Grid source is unavailable: {error}"
            )))
        })?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.align_grid_poses(&owner, &request, source_lease)).await
}

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
    registry: State<'_, GridRuntimeRegistry>,
    job_id: String,
    expected_revision: u64,
) -> Result<ConformerPublicationStep, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    let job = coordinator.get_job(&owner, job_id)?;
    let namespaced_document_id = runtime_document_id(&owner, &job.request.source().document_id);
    let grid_lease = registry
        .acquire_snapshot_lease(&namespaced_document_id)
        .map_err(|error| {
            ComputeCommandError::from(ComputeCoordinatorError::SourceSnapshotUnavailable(format!(
                "The conformer Grid result cannot be applied: {error}"
            )))
        })?;
    run_blocking(move || {
        coordinator.publish_conformer_v1(&owner, job_id, expected_revision, grid_lease)
    })
    .await
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
pub(crate) async fn compute_execute_chemical_space<R: Runtime>(
    window: WebviewWindow<R>,
    coordinator: State<'_, ComputeCoordinator>,
    job_id: String,
    expected_revision: u64,
    request: ChemicalSpaceRequest,
) -> Result<ChemicalSpaceResult, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let job_id = parse_uuid("job ID", &job_id)?;
    validate_revision(expected_revision)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || {
        coordinator.execute_chemical_space(&owner, job_id, expected_revision, request)
    })
    .await
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
