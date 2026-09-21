use crate::validation::{validate_bounded_text, validate_json_safe_u64};

use super::*;

impl StageState {
    pub(super) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }

    pub(super) fn can_transition_to(self, next: Self) -> bool {
        self == next
            || matches!(
                (self, next),
                (
                    Self::Queued,
                    Self::Running | Self::Failed | Self::Interrupted
                ) | (
                    Self::Running,
                    Self::Succeeded | Self::Failed | Self::Cancelled | Self::Interrupted
                )
            )
    }
}

impl StageSnapshot {
    pub(super) fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded_text("stage ID", &self.stage_id, MAX_STATUS_MESSAGE_BYTES)?;
        self.progress.validate()?;
        self.engine.validate()?;
        validate_json_safe_u64("stage transferred bytes", self.transferred_bytes)?;
        for (label, value) in [
            ("stage device", self.device.as_deref()),
            ("stage kernel ID", self.kernel_id.as_deref()),
        ] {
            if let Some(value) = value {
                validate_bounded_text(label, value, MAX_STATUS_MESSAGE_BYTES)?;
            }
        }
        match (
            self.requested_backend == self.effective_backend,
            &self.fallback,
        ) {
            (true, None) => {}
            (false, Some(fallback)) => validate_bounded_text(
                "stage fallback reason",
                &fallback.reason,
                MAX_STATUS_MESSAGE_BYTES,
            )?,
            (true, Some(_)) => {
                return validation_error("stage fallback is forbidden without a backend change")
            }
            (false, None) => {
                return validation_error("stage backend change requires a fallback decision")
            }
        }
        for timing in [self.gpu_time_ms, self.host_time_ms].into_iter().flatten() {
            if !timing.is_finite() || timing < 0.0 {
                return validation_error("stage timings must be finite and non-negative");
            }
        }
        let gpu_numeric = self.kind == StageKind::NumericCompute && self.effective_backend.is_gpu();
        if gpu_numeric {
            if matches!(self.state, StageState::Running | StageState::Succeeded)
                && (self.device.is_none() || self.kernel_id.is_none())
            {
                return validation_error("running GPU stage lacks device or kernel evidence");
            }
            if self.state == StageState::Succeeded && self.gpu_time_ms.is_none() {
                return validation_error("successful GPU stage lacks GPU timing evidence");
            }
        } else if self.device.is_some() || self.kernel_id.is_some() || self.gpu_time_ms.is_some() {
            return validation_error("non-GPU stage contains GPU-only evidence");
        }
        match self.state {
            StageState::Queued => {
                if self.progress.completed_units != 0
                    || self.error.is_some()
                    || self.started_at_ms.is_some()
                    || self.updated_at_ms.is_some()
                    || self.finished_at_ms.is_some()
                    || self.device.is_some()
                    || self.kernel_id.is_some()
                    || self.gpu_time_ms.is_some()
                    || self.host_time_ms.is_some()
                    || self.transferred_bytes != 0
                {
                    return validation_error("queued stage contains execution evidence");
                }
            }
            StageState::Running => {
                if self.error.is_some() || self.finished_at_ms.is_some() {
                    return validation_error("running stage has terminal evidence");
                }
                require_some_times(self.started_at_ms, self.updated_at_ms)?;
            }
            StageState::Succeeded => {
                if self.error.is_some()
                    || self.progress.completed_units != self.progress.total_units
                    || self.host_time_ms.is_none()
                {
                    return validation_error("successful stage is incomplete or has an error");
                }
                require_all_times(self.started_at_ms, self.updated_at_ms, self.finished_at_ms)?;
            }
            StageState::Failed => {
                let error = self.error.as_ref().ok_or_else(|| {
                    ProtocolError::Validation("failed stage requires an error".into())
                })?;
                if error.code == ComputeErrorCode::Cancelled || self.host_time_ms.is_none() {
                    return validation_error("failed stage has invalid error or timing evidence");
                }
                require_stage_error_binding(error, &self.stage_id)?;
                require_all_times(self.started_at_ms, self.updated_at_ms, self.finished_at_ms)?;
            }
            StageState::Interrupted => {
                let error = self.error.as_ref().ok_or_else(|| {
                    ProtocolError::Validation("interrupted stage requires an error".into())
                })?;
                if !error.retryable || self.host_time_ms.is_none() {
                    return validation_error(
                        "interrupted stage requires retryable terminal evidence",
                    );
                }
                require_stage_error_binding(error, &self.stage_id)?;
                require_all_times(self.started_at_ms, self.updated_at_ms, self.finished_at_ms)?;
            }
            StageState::Cancelled => {
                let error = self.error.as_ref().ok_or_else(|| {
                    ProtocolError::Validation("cancelled stage requires an error".into())
                })?;
                if error.code != ComputeErrorCode::Cancelled || self.host_time_ms.is_none() {
                    return validation_error("cancelled stage lacks Cancelled error or timing");
                }
                require_stage_error_binding(error, &self.stage_id)?;
                require_all_times(self.started_at_ms, self.updated_at_ms, self.finished_at_ms)?;
            }
        }
        Ok(())
    }

    pub(super) fn validate_within_job(
        &self,
        created: u64,
        updated: u64,
    ) -> Result<(), ProtocolError> {
        for (label, value) in [
            ("stage start time", self.started_at_ms),
            ("stage update time", self.updated_at_ms),
            ("stage finish time", self.finished_at_ms),
        ] {
            if let Some(value) = value {
                validate_json_safe_u64(label, value)?;
                if !(created..=updated).contains(&value) {
                    return validation_error("stage timestamp is outside the job lifetime");
                }
            }
        }
        validate_ordered_times(self.started_at_ms, self.updated_at_ms, self.finished_at_ms)
    }
}

