use std::fmt;

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
