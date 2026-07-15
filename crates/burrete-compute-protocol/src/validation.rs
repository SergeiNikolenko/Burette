use std::path::Path;

use crate::ProtocolError;

pub(crate) const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) fn validate_bounded_text(
    label: &str,
    value: &str,
    max_bytes: usize,
) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > max_bytes {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={max_bytes} bytes"
        )));
    }
    Ok(())
}

pub(crate) fn validate_optional_bounded_text(
    label: &str,
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), ProtocolError> {
    if let Some(value) = value {
        validate_bounded_text(label, value, max_bytes)?;
    }
    Ok(())
}

pub(crate) fn validate_json_safe_u64(label: &str, value: u64) -> Result<(), ProtocolError> {
    if value > MAX_SAFE_JSON_INTEGER {
        return Err(ProtocolError::Validation(format!(
            "{label} exceeds the JSON safe integer range"
        )));
    }
    Ok(())
}

pub(crate) fn validate_lower_sha256(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ProtocolError::Validation(format!(
            "{label} SHA-256 must contain 64 lowercase hexadecimal characters"
        )));
    }
    Ok(())
}

pub(crate) fn validate_relative_path(
    label: &str,
    value: &str,
    max_bytes: usize,
) -> Result<(), ProtocolError> {
    validate_bounded_text(label, value, max_bytes)?;
    if value.contains('\\')
        || Path::new(value).is_absolute()
        || value
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err(ProtocolError::Validation(format!(
            "{label} must be a canonical relative path under the coordinator-issued root"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_lowercase_hashes() {
        assert_eq!(validate_lower_sha256("test", &"a".repeat(64)), Ok(()));
        assert!(validate_lower_sha256("test", &"A".repeat(64)).is_err());
    }

    #[test]
    fn rejects_non_canonical_relative_paths() {
        for path in ["../result.bin", "./result.bin", "a//b", "a\\b", "/tmp/x"] {
            assert!(validate_relative_path("test path", path, 128).is_err());
        }
        assert_eq!(validate_relative_path("test path", "result/data.bin", 128), Ok(()));
    }
}
