use burrete_compute_protocol::ArtifactManifest;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::{
    decode_snapshot, owner_principal_for_window, ComputeCoordinatorError, ComputeResult,
    ComputeStore,
};

impl ComputeStore {
    pub(crate) fn get_artifact_manifest(
        &self,
        owner_window_label: &str,
        artifact_id: Uuid,
    ) -> ComputeResult<ArtifactManifest> {
        let owner_principal = owner_principal_for_window(owner_window_label)?;
        let connection = self.open_connection()?;
        let row = connection
            .query_row(
                "SELECT artifacts.manifest_json, jobs.snapshot_json
                 FROM artifacts
                 INNER JOIN jobs ON jobs.job_id = artifacts.job_id
                 WHERE artifacts.artifact_id = ?1
                   AND artifacts.publication_state = 'published'
                   AND jobs.owner_principal = ?2",
                params![artifact_id.to_string(), owner_principal],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| artifact_not_found(artifact_id))?;
        let manifest_json = row.0.ok_or_else(|| {
            ComputeCoordinatorError::Unavailable(
                "published compute artifact is missing its durable manifest".into(),
            )
        })?;
        let manifest: ArtifactManifest = serde_json::from_str(&manifest_json)?;
        let job = decode_snapshot(&row.1)?;
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
