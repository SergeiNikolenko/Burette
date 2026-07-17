use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    mem,
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::{fs::OpenOptionsExt, net::UnixStream, process::CommandExt},
    },
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use burrete_compute_core::{
    AlignmentAtom, AlignmentMode, AlignmentScores, AtomMapping,
    DistanceGeometryOptimizationOptions, Fingerprint2048, GraphBuildOptions, MmffParameters,
    RigidTransform, Rm1Evaluation, SemiempiricalAtom, SemiempiricalMethod, SemiempiricalMolecule,
    SemiempiricalScfResult, SemiempiricalScfStatus, SymmetricCsr, FINGERPRINT_BYTES,
};
use burrete_compute_metal::{
    AlignmentPairDescriptor, MetalAlignmentBatch, MetalAlignmentExecution,
    MetalAlignmentPairResult, MetalMmffOptimization, MetalRuntimeError, MetalTanimotoRuntime,
};
use burrete_compute_protocol::{
    read_frame, write_frame, Backend, CapabilityEntry, CapabilityLimits, CapabilityMaturity,
    CapabilityReason, CapabilityReasonCode, CapabilityReportSchemaVersion, ComputeAvailability,
    ComputeCapabilityReport, ControlErrorCode, JobCapabilityToken, PlatformIdentity, Precision,
    ProtocolRange, SessionToken, SimilarityCutoff, WorkerCommand, WorkerControlRequest,
    WorkerControlResponse, WorkerExchange, WorkerOperation, WorkerResult, WorkflowTemplateId,
    MAX_CONTROL_FRAME_BYTES, MAX_PACK_BYTES, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::semiempirical_workflow::evaluate_semiempirical_molecule;
use super::service_mmff;

const SESSION_ENV: &str = "BURRETE_COMPUTE_SESSION_TOKEN";
const EXCHANGE_FD_ENV: &str = "BURRETE_COMPUTE_EXCHANGE_FD";
const CHILD_EXCHANGE_FD: RawFd = 3;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const KERNEL_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const GRAPH_INPUT_MAGIC: &[u8; 4] = b"BTG1";
const GRAPH_OUTPUT_MAGIC: &[u8; 4] = b"BTO1";
const GRAPH_INPUT_HEADER_BYTES: u64 = 44;
const GRAPH_OUTPUT_HEADER_BYTES: u64 = 20;
const ALIGNMENT_INPUT_MAGIC: &[u8; 4] = b"BAL1";
const ALIGNMENT_OUTPUT_MAGIC: &[u8; 4] = b"BAO1";
const ALIGNMENT_INPUT_HEADER_BYTES: u64 = 44;
const ALIGNMENT_OUTPUT_HEADER_BYTES: u64 = 12;
const ALIGNMENT_ATOM_BYTES: u64 = 28;
const ALIGNMENT_MAPPING_BYTES: u64 = 12;
const ALIGNMENT_PAIR_BYTES: u64 = 56;
const ALIGNMENT_RESULT_BYTES: u64 = 84;
const SEMIEMPIRICAL_INPUT_MAGIC: &[u8; 4] = b"BSE1";
const SEMIEMPIRICAL_OUTPUT_MAGIC: &[u8; 4] = b"BSO1";
const SEMIEMPIRICAL_INPUT_HEADER_BYTES: u64 = 32;
const SEMIEMPIRICAL_ATOM_BYTES: u64 = 32;
const SEMIEMPIRICAL_OUTPUT_HEADER_BYTES: u64 = 72;

pub(crate) struct ComputeServiceClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    responses: Mutex<mpsc::Receiver<Result<WorkerControlResponse, String>>>,
    exchange_socket: Mutex<UnixStream>,
    request_lock: Mutex<()>,
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
        let (exchange_socket, child_exchange_socket) = UnixStream::pair()
            .map_err(|error| format!("cannot create compute exchange socket: {error}"))?;
        let child_exchange_fd = child_exchange_socket.as_raw_fd();
        let mut command = Command::new(executable);
        command
            .arg("--runtime-root")
            .arg(runtime_root)
            .env(SESSION_ENV, session_token.as_str())
            .env(EXCHANGE_FD_ENV, CHILD_EXCHANGE_FD.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // SAFETY: `pre_exec` performs only the async-signal-safe `dup2` syscall.
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(child_exchange_fd, CHILD_EXCHANGE_FD) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("cannot launch compute service: {error}"))?;
        drop(child_exchange_socket);
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
            exchange_socket: Mutex::new(exchange_socket),
            request_lock: Mutex::new(()),
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

    pub(crate) fn build_tanimoto_graph(
        &self,
        job_id: Uuid,
        fingerprints: &[Fingerprint2048],
        cutoff: SimilarityCutoff,
        options: GraphBuildOptions,
    ) -> Result<(SymmetricCsr, u64), String> {
        let input = encode_graph_input(fingerprints, cutoff, options)?;
        let max_output_bytes = graph_output_bound(fingerprints.len(), options)?;
        let (output, gpu_time_ms) = self.execute_exchange(
            job_id,
            WorkerOperation::TanimotoGraphV1,
            &input,
            max_output_bytes,
        )?;
        Ok((decode_graph_output(&output)?, gpu_time_ms))
    }

    pub(crate) fn align_and_score(
        &self,
        job_id: Uuid,
        batch: MetalAlignmentBatch<'_>,
        max_memory_bytes: u64,
    ) -> Result<MetalAlignmentExecution, String> {
        let input = encode_alignment_input(batch, max_memory_bytes)?;
        let max_output_bytes = alignment_output_bound(batch.pairs.len())?;
        let (output, gpu_time_ms) = self.execute_exchange(
            job_id,
            WorkerOperation::AlignmentScoreV1,
            &input,
            max_output_bytes,
        )?;
        let mut execution = decode_alignment_output(&output)?;
        execution.gpu_time_ms = gpu_time_ms;
        Ok(execution)
    }

    pub(crate) fn evaluate_semiempirical(
        &self,
        job_id: Uuid,
        molecule: &SemiempiricalMolecule,
        max_memory_bytes: u64,
    ) -> Result<(Rm1Evaluation, u64), String> {
        let input = encode_semiempirical_input(molecule, max_memory_bytes)?;
        let max_output_bytes = semiempirical_output_bound(molecule)?;
        let (output, gpu_time_ms) = self.execute_exchange(
            job_id,
            WorkerOperation::SemiempiricalScfV1,
            &input,
            max_output_bytes,
        )?;
        Ok((decode_semiempirical_output(&output)?, gpu_time_ms))
    }

    pub(crate) fn optimize_mmff(
        &self,
        job_id: Uuid,
        positions: &[[f32; 4]],
        parameters: &MmffParameters,
        options: DistanceGeometryOptimizationOptions,
        max_memory_bytes: u64,
    ) -> Result<MetalMmffOptimization, String> {
        let input = service_mmff::encode_input(positions, parameters, options, max_memory_bytes)?;
        let conformer_count = positions.len() / parameters.atom_count as usize;
        let max_output_bytes = service_mmff::output_bound(positions.len(), conformer_count)?;
        let (output, gpu_time_ms) = self.execute_exchange(
            job_id,
            WorkerOperation::MmffOptimizeV1,
            &input,
            max_output_bytes,
        )?;
        service_mmff::decode_output(&output, gpu_time_ms)
    }

    fn execute_exchange(
        &self,
        job_id: Uuid,
        operation: WorkerOperation,
        input: &[u8],
        max_output_bytes: u64,
    ) -> Result<(Vec<u8>, u64), String> {
        let exchange_id = Uuid::new_v4();
        let capability =
            JobCapabilityToken::new(format!("job-capability.v1.{}", random_base64url()?))
                .map_err(|error| error.to_string())?;
        match self.request(WorkerCommand::AuthorizeJob {
            session_token: self.session_token.clone(),
            job_id,
            capability: capability.clone(),
        })? {
            WorkerResult::JobAuthorized { job_id: authorized } if authorized == job_id => {}
            WorkerResult::Error { message, .. } => return Err(message),
            _ => return Err("compute service returned an invalid job authorization".into()),
        }

        let mut file = anonymous_exchange_file(exchange_id)?;
        file.write_all(&input)
            .map_err(|error| format!("cannot write compute exchange input: {error}"))?;
        file.flush()
            .map_err(|error| format!("cannot flush compute exchange input: {error}"))?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| format!("cannot rewind compute exchange input: {error}"))?;
        let input_sha256 = sha256_hex(&input);
        let exchange = WorkerExchange {
            exchange_id,
            input_bytes: input.len() as u64,
            input_sha256,
            max_output_bytes,
        };
        let exchange_socket = self
            .exchange_socket
            .lock()
            .map_err(|_| "compute exchange socket lock is poisoned".to_string())?;
        send_exchange_fd(&exchange_socket, exchange_id, file.as_raw_fd())?;
        let result = self.request_with_timeout(
            WorkerCommand::ExecuteKernel {
                session_token: self.session_token.clone(),
                job_id,
                capability,
                exchange,
                operation,
            },
            KERNEL_REQUEST_TIMEOUT,
        )?;
        let (output_bytes, output_sha256, gpu_time_ms) = match result {
            WorkerResult::KernelCompleted {
                job_id: completed_job,
                exchange_id: completed_exchange,
                output_bytes,
                output_sha256,
                gpu_time_ms,
            } if completed_job == job_id && completed_exchange == exchange_id => {
                (output_bytes, output_sha256, gpu_time_ms)
            }
            WorkerResult::Error { message, .. } => return Err(message),
            _ => return Err("compute service returned an invalid kernel completion".into()),
        };
        if output_bytes > max_output_bytes {
            return Err("compute service output exceeds the authorized byte bound".into());
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|error| format!("cannot rewind compute exchange output: {error}"))?;
        let output_len = usize::try_from(output_bytes)
            .map_err(|_| "compute service output exceeds this process address space")?;
        let mut output = vec![0_u8; output_len];
        file.read_exact(&mut output)
            .map_err(|error| format!("cannot read compute exchange output: {error}"))?;
        if sha256_hex(&output) != output_sha256 {
            return Err("compute service output digest does not match the exchange file".into());
        }
        Ok((output, gpu_time_ms))
    }

    fn request(&self, command: WorkerCommand) -> Result<WorkerResult, String> {
        self.request_with_timeout(command, REQUEST_TIMEOUT)
    }

    fn request_with_timeout(
        &self,
        command: WorkerCommand,
        timeout: Duration,
    ) -> Result<WorkerResult, String> {
        let _request_guard = self
            .request_lock
            .lock()
            .map_err(|_| "compute service request lock is poisoned".to_string())?;
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
            .recv_timeout(timeout)
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
    let runtime_result = MetalTanimotoRuntime::load(&runtime_root, &helper_sha256);
    let report = capability_report(runtime_result.as_ref());
    let runtime = runtime_result.ok();
    let mut exchange_socket = inherited_exchange_socket().ok();
    let worker_id = Uuid::new_v4();
    let worker_nonce = random_base64url()?;
    let mut seen = BTreeSet::new();
    let mut authorized_jobs = BTreeMap::new();
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
            WorkerCommand::AuthorizeJob {
                session_token: observed,
                job_id,
                capability,
            } if authenticated && observed == session_token => {
                authorized_jobs.insert(job_id, capability);
                WorkerResult::JobAuthorized { job_id }
            }
            WorkerCommand::ExecuteKernel {
                session_token: observed,
                job_id,
                capability,
                exchange,
                operation,
            } if authenticated
                && observed == session_token
                && authorized_jobs.get(&job_id) == Some(&capability) =>
            {
                match execute_kernel(
                    runtime.as_ref(),
                    exchange_socket.as_mut(),
                    job_id,
                    exchange,
                    operation,
                ) {
                    Ok(result) => result,
                    Err(message) => WorkerResult::Error {
                        code: ControlErrorCode::Internal,
                        message,
                    },
                }
            }
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
    runtime: Result<&MetalTanimotoRuntime, &MetalRuntimeError>,
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
            capabilities: capability_entries(true, None),
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
                capabilities: capability_entries(false, Some(code)),
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

fn execute_kernel(
    runtime: Option<&MetalTanimotoRuntime>,
    exchange_socket: Option<&mut UnixStream>,
    job_id: Uuid,
    exchange: WorkerExchange,
    operation: WorkerOperation,
) -> Result<WorkerResult, String> {
    let runtime = runtime.ok_or("native Metal runtime is unavailable")?;
    let exchange_socket = exchange_socket.ok_or("compute exchange descriptor is unavailable")?;
    let (received_id, raw_fd) = receive_exchange_fd(exchange_socket)?;
    if received_id != exchange.exchange_id {
        // SAFETY: ownership of the received descriptor was transferred by SCM_RIGHTS.
        unsafe { libc::close(raw_fd) };
        return Err("compute exchange descriptor ID does not match the command".into());
    }
    // SAFETY: `receive_exchange_fd` returns one newly owned descriptor.
    let mut file = unsafe { File::from_raw_fd(raw_fd) };
    let input_len = usize::try_from(exchange.input_bytes)
        .map_err(|_| "compute exchange input exceeds this process address space")?;
    let mut input = vec![0_u8; input_len];
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.read_exact(&mut input))
        .map_err(|error| format!("cannot read compute exchange input: {error}"))?;
    if sha256_hex(&input) != exchange.input_sha256 {
        return Err("compute exchange input digest mismatch".into());
    }
    let (output, gpu_time_ms) = match operation {
        WorkerOperation::TanimotoGraphV1 => {
            let (fingerprints, cutoff, options) = decode_graph_input(&input)?;
            let execution = runtime
                .build_graph_profiled(&fingerprints, cutoff, options)
                .map_err(|error| error.to_string())?;
            (
                encode_graph_output(&execution.graph)?,
                execution.gpu_time_ms,
            )
        }
        WorkerOperation::AlignmentScoreV1 => {
            let owned = decode_alignment_input(&input)?;
            let execution = runtime
                .align_and_score_profiled(owned.as_batch(), owned.max_memory_bytes)
                .map_err(|error| error.to_string())?;
            (encode_alignment_output(&execution)?, execution.gpu_time_ms)
        }
        WorkerOperation::SemiempiricalScfV1 => {
            let (molecule, max_memory_bytes) = decode_semiempirical_input(&input)?;
            let (evaluation, gpu_time_ms) =
                evaluate_semiempirical_molecule(Some(runtime), &molecule, max_memory_bytes)?;
            (encode_semiempirical_output(&evaluation)?, gpu_time_ms)
        }
        WorkerOperation::MmffOptimizeV1 => {
            let input = service_mmff::decode_input(&input)?;
            let execution = runtime
                .optimize_mmff_profiled(
                    &input.positions,
                    &input.parameters,
                    input.options,
                    input.max_memory_bytes,
                )
                .map_err(|error| error.to_string())?;
            (
                service_mmff::encode_output(&execution, input.parameters.atom_count)?,
                execution.gpu_time_ms,
            )
        }
    };
    if output.len() as u64 > exchange.max_output_bytes {
        return Err("compute kernel output exceeds the authorized byte bound".into());
    }
    file.set_len(0)
        .and_then(|_| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .and_then(|_| file.write_all(&output))
        .and_then(|_| file.sync_data())
        .map_err(|error| format!("cannot publish compute exchange output: {error}"))?;
    Ok(WorkerResult::KernelCompleted {
        job_id,
        exchange_id: exchange.exchange_id,
        output_bytes: output.len() as u64,
        output_sha256: sha256_hex(&output),
        gpu_time_ms,
    })
}

struct OwnedAlignmentInput {
    probe_atoms: Vec<AlignmentAtom>,
    reference_atoms: Vec<AlignmentAtom>,
    mappings: Vec<AtomMapping>,
    pairs: Vec<AlignmentPairDescriptor>,
    max_memory_bytes: u64,
}

impl OwnedAlignmentInput {
    fn as_batch(&self) -> MetalAlignmentBatch<'_> {
        MetalAlignmentBatch {
            probe_atoms: &self.probe_atoms,
            reference_atoms: &self.reference_atoms,
            mappings: &self.mappings,
            pairs: &self.pairs,
        }
    }
}

