use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    common::{
        validate_json_safe, validate_label, validate_sha256, validate_uuid, EnginePackVersion,
        MAX_LABEL_BYTES,
    },
    layout::{PackedFileDescriptor, PackedLayout},
    molecular::MolecularSnapshotRef,
};
use crate::{ProtocolError, WorkflowTemplateId};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnginePackManifest {
    pub schema_version: EnginePackVersion,
    pub engine_pack_id: Uuid,
    pub engine_pack_sha256: String,
    pub workflow_template: WorkflowTemplateId,
    pub molecular_snapshot: MolecularSnapshotRef,
    pub engine_id: String,
    pub engine_version: String,
    pub normalized_settings_sha256: String,
    pub layout: PackedLayout,
    pub created_at_ms: u64,
}

impl EnginePackManifest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_compatibility(self.workflow_template, self.schema_version)?;
        validate_uuid("engine pack ID", self.engine_pack_id)?;
        validate_sha256("engine pack", &self.engine_pack_sha256)?;
        self.molecular_snapshot.validate()?;
        validate_label("engine ID", &self.engine_id, MAX_LABEL_BYTES)?;
        validate_label("engine version", &self.engine_version, MAX_LABEL_BYTES)?;
        validate_sha256(
            "normalized engine settings",
            &self.normalized_settings_sha256,
        )?;
        validate_json_safe("engine pack creation time", self.created_at_ms)?;
        self.layout.validate()?;
        self.layout.reject_file_path(
            &self.molecular_snapshot.manifest.relative_path,
            "molecular snapshot manifest",
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnginePackRef {
    pub schema_version: EnginePackVersion,
    pub engine_pack_id: Uuid,
    pub engine_pack_sha256: String,
    pub workflow_template: WorkflowTemplateId,
    pub snapshot_id: Uuid,
    pub snapshot_sha256: String,
    pub engine_id: String,
    pub engine_version: String,
    pub normalized_settings_sha256: String,
    pub manifest: PackedFileDescriptor,
}

impl EnginePackRef {
    pub fn from_manifest(
        manifest: &EnginePackManifest,
        manifest_file: PackedFileDescriptor,
    ) -> Result<Self, ProtocolError> {
        manifest.validate()?;
        let reference = Self {
            schema_version: manifest.schema_version,
            engine_pack_id: manifest.engine_pack_id,
            engine_pack_sha256: manifest.engine_pack_sha256.clone(),
            workflow_template: manifest.workflow_template,
            snapshot_id: manifest.molecular_snapshot.snapshot_id,
            snapshot_sha256: manifest.molecular_snapshot.snapshot_sha256.clone(),
            engine_id: manifest.engine_id.clone(),
            engine_version: manifest.engine_version.clone(),
            normalized_settings_sha256: manifest.normalized_settings_sha256.clone(),
            manifest: manifest_file,
        };
        reference.validate_against_manifest(manifest)?;
        Ok(reference)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_compatibility(self.workflow_template, self.schema_version)?;
        validate_uuid("engine pack ID", self.engine_pack_id)?;
        validate_uuid("engine pack snapshot ID", self.snapshot_id)?;
        validate_sha256("engine pack", &self.engine_pack_sha256)?;
        validate_sha256("engine pack snapshot", &self.snapshot_sha256)?;
        validate_label("engine ID", &self.engine_id, MAX_LABEL_BYTES)?;
        validate_label("engine version", &self.engine_version, MAX_LABEL_BYTES)?;
        validate_sha256(
            "normalized engine settings",
            &self.normalized_settings_sha256,
        )?;
        self.manifest.validate_manifest("engine pack manifest")
    }

    pub fn validate_against_manifest(
        &self,
        manifest: &EnginePackManifest,
    ) -> Result<(), ProtocolError> {
        self.validate()?;
        manifest.validate()?;
        if self.schema_version != manifest.schema_version
            || self.engine_pack_id != manifest.engine_pack_id
            || self.engine_pack_sha256 != manifest.engine_pack_sha256
            || self.workflow_template != manifest.workflow_template
            || self.snapshot_id != manifest.molecular_snapshot.snapshot_id
            || self.snapshot_sha256 != manifest.molecular_snapshot.snapshot_sha256
            || self.engine_id != manifest.engine_id
            || self.engine_version != manifest.engine_version
            || self.normalized_settings_sha256 != manifest.normalized_settings_sha256
        {
            return Err(ProtocolError::Validation(
                "engine pack reference differs from its manifest identity".into(),
            ));
        }
        manifest
            .layout
            .reject_file_path(&self.manifest.relative_path, "engine pack manifest")
    }
}

fn validate_compatibility(
    workflow: WorkflowTemplateId,
    version: EnginePackVersion,
) -> Result<(), ProtocolError> {
    match (workflow, version) {
        (WorkflowTemplateId::ClusterV1, EnginePackVersion::ClusterV1) => Ok(()),
    }
}
