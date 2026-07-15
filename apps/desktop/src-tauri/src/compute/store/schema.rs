use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

use crate::compute::error::{ComputeCoordinatorError, ComputeResult};

pub(super) const SCHEMA_VERSION: i64 = 1;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) fn configure(connection: &Connection) -> ComputeResult<()> {
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.pragma_update(None, "trusted_schema", false)?;
    Ok(())
}

pub(super) fn initialize(connection: &mut Connection) -> ComputeResult<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS compute_meta (
          key TEXT PRIMARY KEY NOT NULL,
          integer_value INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY NOT NULL,
          owner_principal TEXT NOT NULL,
          created_window_label TEXT NOT NULL,
          workflow_template TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN (
            'queued', 'preparing', 'waiting_gpu', 'running', 'validating',
            'publishing', 'cancel_requested', 'cancelled', 'failed',
            'interrupted', 'succeeded', 'succeeded_with_failures'
          )),
          revision INTEGER NOT NULL CHECK (revision > 0),
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
          updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
          finished_at_ms INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS stages (
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          stage_id TEXT NOT NULL,
          state TEXT NOT NULL,
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          PRIMARY KEY (job_id, ordinal),
          UNIQUE (job_id, stage_id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS attempts (
          attempt_id TEXT PRIMARY KEY NOT NULL,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          stage_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
          state TEXT NOT NULL,
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          UNIQUE (job_id, stage_id, attempt_number)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS artifacts (
          artifact_id TEXT PRIMARY KEY NOT NULL,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          publication_state TEXT NOT NULL CHECK (publication_state IN (
            'staging', 'renamed', 'published', 'corrupt'
          )),
          relative_directory TEXT NOT NULL,
          manifest_json TEXT CHECK (manifest_json IS NULL OR json_valid(manifest_json)),
          created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
          published_at_ms INTEGER,
          CHECK (
            (publication_state = 'staging'
              AND manifest_json IS NULL
              AND published_at_ms IS NULL)
            OR (publication_state = 'renamed'
              AND manifest_json IS NOT NULL
              AND published_at_ms IS NULL)
            OR (publication_state = 'published'
              AND manifest_json IS NOT NULL
              AND published_at_ms IS NOT NULL
              AND published_at_ms >= created_at_ms)
            OR (publication_state = 'corrupt'
              AND published_at_ms IS NULL)
          )
        ) STRICT;

        CREATE TABLE IF NOT EXISTS artifact_files (
          artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
          media_type TEXT NOT NULL,
          PRIMARY KEY (artifact_id, relative_path)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS artifact_refs (
          artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
          ref_kind TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
          created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
          PRIMARY KEY (artifact_id, ref_kind, ref_id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS events (
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          emitted_at_ms INTEGER NOT NULL CHECK (emitted_at_ms >= 0),
          PRIMARY KEY (job_id, revision)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS jobs_owner_updated_idx
          ON jobs(owner_principal, updated_at_ms DESC, job_id);
        CREATE INDEX IF NOT EXISTS attempts_job_stage_idx
          ON attempts(job_id, stage_id, attempt_number);
        CREATE INDEX IF NOT EXISTS artifacts_job_idx
          ON artifacts(job_id, created_at_ms DESC);
        CREATE INDEX IF NOT EXISTS artifact_refs_pinned_idx
          ON artifact_refs(artifact_id, pinned);
        ",
    )?;

    let existing = transaction
        .query_row(
            "SELECT integer_value FROM compute_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    match existing {
        Some(version) if version > SCHEMA_VERSION => {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "compute database schema {version} is newer than supported schema {SCHEMA_VERSION}"
            )));
        }
        Some(version) if version < SCHEMA_VERSION => {
            return Err(ComputeCoordinatorError::Unavailable(format!(
                "compute database schema {version} has no registered migration to {SCHEMA_VERSION}"
            )));
        }
        Some(_) => {}
        None => {
            transaction.execute(
                "INSERT INTO compute_meta(key, integer_value) VALUES ('schema_version', ?1)",
                [SCHEMA_VERSION],
            )?;
        }
    }
    transaction.commit()?;
    Ok(())
}