fn encode_alignment_input(
    batch: MetalAlignmentBatch<'_>,
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    let total_bytes = alignment_input_bytes(
        batch.probe_atoms.len(),
        batch.reference_atoms.len(),
        batch.mappings.len(),
        batch.pairs.len(),
    )?;
    let mut output = Vec::with_capacity(
        usize::try_from(total_bytes)
            .map_err(|_| "alignment input exceeds this process address space")?,
    );
    output.extend_from_slice(ALIGNMENT_INPUT_MAGIC);
    push_u64(&mut output, batch.probe_atoms.len() as u64);
    push_u64(&mut output, batch.reference_atoms.len() as u64);
    push_u64(&mut output, batch.mappings.len() as u64);
    push_u64(&mut output, batch.pairs.len() as u64);
    push_u64(&mut output, max_memory_bytes);
    for atom in batch.probe_atoms.iter().chain(batch.reference_atoms) {
        for coordinate in atom.position {
            push_f32(&mut output, coordinate);
        }
        push_f32(&mut output, atom.gaussian_exponent);
        push_f32(&mut output, atom.gaussian_amplitude);
        push_f32(&mut output, atom.partial_charge);
    }
    for mapping in batch.mappings {
        push_u32(&mut output, mapping.probe_atom);
        push_u32(&mut output, mapping.reference_atom);
        push_f32(&mut output, mapping.weight);
    }
    for pair in batch.pairs {
        push_u64(&mut output, pair.probe_atom_start);
        push_u64(&mut output, pair.probe_atom_count);
        push_u64(&mut output, pair.reference_atom_start);
        push_u64(&mut output, pair.reference_atom_count);
        push_u64(&mut output, pair.mapping_start);
        push_u64(&mut output, pair.mapping_count);
        push_u32(
            &mut output,
            match pair.mode {
                AlignmentMode::FixedPose => 0,
                AlignmentMode::MappedHorn => 1,
            },
        );
        push_u32(&mut output, 0);
    }
    Ok(output)
}

