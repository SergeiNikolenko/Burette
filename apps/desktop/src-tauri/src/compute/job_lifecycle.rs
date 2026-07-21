use burrete_compute_protocol::{
    AttemptSnapshot, AttemptState, ComputeErrorCode, ComputeFailure, JobOutcomeSummary,
    JobSnapshot, JobState, ResultPackRef, StageState,
};
use uuid::Uuid;

use super::error::{ComputeCoordinatorError, ComputeResult};

#[derive(Clone, Debug, Default)]
pub(crate) struct StageStartEvidence {
    pub(crate) device: Option<String>,
    pub(crate) kernel_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct StageFinishMetrics {
    pub(crate) host_time_ms: f64,
    pub(crate) gpu_time_ms: Option<f64>,
    pub(crate) transferred_bytes: u64,
}

pub(crate) fn start_stage(
    previous: &JobSnapshot,
    stage_index: usize,
    state: JobState,
    requested_at_ms: u64,
    message: &str,
    evidence: StageStartEvidence,
) -> ComputeResult<JobSnapshot> {
    previous.validate()?;
    let previous_stage = previous.stages.get(stage_index).ok_or_else(|| {
        ComputeCoordinatorError::Protocol("compute stage index is outside the accepted plan".into())
    })?;
    if previous_stage.state != StageState::Queued
        || previous.stages[..stage_index]
            .iter()
            .any(|stage| stage.state != StageState::Succeeded)
    {
        return Err(ComputeCoordinatorError::Protocol(
            "compute stage cannot start outside the sequential stage boundary".into(),
        ));
    }
    let gpu = previous_stage.effective_backend.is_gpu();
    if gpu != (evidence.device.is_some() && evidence.kernel_id.is_some()) {
        return Err(ComputeCoordinatorError::Protocol(
            "GPU stage start evidence does not match its effective backend".into(),
        ));
    }

    let at_ms = requested_at_ms.max(previous.updated_at_ms);
    let mut successor = previous.clone();
    successor.revision = next_revision(previous.revision)?;
    successor.state = state;
    successor.updated_at_ms = at_ms;
    successor.progress.message = bounded_message(message)?;
    successor.error = None;

    let stage = &mut successor.stages[stage_index];
    stage.state = StageState::Running;
    stage.progress.message = bounded_message(message)?;
    stage.device = evidence.device;
    stage.kernel_id = evidence.kernel_id;
    stage.started_at_ms = Some(at_ms);
    stage.updated_at_ms = Some(at_ms);
    successor.attempts.push(AttemptSnapshot {
        attempt_id: Uuid::new_v4(),
        stage_id: stage.stage_id.clone(),
        attempt_number: next_attempt_number(previous, &stage.stage_id)?,
        runtime_version: successor.pinned_runtime.version.clone(),
        state: AttemptState::Running,
        started_at_ms: at_ms,
        heartbeat_at_ms: at_ms,
        finished_at_ms: None,
        error: None,
        retry_reason: None,
    });
    successor.validate_successor(previous)?;
    Ok(successor)
}

pub(crate) fn finish_stage(
    previous: &JobSnapshot,
    stage_index: usize,
    state: JobState,
    requested_at_ms: u64,
    message: &str,
    metrics: StageFinishMetrics,
) -> ComputeResult<JobSnapshot> {
    previous.validate()?;
    let previous_stage = previous.stages.get(stage_index).ok_or_else(|| {
        ComputeCoordinatorError::Protocol("compute stage index is outside the accepted plan".into())
    })?;
    if previous_stage.state != StageState::Running {
        return Err(ComputeCoordinatorError::Protocol(
            "only a running compute stage can succeed".into(),
        ));
    }
    validate_timing(metrics.host_time_ms, "host")?;
    if let Some(gpu_time_ms) = metrics.gpu_time_ms {
        validate_timing(gpu_time_ms, "GPU")?;
    }
    if previous_stage.effective_backend.is_gpu() != metrics.gpu_time_ms.is_some() {
        return Err(ComputeCoordinatorError::Protocol(
            "GPU timing evidence does not match the stage effective backend".into(),
        ));
    }
    let attempt_index = previous
        .attempts
        .iter()
        .rposition(|attempt| {
            attempt.stage_id == previous_stage.stage_id && attempt.state == AttemptState::Running
        })
        .ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "running compute stage has no running attempt evidence".into(),
            )
        })?;

    let at_ms = requested_at_ms.max(previous.updated_at_ms);
    let mut successor = previous.clone();
    successor.revision = next_revision(previous.revision)?;
    successor.state = state;
    successor.updated_at_ms = at_ms;
    successor.progress.completed_units = u64::try_from(stage_index + 1).map_err(|_| {
        ComputeCoordinatorError::Protocol("compute stage progress overflowed".into())
    })?;
    successor.progress.message = bounded_message(message)?;

    let stage = &mut successor.stages[stage_index];
    stage.state = StageState::Succeeded;
    stage.progress.completed_units = stage.progress.total_units;
    stage.progress.message = bounded_message(message)?;
    stage.gpu_time_ms = metrics.gpu_time_ms;
    stage.host_time_ms = Some(metrics.host_time_ms);
    stage.transferred_bytes = metrics.transferred_bytes;
    stage.updated_at_ms = Some(at_ms);
    stage.finished_at_ms = Some(at_ms);

    let attempt = &mut successor.attempts[attempt_index];
    attempt.state = AttemptState::Succeeded;
    attempt.heartbeat_at_ms = at_ms;
    attempt.finished_at_ms = Some(at_ms);
    successor.validate_successor(previous)?;
    Ok(successor)
}

