use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Backend, ClusterV1SubmitRequest, ComputeFailure, ExecutionPlan, JobState, OwnerSurface,
    Precision, ProtocolError, StageKind, WorkflowTemplateId,
};

const MAX_STAGES: usize = 32;
const MAX_ATTEMPTS: usize = 128;
const MAX_ARTIFACTS: usize = 256;
const MAX_STATUS_MESSAGE_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputeJobSnapshotSchemaVersion {
    #[serde(rename = "burrete.compute-job-snapshot.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub schema_version: ComputeJobSnapshotSchemaVersion,
    pub job_id: Uuid,
    pub revision: u64,
    pub owner_surface: OwnerSurface,
    pub workflow_template: WorkflowTemplateId,
    pub state: JobState,
    pub request: ClusterV1SubmitRequest,
    pub progress: JobProgress,
    pub plan: ExecutionPlan,
    pub stages: Vec<StageSnapshot>,
    pub attempts: Vec<AttemptSnapshot>,
    pub artifact_ids: Vec<Uuid>,
    pub pinned_runtime_version: Option<String>,
    pub error: Option<ComputeFailure>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub finished_at_ms: Option<u64>,
}

impl JobSnapshot {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.revision == 0 {
            return Err(ProtocolError::Validation(
                "job snapshot revision must be positive".into(),
            ));
        }
        if self.workflow_template != self.request.workflow_template {
            return Err(ProtocolError::Validation(
                "job workflow differs from its immutable request".into(),
            ));
        }
        self.request.validate()?;
        self.progress.validate()?;
        self.plan.validate()?;
        if self.stages.is_empty() || self.stages.len() > MAX_STAGES {
            return Err(ProtocolError::Validation(format!(
                "job snapshot requires 1..={MAX_STAGES} stages"
            )));
        }
        if self.attempts.len() > MAX_ATTEMPTS {
            return Err(ProtocolError::Validation(format!(
                "job snapshot has too many attempts: {}",
                self.attempts.len()
            )));
        }
        if self.artifact_ids.len() > MAX_ARTIFACTS {
            return Err(ProtocolError::Validation(format!(
                "job snapshot has too many artifacts: {}",
                self.artifact_ids.len()
            )));
        }
        let mut stage_ids = BTreeSet::new();
        for stage in &self.stages {
            stage.validate()?;
            if !stage_ids.insert(stage.stage_id.as_str()) {
                return Err(ProtocolError::Validation(format!(
                    "duplicate stage ID: {}",
                    stage.stage_id
                )));
            }
        }
        for attempt in &self.attempts {
            attempt.validate()?;
            if !stage_ids.contains(attempt.stage_id.as_str()) {
                return Err(ProtocolError::Validation(format!(
                    "attempt references unknown stage: {}",
                    attempt.stage_id
                )));
            }
        }
        if self.updated_at_ms < self.created_at_ms
            || self
                .finished_at_ms
                .is_some_and(|finished| finished < self.created_at_ms)
        {
            return Err(ProtocolError::Validation(
                "job timestamps are not monotonic".into(),
            ));
        }
        if self.state.is_terminal() && self.finished_at_ms.is_none() {
            return Err(ProtocolError::Validation(
                "terminal job snapshot requires finishedAtMs".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobProgress {
    pub completed_units: u64,
    pub total_units: u64,
    pub message: String,
}

impl JobProgress {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.completed_units > self.total_units {
            return Err(ProtocolError::Validation(
                "job completedUnits exceeds totalUnits".into(),
            ));
        }
        validate_status_text("job progress message", &self.message)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StageState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSnapshot {
    pub stage_id: String,
    pub ordinal: u16,
    pub kind: StageKind,
    pub idempotent: bool,
    pub state: StageState,
    pub progress: JobProgress,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub device: Option<String>,
    pub precision: Precision,
    pub kernel_id: Option<String>,
    pub gpu_time_ms: Option<f64>,
    pub host_time_ms: Option<f64>,
    pub transferred_bytes: u64,
    pub fallback_reason: Option<String>,
    pub error: Option<ComputeFailure>,
}

impl StageSnapshot {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_status_text("stage ID", &self.stage_id)?;
        self.progress.validate()?;
        for (label, value) in [
            ("stage device", self.device.as_deref()),
            ("stage kernel ID", self.kernel_id.as_deref()),
            ("stage fallback reason", self.fallback_reason.as_deref()),
        ] {
            if let Some(value) = value {
                validate_status_text(label, value)?;
            }
        }
        if self
            .gpu_time_ms
            .is_some_and(|value| !value.is_finite() || value < 0.0)
            || self
                .host_time_ms
                .is_some_and(|value| !value.is_finite() || value < 0.0)
        {
            return Err(ProtocolError::Validation(
                "stage timings must be finite and non-negative".into(),
            ));
        }
        if self.state == StageState::Succeeded
            && self.kind == StageKind::NumericCompute
            && self.effective_backend.is_gpu()
            && (self.device.is_none() || self.kernel_id.is_none() || self.gpu_time_ms.is_none())
        {
            return Err(ProtocolError::Validation(
                "successful GPU numeric stage requires device, kernel ID, and GPU timing".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttemptState {
    Running,
    Succeeded,
    Failed,
    Interrupted,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSnapshot {
    pub attempt_id: Uuid,
    pub stage_id: String,
    pub attempt_number: u16,
    pub runtime_version: String,
    pub state: AttemptState,
    pub started_at_ms: u64,
    pub heartbeat_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub retry_reason: Option<String>,
}

impl AttemptSnapshot {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_status_text("attempt stage ID", &self.stage_id)?;
        validate_status_text("attempt runtime version", &self.runtime_version)?;
        if let Some(reason) = &self.retry_reason {
            validate_status_text("attempt retry reason", reason)?;
        }
        if self.attempt_number == 0
            || self.heartbeat_at_ms < self.started_at_ms
            || self
                .finished_at_ms
                .is_some_and(|finished| finished < self.started_at_ms)
        {
            return Err(ProtocolError::Validation(
                "attempt number and timestamps are invalid".into(),
            ));
        }
        if self.state != AttemptState::Running && self.finished_at_ms.is_none() {
            return Err(ProtocolError::Validation(
                "terminal attempt requires finishedAtMs".into(),
            ));
        }
        Ok(())
    }
}

fn validate_status_text(label: &str, value: &str) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > MAX_STATUS_MESSAGE_BYTES {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={MAX_STATUS_MESSAGE_BYTES} bytes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_successful_gpu_trace_without_kernel_evidence() {
        let stage = StageSnapshot {
            stage_id: "neighbors".into(),
            ordinal: 2,
            kind: StageKind::NumericCompute,
            idempotent: true,
            state: StageState::Succeeded,
            progress: JobProgress {
                completed_units: 10,
                total_units: 10,
                message: "Completed".into(),
            },
            requested_backend: Backend::NativeMetal,
            effective_backend: Backend::NativeMetal,
            device: None,
            precision: Precision::IntegerExact,
            kernel_id: None,
            gpu_time_ms: None,
            host_time_ms: Some(1.0),
            transferred_bytes: 128,
            fallback_reason: None,
            error: None,
        };
        assert!(stage.validate().is_err());
    }
}