fn decode_alignment_input(input: &[u8]) -> Result<OwnedAlignmentInput, String> {
    let mut cursor = ByteCursor::new(input);
    cursor.expect_magic(ALIGNMENT_INPUT_MAGIC)?;
    let probe_count = cursor.read_count("probe atom")?;
    let reference_count = cursor.read_count("reference atom")?;
    let mapping_count = cursor.read_count("atom mapping")?;
    let pair_count = cursor.read_count("alignment pair")?;
    let max_memory_bytes = cursor.read_u64()?;
    let expected = alignment_input_bytes(probe_count, reference_count, mapping_count, pair_count)?;
    if input.len() as u64 != expected {
        return Err("alignment input byte length is inconsistent".into());
    }
    let mut read_atoms = |count: usize| -> Result<Vec<AlignmentAtom>, String> {
        let mut atoms = Vec::new();
        atoms
            .try_reserve_exact(count)
            .map_err(|_| "cannot allocate alignment atoms")?;
        for _ in 0..count {
            atoms.push(AlignmentAtom {
                position: [
                    cursor.read_f32()?,
                    cursor.read_f32()?,
                    cursor.read_f32()?,
                    cursor.read_f32()?,
                ],
                gaussian_exponent: cursor.read_f32()?,
                gaussian_amplitude: cursor.read_f32()?,
                partial_charge: cursor.read_f32()?,
            });
        }
        Ok(atoms)
    };
    let probe_atoms = read_atoms(probe_count)?;
    let reference_atoms = read_atoms(reference_count)?;
    let mut mappings = Vec::new();
    mappings
        .try_reserve_exact(mapping_count)
        .map_err(|_| "cannot allocate alignment mappings")?;
    for _ in 0..mapping_count {
        mappings.push(AtomMapping {
            probe_atom: cursor.read_u32()?,
            reference_atom: cursor.read_u32()?,
            weight: cursor.read_f32()?,
        });
    }
    let mut pairs = Vec::new();
    pairs
        .try_reserve_exact(pair_count)
        .map_err(|_| "cannot allocate alignment pairs")?;
    for _ in 0..pair_count {
        let pair = AlignmentPairDescriptor {
            probe_atom_start: cursor.read_u64()?,
            probe_atom_count: cursor.read_u64()?,
            reference_atom_start: cursor.read_u64()?,
            reference_atom_count: cursor.read_u64()?,
            mapping_start: cursor.read_u64()?,
            mapping_count: cursor.read_u64()?,
            mode: match cursor.read_u32()? {
                0 => AlignmentMode::FixedPose,
                1 => AlignmentMode::MappedHorn,
                _ => return Err("alignment mode is invalid".into()),
            },
        };
        if cursor.read_u32()? != 0 {
            return Err("alignment pair reserved field is non-zero".into());
        }
        validate_alignment_pair(&pair, probe_count, reference_count, mapping_count)?;
        pairs.push(pair);
    }
    if cursor.remaining() != 0 {
        return Err("alignment input has trailing bytes".into());
    }
    Ok(OwnedAlignmentInput {
        probe_atoms,
        reference_atoms,
        mappings,
        pairs,
        max_memory_bytes,
    })
}

fn encode_alignment_output(execution: &MetalAlignmentExecution) -> Result<Vec<u8>, String> {
    let bound = alignment_output_bound(execution.pairs.len())?;
    let mut output = Vec::with_capacity(bound as usize);
    output.extend_from_slice(ALIGNMENT_OUTPUT_MAGIC);
    push_u64(&mut output, execution.pairs.len() as u64);
    for pair in &execution.pairs {
        for row in pair.transform.rotation {
            for value in row {
                push_f32(&mut output, value);
            }
        }
        for value in pair.transform.translation {
            push_f32(&mut output, value);
        }
        push_f32(&mut output, pair.scores.rmsd.unwrap_or_default());
        push_f32(&mut output, pair.scores.shape_overlap);
        push_f32(&mut output, pair.scores.shape_tanimoto);
        push_f32(&mut output, pair.scores.shape_carbo);
        push_f32(&mut output, pair.scores.electrostatic_overlap);
        push_f32(&mut output, pair.scores.electrostatic_carbo);
        push_f32(&mut output, pair.scores.electrostatic_tanimoto);
        push_f32(&mut output, pair.scores.combined_similarity);
        let flags = u32::from(pair.scores.rmsd.is_some())
            | (u32::from(pair.scores.electrostatic_available) << 1);
        push_u32(&mut output, flags);
    }
    Ok(output)
}

