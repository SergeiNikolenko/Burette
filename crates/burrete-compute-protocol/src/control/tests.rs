use uuid::Uuid;

use super::{ControlCommand, JobCapabilityToken, SessionToken};

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
