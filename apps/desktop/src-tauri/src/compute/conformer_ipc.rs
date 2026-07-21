use burrete_compute_protocol::MAX_JSON_SAFE_INTEGER;
use uuid::Uuid;

use super::error::{ComputeCoordinatorError, ComputeResult};

const MAGIC: &[u8; 4] = b"BCER";
const VERSION: u16 = 2;
const HEADER_BYTES: usize = 40;
const RECORD_HEADER_BYTES: usize = 64;
const MAX_RECORD_ERROR_BYTES: usize = 2_048;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConformerChunkResult {
    pub(crate) session_id: Uuid,
    pub(crate) start_ordinal: u64,
    pub(crate) records: Vec<ConformerRecordResult>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConformerRecordResult {
    pub(crate) ordinal: u64,
    pub(crate) source_record_id: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) output: Result<Vec<u8>, String>,
    pub(crate) mmff_output: Option<Result<Vec<u8>, String>>,
}

pub(crate) fn decode_conformer_chunk_result(
    bytes: &[u8],
    maximum_bytes: usize,
) -> ComputeResult<ConformerChunkResult> {
    if bytes.len() < HEADER_BYTES || bytes.len() > maximum_bytes {
        return Err(protocol(
            "conformer result envelope is outside its admitted byte bound",
        ));
    }
    if bytes.get(..4) != Some(MAGIC)
        || read_u16(bytes, 4)? != VERSION
        || read_u16(bytes, 6)? as usize != HEADER_BYTES
        || read_u32(bytes, 36)? as usize != bytes.len()
    {
        return Err(protocol("conformer result envelope header is incompatible"));
    }
    let session_id = Uuid::from_slice(
        bytes
            .get(8..24)
            .ok_or_else(|| protocol("conformer result session ID is truncated"))?,
    )
    .map_err(|_| protocol("conformer result session ID is invalid"))?;
    if session_id.is_nil() {
        return Err(protocol("conformer result session ID is nil"));
    }
    let start_ordinal = read_u64(bytes, 24)?;
    let record_count = read_u32(bytes, 32)? as usize;
    if record_count == 0 || start_ordinal > MAX_JSON_SAFE_INTEGER {
        return Err(protocol(
            "conformer result envelope has an invalid ordinal or record count",
        ));
    }
    let minimum = record_count
        .checked_mul(RECORD_HEADER_BYTES)
        .and_then(|value| value.checked_add(HEADER_BYTES))
        .ok_or_else(|| protocol("conformer result record headers overflowed"))?;
    if minimum > bytes.len() {
        return Err(protocol("conformer result record headers are truncated"));
    }

    let mut records = Vec::new();
    records
        .try_reserve_exact(record_count)
        .map_err(|_| unavailable("cannot allocate conformer result records"))?;
    let mut offset = HEADER_BYTES;
    for _ in 0..record_count {
        let end = offset
            .checked_add(RECORD_HEADER_BYTES)
            .ok_or_else(|| protocol("conformer result record header overflowed"))?;
        let header = bytes
            .get(offset..end)
            .ok_or_else(|| protocol("conformer result record header is truncated"))?;
        let ordinal = read_u64(header, 0)?;
        let source_record_id = read_u64(header, 8)?;
        if ordinal > MAX_JSON_SAFE_INTEGER || source_record_id > MAX_JSON_SAFE_INTEGER {
            return Err(protocol(
                "conformer result record identity exceeds the JSON-safe contract",
            ));
        }
        let molecule_content_sha256 = encode_hex(&header[16..48]);
        let status = header[48];
        let mmff_status = header[49];
        if header[50..52]
            .iter()
            .chain(&header[60..64])
            .any(|byte| *byte != 0)
        {
            return Err(protocol(
                "conformer result record reserved bytes are not zero",
            ));
        }
        let conformer_bytes = read_u32(header, 52)? as usize;
        let mmff_bytes = read_u32(header, 56)? as usize;
        offset = end;
        let conformer_end = offset
            .checked_add(conformer_bytes)
            .ok_or_else(|| protocol("conformer result record payload overflowed"))?;
        let conformer_payload = bytes
            .get(offset..conformer_end)
            .ok_or_else(|| protocol("conformer result record payload is truncated"))?;
        let mmff_end = conformer_end
            .checked_add(mmff_bytes)
            .ok_or_else(|| protocol("MMFF result record payload overflowed"))?;
        let mmff_payload = bytes
            .get(conformer_end..mmff_end)
            .ok_or_else(|| protocol("MMFF result record payload is truncated"))?;
        let output = match status {
            0 if !conformer_payload.is_empty() => Ok(conformer_payload.to_vec()),
            1 if !conformer_payload.is_empty()
                && conformer_payload.len() <= MAX_RECORD_ERROR_BYTES
                && mmff_status == 2
                && mmff_payload.is_empty() =>
            {
                Err(decode_error(conformer_payload, "conformer result error")?)
            }
            _ => {
                return Err(protocol(
                    "conformer result record requires one non-empty BCEX payload or error",
                ))
            }
        };
        let mmff_output = if status == 0 {
            Some(match mmff_status {
                0 if !mmff_payload.is_empty() => Ok(mmff_payload.to_vec()),
                1 if !mmff_payload.is_empty() && mmff_payload.len() <= MAX_RECORD_ERROR_BYTES => {
                    let error = decode_error(mmff_payload, "MMFF result error")?;
                    Err(error)
                }
                _ => {
                    return Err(protocol(
                        "conformer result requires one BMFX payload or bounded MMFF error",
                    ))
                }
            })
        } else {
            None
        };
        records.push(ConformerRecordResult {
            ordinal,
            source_record_id,
            molecule_content_sha256,
            output,
            mmff_output,
        });
        offset = align4(mmff_end)?;
        if bytes
            .get(mmff_end..offset)
            .ok_or_else(|| protocol("conformer result record padding is truncated"))?
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err(protocol("conformer result record padding is not zero"));
        }
    }
    if offset != bytes.len() {
        return Err(protocol(
            "conformer result envelope has trailing or missing bytes",
        ));
    }
    Ok(ConformerChunkResult {
        session_id,
        start_ordinal,
        records,
    })
}

