use std::collections::BTreeMap;

use burette_compute_protocol::{MolecularSnapshotRef, MAX_CONTROL_FRAME_BYTES};
use rusqlite::TransactionBehavior;
use uuid::Uuid;

use super::{
    decode_snapshot_with_source,
    snapshot_intents::{load_snapshot_intents_for_reconciliation, SnapshotIntentRecord},
    ComputeCoordinatorError, ComputeResult, ComputeStore,
};

const MAX_COMMITTED_JOB_ROWS: usize = 4_096;
const MAX_RECONCILIATION_JSON_BYTES: usize = 64 * MAX_CONTROL_FRAME_BYTES;

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(
    dead_code,
    reason = "the startup snapshot repository consumes this state in the next integration slice"
)]
pub(crate) struct SnapshotReconciliationState {
    pub(crate) intents: Vec<SnapshotIntentRecord>,
    pub(crate) committed_sources: BTreeMap<Uuid, MolecularSnapshotRef>,
}

impl ComputeStore {
    /// Captures the complete bounded database side of startup reconciliation in
    /// one SQLite snapshot. The coordinator holds the process root lease and is
    /// not yet accepting submissions when this method is called.
    #[allow(
        dead_code,
        reason = "the startup snapshot repository consumes this state in the next integration slice"
    )]
    pub(crate) fn snapshot_reconciliation_state(
        &self,
    ) -> ComputeResult<SnapshotReconciliationState> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let intents = load_snapshot_intents_for_reconciliation(&transaction)?;

        let (row_count, largest_job_json, largest_source_json, aggregate_json) = transaction
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(MAX(length(CAST(jobs.snapshot_json AS BLOB))), 0),
                        COALESCE(MAX(COALESCE(length(CAST(job_source_snapshots.snapshot_ref_json AS BLOB)), 0)), 0),
                        COALESCE(SUM(
                          length(CAST(jobs.snapshot_json AS BLOB))
                          + COALESCE(length(CAST(job_source_snapshots.snapshot_ref_json AS BLOB)), 0)
                        ), 0)
                 FROM jobs
                 LEFT JOIN job_source_snapshots
                   ON job_source_snapshots.job_id = jobs.job_id",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )?;
        let row_count = decode_nonnegative_usize("committed job count", row_count)?;
        if row_count > MAX_COMMITTED_JOB_ROWS {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "snapshot reconciliation has {row_count} committed jobs, exceeding the supported bound of {MAX_COMMITTED_JOB_ROWS}"
            )));
        }
        validate_json_bytes("largest committed job snapshot", largest_job_json)?;
        validate_json_bytes("largest committed source reference", largest_source_json)?;
        let aggregate_json =
            decode_nonnegative_usize("committed reconciliation JSON bytes", aggregate_json)?;
        if aggregate_json > MAX_RECONCILIATION_JSON_BYTES {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "snapshot reconciliation requires {aggregate_json} JSON bytes, exceeding the supported bound of {MAX_RECONCILIATION_JSON_BYTES}"
            )));
        }

        let mut statement = transaction.prepare(
            "SELECT jobs.job_id, jobs.snapshot_json,
                    job_source_snapshots.snapshot_id,
                    job_source_snapshots.snapshot_ref_json
             FROM jobs
             LEFT JOIN job_source_snapshots
               ON job_source_snapshots.job_id = jobs.job_id
             ORDER BY jobs.job_id ASC",
        )?;
        let mut committed_sources = BTreeMap::new();
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let encoded_job_id = row.get::<_, String>(0)?;
            let encoded_snapshot = row.get::<_, String>(1)?;
            let encoded_source_id = row.get::<_, Option<String>>(2)?;
            let encoded_source = row.get::<_, Option<String>>(3)?;
            let job_id = parse_canonical_uuid("committed job ID", &encoded_job_id)?;
            let snapshot = decode_snapshot_with_source(
                &encoded_snapshot,
                encoded_source_id.as_deref(),
                encoded_source.as_deref(),
            )?;
            if snapshot.job_id != job_id {
                return Err(ComputeCoordinatorError::Protocol(format!(
                    "committed job row {job_id} contains a different snapshot job ID"
                )));
            }
            let snapshot_id = snapshot.frozen_source.snapshot_id;
            let reference = snapshot.frozen_source;
            if committed_sources
                .insert(snapshot_id, reference.clone())
                .is_some_and(|existing| existing != reference)
            {
                return Err(ComputeCoordinatorError::Protocol(format!(
                    "committed jobs disagree about immutable snapshot {snapshot_id}"
                )));
            }
        }
        drop(rows);
        drop(statement);
        transaction.commit()?;
        Ok(SnapshotReconciliationState {
            intents,
            committed_sources,
        })
    }
}

fn parse_canonical_uuid(label: &str, encoded: &str) -> ComputeResult<Uuid> {
    let parsed = Uuid::parse_str(encoded).map_err(|_| {
        ComputeCoordinatorError::Protocol(format!("{label} is not a canonical UUID"))
    })?;
    if parsed.is_nil() || parsed.to_string() != encoded {
        return Err(ComputeCoordinatorError::Protocol(format!(
            "{label} is not a canonical non-nil UUID"
        )));
    }
    Ok(parsed)
}

fn validate_json_bytes(label: &str, value: i64) -> ComputeResult<()> {
    let value = decode_nonnegative_usize(label, value)?;
    if value > MAX_CONTROL_FRAME_BYTES {
        return Err(ComputeCoordinatorError::Unavailable(format!(
            "{label} requires {value} bytes, exceeding the supported bound of {MAX_CONTROL_FRAME_BYTES}"
        )));
    }
    Ok(())
}

fn decode_nonnegative_usize(label: &str, value: i64) -> ComputeResult<usize> {
    usize::try_from(value).map_err(|_| {
        ComputeCoordinatorError::Protocol(format!(
            "{label} is negative or cannot be represented in memory"
        ))
    })
}
