use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{validation::validate_json_safe_u64, ProtocolError};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputeJobEventSchemaVersion {
    #[serde(rename = "burette.compute-job-event.v1")]
    V1,
}

/// A bounded notification that tells clients which durable revision to fetch.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRevisionEvent {
    pub schema_version: ComputeJobEventSchemaVersion,
    pub job_id: Uuid,
    pub revision: u64,
    pub emitted_at_ms: u64,
}

impl JobRevisionEvent {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.job_id.is_nil() {
            return Err(ProtocolError::Validation(
                "job revision event requires a non-nil job ID".into(),
            ));
        }
        if self.revision == 0 {
            return Err(ProtocolError::Validation(
                "job revision event revision must be positive".into(),
            ));
        }
        validate_json_safe_u64("job revision event revision", self.revision)?;
        validate_json_safe_u64("job revision event emittedAtMs", self.emitted_at_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_contains_only_a_durable_revision_pointer() {
        let event = JobRevisionEvent {
            schema_version: ComputeJobEventSchemaVersion::V1,
            job_id: Uuid::from_u128(1),
            revision: 2,
            emitted_at_ms: 3,
        };
        assert_eq!(event.validate(), Ok(()));
        let value = serde_json::to_value(event).expect("serialize event");
        assert_eq!(value.as_object().expect("event object").len(), 4);
    }
}