pub(crate) fn finish_cancellation(
    previous: &JobSnapshot,
    requested_at_ms: u64,
) -> ComputeResult<JobSnapshot> {
    previous.validate()?;
    if previous.state != JobState::CancelRequested {
        return Err(ComputeCoordinatorError::Protocol(
            "only a cancellation request can become cancelled".into(),
        ));
    }
    let stage_index = previous
        .stages
        .iter()
        .position(|stage| stage.state != StageState::Succeeded)
        .ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "cancellation request has no active stage boundary".into(),
            )
        })?;
    let running = previous.stages[stage_index].state == StageState::Running;
    let stage_id = running.then(|| previous.stages[stage_index].stage_id.clone());
    let failure = ComputeFailure {
        code: ComputeErrorCode::Cancelled,
        message: "Cancelled by owner.".into(),
        stage_id,
        molecule_stable_id: None,
        retryable: false,
    };
    let at_ms = requested_at_ms.max(previous.updated_at_ms);
    let mut successor = previous.clone();
    successor.revision = next_revision(previous.revision)?;
    successor.state = JobState::Cancelled;
    successor.updated_at_ms = at_ms;
    successor.finished_at_ms = Some(at_ms);
    successor.progress.message = "Cancelled".into();
    successor.error = Some(failure.clone());

    if running {
        let stage = &mut successor.stages[stage_index];
        let started_at_ms = stage.started_at_ms.ok_or_else(|| {
            ComputeCoordinatorError::Protocol("running stage lacks a start time".into())
        })?;
        stage.state = StageState::Cancelled;
        stage.progress.message = "Cancelled".into();
        stage.host_time_ms = Some(at_ms.saturating_sub(started_at_ms) as f64);
        stage.error = Some(failure.clone());
        stage.updated_at_ms = Some(at_ms);
        stage.finished_at_ms = Some(at_ms);
        let attempt = successor
            .attempts
            .iter_mut()
            .rfind(|attempt| {
                attempt.stage_id == stage.stage_id && attempt.state == AttemptState::Running
            })
            .ok_or_else(|| {
                ComputeCoordinatorError::Protocol(
                    "running cancelled stage has no running attempt".into(),
                )
            })?;
        attempt.state = AttemptState::Cancelled;
        attempt.heartbeat_at_ms = at_ms;
        attempt.finished_at_ms = Some(at_ms);
        attempt.error = Some(failure);
    }
    successor.validate_successor(previous)?;
    Ok(successor)
}

