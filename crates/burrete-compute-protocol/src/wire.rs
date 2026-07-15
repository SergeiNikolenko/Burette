use std::io::{Read, Write};

use serde::{de::DeserializeOwned, Serialize};

use crate::ProtocolError;

pub const MAX_CONTROL_FRAME_BYTES: usize = 1024 * 1024;

pub(super) mod sealed {
    pub trait Sealed {}
}

/// A closed set of messages permitted on the framed compute control boundary.
///
/// Deserialization alone checks shape. Implementations additionally reject
/// values that are structurally valid JSON but invalid for the protocol. The
/// sealed supertrait prevents callers from sending arbitrary serializable data
/// through the authority-bearing channel.
pub trait WireMessage: sealed::Sealed {
    fn validate_wire(&self) -> Result<(), ProtocolError>;
}

#[path = "control.rs"]
pub mod control;

pub fn encode_frame<T: Serialize + WireMessage>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    value.validate_wire()?;
    encode_frame_raw(value)
}

pub fn decode_frame<T: DeserializeOwned + WireMessage>(frame: &[u8]) -> Result<T, ProtocolError> {
    let value: T = decode_frame_raw(frame)?;
    value.validate_wire()?;
    Ok(value)
}

pub fn read_frame<R: Read, T: DeserializeOwned + WireMessage>(
    reader: &mut R,
) -> Result<T, ProtocolError> {
    let value: T = read_frame_raw(reader)?;
    value.validate_wire()?;
    Ok(value)
}

pub fn write_frame<W: Write, T: Serialize + WireMessage>(
    writer: &mut W,
    value: &T,
) -> Result<(), ProtocolError> {
    value.validate_wire()?;
    write_frame_raw(writer, value)
}

fn encode_frame_raw<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let payload = serialize_payload(value)?;
    let payload_len = payload_length_prefix(payload.len())?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&payload_len);
    frame.extend_from_slice(&payload);
    Ok(frame)
}

