use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ProtocolError, MAX_JSON_SAFE_INTEGER, PROTOCOL_VERSION};

const MIN_NONCE_BYTES: usize = 16;
const MAX_NONCE_BYTES: usize = 128;
const MIN_TOKEN_PAYLOAD_BYTES: usize = 32;
const MAX_TOKEN_PAYLOAD_BYTES: usize = 192;
const SESSION_TOKEN_PREFIX: &str = "session.v1.";
const JOB_CAPABILITY_TOKEN_PREFIX: &str = "job-capability.v1.";

pub(super) const MAX_ERROR_MESSAGE_BYTES: usize = 2_048;

/// Opaque bearer token that authorizes a client or coordinator session.
///
/// The versioned prefix prevents a job capability from being accepted where a
/// session token is required. The payload remains opaque to protocol users.
#[derive(Clone, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SessionToken(String);

impl SessionToken {
    pub fn new(value: impl Into<String>) -> Result<Self, ProtocolError> {
        let token = Self(value.into());
        token.validate()?;
        Ok(token)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(super) fn validate(&self) -> Result<(), ProtocolError> {
        validate_token("session token", &self.0, SESSION_TOKEN_PREFIX)
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionToken([REDACTED])")
    }
}

/// Opaque bearer capability scoped to one compute job.
#[derive(Clone, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct JobCapabilityToken(String);

impl JobCapabilityToken {
    pub fn new(value: impl Into<String>) -> Result<Self, ProtocolError> {
        let token = Self(value.into());
        token.validate()?;
        Ok(token)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(super) fn validate(&self) -> Result<(), ProtocolError> {
        validate_token("job capability token", &self.0, JOB_CAPABILITY_TOKEN_PREFIX)
    }
}

impl fmt::Debug for JobCapabilityToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JobCapabilityToken([REDACTED])")
    }
}

pub(super) fn validate_envelope(
    protocol_version: u32,
    request_id: Uuid,
) -> Result<(), ProtocolError> {
    if protocol_version != PROTOCOL_VERSION {
        return Err(ProtocolError::Validation(format!(
            "control protocol version must be {PROTOCOL_VERSION}"
        )));
    }
    validate_uuid("request ID", request_id)
}

/// Validates only the wire shape of a job-scoped authority tuple.
///
/// The worker handler must additionally authenticate the session and verify,
/// in constant time, that the opaque capability was issued for this exact job,
/// session, authenticated worker, expiry, and generation. This protocol crate
/// intentionally has no key material or coordinator-owned token lookup.
pub(super) fn validate_job_authority_shape(
    session_token: &SessionToken,
    job_id: Uuid,
    capability: &JobCapabilityToken,
) -> Result<(), ProtocolError> {
    session_token.validate()?;
    validate_uuid("job ID", job_id)?;
    capability.validate()
}

pub(super) fn validate_uuid(label: &str, value: Uuid) -> Result<(), ProtocolError> {
    if value.is_nil() {
        Err(ProtocolError::Validation(format!(
            "{label} must not be the nil UUID"
        )))
    } else {
        Ok(())
    }
}

pub(super) fn validate_revision(label: &str, value: u64) -> Result<(), ProtocolError> {
    if value == 0 || value > MAX_JSON_SAFE_INTEGER {
        Err(ProtocolError::Validation(format!(
            "{label} must be a positive JSON-safe integer"
        )))
    } else {
        Ok(())
    }
}

pub(super) fn validate_nonce(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.len() < MIN_NONCE_BYTES
        || value.len() > MAX_NONCE_BYTES
        || !value.bytes().all(is_base64url_byte)
    {
        Err(ProtocolError::Validation(format!(
            "{label} must contain {MIN_NONCE_BYTES}..={MAX_NONCE_BYTES} canonical base64url bytes"
        )))
    } else {
        Ok(())
    }
}

pub(super) fn validate_text(label: &str, value: &str, max: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > max {
        Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={max} bytes"
        )))
    } else {
        Ok(())
    }
}

pub(super) fn validate_sha256(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Err(ProtocolError::Validation(format!(
            "{label} must be a canonical lowercase SHA-256 digest"
        )))
    } else {
        Ok(())
    }
}

fn validate_token(label: &str, value: &str, prefix: &str) -> Result<(), ProtocolError> {
    let Some(payload) = value.strip_prefix(prefix) else {
        return Err(ProtocolError::Validation(format!(
            "{label} has the wrong token kind or version"
        )));
    };
    if payload.len() < MIN_TOKEN_PAYLOAD_BYTES
        || payload.len() > MAX_TOKEN_PAYLOAD_BYTES
        || !payload.bytes().all(is_base64url_byte)
    {
        return Err(ProtocolError::Validation(format!(
            "{label} payload must contain {MIN_TOKEN_PAYLOAD_BYTES}..={MAX_TOKEN_PAYLOAD_BYTES} canonical base64url bytes"
        )));
    }
    Ok(())
}

fn is_base64url_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}
