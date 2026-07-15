use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    validation::{
        validate_bounded_text, validate_json_safe_u64, validate_lower_sha256,
        validate_optional_bounded_text, validate_relative_path, MAX_SAFE_JSON_INTEGER,
    },
    ProtocolError,
};

pub const MAX_JSON_SAFE_INTEGER: u64 = MAX_SAFE_JSON_INTEGER;
pub const MAX_PACK_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
pub const MAX_PACK_RECORDS: u64 = 10_000_000;
pub const MAX_PACK_FILES: usize = 256;
pub const MAX_PACK_ARRAYS: usize = 512;

#[allow(dead_code)] // Used by the higher-level result manifest module.
pub(crate) const MAX_ENGINE_PACK_REFS: usize = 32;
pub(crate) const MAX_ARRAY_RANK: usize = 8;
pub(crate) const MAX_ALIGNMENT_BYTES: u32 = 4_096;
pub(crate) const MAX_PATH_BYTES: usize = 1_024;
pub(crate) const MAX_LABEL_BYTES: usize = 160;
pub(crate) const MAX_SEMANTIC_BYTES: usize = 160;
pub(crate) const MAX_UNIT_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MolecularSnapshotVersion {
    #[serde(rename = "burrete.molecular-snapshot.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum EnginePackVersion {
    #[serde(rename = "cluster.engine-pack.v1")]
    ClusterV1,
}

pub(crate) fn validate_uuid(label: &str, value: Uuid) -> Result<(), ProtocolError> {
    if value.is_nil() {
        return Err(ProtocolError::Validation(format!(
            "{label} cannot be the nil UUID"
        )));
    }
    Ok(())
}

pub(crate) fn validate_sha256(label: &str, value: &str) -> Result<(), ProtocolError> {
    validate_lower_sha256(label, value)
}

pub(crate) fn validate_json_safe(label: &str, value: u64) -> Result<(), ProtocolError> {
    validate_json_safe_u64(label, value)
}

pub(crate) fn validate_json_safe_positive(label: &str, value: u64) -> Result<(), ProtocolError> {
    validate_json_safe_u64(label, value)?;
    if value == 0 {
        return Err(ProtocolError::Validation(format!(
            "{label} must be positive"
        )));
    }
    Ok(())
}

pub(crate) fn validate_label(label: &str, value: &str, max: usize) -> Result<(), ProtocolError> {
    validate_bounded_text(label, value, max)?;
    validate_clean_text(label, value)
}

pub(crate) fn validate_optional_label(
    label: &str,
    value: Option<&str>,
    max: usize,
) -> Result<(), ProtocolError> {
    validate_optional_bounded_text(label, value, max)?;
    if let Some(value) = value {
        validate_clean_text(label, value)?;
    }
    Ok(())
}

pub(crate) fn validate_pack_path(value: &str) -> Result<(), ProtocolError> {
    validate_relative_path("packed path", value, MAX_PATH_BYTES)?;
    validate_clean_text("packed path", value)
}

fn validate_clean_text(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(ProtocolError::Validation(format!(
            "{label} must be trimmed and contain no control characters"
        )));
    }
    Ok(())
}