pub(crate) fn fail_stage(
    previous: &JobSnapshot,
    stage_index: usize,
    requested_at_ms: u64,
    failure: ComputeFailure,
    metrics: StageFinishMetrics,
) -> ComputeResult<JobSnapshot> {
    previous.validate()?;
    failure.validate()?;
    let previous_stage = previous.stages.get(stage_index).ok_or_else(|| {
        ComputeCoordinatorError::Protocol("compute stage index is outside the accepted plan".into())
    })?;
    if previous_stage.state != StageState::Running
        || failure.stage_id.as_deref() != Some(previous_stage.stage_id.as_str())
    {
        return Err(ComputeCoordinatorError::Protocol(
            "compute failure does not belong to the running stage".into(),
        ));
    }
    validate_timing(metrics.host_time_ms, "host")?;
    if let Some(gpu_time_ms) = metrics.gpu_time_ms {
        validate_timing(gpu_time_ms, "GPU")?;
    }
    if !previous_stage.effective_backend.is_gpu() && metrics.gpu_time_ms.is_some() {
        return Err(ComputeCoordinatorError::Protocol(
            "CPU stage failure cannot carry GPU timing evidence".into(),
        ));
    }
    let attempt_index = previous
        .attempts
        .iter()
        .rposition(|attempt| {
            attempt.stage_id == previous_stage.stage_id && attempt.state == AttemptState::Running
        })
        .ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "running compute stage has no running attempt evidence".into(),
            )
        })?;
    let at_ms = requested_at_ms.max(previous.updated_at_ms);
    let mut successor = previous.clone();
    successor.revision = next_revision(previous.revision)?;
    successor.state = JobState::Failed;
    successor.updated_at_ms = at_ms;
    successor.finished_at_ms = Some(at_ms);
    successor.progress.message = bounded_message(&failure.message)?;
    successor.error = Some(failure.clone());

    let stage = &mut successor.stages[stage_index];
    stage.state = StageState::Failed;
    stage.progress.message = bounded_message(&failure.message)?;
    stage.gpu_time_ms = metrics.gpu_time_ms;
    stage.host_time_ms = Some(metrics.host_time_ms);
    stage.transferred_bytes = metrics.transferred_bytes;
    stage.error = Some(failure.clone());
    stage.updated_at_ms = Some(at_ms);
    stage.finished_at_ms = Some(at_ms);

    let attempt = &mut successor.attempts[attempt_index];
    attempt.state = AttemptState::Failed;
    attempt.heartbeat_at_ms = at_ms;
    attempt.finished_at_ms = Some(at_ms);
    attempt.error = Some(failure);
    successor.validate_successor(previous)?;
    Ok(successor)
}

pub(crate) fn finish_publish_stage(
    previous: &JobSnapshot,
    requested_at_ms: u64,
    artifact_id: Uuid,
    result_pack: ResultPackRef,
    outcome: JobOutcomeSummary,
    metrics: StageFinishMetrics,
) -> ComputeResult<JobSnapshot> {
    previous.validate()?;
    let stage_index = previous.stages.len().checked_sub(1).ok_or_else(|| {
        ComputeCoordinatorError::Protocol("compute job has no publish stage".into())
    })?;
    let previous_stage = &previous.stages[stage_index];
    if previous.state != JobState::Publishing || previous_stage.state != StageState::Running {
        return Err(ComputeCoordinatorError::Protocol(
            "only the running publish stage can complete a compute job".into(),
        ));
    }
    if artifact_id.is_nil() || previous.artifact_ids.contains(&artifact_id) {
        return Err(ComputeCoordinatorError::Validation(
            "published artifact ID must be new and non-nil".into(),
        ));
    }
    validate_timing(metrics.host_time_ms, "host")?;
    if metrics.gpu_time_ms.is_some() {
        return Err(ComputeCoordinatorError::Protocol(
            "artifact publication cannot carry GPU timing evidence".into(),
        ));
    }
    let attempt_index = previous
        .attempts
        .iter()
        .rposition(|attempt| {
            attempt.stage_id == previous_stage.stage_id && attempt.state == AttemptState::Running
        })
        .ok_or_else(|| {
            ComputeCoordinatorError::Protocol(
                "running publish stage has no running attempt evidence".into(),
            )
        })?;
    let at_ms = requested_at_ms.max(previous.updated_at_ms);
    let mut successor = previous.clone();
    successor.revision = next_revision(previous.revision)?;
    successor.state = if outcome.failed_records == 0 {
        JobState::Succeeded
    } else {
        JobState::SucceededWithFailures
    };
    successor.updated_at_ms = at_ms;
    successor.finished_at_ms = Some(at_ms);
    successor.progress.completed_units = successor.progress.total_units;
    successor.progress.message = if outcome.failed_records == 0 {
        "Clustering completed".into()
    } else {
        format!(
            "Clustering completed with {} failed records",
            outcome.failed_records
        )
    };
    successor.artifact_ids.push(artifact_id);
    successor.result_pack = Some(result_pack);
    successor.outcome = Some(outcome);

    let stage = &mut successor.stages[stage_index];
    stage.state = StageState::Succeeded;
    stage.progress.completed_units = stage.progress.total_units;
    stage.progress.message = "Result artifact published".into();
    stage.host_time_ms = Some(metrics.host_time_ms);
    stage.transferred_bytes = metrics.transferred_bytes;
    stage.updated_at_ms = Some(at_ms);
    stage.finished_at_ms = Some(at_ms);

    let attempt = &mut successor.attempts[attempt_index];
    attempt.state = AttemptState::Succeeded;
    attempt.heartbeat_at_ms = at_ms;
    attempt.finished_at_ms = Some(at_ms);
    successor.validate_successor(previous)?;
    Ok(successor)
}

