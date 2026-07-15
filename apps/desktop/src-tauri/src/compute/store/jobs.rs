use burrete_compute_protocol::{
    ComputeJobEventSchemaVersion, JobRevisionEvent, JobSnapshot, JobState, OwnerSurface,
};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use uuid::Uuid;

use super::snapshot_intents::{delete_renamed_intent, require_renamed_intent};
use super::{
    decode_snapshot_with_source,
    events::{insert_event, prune_events},
    owner_principal_for_window, to_json, ComputeCoordinatorError, ComputeResult, ComputeStore,
};

const MAX_LIST_LIMIT: usize = 100;

impl ComputeStore {
    #[allow(
        dead_code,
        reason = "only the Stage 3 transactional Grid snapshot resolver may admit prepared jobs"
    )]
    pub(crate) fn insert_prepared_job(
        &self,
        owner_window_label: &str,
        snapshot: &JobSnapshot,
        snapshot_attempt_id: Uuid,
    ) -> ComputeResult<JobRevisionEvent> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        snapshot.validate()?;
        if snapshot.owner_surface != OwnerSurface::Desktop {
            return Err(ComputeCoordinatorError::Forbidden(
                "Tauri compute jobs must use the desktop owner surface".into(),
            ));
        }
        if snapshot.revision != 1 || snapshot.state != JobState::Queued {
            return Err(ComputeCoordinatorError::Validation(
                "new compute jobs must begin as revision 1 in queued state".into(),
            ));
        }

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(event) = resolve_existing_prepared_job(&transaction, owner_principal, snapshot)?
        {
            transaction.commit()?;
            return Ok(event);
        }
        let intent = require_renamed_intent(
            &transaction,
            snapshot.frozen_source.snapshot_id,
            snapshot.job_id,
            snapshot_attempt_id,
            &snapshot.frozen_source,
        )?;
        insert_job_row(&transaction, owner_principal, owner_window_label, snapshot)?;
        insert_source_snapshot_row(&transaction, snapshot)?;
        replace_child_rows(&transaction, snapshot)?;
        let event = insert_event(&transaction, snapshot)?;
        delete_renamed_intent(&transaction, &intent)?;
        transaction.commit()?;
        Ok(event)
    }

    pub(crate) fn get_job(
        &self,
        owner_window_label: &str,
        job_id: Uuid,
    ) -> ComputeResult<JobSnapshot> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        let connection = self.open_connection()?;
        let encoded = connection
            .query_row(
                "SELECT jobs.snapshot_json,
                        job_source_snapshots.snapshot_id,
                        job_source_snapshots.snapshot_ref_json
                 FROM jobs
                 LEFT JOIN job_source_snapshots
                   ON job_source_snapshots.job_id = jobs.job_id
                 WHERE jobs.job_id = ?1 AND jobs.owner_principal = ?2",
                params![job_id.to_string(), owner_principal],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| job_not_found(job_id))?;
        decode_snapshot_with_source(&encoded.0, encoded.1.as_deref(), encoded.2.as_deref())
    }

    pub(crate) fn list_jobs(
        &self,
        owner_window_label: &str,
        limit: usize,
    ) -> ComputeResult<Vec<JobSnapshot>> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        if !(1..=MAX_LIST_LIMIT).contains(&limit) {
            return Err(ComputeCoordinatorError::Validation(format!(
                "compute job list limit must be in 1..={MAX_LIST_LIMIT}"
            )));
        }
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT jobs.snapshot_json,
                    job_source_snapshots.snapshot_id,
                    job_source_snapshots.snapshot_ref_json
             FROM jobs
             LEFT JOIN job_source_snapshots
               ON job_source_snapshots.job_id = jobs.job_id
             WHERE jobs.owner_principal = ?1
             ORDER BY jobs.updated_at_ms DESC, jobs.job_id ASC
             LIMIT ?2",
        )?;
        let encoded = statement
            .query_map(params![owner_principal, limit as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        encoded
            .iter()
            .map(|(snapshot, source_id, source)| {
                decode_snapshot_with_source(snapshot, source_id.as_deref(), source.as_deref())
            })
            .collect()
    }

    pub(crate) fn apply_successor(
        &self,
        owner_window_label: &str,
        expected_revision: u64,
        successor: &JobSnapshot,
    ) -> ComputeResult<JobRevisionEvent> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous = load_snapshot(&transaction, owner_principal, successor.job_id)?;
        if previous.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: previous.revision,
            });
        }
        successor.validate_successor(&previous)?;

        let updated = transaction.execute(
            "UPDATE jobs
             SET workflow_template = ?1, state = ?2, revision = ?3,
                 snapshot_json = ?4, updated_at_ms = ?5, finished_at_ms = ?6
             WHERE job_id = ?7 AND owner_principal = ?8 AND revision = ?9",
            params![
                super::enum_string(&successor.workflow_template)?,
                super::enum_string(&successor.state)?,
                successor.revision as i64,
                to_json(successor)?,
                successor.updated_at_ms as i64,
                successor.finished_at_ms.map(|value| value as i64),
                successor.job_id.to_string(),
                owner_principal,
                expected_revision as i64,
            ],
        )?;
        if updated != 1 {
            let actual_revision = load_revision(&transaction, owner_principal, successor.job_id)?;
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision,
            });
        }

        replace_child_rows(&transaction, successor)?;
        let event = insert_event(&transaction, successor)?;
        prune_events(&transaction, successor.job_id)?;
        transaction.commit()?;
        Ok(event)
    }

    pub(crate) fn request_cancel(
        &self,
        owner_window_label: &str,
        job_id: Uuid,
        expected_revision: u64,
        requested_at_ms: u64,
    ) -> ComputeResult<JobRevisionEvent> {
        let previous = self.get_job(owner_window_label, job_id)?;
        if previous.revision != expected_revision {
            return Err(ComputeCoordinatorError::Conflict {
                expected_revision,
                actual_revision: previous.revision,
            });
        }
        if previous.state == JobState::CancelRequested {
            return Ok(JobRevisionEvent {
                schema_version: burrete_compute_protocol::ComputeJobEventSchemaVersion::V1,
                job_id,
                revision: previous.revision,
                emitted_at_ms: previous.updated_at_ms,
            });
        }
        if previous.state.is_terminal() {
            return Err(ComputeCoordinatorError::Validation(
                "terminal compute jobs cannot be cancelled".into(),
            ));
        }

        let mut successor = previous.clone();
        successor.revision = previous.revision + 1;
        successor.state = JobState::CancelRequested;
        successor.updated_at_ms = requested_at_ms.max(previous.updated_at_ms);
        successor.finished_at_ms = None;
        successor.error = None;
        successor.progress.message = "Cancellation requested".into();
        self.apply_successor(owner_window_label, expected_revision, &successor)
    }

    pub(crate) fn purge_job(&self, owner_window_label: &str, job_id: Uuid) -> ComputeResult<()> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = load_snapshot(&transaction, owner_principal, job_id)?;
        if !snapshot.state.is_terminal() {
            return Err(ComputeCoordinatorError::Validation(
                "only terminal compute jobs may be purged".into(),
            ));
        }
        let artifact_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM artifacts WHERE job_id = ?1",
            [job_id.to_string()],
            |row| row.get(0),
        )?;
        if artifact_count != 0 {
            return Err(ComputeCoordinatorError::Forbidden(
                "compute job artifacts require coordinated filesystem cleanup before purge".into(),
            ));
        }
        transaction.execute(
            "DELETE FROM jobs WHERE job_id = ?1 AND owner_principal = ?2",
            params![job_id.to_string(), owner_principal],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

#[allow(
    dead_code,
    reason = "job insertion remains unreachable until the Stage 3 Grid snapshot resolver is atomic"
)]
pub(super) fn insert_job_row(
    transaction: &Transaction<'_>,
    owner_principal: &str,
    created_window_label: &str,
    snapshot: &JobSnapshot,
) -> ComputeResult<()> {
    transaction.execute(
        "INSERT INTO jobs(
           job_id, owner_principal, created_window_label, workflow_template, state,
           revision, snapshot_json, created_at_ms, updated_at_ms, finished_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            snapshot.job_id.to_string(),
            owner_principal,
            created_window_label,
            super::enum_string(&snapshot.workflow_template)?,
            super::enum_string(&snapshot.state)?,
            snapshot.revision as i64,
            to_json(snapshot)?,
            snapshot.created_at_ms as i64,
            snapshot.updated_at_ms as i64,
            snapshot.finished_at_ms.map(|value| value as i64),
        ],
    )?;
    Ok(())
}

