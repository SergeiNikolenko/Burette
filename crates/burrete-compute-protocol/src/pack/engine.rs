use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    common::{
        validate_json_safe, validate_label, validate_sha256, validate_uuid, EnginePackVersion,
        MAX_LABEL_BYTES,
    },
    layout::{
        PackedArrayDescriptor, PackedByteOrder, PackedDType, PackedFileDescriptor, PackedLayout,
    },
    molecular::MolecularSnapshotRef,
};
use crate::{ProtocolError, WorkflowTemplateId};

pub const CLUSTER_FINGERPRINT_ARRAY_NAME: &str = "fingerprints";
pub const CLUSTER_FINGERPRINT_SEMANTIC: &str = "morgan_fingerprint_bits";
pub const CLUSTER_FINGERPRINT_WORDS: u64 = 32;
pub const CONFORMER_ENGINE_ARRAY_NAMES: [&str; 26] = [
    "atomicNumbers",
    "chiralAtomQuads",
    "chiralTermStarts",
    "chiralVolumeBounds",
    "distanceAtomPairs",
    "distanceBoundsSquared",
    "distanceTermStarts",
    "distanceWeights",
    "etkDistanceAtomPairs",
    "etkDistanceBounds",
    "etkDistanceKinds",
    "etkDistanceTermStarts",
    "etkDistanceWeights",
    "formalCharges",
    "improperAtomQuads",
    "improperTermStarts",
    "improperWeights",
    "moleculeAtomStarts",
    "recordValidity",
    "stereoAtomQuints",
    "stereoCenterStarts",
    "stereoFlags",
    "torsionAtomQuads",
    "torsionCoefficients",
    "torsionSigns",
    "torsionTermStarts",
];

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
        match self.workflow_template {
            WorkflowTemplateId::ClusterV1 => self.validate_cluster_fingerprint_layout()?,
            WorkflowTemplateId::ConformerV1 => self.validate_conformer_layout()?,
            WorkflowTemplateId::SimilaritySearchV1 => {
                return Err(ProtocolError::Validation(
                    "derived similarity analyses do not own EnginePacks".into(),
                ))
            }
        }
        self.layout.reject_file_path(
            &self.molecular_snapshot.manifest.relative_path,
            "molecular snapshot manifest",
        )
    }

    fn validate_cluster_fingerprint_layout(&self) -> Result<(), ProtocolError> {
        let fingerprints = self
            .layout
            .array(CLUSTER_FINGERPRINT_ARRAY_NAME)
            .ok_or_else(|| {
                ProtocolError::Validation(
                    "cluster engine pack requires a fingerprints array".into(),
                )
            })?;
        let expected_shape = [
            self.molecular_snapshot.frozen_source.record_count,
            CLUSTER_FINGERPRINT_WORDS,
        ];
        if fingerprints.semantic != CLUSTER_FINGERPRINT_SEMANTIC
            || fingerprints.unit.is_some()
            || fingerprints.dtype != PackedDType::U64
            || fingerprints.shape != expected_shape
            || fingerprints.byte_order != PackedByteOrder::LittleEndian
            || fingerprints.alignment < 8
        {
            return Err(ProtocolError::Validation(format!(
                "fingerprints must be a unitless little-endian u64[recordCount,{CLUSTER_FINGERPRINT_WORDS}] {CLUSTER_FINGERPRINT_SEMANTIC} array aligned to at least 8 bytes"
            )));
        }
        Ok(())
    }

    fn validate_conformer_layout(&self) -> Result<(), ProtocolError> {
        if self.layout.arrays.len() != CONFORMER_ENGINE_ARRAY_NAMES.len()
            || self
                .layout
                .arrays
                .iter()
                .map(|array| array.name.as_str())
                .ne(CONFORMER_ENGINE_ARRAY_NAMES)
        {
            return Err(ProtocolError::Validation(
                "conformer EnginePack requires the exact canonical v1 array set".into(),
            ));
        }
        let records = self.molecular_snapshot.frozen_source.record_count;
        let starts_shape = [records.checked_add(1).ok_or_else(|| {
            ProtocolError::Validation("conformer record count overflowed".into())
        })?];
        let atoms = first_dimension(self.array("atomicNumbers")?)?;
        require_array(
            self.array("atomicNumbers")?,
            "atomic_number",
            None,
            PackedDType::U16,
            &[atoms],
        )?;
        require_array(
            self.array("formalCharges")?,
            "formal_charge",
            Some("elementary_charge"),
            PackedDType::I8,
            &[atoms],
        )?;
        require_array(
            self.array("moleculeAtomStarts")?,
            "molecule_atom_offsets",
            None,
            PackedDType::U64,
            &starts_shape,
        )?;
        require_array(
            self.array("recordValidity")?,
            "conformer_input_valid",
            None,
            PackedDType::Bool8,
            &[records],
        )?;

        self.validate_indexed_terms(
            "distanceTermStarts",
            "distanceAtomPairs",
            "distance_pair_offsets",
            "distance_atom_pair",
            2,
            &starts_shape,
        )?;
        let distance_count = first_dimension(self.array("distanceAtomPairs")?)?;
        require_array(
            self.array("distanceBoundsSquared")?,
            "distance_bounds_squared",
            Some("angstrom^2"),
            PackedDType::F32,
            &[distance_count, 2],
        )?;
        require_array(
            self.array("distanceWeights")?,
            "distance_constraint_weight",
            None,
            PackedDType::F32,
            &[distance_count],
        )?;

        self.validate_indexed_terms(
            "chiralTermStarts",
            "chiralAtomQuads",
            "chiral_term_offsets",
            "chiral_atom_quad",
            4,
            &starts_shape,
        )?;
        let chiral_count = first_dimension(self.array("chiralAtomQuads")?)?;
        require_array(
            self.array("chiralVolumeBounds")?,
            "chiral_volume_bounds",
            Some("angstrom^3"),
            PackedDType::F32,
            &[chiral_count, 2],
        )?;

        self.validate_indexed_terms(
            "torsionTermStarts",
            "torsionAtomQuads",
            "torsion_term_offsets",
            "torsion_atom_quad",
            4,
            &starts_shape,
        )?;
        let torsion_count = first_dimension(self.array("torsionAtomQuads")?)?;
        require_array(
            self.array("torsionCoefficients")?,
            "torsion_fourier_coefficients",
            None,
            PackedDType::F32,
            &[torsion_count, 6],
        )?;
        require_array(
            self.array("torsionSigns")?,
            "torsion_fourier_signs",
            None,
            PackedDType::I8,
            &[torsion_count, 6],
        )?;

        self.validate_indexed_terms(
            "improperTermStarts",
            "improperAtomQuads",
            "improper_term_offsets",
            "improper_atom_quad",
            4,
            &starts_shape,
        )?;
        let improper_count = first_dimension(self.array("improperAtomQuads")?)?;
        require_array(
            self.array("improperWeights")?,
            "improper_constraint_weight",
            None,
            PackedDType::F32,
            &[improper_count],
        )?;

        self.validate_indexed_terms(
            "etkDistanceTermStarts",
            "etkDistanceAtomPairs",
            "etk_distance_term_offsets",
            "etk_distance_atom_pair",
            2,
            &starts_shape,
        )?;
        let etk_distance_count = first_dimension(self.array("etkDistanceAtomPairs")?)?;
        require_array(
            self.array("etkDistanceBounds")?,
            "etk_distance_bounds",
            Some("angstrom"),
            PackedDType::F32,
            &[etk_distance_count, 2],
        )?;
        require_array(
            self.array("etkDistanceKinds")?,
            "bond_separation",
            None,
            PackedDType::U8,
            &[etk_distance_count],
        )?;
        require_array(
            self.array("etkDistanceWeights")?,
            "etk_distance_constraint_weight",
            None,
            PackedDType::F32,
            &[etk_distance_count],
        )?;

        self.validate_indexed_terms(
            "stereoCenterStarts",
            "stereoAtomQuints",
            "stereo_center_offsets",
            "stereo_atom_quint",
            5,
            &starts_shape,
        )?;
        let stereo_count = first_dimension(self.array("stereoAtomQuints")?)?;
        require_array(
            self.array("stereoFlags")?,
            "stereo_check_flags",
            None,
            PackedDType::U8,
            &[stereo_count],
        )
    }

    fn array(&self, name: &str) -> Result<&PackedArrayDescriptor, ProtocolError> {
        self.layout.array(name).ok_or_else(|| {
            ProtocolError::Validation(format!("conformer EnginePack lacks {name}"))
        })
    }

    fn validate_indexed_terms(
        &self,
        starts_name: &str,
        indices_name: &str,
        starts_semantic: &str,
        indices_semantic: &str,
        index_width: u64,
        starts_shape: &[u64],
    ) -> Result<(), ProtocolError> {
        require_array(
            self.array(starts_name)?,
            starts_semantic,
            None,
            PackedDType::U64,
            starts_shape,
        )?;
        let count = first_dimension(self.array(indices_name)?)?;
        require_array(
            self.array(indices_name)?,
            indices_semantic,
            None,
            PackedDType::U32,
            &[count, index_width],
        )
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
    let minimum_alignment = dtype.byte_width() as u32;
    if array.semantic != semantic
        || array.unit.as_deref() != unit
        || array.dtype != dtype
        || array.shape != shape
        || array.byte_order
            != if dtype.byte_width() == 1 {
                PackedByteOrder::NotApplicable
            } else {
                PackedByteOrder::LittleEndian
            }
        || array.alignment < minimum_alignment
    {
        return Err(ProtocolError::Validation(format!(
            "conformer array {} violates its v1 semantic, unit, dtype, shape, byte-order, or alignment contract",
            array.name
        )));
    }
    Ok(())
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
        (WorkflowTemplateId::ConformerV1, EnginePackVersion::ConformerV1) => Ok(()),
        _ => Err(ProtocolError::Validation(
            "engine pack version is incompatible with its workflow".into(),
        )),
    }
}
