use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    common::{
        validate_json_safe, validate_json_safe_positive, validate_sha256, validate_uuid,
        MolecularSnapshotVersion, MAX_PACK_RECORDS,
    },
    layout::{PackedDType, PackedFileDescriptor, PackedLayout},
    records::{MOLECULAR_RECORDS_FILE_PATH, MOLECULAR_RECORDS_MEDIA_TYPE},
};
use crate::{
    validation::{canonical_json_bytes, sha256_hex},
    ProtocolError,
};

pub const SOURCE_RECORD_IDS_ARRAY_NAME: &str = "sourceRecordIds";
pub const SOURCE_RECORD_IDS_SEMANTIC: &str = "source_record_id";
pub const MOLECULE_CONTENT_HASHES_ARRAY_NAME: &str = "moleculeContentHashes";
pub const MOLECULE_CONTENT_HASHES_SEMANTIC: &str = "molecule_content_sha256";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrozenSourceIdentity {
    pub document_fingerprint_sha256: String,
    pub source_revision: u64,
    pub record_count: u64,
    /// SHA-256 over the ordered `(source record identity, molecule content hash)` pairs.
    pub ordered_record_molecule_identity_sha256: String,
}

impl FrozenSourceIdentity {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_sha256(
            "source document fingerprint",
            &self.document_fingerprint_sha256,
        )?;
        validate_sha256(
            "ordered record/molecule identity digest",
            &self.ordered_record_molecule_identity_sha256,
        )?;
        validate_json_safe_positive("source revision", self.source_revision)?;
        validate_json_safe_positive("record count", self.record_count)?;
        if self.record_count > MAX_PACK_RECORDS {
            return Err(ProtocolError::Validation(format!(
                "record count exceeds the pack limit of {MAX_PACK_RECORDS}"
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MolecularSnapshotManifest {
    pub schema_version: MolecularSnapshotVersion,
    pub snapshot_id: Uuid,
    pub snapshot_sha256: String,
    pub frozen_source: FrozenSourceIdentity,
    pub layout: PackedLayout,
    pub created_at_ms: u64,
}

impl MolecularSnapshotManifest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_uuid("molecular snapshot ID", self.snapshot_id)?;
        validate_sha256("molecular snapshot", &self.snapshot_sha256)?;
        self.frozen_source.validate()?;
        validate_json_safe("molecular snapshot creation time", self.created_at_ms)?;
        self.layout.validate()?;
        self.validate_identity_arrays()?;
        self.validate_records_file()
    }

    /// Computes the content address for the immutable source identity and
    /// packed-file layout. Per-job IDs and timestamps are intentionally not
    /// part of this cache identity.
    pub fn computed_snapshot_sha256(&self) -> Result<String, ProtocolError> {
        self.frozen_source.validate()?;
        self.layout.validate()?;
        let identity = MolecularSnapshotContentIdentity {
            schema_version: self.schema_version,
            frozen_source: &self.frozen_source,
            layout: &self.layout,
        };
        canonical_json_bytes(&identity).map(|bytes| sha256_hex(&bytes))
    }

    pub fn bind_computed_snapshot_sha256(&mut self) -> Result<(), ProtocolError> {
        self.snapshot_sha256 = self.computed_snapshot_sha256()?;
        Ok(())
    }

    pub fn validate_snapshot_sha256(&self) -> Result<(), ProtocolError> {
        self.validate()?;
        if self.snapshot_sha256 != self.computed_snapshot_sha256()? {
            return Err(ProtocolError::Validation(
                "molecular snapshot hash differs from its immutable content identity".into(),
            ));
        }
        Ok(())
    }

    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        canonical_json_bytes(self)
    }

    fn validate_identity_arrays(&self) -> Result<(), ProtocolError> {
        let source_ids = self
            .layout
            .array(SOURCE_RECORD_IDS_ARRAY_NAME)
            .ok_or_else(|| missing_array(SOURCE_RECORD_IDS_ARRAY_NAME))?;
        if source_ids.semantic != SOURCE_RECORD_IDS_SEMANTIC
            || source_ids.dtype != PackedDType::U64
            || source_ids.shape != [self.frozen_source.record_count]
            || source_ids.unit.is_some()
        {
            return Err(ProtocolError::Validation(
                "sourceRecordIds must be a unitless u64[recordCount] source_record_id array".into(),
            ));
        }

        let molecule_hashes = self
            .layout
            .array(MOLECULE_CONTENT_HASHES_ARRAY_NAME)
            .ok_or_else(|| missing_array(MOLECULE_CONTENT_HASHES_ARRAY_NAME))?;
        if molecule_hashes.semantic != MOLECULE_CONTENT_HASHES_SEMANTIC
            || molecule_hashes.dtype != PackedDType::U8
            || molecule_hashes.shape != [self.frozen_source.record_count, 32]
            || molecule_hashes.unit.is_some()
        {
            return Err(ProtocolError::Validation(
                "moleculeContentHashes must be a unitless u8[recordCount,32] molecule_content_sha256 array"
                    .into(),
            ));
        }
        Ok(())
    }

    fn validate_records_file(&self) -> Result<(), ProtocolError> {
        let records = self
            .layout
            .files
            .iter()
            .find(|file| file.relative_path == MOLECULAR_RECORDS_FILE_PATH)
            .ok_or_else(|| {
                ProtocolError::Validation(format!(
                    "molecular snapshot requires {MOLECULAR_RECORDS_FILE_PATH}"
                ))
            })?;
        if records.byte_length == 0 || records.media_type != MOLECULAR_RECORDS_MEDIA_TYPE {
            return Err(ProtocolError::Validation(format!(
                "{MOLECULAR_RECORDS_FILE_PATH} must be a non-empty {MOLECULAR_RECORDS_MEDIA_TYPE} file"
            )));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MolecularSnapshotContentIdentity<'a> {
    schema_version: MolecularSnapshotVersion,
    frozen_source: &'a FrozenSourceIdentity,
    layout: &'a PackedLayout,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MolecularSnapshotRef {
    pub schema_version: MolecularSnapshotVersion,
    pub snapshot_id: Uuid,
    pub snapshot_sha256: String,
    pub frozen_source: FrozenSourceIdentity,
    pub manifest: PackedFileDescriptor,
}

impl MolecularSnapshotRef {
    pub fn from_manifest(
        manifest: &MolecularSnapshotManifest,
        manifest_file: PackedFileDescriptor,
    ) -> Result<Self, ProtocolError> {
        manifest.validate()?;
        let reference = Self {
            schema_version: manifest.schema_version,
            snapshot_id: manifest.snapshot_id,
            snapshot_sha256: manifest.snapshot_sha256.clone(),
            frozen_source: manifest.frozen_source.clone(),
            manifest: manifest_file,
        };
        reference.validate_against_manifest(manifest)?;
        Ok(reference)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_uuid("molecular snapshot ID", self.snapshot_id)?;
        validate_sha256("molecular snapshot", &self.snapshot_sha256)?;
        self.frozen_source.validate()?;
        self.manifest
            .validate_manifest("molecular snapshot manifest")
    }

    pub fn validate_against_manifest(
        &self,
        manifest: &MolecularSnapshotManifest,
    ) -> Result<(), ProtocolError> {
        self.validate()?;
        manifest.validate()?;
        if self.schema_version != manifest.schema_version
            || self.snapshot_id != manifest.snapshot_id
            || self.snapshot_sha256 != manifest.snapshot_sha256
            || self.frozen_source != manifest.frozen_source
        {
            return Err(ProtocolError::Validation(
                "molecular snapshot reference differs from its manifest identity".into(),
            ));
        }
        manifest
            .layout
            .reject_file_path(&self.manifest.relative_path, "molecular snapshot manifest")
    }
}

fn missing_array(name: &str) -> ProtocolError {
    ProtocolError::Validation(format!(
        "molecular snapshot requires the {name} identity array"
    ))
}