pub(super) fn insert_source_snapshot_row(
    transaction: &Transaction<'_>,
    snapshot: &JobSnapshot,
) -> ComputeResult<()> {
    transaction.execute(
        "INSERT INTO job_source_snapshots(job_id, snapshot_id, snapshot_ref_json)
         VALUES (?1, ?2, ?3)",
        params![
            snapshot.job_id.to_string(),
            snapshot.frozen_source.snapshot_id.to_string(),
            to_json(&snapshot.frozen_source)?,
        ],
    )?;
    Ok(())
}

pub(super) fn replace_child_rows(
    transaction: &Transaction<'_>,
    snapshot: &JobSnapshot,
) -> ComputeResult<()> {
    let job_id = snapshot.job_id.to_string();
    transaction.execute("DELETE FROM attempts WHERE job_id = ?1", [&job_id])?;
    transaction.execute("DELETE FROM stages WHERE job_id = ?1", [&job_id])?;
    for stage in &snapshot.stages {
        transaction.execute(
            "INSERT INTO stages(job_id, ordinal, stage_id, state, snapshot_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                job_id,
                stage.ordinal as i64,
                stage.stage_id,
                super::enum_string(&stage.state)?,
                to_json(stage)?,
            ],
        )?;
    }
    for attempt in &snapshot.attempts {
        transaction.execute(
            "INSERT INTO attempts(
               attempt_id, job_id, stage_id, attempt_number, state, snapshot_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                attempt.attempt_id.to_string(),
                job_id,
                attempt.stage_id,
                attempt.attempt_number as i64,
                super::enum_string(&attempt.state)?,
                to_json(attempt)?,
            ],
        )?;
    }
    Ok(())
}