fn decode_alignment_output(output: &[u8]) -> Result<MetalAlignmentExecution, String> {
    let mut cursor = ByteCursor::new(output);
    cursor.expect_magic(ALIGNMENT_OUTPUT_MAGIC)?;
    let pair_count = cursor.read_count("alignment result")?;
    if output.len() as u64 != alignment_output_bound(pair_count)? {
        return Err("alignment output byte length is inconsistent".into());
    }
    let mut pairs = Vec::new();
    pairs
        .try_reserve_exact(pair_count)
        .map_err(|_| "cannot allocate alignment results")?;
    for _ in 0..pair_count {
        let rotation = [
            [cursor.read_f32()?, cursor.read_f32()?, cursor.read_f32()?],
            [cursor.read_f32()?, cursor.read_f32()?, cursor.read_f32()?],
            [cursor.read_f32()?, cursor.read_f32()?, cursor.read_f32()?],
        ];
        let translation = [cursor.read_f32()?, cursor.read_f32()?, cursor.read_f32()?];
        let rmsd = cursor.read_f32()?;
        let shape_overlap = cursor.read_f32()?;
        let shape_tanimoto = cursor.read_f32()?;
        let shape_carbo = cursor.read_f32()?;
        let electrostatic_overlap = cursor.read_f32()?;
        let electrostatic_carbo = cursor.read_f32()?;
        let electrostatic_tanimoto = cursor.read_f32()?;
        let combined_similarity = cursor.read_f32()?;
        let flags = cursor.read_u32()?;
        if flags & !0b11 != 0 {
            return Err("alignment output flags are invalid".into());
        }
        pairs.push(MetalAlignmentPairResult {
            transform: RigidTransform {
                rotation,
                translation,
            },
            scores: AlignmentScores {
                rmsd: (flags & 1 != 0).then_some(rmsd),
                shape_overlap,
                shape_tanimoto,
                shape_carbo,
                electrostatic_overlap,
                electrostatic_carbo,
                electrostatic_tanimoto,
                electrostatic_available: flags & 2 != 0,
                combined_similarity,
            },
        });
    }
    Ok(MetalAlignmentExecution {
        pairs,
        gpu_time_ms: 0,
    })
}

fn alignment_input_bytes(
    probe_count: usize,
    reference_count: usize,
    mapping_count: usize,
    pair_count: usize,
) -> Result<u64, String> {
    ALIGNMENT_INPUT_HEADER_BYTES
        .checked_add(
            (probe_count as u64)
                .checked_add(reference_count as u64)
                .and_then(|count| count.checked_mul(ALIGNMENT_ATOM_BYTES))
                .ok_or("alignment atom byte length overflow")?,
        )
        .and_then(|value| {
            value.checked_add((mapping_count as u64).checked_mul(ALIGNMENT_MAPPING_BYTES)?)
        })
        .and_then(|value| value.checked_add((pair_count as u64).checked_mul(ALIGNMENT_PAIR_BYTES)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "alignment input exceeds the compute exchange bound".into())
}

fn alignment_output_bound(pair_count: usize) -> Result<u64, String> {
    ALIGNMENT_OUTPUT_HEADER_BYTES
        .checked_add(
            (pair_count as u64)
                .checked_mul(ALIGNMENT_RESULT_BYTES)
                .ok_or("alignment output byte length overflow")?,
        )
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "alignment output exceeds the compute exchange bound".into())
}

fn validate_alignment_pair(
    pair: &AlignmentPairDescriptor,
    probe_count: usize,
    reference_count: usize,
    mapping_count: usize,
) -> Result<(), String> {
    let within = |start: u64, count: u64, total: usize| {
        start
            .checked_add(count)
            .is_some_and(|end| end <= total as u64)
    };
    if !within(pair.probe_atom_start, pair.probe_atom_count, probe_count)
        || !within(
            pair.reference_atom_start,
            pair.reference_atom_count,
            reference_count,
        )
        || !within(pair.mapping_start, pair.mapping_count, mapping_count)
    {
        return Err("alignment pair range exceeds its input array".into());
    }
    Ok(())
}

fn encode_semiempirical_input(
    molecule: &SemiempiricalMolecule,
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    let total_bytes = SEMIEMPIRICAL_INPUT_HEADER_BYTES
        .checked_add(
            (molecule.atoms.len() as u64)
                .checked_mul(SEMIEMPIRICAL_ATOM_BYTES)
                .ok_or("semiempirical atom byte length overflow")?,
        )
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or("semiempirical input exceeds the compute exchange bound")?;
    let mut output = Vec::with_capacity(total_bytes as usize);
    output.extend_from_slice(SEMIEMPIRICAL_INPUT_MAGIC);
    push_u32(&mut output, semiempirical_method_tag(molecule.method));
    push_i32(&mut output, molecule.charge);
    push_u32(&mut output, 0);
    push_u64(&mut output, molecule.atoms.len() as u64);
    push_u64(&mut output, max_memory_bytes);
    for atom in &molecule.atoms {
        output.push(atom.atomic_number);
        output.extend_from_slice(&[0; 7]);
        for coordinate in atom.position_angstrom {
            push_f64(&mut output, coordinate);
        }
    }
    Ok(output)
}

fn decode_semiempirical_input(input: &[u8]) -> Result<(SemiempiricalMolecule, u64), String> {
    let mut cursor = ByteCursor::new(input);
    cursor.expect_magic(SEMIEMPIRICAL_INPUT_MAGIC)?;
    let method = semiempirical_method(cursor.read_u32()?)?;
    let charge = cursor.read_i32()?;
    if cursor.read_u32()? != 0 {
        return Err("semiempirical input reserved field is non-zero".into());
    }
    let atom_count = cursor.read_count("semiempirical atom")?;
    let max_memory_bytes = cursor.read_u64()?;
    let expected = SEMIEMPIRICAL_INPUT_HEADER_BYTES
        .checked_add(
            (atom_count as u64)
                .checked_mul(SEMIEMPIRICAL_ATOM_BYTES)
                .ok_or("semiempirical atom byte length overflow")?,
        )
        .ok_or("semiempirical input byte length overflow")?;
    if input.len() as u64 != expected {
        return Err("semiempirical input byte length is inconsistent".into());
    }
    let mut atoms = Vec::new();
    atoms
        .try_reserve_exact(atom_count)
        .map_err(|_| "cannot allocate semiempirical atoms")?;
    for _ in 0..atom_count {
        let atomic_number = cursor.read_array::<1>()?[0];
        if cursor.read_array::<7>()? != [0; 7] {
            return Err("semiempirical atom reserved bytes are non-zero".into());
        }
        atoms.push(SemiempiricalAtom {
            atomic_number,
            position_angstrom: [cursor.read_f64()?, cursor.read_f64()?, cursor.read_f64()?],
        });
    }
    let molecule =
        SemiempiricalMolecule::new(method, atoms, charge).map_err(|error| error.to_string())?;
    Ok((molecule, max_memory_bytes))
}

