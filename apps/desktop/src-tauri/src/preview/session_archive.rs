//! Inspect only bounded session metadata; molecular asset entries stay compressed.
use flate2::read::DeflateDecoder;
use std::io::Read;

const MAX_STATE_BYTES: usize = 32 * 1024 * 1024;

fn word(bytes: &[u8], offset: usize) -> Option<usize> {
    Some(u16::from_le_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize)
}

fn long(bytes: &[u8], offset: usize) -> Option<usize> {
    Some(u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?) as usize)
}

/// Unknown, oversized or malformed archives retain the existing Mesoscale
/// loader and its errors. Never extract assets or trust ZIP entry order.
pub(super) fn molx_state(bytes: &[u8]) -> Option<Vec<u8>> {
    let end = (bytes.len().saturating_sub(65_557)..bytes.len().checked_sub(21)?)
        .rev()
        .find(|&offset| {
            bytes.get(offset..offset + 4) == Some(b"PK\x05\x06")
                && word(bytes, offset + 20)
                    .is_some_and(|length| offset + 22 + length == bytes.len())
        })?;
    if word(bytes, end + 4)? != 0 || word(bytes, end + 6)? != 0 {
        return None;
    }
    let count = word(bytes, end + 10)?;
    if count == 0 || word(bytes, end + 8)? != count {
        return None;
    }
    let directory = long(bytes, end + 16)?;
    let directory_end = directory.checked_add(long(bytes, end + 12)?)?;
    if directory_end != end {
        return None;
    }
    let mut offset = directory;
    let mut state = None;
    for _ in 0..count {
        if bytes.get(offset..offset + 4) != Some(b"PK\x01\x02") {
            return None;
        }
        let name_length = word(bytes, offset + 28)?;
        let metadata_end = offset
            .checked_add(46)?
            .checked_add(name_length)?
            .checked_add(word(bytes, offset + 30)?)?
            .checked_add(word(bytes, offset + 32)?)?;
        if metadata_end > directory_end || word(bytes, offset + 34)? != 0 {
            return None;
        }
        if bytes.get(offset + 46..offset + 46 + name_length)? == b"state.json" {
            if state.is_some() || word(bytes, offset + 8)? & 1 != 0 {
                return None;
            }
            let compression = word(bytes, offset + 10)?;
            let compressed_size = long(bytes, offset + 20)?;
            let size = long(bytes, offset + 24)?;
            if size > MAX_STATE_BYTES {
                return None;
            }
            let local = long(bytes, offset + 42)?;
            if bytes.get(local..local + 4) != Some(b"PK\x03\x04")
                || word(bytes, local + 6)? & 1 != 0
                || word(bytes, local + 8)? != compression
            {
                return None;
            }
            let local_name_length = word(bytes, local + 26)?;
            if bytes.get(local + 30..local + 30 + local_name_length)? != b"state.json" {
                return None;
            }
            let data = local
                .checked_add(30)?
                .checked_add(local_name_length)?
                .checked_add(word(bytes, local + 28)?)?;
            let data_end = data.checked_add(compressed_size)?;
            if data_end > directory {
                return None;
            }
            let compressed = bytes.get(data..data_end)?;
            let decoded = match compression {
                0 if compressed.len() == size => compressed.to_vec(),
                8 => {
                    let mut decoded = Vec::new();
                    DeflateDecoder::new(compressed)
                        .take(size as u64 + 1)
                        .read_to_end(&mut decoded)
                        .ok()?;
                    if decoded.len() != size {
                        return None;
                    }
                    decoded
                }
                _ => return None,
            };
            state = Some(decoded);
        }
        offset = metadata_end;
    }
    (offset == directory_end).then_some(state).flatten()
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use flate2::{write::DeflateEncoder, Compression};
    use std::io::Write;

    pub(in crate::preview) fn archive(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut central = Vec::new();
        for (name, data, deflate) in entries {
            let payload = if *deflate {
                let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
                encoder.write_all(data).unwrap();
                encoder.finish().unwrap()
            } else {
                data.to_vec()
            };
            let offset = bytes.len() as u32;
            let method = if *deflate { 8u16 } else { 0 };
            let mut local = vec![0; 30];
            local[..4].copy_from_slice(b"PK\x03\x04");
            local[8..10].copy_from_slice(&method.to_le_bytes());
            local[18..22].copy_from_slice(&(payload.len() as u32).to_le_bytes());
            local[22..26].copy_from_slice(&(data.len() as u32).to_le_bytes());
            local[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
            bytes.extend(local);
            bytes.extend_from_slice(name.as_bytes());
            bytes.extend(payload);
            let mut record = vec![0; 46];
            record[..4].copy_from_slice(b"PK\x01\x02");
            record[10..12].copy_from_slice(&method.to_le_bytes());
            record[20..24].copy_from_slice(
                &((bytes.len() - offset as usize - 30 - name.len()) as u32).to_le_bytes(),
            );
            record[24..28].copy_from_slice(&(data.len() as u32).to_le_bytes());
            record[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            record[42..46].copy_from_slice(&offset.to_le_bytes());
            central.extend(record);
            central.extend_from_slice(name.as_bytes());
        }
        let mut end = vec![0; 22];
        end[..4].copy_from_slice(b"PK\x05\x06");
        for offset in [8, 10] {
            end[offset..offset + 2].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        }
        end[12..16].copy_from_slice(&(central.len() as u32).to_le_bytes());
        end[16..20].copy_from_slice(&(bytes.len() as u32).to_le_bytes());
        bytes.extend(central);
        bytes.extend(end);
        bytes
    }

    #[test]
    fn reads_only_state_independent_of_entry_order_and_compression() {
        for deflate in [false, true] {
            let bytes = archive(&[
                ("assets/first", b"not JSON", false),
                ("state.json", b"{\"entries\":[]}", deflate),
                ("assets/last", b"not JSON", false),
            ]);
            assert_eq!(molx_state(&bytes).unwrap(), b"{\"entries\":[]}");
        }
    }

    #[test]
    fn rejects_duplicates_truncation_oversized_state_and_malformed_lengths() {
        let valid = archive(&[("state.json", b"{}", true)]);
        assert!(molx_state(&valid[..valid.len() - 1]).is_none());
        assert!(molx_state(&archive(&[
            ("state.json", b"{}", false),
            ("state.json", b"{}", false)
        ]))
        .is_none());
        let directory = long(&valid, valid.len() - 6).unwrap();
        for size in [MAX_STATE_BYTES as u32 + 1, u32::MAX] {
            let mut corrupt = valid.clone();
            corrupt[directory + 24..directory + 28].copy_from_slice(&size.to_le_bytes());
            assert!(molx_state(&corrupt).is_none());
        }
        let mut corrupt = valid;
        corrupt[directory + 20..directory + 24].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(molx_state(&corrupt).is_none());
    }
}