impl AttemptState {
    pub(super) fn can_transition_to(self, next: Self) -> bool {
        self == next
            || self == Self::Running
                && matches!(
                    next,
                    Self::Succeeded | Self::Failed | Self::Interrupted | Self::Cancelled
                )
    }
}

impl AttemptSnapshot {
    pub(super) fn validate_within_job(
        &self,
        created: u64,
        updated: u64,
    ) -> Result<(), ProtocolError> {
        validate_uuid("attempt ID", self.attempt_id)?;
        validate_bounded_text("attempt stage ID", &self.stage_id, MAX_STATUS_MESSAGE_BYTES)?;
        validate_bounded_text(
            "attempt runtime version",
            &self.runtime_version,
            MAX_RUNTIME_VERSION_BYTES,
        )?;
        if let Some(reason) = &self.retry_reason {
            validate_bounded_text("attempt retry reason", reason, MAX_STATUS_MESSAGE_BYTES)?;
        }
        if self.attempt_number == 0 {
            return validation_error("attempt number must be positive");
        }
        for (label, value) in [
            ("attempt start time", self.started_at_ms),
            ("attempt heartbeat time", self.heartbeat_at_ms),
        ] {
            validate_json_safe_u64(label, value)?;
            if !(created..=updated).contains(&value) {
                return validation_error("attempt timestamp is outside the job lifetime");
            }
        }
        if self.heartbeat_at_ms < self.started_at_ms {
            return validation_error("attempt heartbeat precedes its start");
        }
        if let Some(finished) = self.finished_at_ms {
            validate_json_safe_u64("attempt finish time", finished)?;
            if finished < self.heartbeat_at_ms
                || !(self.started_at_ms..=updated).contains(&finished)
            {
                return validation_error("attempt finish time is outside its lifetime");
            }
        }
        if (self.state == AttemptState::Running) == self.finished_at_ms.is_some() {
            return validation_error("attempt state and finish timestamp disagree");
        }
        if let Some(error) = &self.error {
            error.validate()?;
            require_stage_error_binding(error, &self.stage_id)?;
        }
        match self.state {
            AttemptState::Running | AttemptState::Succeeded if self.error.is_some() => {
                return validation_error("running or successful attempt cannot carry an error")
            }
            AttemptState::Failed => {
                if self
                    .error
                    .as_ref()
                    .is_none_or(|error| error.code == ComputeErrorCode::Cancelled)
                {
                    return validation_error("failed attempt requires a non-cancelled error");
                }
            }
            AttemptState::Interrupted => {
                if self.error.as_ref().is_none_or(|error| {
                    !error.retryable || error.code == ComputeErrorCode::Cancelled
                }) {
                    return validation_error("interrupted attempt requires a retryable error");
                }
            }
            AttemptState::Cancelled => {
                if self.error.as_ref().map(|error| error.code) != Some(ComputeErrorCode::Cancelled)
                {
                    return validation_error("cancelled attempt requires a Cancelled error");
                }
            }
            AttemptState::Running | AttemptState::Succeeded => {}
        }
        Ok(())
    }
}

fn require_stage_error_binding(
    error: &ComputeFailure,
    stage_id: &str,
) -> Result<(), ProtocolError> {
    if error.stage_id.as_deref() != Some(stage_id) {
        validation_error("terminal stage error must identify its stage")
    } else {
        Ok(())
    }
}

fn require_some_times(started: Option<u64>, updated: Option<u64>) -> Result<(), ProtocolError> {
    if started.is_none() || updated.is_none() {
        validation_error("started stage requires start and update timestamps")
    } else {
        Ok(())
    }
}

fn require_all_times(
    started: Option<u64>,
    updated: Option<u64>,
    finished: Option<u64>,
) -> Result<(), ProtocolError> {
    if started.is_none() || updated.is_none() || finished.is_none() {
        validation_error("terminal stage requires start, update, and finish timestamps")
    } else {
        Ok(())
    }
}

fn validate_ordered_times(
    started: Option<u64>,
    updated: Option<u64>,
    finished: Option<u64>,
) -> Result<(), ProtocolError> {
    if let (Some(started), Some(updated)) = (started, updated) {
        if updated < started {
            return validation_error("stage update time precedes start time");
        }
    }
    if let (Some(started), Some(updated), Some(finished)) = (started, updated, finished) {
        if finished < started || finished > updated {
            return validation_error("stage finish time is outside its execution interval");
        }
    }
    Ok(())
}