fn load_snapshot(
    transaction: &Transaction<'_>,
    owner_principal: &str,
    job_id: Uuid,
) -> ComputeResult<JobSnapshot> {
    load_snapshot_if_present(transaction, owner_principal, job_id)?
        .ok_or_else(|| job_not_found(job_id))
}

fn load_snapshot_if_present(
    transaction: &Transaction<'_>,
    owner_principal: &str,
    job_id: Uuid,
) -> ComputeResult<Option<JobSnapshot>> {
    let encoded = transaction
        .query_row(
            "SELECT jobs.snapshot_json,
                    job_source_snapshots.snapshot_id,
                    job_source_snapshots.snapshot_ref_json
             FROM jobs
             LEFT JOIN job_source_snapshots
               ON job_source_snapshots.job_id = jobs.job_id
             WHERE jobs.job_id = ?1 AND jobs.owner_principal = ?2",
            params![job_id.to_string(), owner_principal],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    encoded
        .map(|encoded| {
            decode_snapshot_with_source(&encoded.0, encoded.1.as_deref(), encoded.2.as_deref())
        })
        .transpose()
}

fn resolve_existing_prepared_job(
    transaction: &Transaction<'_>,
    owner_principal: &str,
    candidate: &JobSnapshot,
) -> ComputeResult<Option<JobRevisionEvent>> {
    let Some(existing) = load_snapshot_if_present(transaction, owner_principal, candidate.job_id)?
    else {
        return Ok(None);
    };
    if existing != *candidate {
        return Err(ComputeCoordinatorError::Validation(format!(
            "compute job {} is already committed with different durable state",
            candidate.job_id
        )));
    }
    let emitted_at_ms = transaction
        .query_row(
            "SELECT emitted_at_ms FROM events WHERE job_id = ?1 AND revision = ?2",
            params![candidate.job_id.to_string(), candidate.revision as i64],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| {
            ComputeCoordinatorError::Protocol(format!(
                "idempotently committed job {} is missing its revision event",
                candidate.job_id
            ))
        })?;
    let emitted_at_ms = u64::try_from(emitted_at_ms).map_err(|_| {
        ComputeCoordinatorError::Protocol(format!(
            "idempotently committed job {} has a negative event timestamp",
            candidate.job_id
        ))
    })?;
    let event = JobRevisionEvent {
        schema_version: ComputeJobEventSchemaVersion::V1,
        job_id: candidate.job_id,
        revision: candidate.revision,
        emitted_at_ms,
    };
    event.validate()?;
    Ok(Some(event))
}

fn load_revision(
    transaction: &Transaction<'_>,
    owner_principal: &str,
    job_id: Uuid,
) -> ComputeResult<u64> {
    transaction
        .query_row(
            "SELECT revision FROM jobs WHERE job_id = ?1 AND owner_principal = ?2",
            params![job_id.to_string(), owner_principal],
            |row| row.get::<_, i64>(0).map(|revision| revision as u64),
        )
        .optional()?
        .ok_or_else(|| job_not_found(job_id))
}

fn job_not_found(job_id: Uuid) -> ComputeCoordinatorError {
    ComputeCoordinatorError::NotFound {
        entity: "compute job",
        id: job_id.to_string(),
    }
}
