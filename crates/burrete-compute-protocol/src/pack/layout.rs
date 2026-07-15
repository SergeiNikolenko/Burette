use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::common::{
    validate_json_safe, validate_label, validate_optional_label, validate_pack_path,
    validate_sha256, MAX_ALIGNMENT_BYTES, MAX_ARRAY_RANK, MAX_LABEL_BYTES, MAX_PACK_ARRAYS,
    MAX_PACK_BYTES, MAX_PACK_FILES, MAX_SEMANTIC_BYTES, MAX_UNIT_BYTES,
};
use crate::ProtocolError;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackedFileDescriptor {
    pub relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub media_type: String,
}

impl PackedFileDescriptor {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_pack_path(&self.relative_path)?;
        validate_sha256("packed file", &self.sha256)?;
        validate_json_safe("packed file byte length", self.byte_length)?;
        if self.byte_length > MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(format!(
                "packed file exceeds the {MAX_PACK_BYTES}-byte limit"
            )));
        }
        validate_label("packed file media type", &self.media_type, MAX_LABEL_BYTES)
    }

    #[allow(dead_code)] // Used by the higher-level pack reference modules.
    pub(crate) fn validate_manifest(&self, label: &str) -> Result<(), ProtocolError> {
        self.validate()?;
        if self.byte_length == 0 || self.media_type != "application/json" {
            return Err(ProtocolError::Validation(format!(
                "{label} must be a non-empty application/json file"
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PackedDType {
    #[serde(rename = "bool8")]
    Bool8,
    #[serde(rename = "u8")]
    U8,
    #[serde(rename = "i8")]
    I8,
    #[serde(rename = "u16")]
    U16,
    #[serde(rename = "i16")]
    I16,
    #[serde(rename = "u32")]
    U32,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "u64")]
    U64,
    #[serde(rename = "i64")]
    I64,
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "f64")]
    F64,
}

impl PackedDType {
    pub fn byte_width(self) -> u64 {
        match self {
            Self::Bool8 | Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackedByteOrder {
    LittleEndian,
    BigEndian,
    NotApplicable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackedArrayDescriptor {
    pub name: String,
    pub semantic: String,
    pub unit: Option<String>,
    pub file_relative_path: String,
    pub dtype: PackedDType,
    pub shape: Vec<u64>,
    pub byte_order: PackedByteOrder,
    pub alignment: u32,
    pub byte_offset: u64,
    pub byte_length: u64,
}

impl PackedArrayDescriptor {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        validate_label("packed array name", &self.name, MAX_LABEL_BYTES)?;
        validate_label("packed array semantic", &self.semantic, MAX_SEMANTIC_BYTES)?;
        validate_optional_label("packed array unit", self.unit.as_deref(), MAX_UNIT_BYTES)?;
        validate_pack_path(&self.file_relative_path)?;
        if self.shape.is_empty() || self.shape.len() > MAX_ARRAY_RANK {
            return Err(ProtocolError::Validation(format!(
                "packed array rank must be in 1..={MAX_ARRAY_RANK}"
            )));
        }
        for dimension in &self.shape {
            validate_json_safe("packed array dimension", *dimension)?;
        }
        validate_json_safe("packed array byte offset", self.byte_offset)?;
        validate_json_safe("packed array byte length", self.byte_length)?;
        if self.byte_offset > MAX_PACK_BYTES || self.byte_length > MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(
                "packed array range exceeds the pack byte limit".into(),
            ));
        }
        self.validate_storage_contract()?;
        let expected = self.expected_byte_length()?;
        if self.byte_length != expected {
            return Err(ProtocolError::Validation(format!(
                "packed array {} declares {} bytes but its contiguous shape requires {expected}",
                self.name, self.byte_length
            )));
        }
        Ok(())
    }

    pub fn expected_byte_length(&self) -> Result<u64, ProtocolError> {
        let elements = self.shape.iter().try_fold(1_u64, |count, dimension| {
            count.checked_mul(*dimension).ok_or_else(|| {
                ProtocolError::Validation("packed array element count overflowed u64".into())
            })
        })?;
        elements
            .checked_mul(self.dtype.byte_width())
            .ok_or_else(|| {
                ProtocolError::Validation("packed array byte length overflowed u64".into())
            })
    }

    fn validate_storage_contract(&self) -> Result<(), ProtocolError> {
        let width = self.dtype.byte_width();
        if self.alignment == 0
            || self.alignment > MAX_ALIGNMENT_BYTES
            || !self.alignment.is_power_of_two()
            || u64::from(self.alignment) < width
            || u64::from(self.alignment) % width != 0
            || !self
                .byte_offset
                .is_multiple_of(u64::from(self.alignment))
        {
            return Err(ProtocolError::Validation(
                "packed array alignment is invalid for its dtype and offset".into(),
            ));
        }
        match (width, self.byte_order) {
            (1, PackedByteOrder::NotApplicable)
            | (2 | 4 | 8, PackedByteOrder::LittleEndian | PackedByteOrder::BigEndian) => Ok(()),
            _ => Err(ProtocolError::Validation(
                "packed array byte order is invalid for its dtype".into(),
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackedLayout {
    pub files: Vec<PackedFileDescriptor>,
    pub arrays: Vec<PackedArrayDescriptor>,
}

impl PackedLayout {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.files.is_empty() || self.files.len() > MAX_PACK_FILES {
            return Err(ProtocolError::Validation(format!(
                "packed layout requires 1..={MAX_PACK_FILES} files"
            )));
        }
        if self.arrays.is_empty() || self.arrays.len() > MAX_PACK_ARRAYS {
            return Err(ProtocolError::Validation(format!(
                "packed layout requires 1..={MAX_PACK_ARRAYS} arrays"
            )));
        }
        self.validate_canonical_order()?;
        let file_sizes = self.validate_files()?;
        self.validate_arrays(&file_sizes)
    }

    pub fn array(&self, name: &str) -> Option<&PackedArrayDescriptor> {
        self.arrays.iter().find(|array| array.name == name)
    }

    #[allow(dead_code)] // Used by the higher-level pack manifest modules.
    pub(crate) fn reject_file_path(&self, path: &str, label: &str) -> Result<(), ProtocolError> {
        if self.files.iter().any(|file| file.relative_path == path) {
            return Err(ProtocolError::Validation(format!(
                "packed layout reuses {label} path: {path}"
            )));
        }
        Ok(())
    }

    fn validate_canonical_order(&self) -> Result<(), ProtocolError> {
        if self
            .files
            .windows(2)
            .any(|pair| pair[0].relative_path >= pair[1].relative_path)
        {
            return Err(ProtocolError::Validation(
                "packed files must be strictly sorted by relativePath".into(),
            ));
        }
        if self
            .arrays
            .windows(2)
            .any(|pair| pair[0].name >= pair[1].name)
        {
            return Err(ProtocolError::Validation(
                "packed arrays must be strictly sorted by name".into(),
            ));
        }
        Ok(())
    }

    fn validate_files(&self) -> Result<BTreeMap<&str, u64>, ProtocolError> {
        let mut file_sizes = BTreeMap::new();
        let mut total_bytes = 0_u64;
        for file in &self.files {
            file.validate()?;
            if file_sizes
                .insert(file.relative_path.as_str(), file.byte_length)
                .is_some()
            {
                return Err(ProtocolError::Validation(format!(
                    "duplicate packed file path: {}",
                    file.relative_path
                )));
            }
            total_bytes = total_bytes.checked_add(file.byte_length).ok_or_else(|| {
                ProtocolError::Validation("packed layout byte total overflowed u64".into())
            })?;
        }
        if total_bytes > MAX_PACK_BYTES {
            return Err(ProtocolError::Validation(format!(
                "packed layout exceeds the {MAX_PACK_BYTES}-byte limit"
            )));
        }
        Ok(file_sizes)
    }

    fn validate_arrays(&self, file_sizes: &BTreeMap<&str, u64>) -> Result<(), ProtocolError> {
        let mut names = BTreeSet::new();
        let mut ranges: BTreeMap<&str, Vec<(u64, u64, &str)>> = BTreeMap::new();
        for array in &self.arrays {
            array.validate()?;
            if !names.insert(array.name.as_str()) {
                return Err(ProtocolError::Validation(format!(
                    "duplicate packed array name: {}",
                    array.name
                )));
            }
            let file_size = file_sizes
                .get(array.file_relative_path.as_str())
                .ok_or_else(|| {
                    ProtocolError::Validation(format!(
                        "packed array {} references unknown file {}",
                        array.name, array.file_relative_path
                    ))
                })?;
            let end = array
                .byte_offset
                .checked_add(array.byte_length)
                .ok_or_else(|| {
                    ProtocolError::Validation("packed array range overflowed u64".into())
                })?;
            if end > *file_size {
                return Err(ProtocolError::Validation(format!(
                    "packed array {} exceeds file {}",
                    array.name, array.file_relative_path
                )));
            }
            if array.byte_length != 0 {
                ranges
                    .entry(array.file_relative_path.as_str())
                    .or_default()
                    .push((array.byte_offset, end, array.name.as_str()));
            }
        }
        reject_overlaps(ranges)
    }
}

fn reject_overlaps(mut ranges: BTreeMap<&str, Vec<(u64, u64, &str)>>) -> Result<(), ProtocolError> {
    for file_ranges in ranges.values_mut() {
        file_ranges.sort_by_key(|range| range.0);
        for pair in file_ranges.windows(2) {
            if pair[1].0 < pair[0].1 {
                return Err(ProtocolError::Validation(format!(
                    "packed arrays {} and {} overlap",
                    pair[0].2, pair[1].2
                )));
            }
        }
    }
    Ok(())
}
