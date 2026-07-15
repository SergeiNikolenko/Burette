use std::io::{Read, Write};

use serde::{de::DeserializeOwned, Serialize};

use crate::ProtocolError;

pub const MAX_CONTROL_FRAME_BYTES: usize = 1024 * 1024;

pub fn encode_frame<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let payload = serde_json::to_vec(value)?;
    if payload.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge {
            bytes: payload.len(),
            limit: MAX_CONTROL_FRAME_BYTES,
        });
    }
    let payload_len = u32::try_from(payload.len()).map_err(|_| ProtocolError::FrameTooLarge {
        bytes: payload.len(),
        limit: MAX_CONTROL_FRAME_BYTES,
    })?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&payload_len.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn decode_frame<T: DeserializeOwned>(frame: &[u8]) -> Result<T, ProtocolError> {
    if frame.len() < 4 {
        return Err(ProtocolError::Io(
            "compute control frame is missing its length prefix".into(),
        ));
    }
    let payload_len = u32::from_be_bytes(frame[..4].try_into().expect("four-byte prefix")) as usize;
    validate_frame_len(payload_len)?;
    if frame.len() != payload_len + 4 {
        return Err(ProtocolError::Io(format!(
            "compute control frame length mismatch: prefix={payload_len}, actual={}",
            frame.len().saturating_sub(4)
        )));
    }
    Ok(serde_json::from_slice(&frame[4..])?)
}

pub fn read_frame<R: Read, T: DeserializeOwned>(reader: &mut R) -> Result<T, ProtocolError> {
    let mut prefix = [0_u8; 4];
    reader.read_exact(&mut prefix)?;
    let payload_len = u32::from_be_bytes(prefix) as usize;
    validate_frame_len(payload_len)?;
    let mut payload = vec![0_u8; payload_len];
    reader.read_exact(&mut payload)?;
    Ok(serde_json::from_slice(&payload)?)
}

pub fn write_frame<W: Write, T: Serialize>(writer: &mut W, value: &T) -> Result<(), ProtocolError> {
    let frame = encode_frame(value)?;
    writer.write_all(&frame)?;
    writer.flush()?;
    Ok(())
}

fn validate_frame_len(bytes: usize) -> Result<(), ProtocolError> {
    if bytes > MAX_CONTROL_FRAME_BYTES {
        Err(ProtocolError::FrameTooLarge {
            bytes,
            limit: MAX_CONTROL_FRAME_BYTES,
        })
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde::{Deserialize, Serialize};

    use super::*;

    #[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
    struct Message {
        value: u32,
    }

    #[test]
    fn reads_back_to_back_frames() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &Message { value: 1 }).expect("write first frame");
        write_frame(&mut bytes, &Message { value: 2 }).expect("write second frame");
        let mut reader = Cursor::new(bytes);
        assert_eq!(
            read_frame::<_, Message>(&mut reader).expect("read first frame"),
            Message { value: 1 }
        );
        assert_eq!(
            read_frame::<_, Message>(&mut reader).expect("read second frame"),
            Message { value: 2 }
        );
    }

    #[test]
    fn rejects_oversized_frame_before_payload_read() {
        let bytes = ((MAX_CONTROL_FRAME_BYTES as u32) + 1).to_be_bytes();
        let error = read_frame::<_, Message>(&mut Cursor::new(bytes)).expect_err("reject frame");
        assert!(matches!(error, ProtocolError::FrameTooLarge { .. }));
    }

    #[test]
    fn rejects_trailing_or_truncated_payloads() {
        let mut frame = encode_frame(&Message { value: 7 }).expect("encode frame");
        frame.push(0);
        assert!(decode_frame::<Message>(&frame).is_err());
        frame.pop();
        frame.pop();
        assert!(decode_frame::<Message>(&frame).is_err());
    }
}