fn next_attempt_number(snapshot: &JobSnapshot, stage_id: &str) -> ComputeResult<u16> {
    snapshot
        .attempts
        .iter()
        .filter(|attempt| attempt.stage_id == stage_id)
        .count()
        .checked_add(1)
        .and_then(|count| u16::try_from(count).ok())
        .ok_or_else(|| ComputeCoordinatorError::Protocol("stage attempt count overflowed".into()))
}

fn next_revision(revision: u64) -> ComputeResult<u64> {
    revision
        .checked_add(1)
        .ok_or_else(|| ComputeCoordinatorError::Protocol("compute job revision overflowed".into()))
}

fn validate_timing(value: f64, label: &str) -> ComputeResult<()> {
    if !value.is_finite() || value < 0.0 {
        return Err(ComputeCoordinatorError::Validation(format!(
            "{label} stage timing must be finite and non-negative"
        )));
    }
    Ok(())
}

fn bounded_message(message: &str) -> ComputeResult<String> {
    if message.is_empty() || message.len() > 2_048 || message.chars().any(char::is_control) {
        return Err(ComputeCoordinatorError::Validation(
            "compute stage message is empty, oversized, or unsafe".into(),
        ));
    }
    Ok(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute::store::test_support::queued_snapshot;

    #[test]
    fn emits_one_valid_successor_per_durable_stage_boundary() {
        let queued = queued_snapshot();
        let running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            101,
            "Freezing source",
            StageStartEvidence::default(),
        )
        .expect("start freeze stage");
        assert_eq!(running.revision, 2);
        assert_eq!(running.attempts.len(), 1);

        let succeeded = finish_stage(
            &running,
            0,
            JobState::Preparing,
            102,
            "Source frozen",
            StageFinishMetrics {
                host_time_ms: 1.0,
                transferred_bytes: 128,
                ..StageFinishMetrics::default()
            },
        )
        .expect("finish freeze stage");
        assert_eq!(succeeded.revision, 3);
        assert_eq!(succeeded.progress.completed_units, 1);
        assert_eq!(succeeded.attempts.len(), 1);
        assert_eq!(succeeded.validate_successor(&running), Ok(()));
    }

    #[test]
    fn refuses_gpu_claims_on_cpu_stages() {
        let queued = queued_snapshot();
        assert!(start_stage(
            &queued,
            0,
            JobState::Preparing,
            101,
            "Freezing source",
            StageStartEvidence {
                device: Some("Apple GPU".into()),
                kernel_id: Some("kernel".into()),
            },
        )
        .is_err());
    }

    #[test]
    fn cancellation_finishes_running_stage_and_attempt() {
        let queued = queued_snapshot();
        let running = start_stage(
            &queued,
            0,
            JobState::Preparing,
            101,
            "Freezing source",
            StageStartEvidence::default(),
        )
        .expect("start stage");
        let mut requested = running.clone();
        requested.revision += 1;
        requested.state = JobState::CancelRequested;
        requested.updated_at_ms = 102;
        requested.progress.message = "Cancellation requested".into();
        requested
            .validate_successor(&running)
            .expect("request cancellation");

        let cancelled = finish_cancellation(&requested, 105).expect("finish cancellation");
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.stages[0].state, StageState::Cancelled);
        assert_eq!(cancelled.attempts[0].state, AttemptState::Cancelled);
        assert_eq!(cancelled.finished_at_ms, Some(105));
    }

    #[test]
    fn cancellation_closes_a_queued_job_without_starting_its_stage() {
        let queued = queued_snapshot();
        let mut requested = queued.clone();
        requested.revision += 1;
        requested.state = JobState::CancelRequested;
        requested.updated_at_ms = 102;
        requested.progress.message = "Cancellation requested".into();
        requested
            .validate_successor(&queued)
            .expect("request queued cancellation");

        let cancelled = finish_cancellation(&requested, 103).expect("finish cancellation");
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.stages[0].state, StageState::Queued);
        assert!(cancelled.attempts.is_empty());
    }
}
