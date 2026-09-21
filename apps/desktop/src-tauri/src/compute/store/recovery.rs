use burette_compute_protocol::{
    AttemptSnapshot, AttemptState, ComputeErrorCode, ComputeFailure, JobState, StageState,
};
use uuid::Uuid;

use super::{decode_snapshot_with_source, ComputeCoordinatorError, ComputeResult, ComputeStore};

impl ComputeStore {
    pub(crate) fn recover_active_jobs(&self, recovered_at_ms: u64) -> ComputeResult<usize> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT jobs.created_window_label, jobs.snapshot_json,
                    job_source_snapshots.snapshot_id,
                    job_source_snapshots.snapshot_ref_json
             FROM jobs
             LEFT JOIN job_source_snapshots
               ON job_source_snapshots.job_id = jobs.job_id
             WHERE jobs.state NOT IN (
               'queued', 'cancelled', 'failed', 'interrupted',
               'succeeded', 'succeeded_with_failures'
             )
             ORDER BY jobs.created_at_ms ASC, jobs.job_id ASC",
        )?;
        let encoded = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);

        let mut recovered = 0;
        for (owner, encoded_snapshot, source_id, source) in encoded {
            let previous = decode_snapshot_with_source(
                &encoded_snapshot,
                source_id.as_deref(),
                source.as_deref(),
            )?;
            let Some(stage_index) = previous
                .stages
                .iter()
                .position(|stage| stage.state != StageState::Succeeded)
            else {
                return Err(ComputeCoordinatorError::Protocol(
                    "active job has no recoverable stage boundary".into(),
                ));
            };
            let recovered_at_ms = recovered_at_ms.max(previous.updated_at_ms);
            let stage_id = previous.stages[stage_index].stage_id.clone();

            if previous.stages[stage_index].state == StageState::Interrupted {
                if previous.state != JobState::CancelRequested {
                    return Err(ComputeCoordinatorError::Protocol(
                        "only a cancellation request may retain interrupted stage evidence".into(),
                    ));
                }
                let mut successor = previous.clone();
                successor.revision += 1;
                successor.state = JobState::Cancelled;
                successor.updated_at_ms = recovered_at_ms;
                successor.finished_at_ms = Some(recovered_at_ms);
                successor.error = Some(ComputeFailure {
                    code: ComputeErrorCode::Cancelled,
                    message: "Cancellation completed during coordinator recovery.".into(),
                    stage_id: None,
                    molecule_stable_id: None,
                    retryable: false,
                });
                successor.progress.message = "Cancelled during coordinator recovery".into();
                self.apply_successor(&owner, previous.revision, &successor)?;
                recovered += 1;
                continue;
            }

            let failure = ComputeFailure {
                code: ComputeErrorCode::WorkerCrashed,
                message: "Compute worker stopped before the durable coordinator recovered.".into(),
                stage_id: Some(stage_id.clone()),
                molecule_stable_id: None,
                retryable: true,
            };
            let mut successor = previous.clone();
            successor.revision += 1;
            successor.state = JobState::Interrupted;
            successor.updated_at_ms = recovered_at_ms;
            successor.error = Some(failure.clone());
            successor.progress.message = "Interrupted during coordinator recovery".into();
            let stage_was_running = previous.stages[stage_index].state == StageState::Running;
            let attempt_index = if stage_was_running {
                previous
                    .attempts
                    .iter()
                    .rposition(|attempt| {
                        attempt.stage_id == stage_id && attempt.state == AttemptState::Running
                    })
                    .ok_or_else(|| {
                        ComputeCoordinatorError::Protocol(
                            "running stage lacks a running attempt during recovery".into(),
                        )
                    })?
            } else {
                let prior_attempt = previous
                    .attempts
                    .iter()
                    .rev()
                    .find(|attempt| attempt.stage_id == stage_id);
                let attempt_number = prior_attempt
                    .map(|attempt| {
                        attempt.attempt_number.checked_add(1).ok_or_else(|| {
                            ComputeCoordinatorError::Protocol(
                                "recovery attempt number overflowed".into(),
                            )
                        })
                    })
                    .transpose()?
                    .unwrap_or(1);
                let started_at_ms = previous.updated_at_ms;
                successor.stages[stage_index].started_at_ms = Some(started_at_ms);
                successor.attempts.push(AttemptSnapshot {
                    attempt_id: Uuid::new_v4(),
                    stage_id: stage_id.clone(),
                    attempt_number,
                    runtime_version: previous.pinned_runtime.version.clone(),
                    state: AttemptState::Interrupted,
                    started_at_ms,
                    heartbeat_at_ms: recovered_at_ms,
                    finished_at_ms: Some(recovered_at_ms),
                    error: Some(failure.clone()),
                    retry_reason: prior_attempt
                        .map(|_| "Coordinator recovery after interrupted retry".into()),
                });
                successor.attempts.len() - 1
            };
            let stage = &mut successor.stages[stage_index];
            stage.state = StageState::Interrupted;
            stage.progress.message = "Interrupted during coordinator recovery".into();
            stage.updated_at_ms = Some(recovered_at_ms);
            stage.finished_at_ms = Some(recovered_at_ms);
            stage.host_time_ms = stage
                .started_at_ms
                .map(|started| recovered_at_ms.saturating_sub(started) as f64);
            stage.error = Some(failure.clone());
            let attempt = &mut successor.attempts[attempt_index];
            if attempt.state == AttemptState::Running {
                attempt.state = AttemptState::Interrupted;
                attempt.heartbeat_at_ms = recovered_at_ms;
                attempt.finished_at_ms = Some(recovered_at_ms);
                attempt.error = Some(failure);
            }
            self.apply_successor(&owner, previous.revision, &successor)?;
            recovered += 1;
        }
        Ok(recovered)
    }
}
