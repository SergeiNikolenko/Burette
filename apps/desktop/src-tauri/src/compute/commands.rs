use burrete_compute_protocol::{
    ArtifactManifest, ClusterV1SubmitRequest, ComputeCapabilityReport, JobRevisionEvent,
    JobSnapshot, MAX_JSON_SAFE_INTEGER,
};
use serde::Serialize;
use tauri::{Runtime, State, WebviewWindow};
use uuid::Uuid;

use crate::compute::{
    coordinator::ComputeCoordinator,
    error::{ComputeCoordinatorError, ComputeResult},
    store::validate_owner_window_label,
};

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
    request: ClusterV1SubmitRequest,
) -> Result<JobSnapshot, ComputeCommandError> {
    let owner = trusted_owner(&window)?;
    let coordinator = coordinator.inner().clone();
    run_blocking(move || coordinator.submit_cluster_v1(&owner, &request)).await
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