fn decode_error(bytes: &[u8], label: &str) -> ComputeResult<String> {
    let error =
        std::str::from_utf8(bytes).map_err(|_| protocol(format!("{label} is not UTF-8")))?;
    if error.chars().any(char::is_control) {
        return Err(protocol(format!("{label} contains control characters")));
    }
    Ok(error.to_string())
}

fn read_u16(bytes: &[u8], offset: usize) -> ComputeResult<u16> {
    Ok(u16::from_le_bytes(
        bytes
            .get(offset..offset + 2)
            .ok_or_else(|| protocol("conformer result integer is truncated"))?
            .try_into()
            .expect("two-byte integer"),
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> ComputeResult<u32> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or_else(|| protocol("conformer result integer is truncated"))?
            .try_into()
            .expect("four-byte integer"),
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> ComputeResult<u64> {
    Ok(u64::from_le_bytes(
        bytes
            .get(offset..offset + 8)
            .ok_or_else(|| protocol("conformer result integer is truncated"))?
            .try_into()
            .expect("eight-byte integer"),
    ))
}

fn align4(value: usize) -> ComputeResult<usize> {
    value
        .checked_add(3)
        .map(|value| value / 4 * 4)
        .ok_or_else(|| protocol("conformer result alignment overflowed"))
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn unavailable(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Unavailable(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_raw_success_and_error_records() {
        let session = Uuid::from_u128(7);
        let success = vec![0x42, 0x43, 0x45, 0x58];
        let mmff = vec![0x42, 0x4d, 0x46, 0x58];
        let error = b"unsupported IDCode";
        let mut bytes = envelope_header(session, 3, 2);
        push_record(&mut bytes, 3, 10, 0xaa, 0, 0, &success, &mmff);
        push_record(&mut bytes, 4, 11, 0xbb, 1, 2, error, &[]);
        let total = bytes.len() as u32;
        bytes[36..40].copy_from_slice(&total.to_le_bytes());

        let decoded = decode_conformer_chunk_result(&bytes, bytes.len()).expect("valid envelope");
        assert_eq!(decoded.session_id, session);
        assert_eq!(decoded.start_ordinal, 3);
        assert_eq!(decoded.records[0].output, Ok(success));
        assert_eq!(decoded.records[0].mmff_output, Some(Ok(mmff)));
        assert_eq!(decoded.records[1].output, Err("unsupported IDCode".into()));
        assert_eq!(decoded.records[1].molecule_content_sha256, "bb".repeat(32));
    }

    #[test]
    fn rejects_nonzero_padding_and_oversized_envelopes() {
        let mut bytes = envelope_header(Uuid::from_u128(7), 0, 1);
        push_record(&mut bytes, 0, 1, 0xaa, 0, 1, &[1], b"not typed");
        let total = bytes.len() as u32;
        bytes[36..40].copy_from_slice(&total.to_le_bytes());
        *bytes.last_mut().expect("padding") = 1;
        assert!(decode_conformer_chunk_result(&bytes, bytes.len()).is_err());
        assert!(decode_conformer_chunk_result(&bytes, bytes.len() - 1).is_err());
    }

    fn envelope_header(session: Uuid, start: u64, records: u32) -> Vec<u8> {
        let mut bytes = vec![0_u8; HEADER_BYTES];
        bytes[..4].copy_from_slice(MAGIC);
        bytes[4..6].copy_from_slice(&VERSION.to_le_bytes());
        bytes[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
        bytes[8..24].copy_from_slice(session.as_bytes());
        bytes[24..32].copy_from_slice(&start.to_le_bytes());
        bytes[32..36].copy_from_slice(&records.to_le_bytes());
        bytes
    }

    fn push_record(
        bytes: &mut Vec<u8>,
        ordinal: u64,
        source_id: u64,
        hash_byte: u8,
        status: u8,
        mmff_status: u8,
        conformer_payload: &[u8],
        mmff_payload: &[u8],
    ) {
        bytes.extend(ordinal.to_le_bytes());
        bytes.extend(source_id.to_le_bytes());
        bytes.extend([hash_byte; 32]);
        bytes.push(status);
        bytes.push(mmff_status);
        bytes.extend([0; 2]);
        bytes.extend((conformer_payload.len() as u32).to_le_bytes());
        bytes.extend((mmff_payload.len() as u32).to_le_bytes());
        bytes.extend([0; 4]);
        bytes.extend(conformer_payload);
        bytes.extend(mmff_payload);
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
}