fn encode_semiempirical_output(evaluation: &Rm1Evaluation) -> Result<Vec<u8>, String> {
    let total_bytes = semiempirical_output_bytes(
        evaluation.atomic_charges.len(),
        evaluation.scf.density.len(),
        evaluation.scf.orbital_energies.len(),
    )?;
    let mut output = Vec::with_capacity(total_bytes as usize);
    output.extend_from_slice(SEMIEMPIRICAL_OUTPUT_MAGIC);
    push_f64(&mut output, evaluation.electronic_energy_ev);
    push_f64(&mut output, evaluation.nuclear_energy_ev);
    push_f64(&mut output, evaluation.total_energy_ev);
    push_u64(&mut output, evaluation.scf.iterations as u64);
    push_f64(&mut output, evaluation.scf.density_error);
    push_u32(
        &mut output,
        match evaluation.scf.status {
            SemiempiricalScfStatus::Converged => 0,
            SemiempiricalScfStatus::MaximumIterations => 1,
        },
    );
    push_u64(&mut output, evaluation.atomic_charges.len() as u64);
    push_u64(&mut output, evaluation.scf.density.len() as u64);
    push_u64(&mut output, evaluation.scf.orbital_energies.len() as u64);
    for value in evaluation
        .atomic_charges
        .iter()
        .chain(&evaluation.scf.density)
        .chain(&evaluation.scf.orbital_energies)
    {
        push_f64(&mut output, *value);
    }
    Ok(output)
}

fn decode_semiempirical_output(output: &[u8]) -> Result<Rm1Evaluation, String> {
    let mut cursor = ByteCursor::new(output);
    cursor.expect_magic(SEMIEMPIRICAL_OUTPUT_MAGIC)?;
    let electronic_energy_ev = cursor.read_f64()?;
    let nuclear_energy_ev = cursor.read_f64()?;
    let total_energy_ev = cursor.read_f64()?;
    let iterations = cursor.read_count("SCF iteration")?;
    let density_error = cursor.read_f64()?;
    let status = match cursor.read_u32()? {
        0 => SemiempiricalScfStatus::Converged,
        1 => SemiempiricalScfStatus::MaximumIterations,
        _ => return Err("semiempirical SCF status is invalid".into()),
    };
    let charge_count = cursor.read_count("atomic charge")?;
    let density_count = cursor.read_count("SCF density")?;
    let orbital_count = cursor.read_count("orbital energy")?;
    if output.len() as u64
        != semiempirical_output_bytes(charge_count, density_count, orbital_count)?
    {
        return Err("semiempirical output byte length is inconsistent".into());
    }
    let mut read_values = |count: usize| -> Result<Vec<f64>, String> {
        let mut values = Vec::new();
        values
            .try_reserve_exact(count)
            .map_err(|_| "cannot allocate semiempirical output")?;
        for _ in 0..count {
            let value = cursor.read_f64()?;
            if !value.is_finite() {
                return Err("semiempirical output contains a non-finite value".into());
            }
            values.push(value);
        }
        Ok(values)
    };
    let atomic_charges = read_values(charge_count)?;
    let density = read_values(density_count)?;
    let orbital_energies = read_values(orbital_count)?;
    if [
        electronic_energy_ev,
        nuclear_energy_ev,
        total_energy_ev,
        density_error,
    ]
    .iter()
    .any(|value| !value.is_finite())
    {
        return Err("semiempirical output contains a non-finite scalar".into());
    }
    Ok(Rm1Evaluation {
        electronic_energy_ev,
        nuclear_energy_ev,
        total_energy_ev,
        atomic_charges,
        scf: SemiempiricalScfResult {
            density,
            orbital_energies,
            iterations,
            density_error,
            status,
        },
    })
}

fn semiempirical_output_bound(molecule: &SemiempiricalMolecule) -> Result<u64, String> {
    let orbitals = molecule.orbital_count as u64;
    SEMIEMPIRICAL_OUTPUT_HEADER_BYTES
        .checked_add(
            (molecule.atoms.len() as u64)
                .checked_mul(8)
                .ok_or("charge bound overflow")?,
        )
        .and_then(|value| value.checked_add(orbitals.checked_mul(orbitals)?.checked_mul(8)?))
        .and_then(|value| value.checked_add(orbitals.checked_mul(8)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "semiempirical output exceeds the compute exchange bound".into())
}

fn semiempirical_output_bytes(
    charge_count: usize,
    density_count: usize,
    orbital_count: usize,
) -> Result<u64, String> {
    let values = (charge_count as u64)
        .checked_add(density_count as u64)
        .and_then(|value| value.checked_add(orbital_count as u64))
        .ok_or("semiempirical output value count overflow")?;
    SEMIEMPIRICAL_OUTPUT_HEADER_BYTES
        .checked_add(
            values
                .checked_mul(8)
                .ok_or("semiempirical output byte length overflow")?,
        )
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "semiempirical output exceeds the compute exchange bound".into())
}

fn semiempirical_method_tag(method: SemiempiricalMethod) -> u32 {
    match method {
        SemiempiricalMethod::Rm1 => 0,
        SemiempiricalMethod::Am1 => 1,
        SemiempiricalMethod::Pm3 => 2,
        SemiempiricalMethod::Pm6 => 3,
        SemiempiricalMethod::Pm6Sp => 4,
        SemiempiricalMethod::Pm6D => 5,
        SemiempiricalMethod::Pm6D3H4 => 6,
        SemiempiricalMethod::Am1Star => 7,
    }
}

fn semiempirical_method(tag: u32) -> Result<SemiempiricalMethod, String> {
    match tag {
        0 => Ok(SemiempiricalMethod::Rm1),
        1 => Ok(SemiempiricalMethod::Am1),
        2 => Ok(SemiempiricalMethod::Pm3),
        3 => Ok(SemiempiricalMethod::Pm6),
        4 => Ok(SemiempiricalMethod::Pm6Sp),
        5 => Ok(SemiempiricalMethod::Pm6D),
        6 => Ok(SemiempiricalMethod::Pm6D3H4),
        7 => Ok(SemiempiricalMethod::Am1Star),
        _ => Err("semiempirical method is invalid".into()),
    }
}

fn encode_graph_input(
    fingerprints: &[Fingerprint2048],
    cutoff: SimilarityCutoff,
    options: GraphBuildOptions,
) -> Result<Vec<u8>, String> {
    cutoff.validate().map_err(|error| error.to_string())?;
    let fingerprint_bytes = (fingerprints.len() as u64)
        .checked_mul(FINGERPRINT_BYTES as u64)
        .ok_or("Tanimoto input byte length overflow")?;
    let total_bytes = GRAPH_INPUT_HEADER_BYTES
        .checked_add(fingerprint_bytes)
        .ok_or("Tanimoto input byte length overflow")?;
    if total_bytes > MAX_PACK_BYTES {
        return Err("Tanimoto input exceeds the compute exchange bound".into());
    }
    let capacity = usize::try_from(total_bytes)
        .map_err(|_| "Tanimoto input exceeds this process address space")?;
    let mut output = Vec::with_capacity(capacity);
    output.extend_from_slice(GRAPH_INPUT_MAGIC);
    push_u64(&mut output, fingerprints.len() as u64);
    push_u32(&mut output, cutoff.numerator);
    push_u32(&mut output, cutoff.denominator);
    push_u64(&mut output, options.max_undirected_edges());
    push_u64(&mut output, options.max_memory_bytes());
    push_u64(&mut output, options.tile_size().get() as u64);
    for fingerprint in fingerprints {
        output.extend_from_slice(&fingerprint.to_le_bytes());
    }
    Ok(output)
}

