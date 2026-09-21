use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::auth::{
    validate_envelope, validate_nonce, validate_revision, validate_text, validate_uuid,
    SessionToken, MAX_ERROR_MESSAGE_BYTES,
};
use crate::wire::{sealed::Sealed, WireMessage};
use crate::{
    ClusterV1SubmitRequest, ComputeCapabilityReport, ConformerV1SubmitRequest, JobState,
    ProtocolError, PROTOCOL_VERSION,
};

/// Strict public client-to-coordinator control envelope.
///
/// The coordinator must treat `request_id` as a replay key scoped to the
/// authenticated session. A handshake response echoes the client nonce so the
/// caller can bind the accepted session to the live transcript.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlRequest {
    protocol_version: u32,
    pub request_id: Uuid,
    pub command: ControlCommand,
}

impl ControlRequest {
    pub fn new(request_id: Uuid, command: ControlCommand) -> Self {
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

impl Sealed for ControlRequest {}

impl WireMessage for ControlRequest {
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
pub enum ControlCommand {
    Handshake {
        client_nonce: String,
    },
    Capabilities {
        session_token: SessionToken,
    },
    SubmitClusterV1 {
        session_token: SessionToken,
        request: ClusterV1SubmitRequest,
    },
    SubmitConformerV1 {
        session_token: SessionToken,
        request: ConformerV1SubmitRequest,
    },
    JobStatus {
        session_token: SessionToken,
        job_id: Uuid,
    },
    CancelJob {
        session_token: SessionToken,
        job_id: Uuid,
    },
}

impl ControlCommand {
    pub(super) fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Handshake { client_nonce } => validate_nonce("client nonce", client_nonce),
            Self::Capabilities { session_token } => session_token.validate(),
            Self::SubmitClusterV1 {
                session_token,
                request,
            } => {
                session_token.validate()?;
                request.clone().normalized().map(|_| ())
            }
            Self::SubmitConformerV1 {
                session_token,
                request,
            } => {
                session_token.validate()?;
                request.clone().normalized().map(|_| ())
            }
            Self::JobStatus {
                session_token,
                job_id,
            }
            | Self::CancelJob {
                session_token,
                job_id,
            } => {
                session_token.validate()?;
                validate_uuid("job ID", *job_id)
            }
        }
    }
}

/// Strict coordinator-to-client control envelope.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlResponse {
    protocol_version: u32,
    pub request_id: Uuid,
    pub result: ControlResult,
}

impl ControlResponse {
    pub fn new(request_id: Uuid, result: ControlResult) -> Self {
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

impl Sealed for ControlResponse {}

impl WireMessage for ControlResponse {
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
pub enum ControlResult {
    HandshakeAccepted {
        session_token: SessionToken,
        client_nonce: String,
        server_nonce: String,
    },
    Capabilities {
        report: Box<ComputeCapabilityReport>,
    },
    JobAccepted {
        job_id: Uuid,
        revision: u64,
    },
    JobStatus {
        job_id: Uuid,
        revision: u64,
        state: JobState,
    },
    CancelAccepted {
        job_id: Uuid,
        revision: u64,
    },
    Error {
        code: ControlErrorCode,
        message: String,
    },
}

impl ControlResult {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::HandshakeAccepted {
                session_token,
                client_nonce,
                server_nonce,
            } => {
                session_token.validate()?;
                validate_nonce("echoed client nonce", client_nonce)?;
                validate_nonce("server nonce", server_nonce)
            }
            Self::Capabilities { report } => report.validate(),
            Self::JobAccepted { job_id, revision }
            | Self::JobStatus {
                job_id, revision, ..
            }
            | Self::CancelAccepted { job_id, revision } => {
                validate_uuid("job ID", *job_id)?;
                validate_revision("job revision", *revision)
            }
            Self::Error { message, .. } => {
                validate_text("control error message", message, MAX_ERROR_MESSAGE_BYTES)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlErrorCode {
    InvalidRequest,
    Unauthorized,
    CapabilityDenied,
    JobNotFound,
    Conflict,
    Unavailable,
    Internal,
}
