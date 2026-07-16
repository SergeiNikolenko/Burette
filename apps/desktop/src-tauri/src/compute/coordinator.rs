use std::{
    path::PathBuf,
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use burrete_compute_protocol::{
    Backend, CapabilityEntry, CapabilityLimits, CapabilityMaturity, CapabilityReason,
    CapabilityReasonCode, CapabilityReportSchemaVersion, ClusterV1SubmitRequest,
    ComputeAvailability, ComputeCapabilityReport, JobRevisionEvent, JobSnapshot, PlatformIdentity,
    Precision, ProtocolRange, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use uuid::Uuid;

use crate::compute::{
    error::{ComputeCoordinatorError, ComputeResult},
    snapshot_repository::SnapshotRepository,
    store::{validate_owner_window_label, ComputeStore},
};

#[derive(Clone, Debug)]
pub(crate) struct ComputeCoordinator {
    state: Arc<CoordinatorState>,
}

#[derive(Debug)]
enum CoordinatorState {
    Ready(ReadyCoordinator),
    Unavailable(String),
}

#[derive(Debug)]
struct ReadyCoordinator {
    store: ComputeStore,
    snapshots: SnapshotRepository,
}

impl ComputeCoordinator {
    pub(crate) fn initialize(compute_root: PathBuf) -> Self {
        let state = match ComputeStore::initialize(compute_root) {
            Ok(store) => match SnapshotRepository::initialize(&store) {
                Ok(snapshots) => match store.recover_active_jobs(now_ms()) {
                    Ok(_) => CoordinatorState::Ready(ReadyCoordinator { store, snapshots }),
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
        let (reason_code, reason_message) = match self.state.as_ref() {
            CoordinatorState::Ready(ready) => match ready.snapshots.health_check() {
                Ok(()) => (
                    CapabilityReasonCode::RuntimeMissing,
                    "The versioned Burrete GPU runtime has not been installed yet.".to_string(),
                ),
                Err(error) => (
                    CapabilityReasonCode::RuntimeIntegrityError,
                    format!("The durable compute snapshot repository is unavailable: {error}"),
                ),
            },
            CoordinatorState::Unavailable(message) => (
                CapabilityReasonCode::RuntimeIntegrityError,
                format!("The durable compute coordinator is unavailable: {message}"),
            ),
        };
        let report = ComputeCapabilityReport {
            schema_version: CapabilityReportSchemaVersion::V1,
            report_revision: 1,
            protocol: ProtocolRange {
                min: PROTOCOL_VERSION,
                max: PROTOCOL_VERSION,
            },
            availability: ComputeAvailability::Unavailable,
            platform: PlatformIdentity {
                architecture: std::env::consts::ARCH.into(),
                os_name: "macOS".into(),
                os_version: macos_version(),
            },
            runtime: None,
            device: None,
            capabilities: vec![CapabilityEntry {
                workflow_template: WorkflowTemplateId::ClusterV1,
                method: "tanimotoNeighbors".into(),
                chemistry_domain: "cluster.v1/all".into(),
                backend: Backend::NativeMetal,
                precision: Precision::IntegerExact,
                maturity: CapabilityMaturity::Experimental,
                available: false,
                reason_code: Some(reason_code),
            }],
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
        };
        report.validate()?;
        Ok(report)
    }

    pub(crate) fn submit_cluster_v1(
        &self,
        owner: &str,
        request: &ClusterV1SubmitRequest,
    ) -> ComputeResult<JobSnapshot> {
        validate_owner_window_label(owner)?;
        let _normalized_request = request.clone().normalized()?;
        let _ = self.store()?;
        Err(ComputeCoordinatorError::SourceSnapshotUnavailable(
            "cluster.v1 submission requires a transactionally frozen Grid source; Stage 3 has not connected that resolver yet".into(),
        ))
    }

    pub(crate) fn get_job(&self, owner: &str, job_id: Uuid) -> ComputeResult<JobSnapshot> {
        self.store()?.get_job(owner, job_id)
    }

    pub(crate) fn list_jobs(&self, owner: &str, limit: usize) -> ComputeResult<Vec<JobSnapshot>> {
        self.store()?.list_jobs(owner, limit)
    }

    pub(crate) fn cancel_job(
        &self,
        owner: &str,
        job_id: Uuid,
        expected_revision: u64,
    ) -> ComputeResult<JobRevisionEvent> {
        self.store()?
            .request_cancel(owner, job_id, expected_revision, now_ms())
    }

    pub(crate) fn get_artifact_manifest(
        &self,
        owner: &str,
        artifact_id: Uuid,
    ) -> ComputeResult<burrete_compute_protocol::ArtifactManifest> {
        self.store()?.get_artifact_manifest(owner, artifact_id)
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
}

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
