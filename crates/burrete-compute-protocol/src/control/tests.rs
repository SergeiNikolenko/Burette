use uuid::Uuid;

use super::{
    ControlCommand, ControlResponse, ControlResult, JobCapabilityToken, SessionToken,
    WorkerControlResponse, WorkerResult,
};
use crate::{decode_frame, encode_frame, ProtocolError};

const SESSION_TOKEN_PREFIX: &str = "session.v1.";

#[test]
fn token_kinds_are_distinct_and_debug_output_is_redacted() {
    let session = SessionToken::new(format!("{SESSION_TOKEN_PREFIX}{}", "a".repeat(32)))
        .expect("valid session token");
    assert_eq!(format!("{session:?}"), "SessionToken([REDACTED])");
    assert!(JobCapabilityToken::new(session.as_str()).is_err());
}

#[test]
fn job_commands_require_non_nil_job_ids() {
    let command = ControlCommand::JobStatus {
        session_token: SessionToken::new(format!("{SESSION_TOKEN_PREFIX}{}", "a".repeat(32)))
            .expect("valid session token"),
        job_id: Uuid::nil(),
    };
    assert!(command.validate().is_err());
}

#[test]
fn handshake_response_echoes_and_validates_the_client_nonce() {
    let response = ControlResponse::new(
        Uuid::from_u128(1),
        ControlResult::HandshakeAccepted {
            session_token: SessionToken::new(format!("{SESSION_TOKEN_PREFIX}{}", "a".repeat(32)))
                .expect("valid session token"),
            client_nonce: "client-nonce-0001".into(),
            server_nonce: "server-nonce-0001".into(),
        },
    );
    let frame = encode_frame(&response).expect("encode transcript-bound response");
    assert_eq!(
        decode_frame::<ControlResponse>(&frame).expect("decode response"),
        response
    );

    let mut value = serde_json::to_value(response).expect("serialize response");
    value["result"]["clientNonce"] = serde_json::json!("stale");
    let payload = serde_json::to_vec(&value).expect("serialize malformed response");
    let mut malformed = Vec::with_capacity(payload.len() + 4);
    malformed.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    malformed.extend_from_slice(&payload);
    assert!(matches!(
        decode_frame::<ControlResponse>(&malformed),
        Err(ProtocolError::Validation(_))
    ));
}

#[test]
fn worker_handshake_response_echoes_the_coordinator_nonce() {
    let response = WorkerControlResponse::new(
        Uuid::from_u128(2),
        WorkerResult::HandshakeAccepted {
            worker_id: Uuid::from_u128(3),
            coordinator_nonce: "coordinator-0001".into(),
            worker_nonce: "worker-nonce-0001".into(),
        },
    );
    let frame = encode_frame(&response).expect("encode worker response");
    assert_eq!(
        decode_frame::<WorkerControlResponse>(&frame).expect("decode worker response"),
        response
    );
}
