use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::common::{validate_json_safe, validate_sha256, MAX_PACK_RECORDS};
use crate::{validation::canonical_json_bytes, ProtocolError};

pub const MOLECULAR_RECORDS_FILE_NAME: &str = "molecular-records.v1.jsonl";
pub const MOLECULAR_RECORDS_FILE_PATH: &str = "pack/molecular-records.v1.jsonl";
pub const MOLECULAR_RECORDS_MEDIA_TYPE: &str = "application/vnd.burette.molecular-records-v1+jsonl";
pub const ORDERED_RECORD_MOLECULE_IDENTITY_DOMAIN: &[u8] = b"burette.snapshot-record-identity.v1\0";

const MAX_NAME_CHARS: usize = 160;
const MAX_SMILES_CHARS: usize = 2_048;
const MAX_MOLBLOCK_CHARS: usize = 250_000;
const MAX_IDCODE_CHARS: usize = 4_096;
const MAX_IDCOORDINATES_CHARS: usize = 16_384;
const MAX_PROPERTIES: usize = 64;
const MAX_PROPERTY_NAME_CHARS: usize = 80;
const MAX_PROPERTY_VALUE_CHARS: usize = 500;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MolecularSnapshotRecordVersion {
    #[serde(rename = "burette.molecular-snapshot-record.v1")]
    V1,
}

/// One canonical raw record in a MolecularSnapshot JSON Lines staging file.
/// Engine-specific atom, bond, conformer, and fingerprint arrays belong in
/// EnginePacks and are deliberately not part of this source-preserving record.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MolecularSnapshotRecordV1 {
    pub schema_version: MolecularSnapshotRecordVersion,
    pub source_record_id: u64,
    pub molecule_content_sha256: String,
    pub name: String,
    pub smiles: Option<String>,
    pub molblock: Option<String>,
    pub idcode: Option<String>,
    pub idcoordinates: Option<String>,
    pub props: BTreeMap<String, String>,
}

impl MolecularSnapshotRecordV1 {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_json_safe("molecular snapshot source record ID", self.source_record_id)?;
        validate_sha256(
            "molecular snapshot record content",
            &self.molecule_content_sha256,
        )?;
        validate_chars("molecular snapshot record name", &self.name, MAX_NAME_CHARS)?;
        validate_optional_chars("SMILES", self.smiles.as_deref(), MAX_SMILES_CHARS)?;
        validate_optional_chars("molblock", self.molblock.as_deref(), MAX_MOLBLOCK_CHARS)?;
        validate_optional_chars("IDCode", self.idcode.as_deref(), MAX_IDCODE_CHARS)?;
        validate_optional_chars(
            "IDCoordinates",
            self.idcoordinates.as_deref(),
            MAX_IDCOORDINATES_CHARS,
        )?;
        if self.smiles.is_none() && self.molblock.is_none() && self.idcode.is_none() {
            return Err(ProtocolError::Validation(
                "molecular snapshot record requires SMILES, molblock, or IDCode chemistry input"
                    .into(),
            ));
        }
        if self.props.len() > MAX_PROPERTIES {
            return Err(ProtocolError::Validation(format!(
                "molecular snapshot record exceeds the {MAX_PROPERTIES}-property limit"
            )));
        }
        for (name, value) in &self.props {
            validate_chars(
                "molecular snapshot property name",
                name,
                MAX_PROPERTY_NAME_CHARS,
            )?;
            validate_chars(
                "molecular snapshot property value",
                value,
                MAX_PROPERTY_VALUE_CHARS,
            )?;
        }
        Ok(())
    }

    /// RFC 8785 canonical JSON followed by exactly one LF record delimiter.
    pub fn canonical_json_line_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        let mut bytes = canonical_json_bytes(self)?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

/// Streaming authority for `orderedRecordMoleculeIdentitySha256`.
///
/// The byte stream is the domain above followed by one fixed 40-byte tuple per
/// record: the strictly increasing source record ID as big-endian `u64`, then
/// the raw 32 SHA-256 bytes. Big-endian is the digest protocol encoding; it is
/// intentionally independent of the little-endian packed identity array.
pub struct OrderedRecordMoleculeIdentityHasher {
    digest: Sha256,
    last_source_record_id: Option<u64>,
    record_count: u64,
}

impl OrderedRecordMoleculeIdentityHasher {
    pub fn new() -> Self {
        let mut digest = Sha256::new();
        digest.update(ORDERED_RECORD_MOLECULE_IDENTITY_DOMAIN);
        Self {
            digest,
            last_source_record_id: None,
            record_count: 0,
        }
    }

    pub fn push(
        &mut self,
        source_record_id: u64,
        molecule_content_sha256: &str,
    ) -> Result<(), ProtocolError> {
        validate_json_safe("ordered identity source record ID", source_record_id)?;
        validate_sha256("ordered identity molecule content", molecule_content_sha256)?;
        if self
            .last_source_record_id
            .is_some_and(|previous| source_record_id <= previous)
        {
            return Err(ProtocolError::Validation(
                "ordered identity source record IDs must be strictly increasing".into(),
            ));
        }
        if self.record_count >= MAX_PACK_RECORDS {
            return Err(ProtocolError::Validation(format!(
                "ordered identity exceeds the {MAX_PACK_RECORDS}-record limit"
            )));
        }

        let molecule_hash = decode_sha256(molecule_content_sha256);
        self.digest.update(source_record_id.to_be_bytes());
        self.digest.update(molecule_hash);
        self.last_source_record_id = Some(source_record_id);
        self.record_count += 1;
        Ok(())
    }

    pub const fn record_count(&self) -> u64 {
        self.record_count
    }

    pub fn finish_hex(self) -> String {
        encode_hex(self.digest.finalize())
    }
}

impl Default for OrderedRecordMoleculeIdentityHasher {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_chars(label: &str, value: &str, max_chars: usize) -> Result<(), ProtocolError> {
    let count = value.chars().count();
    if count == 0 || count > max_chars {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={max_chars} characters"
        )));
    }
    Ok(())
}

fn validate_optional_chars(
    label: &str,
    value: Option<&str>,
    max_chars: usize,
) -> Result<(), ProtocolError> {
    if let Some(value) = value {
        validate_chars(label, value, max_chars)?;
    }
    Ok(())
}

fn decode_sha256(value: &str) -> [u8; 32] {
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(pair[0]) << 4) | hex_nibble(pair[1]);
    }
    decoded
}

fn hex_nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => unreachable!("SHA-256 validation accepts only lowercase hexadecimal bytes"),
    }
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    let mut encoded = String::with_capacity(64);
    for byte in bytes.as_ref() {
        use std::fmt::Write;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}