fn decode_frame_raw<T: DeserializeOwned>(frame: &[u8]) -> Result<T, ProtocolError> {
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

fn read_frame_raw<R: Read, T: DeserializeOwned>(reader: &mut R) -> Result<T, ProtocolError> {
    let mut prefix = [0_u8; 4];
    reader.read_exact(&mut prefix)?;
    let payload_len = u32::from_be_bytes(prefix) as usize;
    validate_frame_len(payload_len)?;
    let mut payload = vec![0_u8; payload_len];
    reader.read_exact(&mut payload)?;
    Ok(serde_json::from_slice(&payload)?)
}

fn write_frame_raw<W: Write, T: Serialize>(writer: &mut W, value: &T) -> Result<(), ProtocolError> {
    let payload = serialize_payload(value)?;
    writer.write_all(&payload_length_prefix(payload.len())?)?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

fn serialize_payload<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let mut writer = CappedPayloadWriter::new(MAX_CONTROL_FRAME_BYTES);
    match serde_json::to_writer(&mut writer, value) {
        Ok(()) => Ok(writer.into_inner()),
        Err(error) => {
            if let Some(bytes) = writer.overflow_bytes() {
                Err(ProtocolError::FrameTooLarge {
                    bytes,
                    limit: MAX_CONTROL_FRAME_BYTES,
                })
            } else {
                Err(ProtocolError::Json(error.to_string()))
            }
        }
    }
}

fn payload_length_prefix(bytes: usize) -> Result<[u8; 4], ProtocolError> {
    validate_frame_len(bytes)?;
    let payload_len = u32::try_from(bytes).map_err(|_| ProtocolError::FrameTooLarge {
        bytes,
        limit: MAX_CONTROL_FRAME_BYTES,
    })?;
    Ok(payload_len.to_be_bytes())
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

struct CappedPayloadWriter {
    bytes: Vec<u8>,
    limit: usize,
    overflow_bytes: Option<usize>,
}

impl CappedPayloadWriter {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
            overflow_bytes: None,
        }
    }

    fn overflow_bytes(&self) -> Option<usize> {
        self.overflow_bytes
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for CappedPayloadWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let attempted = self.bytes.len().saturating_add(bytes.len());
        if attempted > self.limit {
            self.overflow_bytes = Some(attempted);
            return Err(std::io::Error::other(
                "compute control frame exceeds its byte limit",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use uuid::Uuid;

    use super::control::{
        ControlRequest, JobCapabilityToken, SessionToken, WorkerCommand, WorkerControlRequest,
    };
    use super::*;

    const REQUEST_ID: Uuid = Uuid::from_u128(1);
    const JOB_ID: Uuid = Uuid::from_u128(2);

    #[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
    struct Message {
        value: u32,
    }

    impl sealed::Sealed for Message {}

    impl WireMessage for Message {
        fn validate_wire(&self) -> Result<(), ProtocolError> {
            if self.value == 0 {
                Err(ProtocolError::Validation(
                    "message value must be positive".into(),
                ))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn reads_back_to_back_validated_frames() {
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

    #[test]
    fn applies_semantic_validation_outbound_and_inbound() {
        assert!(matches!(
            encode_frame(&Message { value: 0 }),
            Err(ProtocolError::Validation(_))
        ));

        let frame = test_frame(&json!({ "value": 0 }));
        assert!(matches!(
            decode_frame::<Message>(&frame),
            Err(ProtocolError::Validation(_))
        ));
    }

    #[test]
    fn aborts_oversized_outbound_serialization_at_the_cap() {
        #[derive(Serialize)]
        struct LargeMessage {
            value: String,
        }

        impl sealed::Sealed for LargeMessage {}

        impl WireMessage for LargeMessage {
            fn validate_wire(&self) -> Result<(), ProtocolError> {
                Ok(())
            }
        }

        let message = LargeMessage {
            value: "x".repeat(MAX_CONTROL_FRAME_BYTES + 1),
        };
        let error = encode_frame(&message).expect_err("reject oversized outbound frame");
        assert!(matches!(error, ProtocolError::FrameTooLarge { .. }));
    }

    #[test]
    fn rejects_unknown_client_fields_and_commands() {
        let nonce = "a".repeat(16);
        let unknown_field = test_frame(&json!({
            "protocolVersion": 1,
            "requestId": REQUEST_ID,
            "command": { "kind": "handshake", "clientNonce": nonce },
            "path": "/tmp/compute"
        }));
        assert!(matches!(
            decode_frame::<ControlRequest>(&unknown_field),
            Err(ProtocolError::Json(_))
        ));

        let unknown_command = test_frame(&json!({
            "protocolVersion": 1,
            "requestId": REQUEST_ID,
            "command": { "kind": "deleteFiles", "sessionToken": valid_session_token() }
        }));
        assert!(matches!(
            decode_frame::<ControlRequest>(&unknown_command),
            Err(ProtocolError::Json(_))
        ));
    }

    #[test]
    fn rejects_missing_and_malformed_session_tokens() {
        let missing = test_frame(&json!({
            "protocolVersion": 1,
            "requestId": REQUEST_ID,
            "command": { "kind": "capabilities" }
        }));
        assert!(matches!(
            decode_frame::<ControlRequest>(&missing),
            Err(ProtocolError::Json(_))
        ));

        let malformed = test_frame(&json!({
            "protocolVersion": 1,
            "requestId": REQUEST_ID,
            "command": { "kind": "capabilities", "sessionToken": "../../tmp" }
        }));
        assert!(matches!(
            decode_frame::<ControlRequest>(&malformed),
            Err(ProtocolError::Validation(_))
        ));
    }

    #[test]
    fn rejects_wrong_token_kind_for_job_commands() {
        let request = WorkerControlRequest::new(
            REQUEST_ID,
            WorkerCommand::JobStatus {
                session_token: SessionToken::new(valid_session_token())
                    .expect("valid session token"),
                job_id: JOB_ID,
                capability: JobCapabilityToken::new(valid_job_capability())
                    .expect("valid job capability"),
            },
        );
        let mut value = serde_json::to_value(request).expect("serialize request");
        value["command"]["capability"] = json!(valid_session_token());
        let frame = test_frame(&value);
        assert!(matches!(
            decode_frame::<WorkerControlRequest>(&frame),
            Err(ProtocolError::Validation(_))
        ));
    }

    #[test]
    fn worker_job_commands_reject_path_injection() {
        let frame = test_frame(&json!({
            "protocolVersion": 1,
            "requestId": REQUEST_ID,
            "command": {
                "kind": "interrupt",
                "sessionToken": valid_session_token(),
                "jobId": JOB_ID,
                "capability": valid_job_capability(),
                "path": "/tmp/result"
            }
        }));
        assert!(matches!(
            decode_frame::<WorkerControlRequest>(&frame),
            Err(ProtocolError::Json(_))
        ));
    }

    #[test]
    fn rejects_wrong_protocol_version_semantically() {
        let frame = test_frame(&json!({
            "protocolVersion": 2,
            "requestId": REQUEST_ID,
            "command": { "kind": "handshake", "clientNonce": "aaaaaaaaaaaaaaaa" }
        }));
        assert!(matches!(
            decode_frame::<ControlRequest>(&frame),
            Err(ProtocolError::Validation(_))
        ));
    }

    fn valid_session_token() -> String {
        format!("session.v1.{}", "a".repeat(32))
    }

    fn valid_job_capability() -> String {
        format!("job-capability.v1.{}", "b".repeat(32))
    }

    fn test_frame(value: &serde_json::Value) -> Vec<u8> {
        let payload = serde_json::to_vec(value).expect("serialize test JSON");
        let mut frame = Vec::with_capacity(4 + payload.len());
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);
        frame
    }
}
