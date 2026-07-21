use std::fmt;

use burrete_compute_protocol::ProtocolError;

#[derive(Debug)]
pub(crate) enum ComputeCoordinatorError {
    Database(String),
    Filesystem(String),
    Serialization(String),
    Protocol(String),
    NotFound {
        entity: &'static str,
        id: String,
    },
    Conflict {
        expected_revision: u64,
        actual_revision: u64,
    },
    Forbidden(String),
    SourceSnapshotUnavailable(String),
    Unavailable(String),
    Validation(String),
}

impl ComputeCoordinatorError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "Database",
            Self::Filesystem(_) => "Filesystem",
            Self::Serialization(_) => "Serialization",
            Self::Protocol(_) => "Protocol",
            Self::NotFound { .. } => "NotFound",
            Self::Conflict { .. } => "Conflict",
            Self::Forbidden(_) => "Forbidden",
            Self::SourceSnapshotUnavailable(_) => "SourceSnapshotUnavailable",
            Self::Unavailable(_) => "Unavailable",
            Self::Validation(_) => "Validation",
        }
    }

    pub(crate) fn current_revision(&self) -> Option<u64> {
        match self {
            Self::Conflict {
                actual_revision, ..
            } => Some(*actual_revision),
            _ => None,
        }
    }
}

impl fmt::Display for ComputeCoordinatorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(message) => write!(formatter, "compute database failed: {message}"),
            Self::Filesystem(message) => write!(formatter, "compute filesystem failed: {message}"),
            Self::Serialization(message) => {
                write!(formatter, "compute state serialization failed: {message}")
            }
            Self::Protocol(message) => {
                write!(formatter, "compute protocol rejected state: {message}")
            }
            Self::NotFound { entity, id } => write!(formatter, "{entity} not found: {id}"),
            Self::Conflict {
                expected_revision,
                actual_revision,
            } => write!(
                formatter,
                "compute revision conflict: expected {expected_revision}, current {actual_revision}"
            ),
            Self::Forbidden(message) => formatter.write_str(message),
            Self::SourceSnapshotUnavailable(message) => formatter.write_str(message),
            Self::Unavailable(message) => formatter.write_str(message),
            Self::Validation(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ComputeCoordinatorError {}

impl From<rusqlite::Error> for ComputeCoordinatorError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<std::io::Error> for ComputeCoordinatorError {
    fn from(error: std::io::Error) -> Self {
        Self::Filesystem(error.to_string())
    }
}

impl From<serde_json::Error> for ComputeCoordinatorError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(error.to_string())
    }
}

impl From<ProtocolError> for ComputeCoordinatorError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error.to_string())
    }
}

pub(crate) type ComputeResult<T> = Result<T, ComputeCoordinatorError>;