fn decode_graph_input(
    input: &[u8],
) -> Result<(Vec<Fingerprint2048>, SimilarityCutoff, GraphBuildOptions), String> {
    let mut cursor = ByteCursor::new(input);
    cursor.expect_magic(GRAPH_INPUT_MAGIC)?;
    let count = cursor.read_u64()?;
    let cutoff = SimilarityCutoff {
        numerator: cursor.read_u32()?,
        denominator: cursor.read_u32()?,
    };
    let max_edges = cursor.read_u64()?;
    let max_memory_bytes = cursor.read_u64()?;
    let tile_size = usize::try_from(cursor.read_u64()?)
        .ok()
        .and_then(std::num::NonZeroUsize::new)
        .ok_or("Tanimoto tile size is invalid")?;
    let expected = count
        .checked_mul(FINGERPRINT_BYTES as u64)
        .ok_or("Tanimoto fingerprint byte length overflow")?;
    if cursor.remaining() as u64 != expected {
        return Err("Tanimoto input fingerprint length is inconsistent".into());
    }
    let count = usize::try_from(count)
        .map_err(|_| "Tanimoto fingerprint count exceeds this process address space")?;
    let mut fingerprints = Vec::new();
    fingerprints
        .try_reserve_exact(count)
        .map_err(|_| "cannot allocate Tanimoto fingerprint input")?;
    for _ in 0..count {
        fingerprints.push(Fingerprint2048::from_le_bytes(
            cursor.read_array::<FINGERPRINT_BYTES>()?,
        ));
    }
    let options = GraphBuildOptions::try_new(tile_size, max_edges, max_memory_bytes)
        .map_err(|error| error.to_string())?;
    cutoff.validate().map_err(|error| error.to_string())?;
    Ok((fingerprints, cutoff, options))
}

fn encode_graph_output(graph: &SymmetricCsr) -> Result<Vec<u8>, String> {
    let total_bytes = GRAPH_OUTPUT_HEADER_BYTES
        .checked_add((graph.row_offsets().len() as u64).saturating_mul(8))
        .and_then(|value| {
            value.checked_add((graph.column_indices().len() as u64).saturating_mul(8))
        })
        .ok_or("Tanimoto output byte length overflow")?;
    let capacity = usize::try_from(total_bytes)
        .map_err(|_| "Tanimoto output exceeds this process address space")?;
    let mut output = Vec::with_capacity(capacity);
    output.extend_from_slice(GRAPH_OUTPUT_MAGIC);
    push_u64(&mut output, graph.vertex_count() as u64);
    push_u64(&mut output, graph.column_indices().len() as u64);
    for value in graph.row_offsets() {
        push_u64(&mut output, *value);
    }
    for value in graph.column_indices() {
        push_u64(&mut output, *value);
    }
    Ok(output)
}

fn decode_graph_output(output: &[u8]) -> Result<SymmetricCsr, String> {
    let mut cursor = ByteCursor::new(output);
    cursor.expect_magic(GRAPH_OUTPUT_MAGIC)?;
    let vertex_count = usize::try_from(cursor.read_u64()?)
        .map_err(|_| "Tanimoto graph vertex count exceeds this process address space")?;
    let column_count = usize::try_from(cursor.read_u64()?)
        .map_err(|_| "Tanimoto graph edge count exceeds this process address space")?;
    let mut row_offsets = Vec::new();
    row_offsets
        .try_reserve_exact(vertex_count.saturating_add(1))
        .map_err(|_| "cannot allocate Tanimoto row offsets")?;
    for _ in 0..=vertex_count {
        row_offsets.push(cursor.read_u64()?);
    }
    let mut column_indices = Vec::new();
    column_indices
        .try_reserve_exact(column_count)
        .map_err(|_| "cannot allocate Tanimoto column indices")?;
    for _ in 0..column_count {
        column_indices.push(cursor.read_u64()?);
    }
    if cursor.remaining() != 0 {
        return Err("Tanimoto graph output has trailing bytes".into());
    }
    SymmetricCsr::try_new(row_offsets, column_indices).map_err(|error| error.to_string())
}

fn graph_output_bound(count: usize, options: GraphBuildOptions) -> Result<u64, String> {
    let count = count as u64;
    let possible_edges = count
        .checked_mul(count.saturating_sub(1))
        .and_then(|value| value.checked_div(2))
        .ok_or("Tanimoto graph edge bound overflow")?;
    let edges = possible_edges.min(options.max_undirected_edges());
    GRAPH_OUTPUT_HEADER_BYTES
        .checked_add(
            count
                .checked_add(1)
                .and_then(|value| value.checked_mul(8))
                .ok_or("Tanimoto graph row-offset bound overflow")?,
        )
        .and_then(|value| value.checked_add(edges.checked_mul(16)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "Tanimoto graph output exceeds the compute exchange bound".into())
}

fn anonymous_exchange_file(exchange_id: Uuid) -> Result<File, String> {
    let path = std::env::temp_dir().join(format!(".burrete-compute-exchange-{exchange_id}"));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("cannot create anonymous compute exchange: {error}"))?;
    std::fs::remove_file(&path)
        .map_err(|error| format!("cannot unlink compute exchange: {error}"))?;
    Ok(file)
}

fn inherited_exchange_socket() -> Result<UnixStream, String> {
    let raw_fd = std::env::var(EXCHANGE_FD_ENV)
        .map_err(|_| "compute exchange descriptor is missing")?
        .parse::<RawFd>()
        .map_err(|_| "compute exchange descriptor is invalid")?;
    std::env::remove_var(EXCHANGE_FD_ENV);
    if raw_fd != CHILD_EXCHANGE_FD {
        return Err("compute exchange descriptor differs from the fixed service ABI".into());
    }
    // SAFETY: the coordinator transfers ownership of this inherited descriptor.
    Ok(unsafe { UnixStream::from_raw_fd(raw_fd) })
}

