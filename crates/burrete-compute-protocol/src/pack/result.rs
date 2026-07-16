use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    common::{validate_json_safe, validate_sha256, validate_uuid, MAX_ENGINE_PACK_REFS},
    engine::EnginePackRef,
    layout::{PackedFileDescriptor, PackedLayout},
    molecular::MolecularSnapshotRef,
};
use crate::{ProtocolError, ResultPackVersion, WorkflowTemplateId};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultPackManifest {
    pub schema_version: ResultPackVersion,
    pub result_pack_id: Uuid,
    pub result_pack_sha256: String,
    pub job_id: Uuid,
    pub workflow_template: WorkflowTemplateId,
    pub molecular_snapshot: MolecularSnapshotRef,
    pub engine_packs: Vec<EnginePackRef>,
    pub layout: PackedLayout,
    pub created_at_ms: u64,
}

impl ResultPackManifest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_compatibility(self.workflow_template, self.schema_version)?;
        validate_uuid("result pack ID", self.result_pack_id)?;
        validate_uuid("result pack job ID", self.job_id)?;
        validate_sha256("result pack", &self.result_pack_sha256)?;
        self.molecular_snapshot.validate()?;
        validate_json_safe("result pack creation time", self.created_at_ms)?;
        if self.engine_packs.is_empty() || self.engine_packs.len() > MAX_ENGINE_PACK_REFS {
            return Err(ProtocolError::Validation(format!(
                "result pack requires 1..={MAX_ENGINE_PACK_REFS} engine pack references"
            )));
        }
        let reserved_paths = self.validate_engine_refs()?;
        self.layout.validate()?;
        for path in reserved_paths {
            self.layout.reject_file_path(path, "referenced manifest")?;
        }
        Ok(())
    }

    fn validate_engine_refs(&self) -> Result<BTreeSet<&str>, ProtocolError> {
        let mut engine_ids = BTreeSet::new();
        let mut reserved_paths =
            BTreeSet::from([self.molecular_snapshot.manifest.relative_path.as_str()]);
        for engine in &self.engine_packs {
            engine.validate()?;
            if !engine_ids.insert(engine.engine_pack_id) {
                return Err(ProtocolError::Validation(format!(
                    "duplicate engine pack reference: {}",
                    engine.engine_pack_id
                )));
            }
            if engine.workflow_template != self.workflow_template
                || engine.snapshot_id != self.molecular_snapshot.snapshot_id
                || engine.snapshot_sha256 != self.molecular_snapshot.snapshot_sha256
            {
                return Err(ProtocolError::Validation(
                    "result pack engine reference differs from its workflow or frozen snapshot"
                        .into(),
                ));
            }
            if !reserved_paths.insert(engine.manifest.relative_path.as_str()) {
                return Err(ProtocolError::Validation(format!(
                    "duplicate referenced manifest path: {}",
                    engine.manifest.relative_path
                )));
            }
        }
        Ok(reserved_paths)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultPackRef {
    pub schema_version: ResultPackVersion,
    pub result_pack_id: Uuid,
    pub result_pack_sha256: String,
    pub job_id: Uuid,
    pub workflow_template: WorkflowTemplateId,
    pub snapshot_id: Uuid,
    pub snapshot_sha256: String,
    pub manifest: PackedFileDescriptor,
}

impl ResultPackRef {
    pub fn from_manifest(
        manifest: &ResultPackManifest,
        manifest_file: PackedFileDescriptor,
    ) -> Result<Self, ProtocolError> {
        manifest.validate()?;
        let reference = Self {
            schema_version: manifest.schema_version,
            result_pack_id: manifest.result_pack_id,
            result_pack_sha256: manifest.result_pack_sha256.clone(),
            job_id: manifest.job_id,
            workflow_template: manifest.workflow_template,
            snapshot_id: manifest.molecular_snapshot.snapshot_id,
            snapshot_sha256: manifest.molecular_snapshot.snapshot_sha256.clone(),
            manifest: manifest_file,
        };
        reference.validate_against_manifest(manifest)?;
        Ok(reference)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_compatibility(self.workflow_template, self.schema_version)?;
        validate_uuid("result pack ID", self.result_pack_id)?;
        validate_uuid("result pack job ID", self.job_id)?;
        validate_uuid("result pack snapshot ID", self.snapshot_id)?;
        validate_sha256("result pack", &self.result_pack_sha256)?;
        validate_sha256("result pack snapshot", &self.snapshot_sha256)?;
        self.manifest.validate_manifest("result pack manifest")
    }

    pub fn validate_against_manifest(
        &self,
        manifest: &ResultPackManifest,
    ) -> Result<(), ProtocolError> {
        self.validate()?;
        manifest.validate()?;
        if self.schema_version != manifest.schema_version
            || self.result_pack_id != manifest.result_pack_id
            || self.result_pack_sha256 != manifest.result_pack_sha256
            || self.job_id != manifest.job_id
            || self.workflow_template != manifest.workflow_template
            || self.snapshot_id != manifest.molecular_snapshot.snapshot_id
            || self.snapshot_sha256 != manifest.molecular_snapshot.snapshot_sha256
        {
            return Err(ProtocolError::Validation(
                "result pack reference differs from its manifest identity".into(),
            ));
        }
        manifest
            .layout
            .reject_file_path(&self.manifest.relative_path, "result pack manifest")
    }
}

fn validate_compatibility(
    workflow: WorkflowTemplateId,
    version: ResultPackVersion,
) -> Result<(), ProtocolError> {
    match (workflow, version) {
        (WorkflowTemplateId::ClusterV1, ResultPackVersion::ClusterV1) => Ok(()),
        _ => Err(ProtocolError::Validation(
            "cluster result packs are compatible only with cluster.v1".into(),
        )),
    }
}
