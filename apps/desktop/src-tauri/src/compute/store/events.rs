use burette_compute_protocol::{ComputeJobEventSchemaVersion, JobRevisionEvent, JobSnapshot};
use rusqlite::{params, Transaction};
use uuid::Uuid;

use super::{owner_principal_for_window, ComputeCoordinatorError, ComputeResult, ComputeStore};

const MAX_EVENT_LIMIT: usize = 256;
const MAX_RETAINED_EVENTS_PER_JOB: i64 = 256;

impl ComputeStore {
    #[allow(
        dead_code,
        reason = "the Stage 3 watch adapter consumes durable job-scoped revision events"
    )]
    pub(crate) fn events_since(
        &self,
        owner_window_label: &str,
        job_id: Uuid,
        after_revision: u64,
        limit: usize,
    ) -> ComputeResult<Vec<JobRevisionEvent>> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        if !(1..=MAX_EVENT_LIMIT).contains(&limit) {
            return Err(ComputeCoordinatorError::Validation(format!(
                "compute event limit must be in 1..={MAX_EVENT_LIMIT}"
            )));
        }
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT events.job_id, events.revision, events.emitted_at_ms
             FROM events
             INNER JOIN jobs ON jobs.job_id = events.job_id
             WHERE jobs.owner_principal = ?1
               AND events.job_id = ?2
               AND events.revision > ?3
             ORDER BY events.revision ASC
             LIMIT ?4",
        )?;
        let events = statement
            .query_map(
                params![
                    owner_principal,
                    job_id.to_string(),
                    after_revision as i64,
                    limit as i64
                ],
                |row| {
                    let job_id = row.get::<_, String>(0)?;
                    Ok((
                        job_id,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? as u64,
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        events
            .into_iter()
            .map(|(job_id, revision, emitted_at_ms)| {
                let event = JobRevisionEvent {
                    schema_version: ComputeJobEventSchemaVersion::V1,
                    job_id: Uuid::parse_str(&job_id).map_err(|error| {
                        ComputeCoordinatorError::Serialization(error.to_string())
                    })?,
                    revision,
                    emitted_at_ms,
                };
                event.validate()?;
                Ok(event)
            })
            .collect()
    }
}

pub(super) fn insert_event(
    transaction: &Transaction<'_>,
    snapshot: &JobSnapshot,
) -> ComputeResult<JobRevisionEvent> {
    let event = JobRevisionEvent {
        schema_version: ComputeJobEventSchemaVersion::V1,
        job_id: snapshot.job_id,
        revision: snapshot.revision,
        emitted_at_ms: snapshot.updated_at_ms,
    };
    event.validate()?;
    transaction.execute(
        "INSERT INTO events(job_id, revision, emitted_at_ms) VALUES (?1, ?2, ?3)",
        params![
            event.job_id.to_string(),
            event.revision as i64,
            event.emitted_at_ms as i64,
        ],
    )?;
    Ok(event)
}

pub(super) fn prune_events(transaction: &Transaction<'_>, job_id: Uuid) -> ComputeResult<()> {
    transaction.execute(
        "DELETE FROM events
         WHERE job_id = ?1 AND revision NOT IN (
           SELECT revision FROM events WHERE job_id = ?1
           ORDER BY revision DESC LIMIT ?2
         )",
        params![job_id.to_string(), MAX_RETAINED_EVENTS_PER_JOB],
    )?;
    Ok(())
}
