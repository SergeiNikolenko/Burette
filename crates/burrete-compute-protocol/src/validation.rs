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
