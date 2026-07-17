use std::{
    collections::BTreeSet,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use burrete_compute_metal::{MetalRuntimeError, MetalTanimotoRuntime};
use burrete_compute_protocol::{
    read_frame, write_frame, Backend, CapabilityEntry, CapabilityLimits, CapabilityMaturity,
    CapabilityReason, CapabilityReasonCode, CapabilityReportSchemaVersion, ComputeAvailability,
    ComputeCapabilityReport, ControlErrorCode, PlatformIdentity, Precision, ProtocolRange,
    SessionToken, WorkerCommand, WorkerControlRequest, WorkerControlResponse, WorkerResult,
    WorkflowTemplateId, MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const SESSION_ENV: &str = "BURRETE_COMPUTE_SESSION_TOKEN";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct ComputeServiceClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    responses: Mutex<mpsc::Receiver<Result<WorkerControlResponse, String>>>,
    session_token: SessionToken,
    worker_id: Uuid,
}

impl std::fmt::Debug for ComputeServiceClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ComputeServiceClient")
            .field("worker_id", &self.worker_id)
            .finish_non_exhaustive()
    }
}

impl ComputeServiceClient {
    pub(crate) fn launch(executable: &Path, runtime_root: &Path) -> Result<Self, String> {
        require_regular_executable(executable)?;
        let session_token = SessionToken::new(format!("session.v1.{}", random_base64url()?))
            .map_err(|error| error.to_string())?;
        let mut child = Command::new(executable)
            .arg("--runtime-root")
            .arg(runtime_root)
            .env(SESSION_ENV, session_token.as_str())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("cannot launch compute service: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or("compute service stdin is unavailable")?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or("compute service stdout is unavailable")?;
        let (sender, receiver) = mpsc::sync_channel(8);
        thread::Builder::new()
            .name("burrete-compute-service-reader".into())
            .spawn(move || loop {
                match read_frame::<_, WorkerControlResponse>(&mut stdout) {
                    Ok(response) => {
                        if sender.send(Ok(response)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        break;
                    }
                }
            })
            .map_err(|error| format!("cannot start compute service reader: {error}"))?;
        let mut client = Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            responses: Mutex::new(receiver),
            session_token,
            worker_id: Uuid::nil(),
        };
        let coordinator_nonce = random_base64url()?;
        let result = client.request(WorkerCommand::Handshake {
            session_token: client.session_token.clone(),
            coordinator_nonce: coordinator_nonce.clone(),
        })?;
        match result {
            WorkerResult::HandshakeAccepted {
                worker_id,
                coordinator_nonce: echoed,
                ..
            } if echoed == coordinator_nonce => client.worker_id = worker_id,
            WorkerResult::Error { message, .. } => return Err(message),
            _ => return Err("compute service returned an invalid handshake transcript".into()),
        }
        Ok(client)
    }

    pub(crate) fn capabilities(&self) -> Result<ComputeCapabilityReport, String> {
        match self.request(WorkerCommand::Capabilities {
            session_token: self.session_token.clone(),
        })? {
            WorkerResult::Capabilities { report } => Ok(*report),
            WorkerResult::Error { message, .. } => Err(message),
            _ => Err("compute service returned the wrong capability response".into()),
        }
    }

    fn request(&self, command: WorkerCommand) -> Result<WorkerResult, String> {
        let request_id = Uuid::new_v4();
        {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| "compute service stdin lock is poisoned".to_string())?;
            write_frame(&mut *stdin, &WorkerControlRequest::new(request_id, command))
                .map_err(|error| error.to_string())?;
        }
        let response = self
            .responses
            .lock()
            .map_err(|_| "compute service response lock is poisoned".to_string())?
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| format!("compute service response timed out: {error}"))??;
        if response.request_id != request_id {
            return Err("compute service response request ID differs from the request".into());
        }
        Ok(response.result)
    }
}

