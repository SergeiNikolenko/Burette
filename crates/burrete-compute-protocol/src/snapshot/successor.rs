use super::*;

impl JobSnapshot {
    pub fn validate_successor(&self, previous: &Self) -> Result<(), ProtocolError> {
        previous.validate()?;
        self.validate()?;
        if previous.state.is_terminal() {
            return validation_error("terminal job snapshots cannot have successors");
        }
        if self.job_id != previous.job_id
            || self.owner_surface != previous.owner_surface
            || self.workflow_template != previous.workflow_template
            || self.request != previous.request
            || self.normalized_request_sha256 != previous.normalized_request_sha256
            || self.frozen_source != previous.frozen_source
            || self.plan != previous.plan
            || self.accepted_plan_sha256 != previous.accepted_plan_sha256
            || self.created_at_ms != previous.created_at_ms
            || self.pinned_runtime != previous.pinned_runtime
        {
            return validation_error("immutable job snapshot fields changed");
        }
        if self.revision != previous.revision.saturating_add(1) {
            return validation_error("job successor revision must increase by exactly one");
        }
        if self.updated_at_ms < previous.updated_at_ms
            || self
                .finished_at_ms
                .is_some_and(|time| time < previous.updated_at_ms)
            || self.progress.total_units != previous.progress.total_units
            || self.progress.completed_units < previous.progress.completed_units
            || !self.artifact_ids.starts_with(&previous.artifact_ids)
        {
            return validation_error("job successor timestamps, progress, or artifacts regressed");
        }

        let retry = previous.state == JobState::Interrupted && self.state == JobState::Preparing;
        if retry {
            self.validate_interrupted_retry(previous)?;
        } else if self.state != previous.state {
            previous.state.require_transition(self.state)?;
        } else if self.state == JobState::Interrupted && self.error != previous.error {
            return validation_error("interrupted job error evidence changed");
        }
        self.validate_stage_successors(previous, retry)?;
        self.validate_attempt_successors(previous)
    }

    fn validate_interrupted_retry(&self, previous: &Self) -> Result<(), ProtocolError> {
        let interrupted = previous
            .stages
            .iter()
            .find(|stage| stage.state == StageState::Interrupted)
            .ok_or_else(|| ProtocolError::Validation("retry has no interrupted stage".into()))?;
        if !interrupted.idempotent || !previous.error.as_ref().is_some_and(|error| error.retryable)
        {
            return validation_error("only retryable idempotent interrupted stages may restart");
        }
        Ok(())
    }

    fn validate_stage_successors(&self, previous: &Self, retry: bool) -> Result<(), ProtocolError> {
        for (current, prior) in self.stages.iter().zip(&previous.stages) {
            let retry_reset = retry
                && prior.state == StageState::Interrupted
                && current.state == StageState::Queued;
            if retry_reset {
                if current.progress.completed_units != 0
                    || current.error.is_some()
                    || current.started_at_ms.is_some()
                    || current.updated_at_ms.is_some()
                    || current.finished_at_ms.is_some()
                {
                    return validation_error("retried stage was not reset to a clean queued state");
                }
                continue;
            }
            if prior.state.is_terminal() && current != prior {
                return validation_error("terminal stage evidence changed");
            }
            if !prior.state.can_transition_to(current.state)
                || current.progress.total_units != prior.progress.total_units
                || current.progress.completed_units < prior.progress.completed_units
                || current.transferred_bytes < prior.transferred_bytes
                || regressed_optional(current.gpu_time_ms, prior.gpu_time_ms)
                || regressed_optional(current.host_time_ms, prior.host_time_ms)
                || prior
                    .device
                    .as_ref()
                    .is_some_and(|device| current.device.as_ref() != Some(device))
                || prior
                    .kernel_id
                    .as_ref()
                    .is_some_and(|kernel| current.kernel_id.as_ref() != Some(kernel))
                || current.finished_at_ms.is_some_and(|time| {
                    prior
                        .updated_at_ms
                        .is_some_and(|previous_update| time < previous_update)
                })
            {
                return validation_error("stage successor regressed or skipped a state");
            }
            if prior.started_at_ms.is_some() && current.started_at_ms != prior.started_at_ms {
                return validation_error("stage start time changed");
            }
            if prior
                .updated_at_ms
                .is_some_and(|old| current.updated_at_ms.is_none_or(|new| new < old))
            {
                return validation_error("stage update time regressed");
            }
        }
        Ok(())
    }

    fn validate_attempt_successors(&self, previous: &Self) -> Result<(), ProtocolError> {
        if self.attempts.len() < previous.attempts.len() {
            return validation_error("attempt history was truncated");
        }
        for (current, prior) in self.attempts.iter().zip(&previous.attempts) {
            if current.attempt_id != prior.attempt_id
                || current.stage_id != prior.stage_id
                || current.attempt_number != prior.attempt_number
                || current.runtime_version != prior.runtime_version
                || current.started_at_ms != prior.started_at_ms
                || current.retry_reason != prior.retry_reason
                || current.heartbeat_at_ms < prior.heartbeat_at_ms
                || current
                    .finished_at_ms
                    .is_some_and(|time| time < prior.heartbeat_at_ms)
            {
                return validation_error("immutable attempt history changed");
            }
            if prior.state != AttemptState::Running && current != prior {
                return validation_error("terminal attempt evidence changed");
            }
            if !prior.state.can_transition_to(current.state) {
                return validation_error("attempt successor skipped a state");
            }
        }
        for appended in &self.attempts[previous.attempts.len()..] {
            if appended.attempt_number == 1 {
                continue;
            }
            let prior = previous
                .attempts
                .iter()
                .rev()
                .find(|attempt| attempt.stage_id == appended.stage_id)
                .ok_or_else(|| {
                    ProtocolError::Validation(
                        "new retry attempt has no durable prior attempt".into(),
                    )
                })?;
            let stage = previous
                .stages
                .iter()
                .find(|stage| stage.stage_id == appended.stage_id)
                .ok_or_else(|| {
                    ProtocolError::Validation("retry references an unknown stage".into())
                })?;
            if !stage.idempotent
                || !matches!(
                    prior.state,
                    AttemptState::Failed | AttemptState::Interrupted
                )
                || prior.error.as_ref().is_none_or(|error| !error.retryable)
            {
                return validation_error(
                    "retry requires a durable retryable terminal attempt on an idempotent stage",
                );
            }
        }
        Ok(())
    }
}

fn regressed_optional(current: Option<f64>, previous: Option<f64>) -> bool {
    previous.is_some_and(|old| current.is_none_or(|new| new < old))
}