fn send_exchange_fd(socket: &UnixStream, exchange_id: Uuid, raw_fd: RawFd) -> Result<(), String> {
    let bytes = *exchange_id.as_bytes();
    let mut iov = libc::iovec {
        iov_base: bytes.as_ptr().cast_mut().cast(),
        iov_len: bytes.len(),
    };
    let control_len = unsafe { libc::CMSG_SPACE(mem::size_of::<RawFd>() as _) } as usize;
    let mut control = vec![0_u8; control_len];
    // SAFETY: all pointers in the message reference live, correctly sized buffers for sendmsg.
    let sent = unsafe {
        let mut message: libc::msghdr = mem::zeroed();
        message.msg_iov = &mut iov;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = control.len() as _;
        let header = libc::CMSG_FIRSTHDR(&message);
        if header.is_null() {
            return Err("cannot construct compute exchange descriptor message".into());
        }
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(mem::size_of::<RawFd>() as _) as _;
        std::ptr::copy_nonoverlapping(
            (&raw_fd as *const RawFd).cast::<u8>(),
            libc::CMSG_DATA(header),
            mem::size_of::<RawFd>(),
        );
        libc::sendmsg(socket.as_raw_fd(), &message, 0)
    };
    if sent != bytes.len() as isize {
        return Err(format!(
            "cannot transfer compute exchange descriptor: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn receive_exchange_fd(socket: &mut UnixStream) -> Result<(Uuid, RawFd), String> {
    let mut bytes = [0_u8; 16];
    let mut iov = libc::iovec {
        iov_base: bytes.as_mut_ptr().cast(),
        iov_len: bytes.len(),
    };
    let control_len = unsafe { libc::CMSG_SPACE(mem::size_of::<RawFd>() as _) } as usize;
    let mut control = vec![0_u8; control_len];
    // SAFETY: all pointers in the message reference live, correctly sized buffers for recvmsg.
    let (received, raw_fd) = unsafe {
        let mut message: libc::msghdr = mem::zeroed();
        message.msg_iov = &mut iov;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = control.len() as _;
        let received = libc::recvmsg(socket.as_raw_fd(), &mut message, 0);
        if received < 0 {
            return Err(format!(
                "cannot receive compute exchange descriptor: {}",
                std::io::Error::last_os_error()
            ));
        }
        if message.msg_flags & (libc::MSG_TRUNC | libc::MSG_CTRUNC) != 0 {
            return Err("compute exchange descriptor message was truncated".into());
        }
        let header = libc::CMSG_FIRSTHDR(&message);
        if header.is_null()
            || (*header).cmsg_level != libc::SOL_SOCKET
            || (*header).cmsg_type != libc::SCM_RIGHTS
            || (*header).cmsg_len as usize != libc::CMSG_LEN(mem::size_of::<RawFd>() as _) as usize
        {
            return Err("compute exchange descriptor message is malformed".into());
        }
        let mut raw_fd = -1;
        std::ptr::copy_nonoverlapping(
            libc::CMSG_DATA(header),
            (&mut raw_fd as *mut RawFd).cast::<u8>(),
            mem::size_of::<RawFd>(),
        );
        (received, raw_fd)
    };
    if received != bytes.len() as isize || raw_fd < 0 {
        if raw_fd >= 0 {
            // SAFETY: the descriptor was received but the envelope was invalid.
            unsafe { libc::close(raw_fd) };
        }
        return Err("compute exchange descriptor message has an invalid envelope".into());
    }
    Ok((Uuid::from_bytes(bytes), raw_fd))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_i32(output: &mut Vec<u8>, value: i32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_f32(output: &mut Vec<u8>, value: f32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_f64(output: &mut Vec<u8>, value: f64) {
    output.extend_from_slice(&value.to_le_bytes());
}

struct ByteCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn expect_magic(&mut self, magic: &[u8; 4]) -> Result<(), String> {
        if self.read_array::<4>()? != *magic {
            return Err("compute exchange operation magic is invalid".into());
        }
        Ok(())
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.read_array()?))
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.read_array()?))
    }

    fn read_u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.read_array()?))
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        Ok(f32::from_le_bytes(self.read_array()?))
    }

    fn read_f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.read_array()?))
    }

    fn read_count(&mut self, label: &str) -> Result<usize, String> {
        usize::try_from(self.read_u64()?)
            .map_err(|_| format!("{label} count exceeds this process address space"))
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self
            .offset
            .checked_add(N)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("compute exchange payload is truncated")?;
        let value = self.bytes[self.offset..end]
            .try_into()
            .expect("validated fixed-size slice");
        self.offset = end;
        Ok(value)
    }
}

