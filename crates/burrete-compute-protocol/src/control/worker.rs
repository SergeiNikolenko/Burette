use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::auth::{
    validate_envelope, validate_job_authority_shape, validate_nonce, validate_revision,
    validate_sha256, validate_text, validate_uuid, JobCapabilityToken, SessionToken,
    MAX_ERROR_MESSAGE_BYTES,
};
use super::client::ControlErrorCode;
use crate::wire::{sealed::Sealed, WireMessage};
use crate::{ComputeCapabilityReport, JobState, ProtocolError, PROTOCOL_VERSION};

/// Strict coordinator-to-worker control envelope. Job-scoped commands always
/// carry both the immutable job ID and its bearer capability; no command has a
/// filesystem path field. The worker must reject replayed request IDs and must
/// authenticate the session/capability/job tuple before dispatch.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerControlRequest {
    protocol_version: u32,
    pub request_id: Uuid,
    pub command: WorkerCommand,
}

impl WorkerControlRequest {
    pub fn new(request_id: Uuid, command: WorkerCommand) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            command,
        }
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version
    }
}

impl Sealed for WorkerControlRequest {}

impl WireMessage for WorkerControlRequest {
    fn validate_wire(&self) -> Result<(), ProtocolError> {
        validate_envelope(self.protocol_version, self.request_id)?;
        self.command.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkerCommand {
    Handshake {
        session_token: SessionToken,
        coordinator_nonce: String,
    },
    Capabilities {
        session_token: SessionToken,
    },
    JobStatus {
        session_token: SessionToken,
        job_id: Uuid,
        capability: JobCapabilityToken,
    },
    Ping {
        session_token: SessionToken,
        nonce: String,
    },
    AuthorizeJob {
        session_token: SessionToken,
        job_id: Uuid,
        capability: JobCapabilityToken,
    },
    ExecuteKernel {
        session_token: SessionToken,
        job_id: Uuid,
        capability: JobCapabilityToken,
        exchange: WorkerExchange,
        operation: WorkerOperation,
    },
    Interrupt {
        session_token: SessionToken,
        job_id: Uuid,
        capability: JobCapabilityToken,
    },
}

impl WorkerCommand {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Handshake {
                session_token,
                coordinator_nonce,
            } => {
                session_token.validate()?;
                validate_nonce("coordinator nonce", coordinator_nonce)
            }
            Self::Capabilities { session_token } => session_token.validate(),
            Self::JobStatus {
                session_token,
                job_id,
                capability,
            }
            | Self::AuthorizeJob {
                session_token,
                job_id,
                capability,
            }
            | Self::ExecuteKernel {
                session_token,
                job_id,
                capability,
                ..
            }
            | Self::Interrupt {
                session_token,
                job_id,
                capability,
            } => {
                validate_job_authority_shape(session_token, *job_id, capability)?;
                if let Self::ExecuteKernel { exchange, .. } = self {
                    exchange.validate()?;
                }
                Ok(())
            }
            Self::Ping {
                session_token,
                nonce,
            } => {
                session_token.validate()?;
                validate_nonce("ping nonce", nonce)
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerExchange {
    pub exchange_id: Uuid,
    pub input_bytes: u64,
    pub input_sha256: String,
    pub max_output_bytes: u64,
}

impl WorkerExchange {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_uuid("worker exchange ID", self.exchange_id)?;
        if self.input_bytes == 0 || self.input_bytes > crate::MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(
                "worker exchange input byte length is outside the pack bound".into(),
            ));
        }
        validate_sha256("worker exchange input", &self.input_sha256)?;
        if self.max_output_bytes == 0 || self.max_output_bytes > crate::MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(
                "worker exchange output byte limit is outside the pack bound".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkerOperation {
    TanimotoGraphV1,
    AlignmentScoreV1,
    SemiempiricalScfV1,
    MmffOptimizeV1,
}

/// Strict worker-to-coordinator control envelope.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerControlResponse {
    protocol_version: u32,
    pub request_id: Uuid,
    pub result: WorkerResult,
}

impl WorkerControlResponse {
    pub fn new(request_id: Uuid, result: WorkerResult) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            result,
        }
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version
    }
}

impl Sealed for WorkerControlResponse {}

impl WireMessage for WorkerControlResponse {
    fn validate_wire(&self) -> Result<(), ProtocolError> {
        validate_envelope(self.protocol_version, self.request_id)?;
        self.result.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkerResult {
    HandshakeAccepted {
        worker_id: Uuid,
        coordinator_nonce: String,
        worker_nonce: String,
    },
    Capabilities {
        report: Box<ComputeCapabilityReport>,
    },
    JobStatus {
        job_id: Uuid,
        revision: u64,
        state: JobState,
    },
    Pong {
        nonce: String,
    },
    InterruptAccepted {
        job_id: Uuid,
        revision: u64,
    },
    JobAuthorized {
        job_id: Uuid,
    },
    KernelCompleted {
        job_id: Uuid,
        exchange_id: Uuid,
        output_bytes: u64,
        output_sha256: String,
        gpu_time_ms: u64,
    },
    Error {
        code: ControlErrorCode,
        message: String,
    },
}

impl WorkerResult {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::HandshakeAccepted {
                worker_id,
                coordinator_nonce,
                worker_nonce,
            } => {
                validate_uuid("worker ID", *worker_id)?;
                validate_nonce("echoed coordinator nonce", coordinator_nonce)?;
                validate_nonce("worker nonce", worker_nonce)
            }
            Self::Capabilities { report } => report.validate(),
            Self::JobStatus {
                job_id, revision, ..
            }
            | Self::InterruptAccepted { job_id, revision } => {
                validate_uuid("job ID", *job_id)?;
                validate_revision("job revision", *revision)
            }
            Self::JobAuthorized { job_id } => validate_uuid("job ID", *job_id),
            Self::KernelCompleted {
                job_id,
                exchange_id,
                output_bytes,
                output_sha256,
                gpu_time_ms,
            } => {
                validate_uuid("job ID", *job_id)?;
                validate_uuid("worker exchange ID", *exchange_id)?;
                if *output_bytes == 0 || *output_bytes > crate::MAX_PACK_BYTES {
                    return Err(ProtocolError::Validation(
                        "worker output byte length is outside the pack bound".into(),
                    ));
                }
                validate_sha256("worker output", output_sha256)?;
                if *gpu_time_ms > crate::MAX_JSON_SAFE_INTEGER {
                    return Err(ProtocolError::Validation(
                        "worker GPU time exceeds the JSON-safe integer limit".into(),
                    ));
                }
                Ok(())
            }
            Self::Pong { nonce } => validate_nonce("pong nonce", nonce),
            Self::Error { message, .. } => {
                validate_text("worker error message", message, MAX_ERROR_MESSAGE_BYTES)
            }
        }
    }
}
