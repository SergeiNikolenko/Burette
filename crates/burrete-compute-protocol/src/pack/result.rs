use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    common::{validate_json_safe, validate_sha256, validate_uuid, MAX_ENGINE_PACK_REFS},
    engine::EnginePackRef,
    layout::{
        PackedArrayDescriptor, PackedByteOrder, PackedDType, PackedFileDescriptor, PackedLayout,
    },
    molecular::MolecularSnapshotRef,
};
use crate::{ProtocolError, ResultPackVersion, WorkflowTemplateId};

pub const CONFORMER_RESULT_ARRAY_NAMES: [&str; 8] = [
    "conformerAtomStarts",
    "conformerMoleculeIndices",
    "conformerOrdinals",
    "embeddingAttemptCounts",
    "embeddingEnergies",
    "embeddingStatuses",
    "positions",
    "seedWords",
];

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
        if self.workflow_template == WorkflowTemplateId::ConformerV1 {
            self.validate_conformer_layout()?;
        }
        for path in reserved_paths {
            self.layout.reject_file_path(path, "referenced manifest")?;
        }
        Ok(())
    }

    fn validate_conformer_layout(&self) -> Result<(), ProtocolError> {
        if self.layout.arrays.len() != CONFORMER_RESULT_ARRAY_NAMES.len()
            || self
                .layout
                .arrays
                .iter()
                .map(|array| array.name.as_str())
                .ne(CONFORMER_RESULT_ARRAY_NAMES)
        {
            return Err(ProtocolError::Validation(
                "conformer ResultPack requires the exact canonical v1 array set".into(),
            ));
        }
        let conformers = first_dimension(self.array("conformerMoleculeIndices")?)?;
        let starts = conformers.checked_add(1).ok_or_else(|| {
            ProtocolError::Validation("conformer result count overflowed".into())
        })?;
        require_array(
            self.array("conformerAtomStarts")?,
            "conformer_atom_offsets",
            None,
            PackedDType::U64,
            &[starts],
        )?;
        require_array(
            self.array("conformerMoleculeIndices")?,
            "conformer_molecule_index",
            None,
            PackedDType::U32,
            &[conformers],
        )?;
        require_array(
            self.array("conformerOrdinals")?,
            "conformer_ordinal",
            None,
            PackedDType::U32,
            &[conformers],
        )?;
        require_array(
            self.array("embeddingAttemptCounts")?,
            "embedding_attempt_count",
            None,
            PackedDType::U16,
            &[conformers],
        )?;
        require_array(
            self.array("embeddingEnergies")?,
            "distance_geometry_objective",
            None,
            PackedDType::F32,
            &[conformers],
        )?;
        require_array(
            self.array("embeddingStatuses")?,
            "conformer_embedding_status",
            None,
            PackedDType::U8,
            &[conformers],
        )?;
        let coordinate_atoms = first_dimension(self.array("positions")?)?;
        require_array(
            self.array("positions")?,
            "cartesian_position",
            Some("angstrom"),
            PackedDType::F32,
            &[coordinate_atoms, 3],
        )?;
        require_array(
            self.array("seedWords")?,
            "conformer_seed_words",
            None,
            PackedDType::U32,
            &[conformers, 4],
        )
    }

    fn array(&self, name: &str) -> Result<&PackedArrayDescriptor, ProtocolError> {
        self.layout.array(name).ok_or_else(|| {
            ProtocolError::Validation(format!("conformer ResultPack lacks {name}"))
        })
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

fn first_dimension(array: &PackedArrayDescriptor) -> Result<u64, ProtocolError> {
    array.shape.first().copied().ok_or_else(|| {
        ProtocolError::Validation(format!("packed array {} has no dimensions", array.name))
    })
}

fn require_array(
    array: &PackedArrayDescriptor,
    semantic: &str,
    unit: Option<&str>,
    dtype: PackedDType,
    shape: &[u64],
) -> Result<(), ProtocolError> {
    let alignment = dtype.byte_width() as u32;
    let byte_order = if dtype.byte_width() == 1 {
        PackedByteOrder::NotApplicable
    } else {
        PackedByteOrder::LittleEndian
    };
    if array.semantic != semantic
        || array.unit.as_deref() != unit
        || array.dtype != dtype
        || array.shape != shape
        || array.byte_order != byte_order
        || array.alignment < alignment
    {
        return Err(ProtocolError::Validation(format!(
            "conformer result array {} violates its v1 contract",
            array.name
        )));
    }
    Ok(())
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
        (WorkflowTemplateId::ConformerV1, ResultPackVersion::ConformerV1) => Ok(()),
        _ => Err(ProtocolError::Validation(
            "result pack schema is incompatible with its workflow".into(),
        )),
    }
}