fn capability_entries(
    available: bool,
    reason_code: Option<CapabilityReasonCode>,
) -> Vec<CapabilityEntry> {
    [
        (
            WorkflowTemplateId::ClusterV1,
            "tanimotoNeighbors",
            "cluster.v1/all",
            Precision::IntegerExact,
        ),
        (
            WorkflowTemplateId::AlignmentV1,
            "mappedHornShapeElectrostatics",
            "alignment.v1/selected",
            Precision::Float32,
        ),
        (
            WorkflowTemplateId::SemiempiricalV1,
            "scfDiisAdaptiveDamping",
            "semiempirical.v1/selected",
            Precision::Mixed,
        ),
    ]
    .into_iter()
    .map(
        |(workflow_template, method, chemistry_domain, precision)| CapabilityEntry {
            workflow_template,
            method: method.into(),
            chemistry_domain: chemistry_domain.into(),
            backend: Backend::NativeMetal,
            precision,
            maturity: CapabilityMaturity::Experimental,
            available,
            reason_code,
        },
    )
    .collect()
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

#[cfg(test)]
mod tests {
    use std::num::NonZeroUsize;

    use burrete_compute_core::{MmffBondTerm, MmffVariant};

    use super::*;

    fn graph_options() -> GraphBuildOptions {
        GraphBuildOptions::try_new(NonZeroUsize::new(2).unwrap(), 32, 8 * 1024 * 1024)
            .expect("valid graph options")
    }

    #[test]
    fn graph_exchange_abi_round_trips_exactly() {
        let fingerprints = vec![
            Fingerprint2048::from_words([0x11; 32]),
            Fingerprint2048::from_words([0x22; 32]),
        ];
        let cutoff = SimilarityCutoff {
            numerator: 3,
            denominator: 5,
        };
        let input = encode_graph_input(&fingerprints, cutoff, graph_options()).expect("encode");
        let (decoded, decoded_cutoff, decoded_options) =
            decode_graph_input(&input).expect("decode");
        assert_eq!(decoded, fingerprints);
        assert_eq!(decoded_cutoff, cutoff);
        assert_eq!(decoded_options, graph_options());

        let graph = SymmetricCsr::try_new(vec![0, 1, 2], vec![1, 0]).expect("valid graph");
        assert_eq!(
            decode_graph_output(&encode_graph_output(&graph).expect("encode output"))
                .expect("decode output"),
            graph
        );
    }

    #[test]
    fn service_capabilities_match_executable_kernel_operations() {
        let entries = capability_entries(true, None);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].workflow_template, WorkflowTemplateId::ClusterV1);
        assert_eq!(
            entries[1].workflow_template,
            WorkflowTemplateId::AlignmentV1
        );
        assert_eq!(
            entries[2].workflow_template,
            WorkflowTemplateId::SemiempiricalV1
        );
        assert!(entries.iter().all(|entry| entry.available));
    }

    #[test]
    fn alignment_exchange_abi_round_trips_exactly() {
        let probe_atoms = [AlignmentAtom {
            position: [1.0, 2.0, 3.0, 0.0],
            gaussian_exponent: 0.8,
            gaussian_amplitude: 1.2,
            partial_charge: -0.3,
        }];
        let reference_atoms = [AlignmentAtom {
            position: [3.0, 2.0, 1.0, 0.0],
            ..probe_atoms[0]
        }];
        let mappings = [AtomMapping {
            probe_atom: 0,
            reference_atom: 0,
            weight: 1.0,
        }];
        let descriptors = [AlignmentPairDescriptor {
            probe_atom_start: 0,
            probe_atom_count: 1,
            reference_atom_start: 0,
            reference_atom_count: 1,
            mapping_start: 0,
            mapping_count: 1,
            mode: AlignmentMode::MappedHorn,
        }];
        let encoded = encode_alignment_input(
            MetalAlignmentBatch {
                probe_atoms: &probe_atoms,
                reference_atoms: &reference_atoms,
                mappings: &mappings,
                pairs: &descriptors,
            },
            8 * 1024 * 1024,
        )
        .expect("encode alignment input");
        let decoded = decode_alignment_input(&encoded).expect("decode alignment input");
        assert_eq!(decoded.probe_atoms, probe_atoms);
        assert_eq!(decoded.reference_atoms, reference_atoms);
        assert_eq!(decoded.mappings, mappings);
        assert_eq!(decoded.pairs, descriptors);
        assert_eq!(decoded.max_memory_bytes, 8 * 1024 * 1024);

        let expected = MetalAlignmentExecution {
            pairs: vec![MetalAlignmentPairResult {
                transform: RigidTransform::IDENTITY,
                scores: AlignmentScores {
                    rmsd: Some(0.25),
                    shape_overlap: 1.0,
                    shape_tanimoto: 0.9,
                    shape_carbo: 0.8,
                    electrostatic_overlap: -0.5,
                    electrostatic_carbo: -0.4,
                    electrostatic_tanimoto: -0.3,
                    electrostatic_available: true,
                    combined_similarity: 0.2,
                },
            }],
            gpu_time_ms: 0,
        };
        assert_eq!(
            decode_alignment_output(&encode_alignment_output(&expected).expect("encode output"))
                .expect("decode output"),
            expected
        );
    }

    #[test]
    fn semiempirical_exchange_abi_round_trips_exactly() {
        let molecule = SemiempiricalMolecule::new(
            SemiempiricalMethod::Pm6D3H4,
            vec![
                SemiempiricalAtom {
                    atomic_number: 8,
                    position_angstrom: [0.0, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.95, 0.0, 0.0],
                },
            ],
            -1,
        )
        .expect("valid molecule");
        let input = encode_semiempirical_input(&molecule, 64 * 1024 * 1024).expect("encode input");
        let (decoded, memory) = decode_semiempirical_input(&input).expect("decode input");
        assert_eq!(decoded, molecule);
        assert_eq!(memory, 64 * 1024 * 1024);

        let expected = Rm1Evaluation {
            electronic_energy_ev: -12.0,
            nuclear_energy_ev: 3.0,
            total_energy_ev: -9.0,
            atomic_charges: vec![-0.5, -0.5],
            scf: SemiempiricalScfResult {
                density: vec![1.0, 0.0, 0.0, 1.0],
                orbital_energies: vec![-2.0, 1.0],
                iterations: 7,
                density_error: 1.0e-8,
                status: SemiempiricalScfStatus::Converged,
            },
        };
        assert_eq!(
            decode_semiempirical_output(
                &encode_semiempirical_output(&expected).expect("encode output")
            )
            .expect("decode output"),
            expected
        );
    }

    #[test]
    fn exchange_descriptor_transfer_preserves_identity_and_contents() {
        let (sender, mut receiver) = UnixStream::pair().expect("socket pair");
        let exchange_id = Uuid::new_v4();
        let mut source = anonymous_exchange_file(exchange_id).expect("exchange file");
        source.write_all(b"descriptor payload").expect("write");
        source.seek(SeekFrom::Start(0)).expect("rewind");
        send_exchange_fd(&sender, exchange_id, source.as_raw_fd()).expect("send descriptor");
        let (received_id, received_fd) =
            receive_exchange_fd(&mut receiver).expect("receive descriptor");
        assert_eq!(received_id, exchange_id);
        // SAFETY: the descriptor was newly received and is owned by this test.
        let mut received = unsafe { File::from_raw_fd(received_fd) };
        let mut contents = String::new();
        received.read_to_string(&mut contents).expect("read");
        assert_eq!(contents, "descriptor payload");
    }

    #[test]
    #[ignore = "requires a packaged helper and a real Apple Metal runtime"]
    fn packaged_service_executes_tanimoto_on_real_metal() {
        let helper =
            PathBuf::from(std::env::var("BURRETE_TEST_COMPUTE_SERVICE").expect("helper path"));
        let runtime =
            PathBuf::from(std::env::var("BURRETE_TEST_COMPUTE_RUNTIME").expect("runtime path"));
        let client = ComputeServiceClient::launch(&helper, &runtime).expect("launch service");
        let fingerprints = vec![
            Fingerprint2048::from_words([u64::MAX; 32]),
            Fingerprint2048::from_words([u64::MAX; 32]),
            Fingerprint2048::ZERO,
        ];
        let (graph, _) = client
            .build_tanimoto_graph(
                Uuid::new_v4(),
                &fingerprints,
                SimilarityCutoff {
                    numerator: 1,
                    denominator: 2,
                },
                graph_options(),
            )
            .expect("execute graph kernel through helper");
        assert_eq!(graph.row_offsets(), &[0, 1, 2, 2]);
        assert_eq!(graph.column_indices(), &[1, 0]);

        let atoms = [
            AlignmentAtom {
                position: [0.0, 0.0, 0.0, 0.0],
                gaussian_exponent: 0.8,
                gaussian_amplitude: 1.2,
                partial_charge: 0.3,
            },
            AlignmentAtom {
                position: [1.5, 0.0, 0.0, 0.0],
                gaussian_exponent: 0.9,
                gaussian_amplitude: 1.4,
                partial_charge: -0.2,
            },
        ];
        let descriptors = [AlignmentPairDescriptor {
            probe_atom_start: 0,
            probe_atom_count: 2,
            reference_atom_start: 0,
            reference_atom_count: 2,
            mapping_start: 0,
            mapping_count: 0,
            mode: AlignmentMode::FixedPose,
        }];
        let alignment = client
            .align_and_score(
                Uuid::new_v4(),
                MetalAlignmentBatch {
                    probe_atoms: &atoms,
                    reference_atoms: &atoms,
                    mappings: &[],
                    pairs: &descriptors,
                },
                8 * 1024 * 1024,
            )
            .expect("execute alignment kernel through helper");
        assert!((alignment.pairs[0].scores.shape_tanimoto - 1.0).abs() < 1.0e-5);
        assert!((alignment.pairs[0].scores.electrostatic_carbo - 1.0).abs() < 1.0e-5);

        let water = SemiempiricalMolecule::new(
            SemiempiricalMethod::Rm1,
            vec![
                SemiempiricalAtom {
                    atomic_number: 8,
                    position_angstrom: [0.0, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.9584, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [-0.2396, 0.9275, 0.0],
                },
            ],
            0,
        )
        .expect("valid water");
        let (evaluation, gpu_time_ms) = client
            .evaluate_semiempirical(Uuid::new_v4(), &water, 64 * 1024 * 1024)
            .expect("execute semiempirical SCF through helper");
        assert_eq!(evaluation.scf.status, SemiempiricalScfStatus::Converged);
        assert!(evaluation.total_energy_ev.is_finite());
        assert!(gpu_time_ms > 0);

        let mmff_parameters = MmffParameters {
            variant: MmffVariant::Mmff94,
            atom_count: 2,
            bonds: vec![MmffBondTerm {
                atoms: [0, 1],
                force_constant: 4.0,
                equilibrium_distance: 1.5,
            }],
            angles: Vec::new(),
            stretch_bends: Vec::new(),
            out_of_planes: Vec::new(),
            torsions: Vec::new(),
            van_der_waals: Vec::new(),
            electrostatics: Vec::new(),
        };
        let optimized = client
            .optimize_mmff(
                Uuid::new_v4(),
                &[[0.0, 0.0, 0.0, 0.0], [1.8, 0.0, 0.0, 0.0]],
                &mmff_parameters,
                DistanceGeometryOptimizationOptions::default(),
                64 * 1024 * 1024,
            )
            .expect("execute MMFF optimization through helper");
        assert!(matches!(
            optimized.statuses[0],
            burrete_compute_core::DistanceGeometryOptimizationStatus::ConvergedGradient
                | burrete_compute_core::DistanceGeometryOptimizationStatus::ConvergedStep
        ));
        assert_eq!(
            optimized.optimizers,
            [burrete_compute_core::MmffOptimizerKind::Bfgs]
        );
        assert!(optimized.gpu_time_ms > 0);
    }
}
