use std::collections::BTreeMap;

use burrete_compute_protocol::{ArtifactManifest, JobRevisionEvent, JobSnapshot};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use uuid::Uuid;

use super::{
    decode_snapshot_with_source,
    events::{insert_event, prune_events},
    jobs::{load_revision, load_snapshot, replace_child_rows},
    owner_principal_for_window, to_json, ComputeCoordinatorError, ComputeResult, ComputeStore,
};

impl ComputeStore {
    pub(crate) fn published_artifact_inventory(
        &self,
    ) -> ComputeResult<BTreeMap<String, ArtifactManifest>> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT artifacts.relative_directory, artifacts.manifest_json,
                    jobs.snapshot_json, job_source_snapshots.snapshot_id,
                    job_source_snapshots.snapshot_ref_json
             FROM artifacts
             INNER JOIN jobs ON jobs.job_id = artifacts.job_id
             LEFT JOIN job_source_snapshots
               ON job_source_snapshots.job_id = jobs.job_id
             WHERE publication_state = 'published'
             ORDER BY artifacts.relative_directory",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut inventory = BTreeMap::new();
        for row in rows {
            let (directory, manifest_json, snapshot_json, snapshot_id, snapshot_ref_json) = row?;
            if inventory.len() >= 4_096 {
                return Err(ComputeCoordinatorError::Unavailable(
                    "published compute artifact inventory exceeds the recovery bound".into(),
                ));
            }
            let manifest_json = manifest_json.ok_or_else(|| {
                ComputeCoordinatorError::Unavailable(
                    "published compute artifact is missing its durable manifest".into(),
                )
            })?;
            let manifest: ArtifactManifest = serde_json::from_str(&manifest_json)?;
            let job = decode_snapshot_with_source(
                &snapshot_json,
                snapshot_id.as_deref(),
                snapshot_ref_json.as_deref(),
            )?;
            manifest.validate_against_job(&job)?;
            if inventory.insert(directory, manifest).is_some() {
                return Err(ComputeCoordinatorError::Unavailable(
                    "published compute artifact directory is duplicated".into(),
                ));
            }
        }
        Ok(inventory)
    }

    pub(crate) fn commit_published_artifact(
        &self,
        owner_window_label: &str,
        expected_revision: u64,
        successor: &JobSnapshot,
        manifest: &ArtifactManifest,
        relative_directory: &str,
    ) -> ComputeResult<JobRevisionEvent> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        successor.validate()?;
        manifest.validate_against_job(successor)?;
        let expected_directory = format!("artifacts/artifact-{}", manifest.artifact_id);
        if relative_directory != expected_directory {
            return Err(ComputeCoordinatorError::Validation(
                "artifact directory does not match its immutable artifact ID".into(),
            ));
        }

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
        transaction.execute(
            "INSERT INTO artifacts(
               artifact_id, job_id, publication_state, relative_directory,
               manifest_json, created_at_ms, published_at_ms
             ) VALUES (?1, ?2, 'published', ?3, ?4, ?5, ?5)",
            params![
                manifest.artifact_id.to_string(),
                successor.job_id.to_string(),
                relative_directory,
                to_json(manifest)?,
                manifest.created_at_ms as i64,
            ],
        )?;
        {
            let mut statement = transaction.prepare(
                "INSERT INTO artifact_files(
                   artifact_id, relative_path, sha256, byte_count, media_type
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for file in &manifest.files {
                statement.execute(params![
                    manifest.artifact_id.to_string(),
                    file.relative_path,
                    file.sha256,
                    file.byte_count as i64,
                    file.media_type,
                ])?;
            }
        }
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

    pub(crate) fn get_artifact_manifest(
        &self,
        owner_window_label: &str,
        artifact_id: Uuid,
    ) -> ComputeResult<ArtifactManifest> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        let connection = self.open_connection()?;
        let row = connection
            .query_row(
                "SELECT artifacts.manifest_json, jobs.snapshot_json,
                        job_source_snapshots.snapshot_id,
                        job_source_snapshots.snapshot_ref_json
                 FROM artifacts
                 INNER JOIN jobs ON jobs.job_id = artifacts.job_id
                 LEFT JOIN job_source_snapshots
                   ON job_source_snapshots.job_id = jobs.job_id
                 WHERE artifacts.artifact_id = ?1
                   AND artifacts.publication_state = 'published'
                   AND jobs.owner_principal = ?2",
                params![artifact_id.to_string(), owner_principal],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| artifact_not_found(artifact_id))?;
        let manifest_json = row.0.ok_or_else(|| {
            ComputeCoordinatorError::Unavailable(
                "published compute artifact is missing its durable manifest".into(),
            )
        })?;
        let manifest: ArtifactManifest = serde_json::from_str(&manifest_json)?;
        let job = decode_snapshot_with_source(&row.1, row.2.as_deref(), row.3.as_deref())?;
        manifest.validate_against_job(&job)?;
        Ok(manifest)
    }
}

fn artifact_not_found(artifact_id: Uuid) -> ComputeCoordinatorError {
    ComputeCoordinatorError::NotFound {
        entity: "compute artifact",
        id: artifact_id.to_string(),
    }
}
