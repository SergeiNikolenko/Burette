use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    validation::{validate_bounded_text, validate_json_safe_u64, validate_lower_sha256},
    Backend, BackendPolicy, ClusterV1SubmitRequest, ComputeErrorCode, ComputeFailure,
    EngineIdentity, ExecutionPlan, FallbackDecision, GridScope, JobState, MolecularSnapshotRef,
    OwnerSurface, Precision, ProtocolError, ResultPackRef, StageKind, WorkflowTemplateId,
};

const MAX_STAGES: usize = 32;
const MAX_ATTEMPTS: usize = 128;
const MAX_ARTIFACTS: usize = 256;
const MAX_STATUS_MESSAGE_BYTES: usize = 2_048;
const MAX_RUNTIME_VERSION_BYTES: usize = 160;

mod stage_validation;
mod successor;
#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputeJobSnapshotSchemaVersion {
    #[serde(rename = "burrete.compute-job-snapshot.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobOutcomeSummary {
    pub successful_records: u64,
    pub failed_records: u64,
}

impl JobOutcomeSummary {
    fn validate(&self, record_count: u64) -> Result<(), ProtocolError> {
        validate_json_safe_u64("successful record count", self.successful_records)?;
        validate_json_safe_u64("failed record count", self.failed_records)?;
        let total = self
            .successful_records
            .checked_add(self.failed_records)
            .ok_or_else(|| ProtocolError::Validation("outcome record count overflowed".into()))?;
        if total != record_count {
            return Err(ProtocolError::Validation(
                "outcome record count differs from the frozen source".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobSnapshot {
    pub schema_version: ComputeJobSnapshotSchemaVersion,
    pub job_id: Uuid,
    pub revision: u64,
    pub owner_surface: OwnerSurface,
    pub workflow_template: WorkflowTemplateId,
    pub state: JobState,
    pub request: ClusterV1SubmitRequest,
    pub normalized_request_sha256: String,
    pub frozen_source: MolecularSnapshotRef,
    pub progress: JobProgress,
    pub plan: ExecutionPlan,
    pub accepted_plan_sha256: String,
    pub stages: Vec<StageSnapshot>,
    pub attempts: Vec<AttemptSnapshot>,
    pub artifact_ids: Vec<Uuid>,
    pub result_pack: Option<ResultPackRef>,
    pub outcome: Option<JobOutcomeSummary>,
    pub pinned_runtime_version: Option<String>,
    pub error: Option<ComputeFailure>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub finished_at_ms: Option<u64>,
}

impl JobSnapshot {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_uuid("job ID", self.job_id)?;
        validate_positive_json_safe("job revision", self.revision)?;
        validate_positive_json_safe("job creation time", self.created_at_ms)?;
        validate_json_safe_u64("job update time", self.updated_at_ms)?;
        if self.updated_at_ms < self.created_at_ms {
            return validation_error("job update time precedes creation time");
        }
        if let Some(finished) = self.finished_at_ms {
            validate_json_safe_u64("job finish time", finished)?;
            if !(self.created_at_ms..=self.updated_at_ms).contains(&finished) {
                return validation_error("job finish time is outside its lifetime");
            }
        }
        self.request.validate()?;
        if self.request.clone().normalized()? != self.request {
            return validation_error("job request is not in canonical hash form");
        }
        if self.workflow_template != self.request.workflow_template
            || self.workflow_template != self.plan.workflow_template
            || self.request.execution_policy.backend_policy != self.plan.backend_policy
        {
            return validation_error("job request differs from its accepted workflow or policy");
        }
        validate_lower_sha256("normalized request", &self.normalized_request_sha256)?;
        validate_lower_sha256("accepted plan", &self.accepted_plan_sha256)?;
        if let Some(runtime) = &self.pinned_runtime_version {
            validate_bounded_text("pinned runtime version", runtime, MAX_RUNTIME_VERSION_BYTES)?;
        }
        self.frozen_source.validate()?;
        let record_count = self.frozen_source.frozen_source.record_count;
        self.plan.validate_for_record_count(record_count)?;
        if let GridScope::Selected(selected) = &self.request.source.scope {
            if selected.source_indexes.len() as u64 != record_count {
                return validation_error("selected request count differs from the frozen source");
            }
        }
        self.progress.validate()?;
        self.validate_stages()?;
        self.validate_attempts()?;
        self.validate_artifacts_and_result(record_count)?;
        self.validate_job_state(record_count)
    }

    fn validate_stages(&self) -> Result<(), ProtocolError> {
        if self.stages.is_empty()
            || self.stages.len() > MAX_STAGES
            || self.stages.len() != self.plan.stages.len()
        {
            return validation_error("job stages must match the accepted execution plan exactly");
        }
        for (ordinal, (stage, planned)) in self.stages.iter().zip(&self.plan.stages).enumerate() {
            stage.validate()?;
            validate_stage_plan_binding(stage, planned, ordinal, self.plan.backend_policy)?;
            stage.validate_within_job(self.created_at_ms, self.updated_at_ms)?;
            if let Some(error) = &stage.error {
                error.validate()?;
                if error
                    .stage_id
                    .as_deref()
                    .is_some_and(|id| id != stage.stage_id)
                {
                    return validation_error("stage error references a different stage");
                }
            }
        }
        if let Some(first_not_succeeded) = self
            .stages
            .iter()
            .position(|stage| stage.state != StageState::Succeeded)
        {
            if self.stages[first_not_succeeded + 1..]
                .iter()
                .any(|stage| stage.state != StageState::Queued)
            {
                return validation_error("job stage states are not a sequential prefix");
            }
        }
        for pair in self.stages.windows(2) {
            if let (Some(left), Some(right)) = (pair[0].finished_at_ms, pair[1].started_at_ms) {
                if right < left {
                    return validation_error("stage execution timestamps overlap out of order");
                }
            }
        }
        Ok(())
    }

    fn validate_attempts(&self) -> Result<(), ProtocolError> {
        if self.attempts.len() > MAX_ATTEMPTS {
            return validation_error("job has too many attempts");
        }
        if self.attempts.is_empty() {
            return if self
                .stages
                .iter()
                .all(|stage| stage.state == StageState::Queued)
            {
                Ok(())
            } else {
                validation_error("started or terminal stages require attempt evidence")
            };
        }
        let runtime = self.pinned_runtime_version.as_deref().ok_or_else(|| {
            ProtocolError::Validation("attempts require a pinned runtime version".into())
        })?;
        validate_bounded_text("pinned runtime version", runtime, MAX_RUNTIME_VERSION_BYTES)?;
        let mut attempt_ids = BTreeSet::new();
        let mut by_stage: BTreeMap<&str, Vec<&AttemptSnapshot>> = BTreeMap::new();
        for attempt in &self.attempts {
            attempt.validate_within_job(self.created_at_ms, self.updated_at_ms)?;
            if !attempt_ids.insert(attempt.attempt_id) {
                return validation_error("job has duplicate attempt IDs");
            }
            if attempt.runtime_version != runtime {
                return validation_error("attempt runtime differs from the pinned runtime");
            }
            by_stage.entry(&attempt.stage_id).or_default().push(attempt);
        }
        for stage in &self.stages {
            let attempts = by_stage.remove(stage.stage_id.as_str()).unwrap_or_default();
            for (index, attempt) in attempts.iter().enumerate() {
                if attempt.attempt_number as usize != index + 1
                    || (index == 0 && attempt.retry_reason.is_some())
                    || (index > 0 && attempt.retry_reason.is_none())
                {
                    return validation_error("stage attempt numbers or retry reasons are invalid");
                }
                if index + 1 < attempts.len()
                    && !matches!(
                        attempt.state,
                        AttemptState::Failed | AttemptState::Interrupted
                    )
                {
                    return validation_error("only failed or interrupted attempts can be retried");
                }
                if index + 1 < attempts.len()
                    && !attempt.error.as_ref().is_some_and(|error| error.retryable)
                {
                    return validation_error("retried attempt must carry a retryable error");
                }
            }
            let last_state = attempts.last().map(|attempt| attempt.state);
            let retry_reset = self.state == JobState::Preparing
                && stage.state == StageState::Queued
                && stage.idempotent
                && last_state == Some(AttemptState::Interrupted);
            let expected = match stage.state {
                StageState::Queued if attempts.is_empty() || retry_reset => continue,
                StageState::Running => AttemptState::Running,
                StageState::Succeeded => AttemptState::Succeeded,
                StageState::Failed => AttemptState::Failed,
                StageState::Cancelled => AttemptState::Cancelled,
                StageState::Interrupted => AttemptState::Interrupted,
                StageState::Queued => {
                    return validation_error("queued stage retains invalid attempt history")
                }
            };
            if last_state != Some(expected) {
                return validation_error("stage state differs from its latest attempt");
            }
            if matches!(
                stage.state,
                StageState::Failed | StageState::Interrupted | StageState::Cancelled
            ) && attempts.last().and_then(|attempt| attempt.error.as_ref())
                != stage.error.as_ref()
            {
                return validation_error("terminal stage and latest attempt errors differ");
            }
        }
        if !by_stage.is_empty() {
            return validation_error("attempt references an unknown stage");
        }
        Ok(())
    }

    fn validate_artifacts_and_result(&self, record_count: u64) -> Result<(), ProtocolError> {
        if self.artifact_ids.len() > MAX_ARTIFACTS {
            return validation_error("job has too many artifacts");
        }
        let mut artifacts = BTreeSet::new();
        for artifact_id in &self.artifact_ids {
            validate_uuid("artifact ID", *artifact_id)?;
            if !artifacts.insert(*artifact_id) {
                return validation_error("job has duplicate artifact IDs");
            }
        }
        if let Some(result) = &self.result_pack {
            result.validate()?;
            if result.job_id != self.job_id
                || result.workflow_template != self.workflow_template
                || result.snapshot_id != self.frozen_source.snapshot_id
                || result.snapshot_sha256 != self.frozen_source.snapshot_sha256
            {
                return validation_error("result pack is not bound to this job and frozen source");
            }
        }
        if let Some(outcome) = &self.outcome {
            outcome.validate(record_count)?;
        }
        Ok(())
    }

    fn validate_job_state(&self, record_count: u64) -> Result<(), ProtocolError> {
        let pivot = self
            .stages
            .iter()
            .find(|stage| stage.state != StageState::Succeeded);
        let all_succeeded = pivot.is_none();
        let terminal_time_matches = self.state.is_terminal() == self.finished_at_ms.is_some();
        if !terminal_time_matches {
            return validation_error("job terminal state and finish timestamp disagree");
        }
        if let Some(error) = &self.error {
            error.validate()?;
            if let Some(stage_id) = &error.stage_id {
                if !self.stages.iter().any(|stage| &stage.stage_id == stage_id) {
                    return validation_error("job error references an unknown stage");
                }
            }
        }
        let active_matches = match self.state {
            JobState::Queued => self.stages.iter().all(|s| s.state == StageState::Queued),
            JobState::Preparing => pivot.is_some_and(|stage| {
                matches!(stage.state, StageState::Queued | StageState::Running)
                    && stage.kind == StageKind::Materialize
                    || self.is_retry_preparing_stage(stage)
            }),
            JobState::WaitingGpu => pivot.is_some_and(|s| {
                s.state == StageState::Queued && s.kind == StageKind::NumericCompute
            }),
            JobState::Running => pivot.is_some_and(|stage| {
                stage.state == StageState::Running
                    && !matches!(stage.kind, StageKind::Validation | StageKind::ArtifactIo)
            }),
            JobState::Validating => pivot.is_some_and(|s| {
                matches!(s.state, StageState::Queued | StageState::Running)
                    && s.kind == StageKind::Validation
            }),
            JobState::Publishing => pivot.is_some_and(|s| {
                matches!(s.state, StageState::Queued | StageState::Running)
                    && s.kind == StageKind::ArtifactIo
            }),
            JobState::CancelRequested => pivot.is_some_and(|s| {
                matches!(
                    s.state,
                    StageState::Queued | StageState::Running | StageState::Interrupted
                )
            }),
            JobState::Cancelled => pivot.is_some_and(|s| {
                matches!(
                    s.state,
                    StageState::Queued | StageState::Cancelled | StageState::Interrupted
                )
            }),
            JobState::Failed => pivot
                .is_some_and(|s| matches!(s.state, StageState::Failed | StageState::Interrupted)),
            JobState::Interrupted => pivot.is_some_and(|s| s.state == StageState::Interrupted),
            JobState::Succeeded | JobState::SucceededWithFailures => all_succeeded,
        };
        if !active_matches {
            return validation_error("job state disagrees with its sequential stage states");
        }

        match self.state {
            JobState::Succeeded => {
                self.require_published_success(record_count, false)?;
            }
            JobState::SucceededWithFailures => {
                self.require_published_success(record_count, true)?;
            }
            JobState::Failed => {
                let error = self.error.as_ref().ok_or_else(|| {
                    ProtocolError::Validation("failed job requires an error".into())
                })?;
                if error.code == ComputeErrorCode::Cancelled {
                    return validation_error("failed job cannot use the Cancelled error code");
                }
                let failed_stage = pivot.expect("failed state has a pivot");
                if error.stage_id.as_deref() != Some(failed_stage.stage_id.as_str()) {
                    return validation_error("failed job error must identify its failed stage");
                }
                self.require_no_result()?;
            }
            JobState::Cancelled => {
                if self.error.as_ref().map(|error| error.code) != Some(ComputeErrorCode::Cancelled)
                {
                    return validation_error("cancelled job requires a Cancelled error");
                }
                self.require_no_result()?;
            }
            JobState::Interrupted => {
                let interrupted = pivot.expect("interrupted state has a pivot");
                if !self.error.as_ref().is_some_and(|error| {
                    error.retryable
                        && error.code != ComputeErrorCode::Cancelled
                        && error.stage_id.as_deref() == Some(interrupted.stage_id.as_str())
                }) {
                    return validation_error("interrupted job requires a retryable error");
                }
                self.require_no_result()?;
            }
            _ => {
                if self.error.is_some() {
                    return validation_error("active or successful job cannot carry an error");
                }
                self.require_no_result()?;
            }
        }
        Ok(())
    }

    fn require_published_success(
        &self,
        record_count: u64,
        with_failures: bool,
    ) -> Result<(), ProtocolError> {
        if self.error.is_some()
            || self.result_pack.is_none()
            || self.artifact_ids.is_empty()
            || self.progress.completed_units != self.progress.total_units
        {
            return validation_error("successful job requires a complete published result");
        }
        let outcome = self.outcome.as_ref().ok_or_else(|| {
            ProtocolError::Validation("successful job requires an outcome summary".into())
        })?;
        outcome.validate(record_count)?;
        if with_failures != (outcome.failed_records > 0) {
            return validation_error("success state disagrees with failedRecords");
        }
        if with_failures && outcome.successful_records == 0 {
            return validation_error("partial success requires at least one successful record");
        }
        Ok(())
    }

    fn require_no_result(&self) -> Result<(), ProtocolError> {
        if self.result_pack.is_some() || self.outcome.is_some() {
            validation_error("non-successful job cannot publish a result or outcome")
        } else {
            Ok(())
        }
    }

    fn is_retry_preparing_stage(&self, stage: &StageSnapshot) -> bool {
        stage.state == StageState::Queued
            && stage.idempotent
            && self
                .attempts
                .iter()
                .rev()
                .find(|attempt| attempt.stage_id == stage.stage_id)
                .is_some_and(|attempt| attempt.state == AttemptState::Interrupted)
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
        validate_json_safe_u64("completed progress units", self.completed_units)?;
        validate_positive_json_safe("total progress units", self.total_units)?;
        if self.completed_units > self.total_units {
            return validation_error("completed progress exceeds total progress");
        }
        validate_bounded_text("progress message", &self.message, MAX_STATUS_MESSAGE_BYTES)
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageSnapshot {
    pub stage_id: String,
    pub ordinal: u16,
    pub kind: StageKind,
    pub idempotent: bool,
    pub state: StageState,
    pub progress: JobProgress,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub engine: EngineIdentity,
    pub device: Option<String>,
    pub precision: Precision,
    pub kernel_id: Option<String>,
    pub gpu_time_ms: Option<f64>,
    pub host_time_ms: Option<f64>,
    pub transferred_bytes: u64,
    pub fallback: Option<FallbackDecision>,
    pub error: Option<ComputeFailure>,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptSnapshot {
    pub attempt_id: Uuid,
    pub stage_id: String,
    pub attempt_number: u16,
    pub runtime_version: String,
    pub state: AttemptState,
    pub started_at_ms: u64,
    pub heartbeat_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub error: Option<ComputeFailure>,
    pub retry_reason: Option<String>,
}

fn validate_positive_json_safe(label: &str, value: u64) -> Result<(), ProtocolError> {
    validate_json_safe_u64(label, value)?;
    if value == 0 {
        validation_error(&format!("{label} must be positive"))
    } else {
        Ok(())
    }
}

fn validate_stage_plan_binding(
    stage: &StageSnapshot,
    planned: &crate::PlannedStage,
    ordinal: usize,
    backend_policy: BackendPolicy,
) -> Result<(), ProtocolError> {
    if stage.ordinal as usize != ordinal
        || stage.stage_id != planned.stage_id
        || stage.kind != planned.kind
        || stage.idempotent != planned.idempotent
        || stage.requested_backend != planned.requested_backend
        || stage.effective_backend != planned.effective_backend
        || stage.precision != planned.precision
        || stage.engine != planned.engine
        || stage.fallback != planned.fallback
    {
        return Err(ProtocolError::Validation(format!(
            "stage {} differs from its accepted plan entry",
            stage.stage_id
        )));
    }
    if backend_policy == BackendPolicy::GpuRequired
        && stage.kind == StageKind::NumericCompute
        && !stage.effective_backend.is_gpu()
    {
        return validation_error("gpuRequired job has an actual CPU numeric stage");
    }
    Ok(())
}

fn validate_uuid(label: &str, value: Uuid) -> Result<(), ProtocolError> {
    if value.is_nil() {
        validation_error(&format!("{label} cannot be the nil UUID"))
    } else {
        Ok(())
    }
}

fn validation_error<T>(message: &str) -> Result<T, ProtocolError> {
    Err(ProtocolError::Validation(message.into()))
}
