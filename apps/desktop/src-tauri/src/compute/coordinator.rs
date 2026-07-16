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
    Backend, BackendPolicy, CapabilityEntry, CapabilityLimits, CapabilityMaturity,
    CapabilityReason, CapabilityReasonCode, CapabilityReportSchemaVersion, ClusterV1SubmitRequest,
    ComputeAvailability, ComputeCapabilityReport, EngineIdentity, FallbackDecision,
    FallbackReasonCode, JobRevisionEvent, JobSnapshot, OwnerSurface, PlatformIdentity, Precision,
    ProtocolRange, RuntimeIdentity, WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::compute::{
    cluster_plan::{ClusterV1AdmissionError, SimilarityBackendAdmission},
    engine_catalog::VerifiedEngineCatalog,
    error::{ComputeCoordinatorError, ComputeResult},
    job_factory::{build_queued_cluster_v1_job, QueuedClusterV1JobInput},
    snapshot_repository::SnapshotRepository,
    store::{validate_owner_window_label, ComputeStore},
};
use crate::preview::grid_store::GridSnapshotLease;
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
    pub(crate) fn initialize(
        compute_root: PathBuf,
        metal_runtime_root: Option<PathBuf>,
        viewer_runtime_root: Option<PathBuf>,
    ) -> Self {
        let state = match ComputeStore::initialize(compute_root) {
            Ok(store) => match SnapshotRepository::initialize(&store) {
                Ok(snapshots) => match store.recover_active_jobs(now_ms()) {
                    Ok(_) => match initialize_runtime_catalog(viewer_runtime_root) {
                        Ok((helper_sha256, engines)) => {
                            CoordinatorState::Ready(Box::new(ReadyCoordinator {
                                store,
                                snapshots,
                                engines,
                                native_metal: NativeMetalState::probe(
                                    metal_runtime_root,
                                    &helper_sha256,
                                ),
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
                    "gpuRequired cluster.v1 admission failed: {message}"
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
        let state = NativeMetalState::probe(Some(missing), &"a".repeat(64));
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
