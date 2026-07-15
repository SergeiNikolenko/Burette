use std::fmt;

use serde::{Deserialize, Serialize};

use crate::validation::{validate_bounded_text, validate_optional_bounded_text};

const MAX_ERROR_MESSAGE_BYTES: usize = 2_048;
const MAX_STAGE_ID_BYTES: usize = 96;
const MAX_MOLECULE_ID_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ComputeErrorCode {
    InvalidChemistry,
    UnsupportedChemistry,
    CapabilityMismatch,
    GpuAdmissionDenied,
    GpuExecutionFailed,
    NumericalFailure,
    ValidationMismatch,
    WorkerCrashed,
    ArtifactCorrupt,
    RuntimeIntegrityError,
    SourceRevisionMismatch,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputeFailure {
    pub code: ComputeErrorCode,
    pub message: String,
    pub stage_id: Option<String>,
    pub molecule_stable_id: Option<String>,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    Validation(String),
    InvalidTransition { from: String, to: String },
    FrameTooLarge { bytes: usize, limit: usize },
    Io(String),
    Json(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) => formatter.write_str(message),
            Self::InvalidTransition { from, to } => {
                write!(formatter, "invalid compute job transition: {from} -> {to}")
            }
            Self::FrameTooLarge { bytes, limit } => {
                write!(
                    formatter,
                    "compute control frame is {bytes} bytes; limit is {limit}"
                )
            }
            Self::Io(message) => write!(formatter, "compute control I/O failed: {message}"),
            Self::Json(message) => write!(formatter, "compute control JSON failed: {message}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

impl ComputeFailure {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text(
            "compute failure message",
            &self.message,
            MAX_ERROR_MESSAGE_BYTES,
        )?;
        validate_optional_bounded_text(
            "compute failure stage ID",
            self.stage_id.as_deref(),
            MAX_STAGE_ID_BYTES,
        )?;
        validate_optional_bounded_text(
            "compute failure molecule ID",
            self.molecule_stable_id.as_deref(),
            MAX_MOLECULE_ID_BYTES,
        )?;
        if self.code == ComputeErrorCode::Cancelled && self.retryable {
            return Err(ProtocolError::Validation(
                "cancelled compute failures cannot be retryable".into(),
            ));
        }
        Ok(())
    }
}

impl From<std::io::Error> for ProtocolError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<serde_json::Error> for ProtocolError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error.to_string())
    }
}
