use crate::ProtocolError;

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
