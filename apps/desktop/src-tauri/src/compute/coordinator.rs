use std::{
    fs::File,
    io::Read,
    path::PathBuf,
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use burrete_compute_metal::{MetalRuntimeError, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    Backend, CapabilityEntry, CapabilityLimits, CapabilityMaturity, CapabilityReason,
    CapabilityReasonCode, CapabilityReportSchemaVersion, ClusterV1SubmitRequest,
    ComputeAvailability, ComputeCapabilityReport, JobRevisionEvent, JobSnapshot, PlatformIdentity,
    Precision, ProtocolRange, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
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
    Ready(Box<ReadyCoordinator>),
    Unavailable(String),
}

#[derive(Debug)]
struct ReadyCoordinator {
    store: ComputeStore,
    snapshots: SnapshotRepository,
    native_metal: NativeMetalState,
}

#[derive(Debug)]
enum NativeMetalState {
    Available(MetalTanimotoRuntime),
    Unavailable {
        code: CapabilityReasonCode,
        message: String,
    },
}

impl ComputeCoordinator {
    pub(crate) fn initialize(compute_root: PathBuf, metal_runtime_root: Option<PathBuf>) -> Self {
        let state = match ComputeStore::initialize(compute_root) {
            Ok(store) => match SnapshotRepository::initialize(&store) {
                Ok(snapshots) => match store.recover_active_jobs(now_ms()) {
                    Ok(_) => CoordinatorState::Ready(Box::new(ReadyCoordinator {
                        store,
                        snapshots,
                        native_metal: NativeMetalState::probe(metal_runtime_root),
                    })),
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
                Ok(()) => match &ready.native_metal {
                    NativeMetalState::Available(runtime) => available_report(runtime),
                    NativeMetalState::Unavailable { code, message } => {
                        unavailable_report(*code, message.clone())
                    }
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

impl NativeMetalState {
    fn probe(runtime_root: Option<PathBuf>) -> Self {
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
        let helper_sha256 = match current_executable_sha256() {
            Ok(hash) => hash,
            Err(message) => {
                return Self::unavailable(CapabilityReasonCode::RuntimeIntegrityError, message)
            }
        };
        match MetalTanimotoRuntime::load(&runtime_root, &helper_sha256) {
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
mod tests {
    use super::*;

    #[test]
    fn missing_runtime_never_advertises_gpu_execution() {
        let missing =
            std::env::temp_dir().join(format!("burrete-missing-metal-{}", Uuid::new_v4()));
        let state = NativeMetalState::probe(Some(missing));
        let NativeMetalState::Unavailable { code, message } = state else {
            panic!("missing runtime cannot become available");
        };
        assert_eq!(code, CapabilityReasonCode::RuntimeMissing);
        let report = unavailable_report(code, message);
        assert_eq!(report.availability, ComputeAvailability::Unavailable);
        assert_eq!(report.limits.max_edges, 0);
        assert!(!report.capabilities[0].available);
        assert_eq!(report.validate(), Ok(()));
    }

    #[test]
    fn helper_attestation_is_a_real_sha256_digest() {
        let hash = current_executable_sha256().expect("hash current test executable");
        assert_eq!(hash.len(), 64);
        assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
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