impl Drop for ComputeServiceClient {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn run_compute_service() -> Result<(), String> {
    let runtime_root = parse_runtime_root()?;
    let session_token = SessionToken::new(
        std::env::var(SESSION_ENV).map_err(|_| "compute service session token is missing")?,
    )
    .map_err(|error| error.to_string())?;
    std::env::remove_var(SESSION_ENV);
    let helper_sha256 = executable_sha256()?;
    let report = capability_report(MetalTanimotoRuntime::load(&runtime_root, &helper_sha256));
    let worker_id = Uuid::new_v4();
    let worker_nonce = random_base64url()?;
    let mut seen = BTreeSet::new();
    let mut authenticated = false;
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();
    loop {
        let request = match read_frame::<_, WorkerControlRequest>(&mut reader) {
            Ok(request) => request,
            Err(burrete_compute_protocol::ProtocolError::Io(message))
                if message.contains("failed to fill whole buffer") =>
            {
                return Ok(())
            }
            Err(error) => return Err(error.to_string()),
        };
        if !seen.insert(request.request_id) {
            respond_error(
                &mut writer,
                request.request_id,
                ControlErrorCode::Conflict,
                "compute service request ID was replayed",
            )?;
            continue;
        }
        let result = match request.command {
            WorkerCommand::Handshake {
                session_token: observed,
                coordinator_nonce,
            } if observed == session_token && !authenticated => {
                authenticated = true;
                WorkerResult::HandshakeAccepted {
                    worker_id,
                    coordinator_nonce,
                    worker_nonce: worker_nonce.clone(),
                }
            }
            WorkerCommand::Handshake { .. } => WorkerResult::Error {
                code: ControlErrorCode::Unauthorized,
                message: "compute service handshake authority was rejected".into(),
            },
            WorkerCommand::Capabilities {
                session_token: observed,
            } if authenticated && observed == session_token => WorkerResult::Capabilities {
                report: Box::new(report.clone()),
            },
            WorkerCommand::Ping {
                session_token: observed,
                nonce,
            } if authenticated && observed == session_token => WorkerResult::Pong { nonce },
            _ => WorkerResult::Error {
                code: ControlErrorCode::Unauthorized,
                message: "compute service command is not authorized".into(),
            },
        };
        write_frame(
            &mut writer,
            &WorkerControlResponse::new(request.request_id, result),
        )
        .map_err(|error| error.to_string())?;
    }
}

fn respond_error(
    writer: &mut impl Write,
    request_id: Uuid,
    code: ControlErrorCode,
    message: &str,
) -> Result<(), String> {
    write_frame(
        writer,
        &WorkerControlResponse::new(
            request_id,
            WorkerResult::Error {
                code,
                message: message.into(),
            },
        ),
    )
    .map_err(|error| error.to_string())
}

fn parse_runtime_root() -> Result<PathBuf, String> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--runtime-root")) {
        return Err("usage: burrete-compute-service --runtime-root <directory>".into());
    }
    let root = args
        .next()
        .map(PathBuf::from)
        .ok_or("compute service runtime root is missing")?;
    if args.next().is_some() || !root.is_dir() {
        return Err("compute service runtime root is invalid".into());
    }
    Ok(root)
}

fn capability_report(
    runtime: Result<MetalTanimotoRuntime, MetalRuntimeError>,
) -> ComputeCapabilityReport {
    match runtime {
        Ok(runtime) => ComputeCapabilityReport {
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
        },
        Err(error) => {
            let code = reason_code(&error);
            ComputeCapabilityReport {
                schema_version: CapabilityReportSchemaVersion::V1,
                report_revision: 1,
                protocol: protocol_range(),
                availability: ComputeAvailability::Unavailable,
                platform: platform_identity(),
                runtime: None,
                device: None,
                capabilities: vec![capability_entry(false, Some(code))],
                limits: CapabilityLimits {
                    max_control_frame_bytes: MAX_CONTROL_FRAME_BYTES as u64,
                    max_edges: 0,
                    max_memory_bytes: 0,
                    max_dispatch_ms: 0,
                },
                reasons: vec![CapabilityReason {
                    code,
                    message: error.to_string(),
                }],
                generated_at_ms: now_ms(),
            }
        }
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

fn reason_code(error: &MetalRuntimeError) -> CapabilityReasonCode {
    match error {
        MetalRuntimeError::RuntimeMissing(_) => CapabilityReasonCode::RuntimeMissing,
        MetalRuntimeError::Integrity(_) => CapabilityReasonCode::RuntimeIntegrityError,
        MetalRuntimeError::UnsupportedPlatform(_) => {
            CapabilityReasonCode::UnsupportedOperatingSystem
        }
        MetalRuntimeError::MetalUnavailable(_) => CapabilityReasonCode::MetalUnavailable,
        MetalRuntimeError::KernelUnavailable(_) => CapabilityReasonCode::KernelUnavailable,
        MetalRuntimeError::Dispatch(_) | MetalRuntimeError::ResourceLimit(_) => {
            CapabilityReasonCode::RuntimeIntegrityError
        }
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
        os_version: "unknown".into(),
    }
}

fn require_regular_executable(path: &Path) -> Result<(), String> {
    let metadata = path.symlink_metadata().map_err(|error| {
        format!(
            "compute service is unavailable at {}: {error}",
            path.display()
        )
    })?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("compute service must be a regular non-symlink file".into());
    }
    Ok(())
}

fn executable_sha256() -> Result<String, String> {
    let path = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn random_base64url() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| format!("cannot obtain compute service entropy: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
