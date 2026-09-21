//! Canonical conformer EnginePack array assembly.

use std::fmt;

use burette_compute_protocol::{ConformerVariant, CONFORMER_ENGINE_ARRAY_NAMES};

use crate::ExtractedConformerParameters;

#[derive(Clone, Debug, PartialEq)]
pub struct ConformerEnginePackArrays {
    pub atomic_numbers: Vec<u16>,
    pub chiral_atom_quads: Vec<[u32; 4]>,
    pub chiral_term_starts: Vec<u64>,
    pub chiral_volume_bounds: Vec<[f32; 2]>,
    pub distance_atom_pairs: Vec<[u32; 2]>,
    pub distance_bounds_squared: Vec<[f32; 2]>,
    pub distance_term_starts: Vec<u64>,
    pub distance_weights: Vec<f32>,
    pub etk_distance_atom_pairs: Vec<[u32; 2]>,
    pub etk_distance_bounds: Vec<[f32; 2]>,
    pub etk_distance_kinds: Vec<u8>,
    pub etk_distance_term_starts: Vec<u64>,
    pub etk_distance_weights: Vec<f32>,
    pub formal_charges: Vec<i8>,
    pub improper_atom_quads: Vec<[u32; 4]>,
    pub improper_term_starts: Vec<u64>,
    pub improper_weights: Vec<f32>,
    pub molecule_atom_starts: Vec<u64>,
    pub record_validity: Vec<bool>,
    pub stereo_atom_quints: Vec<[u32; 5]>,
    pub stereo_center_starts: Vec<u64>,
    pub stereo_flags: Vec<u8>,
    pub torsion_atom_quads: Vec<[u32; 4]>,
    pub torsion_coefficients: Vec<[f32; 6]>,
    pub torsion_signs: Vec<[i8; 6]>,
    pub torsion_term_starts: Vec<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerPackedArraySpan {
    pub name: &'static str,
    pub byte_offset: u64,
    pub byte_length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerEnginePackBinary {
    pub bytes: Vec<u8>,
    pub arrays: Vec<ConformerPackedArraySpan>,
}

impl ConformerEnginePackArrays {
    pub fn record_count(&self) -> usize {
        self.record_validity.len()
    }

    pub fn payload_bytes(&self) -> Result<u64, ConformerPackError> {
        payload_bytes(Counts::from_arrays(self))
    }

    pub fn encode_le(
        &self,
        maximum_bytes: u64,
    ) -> Result<ConformerEnginePackBinary, ConformerPackError> {
        let expected_bytes = self.payload_bytes()?;
        if expected_bytes > maximum_bytes {
            return Err(ConformerPackError::new(
                "conformer EnginePack exceeds its encoded byte budget",
            ));
        }
        let mut writer = BinaryWriter::new(maximum_bytes);
        writer.u16s("atomicNumbers", &self.atomic_numbers)?;
        writer.u32_arrays("chiralAtomQuads", &self.chiral_atom_quads)?;
        writer.u64s("chiralTermStarts", &self.chiral_term_starts)?;
        writer.f32_arrays("chiralVolumeBounds", &self.chiral_volume_bounds)?;
        writer.u32_arrays("distanceAtomPairs", &self.distance_atom_pairs)?;
        writer.f32_arrays("distanceBoundsSquared", &self.distance_bounds_squared)?;
        writer.u64s("distanceTermStarts", &self.distance_term_starts)?;
        writer.f32s("distanceWeights", &self.distance_weights)?;
        writer.u32_arrays("etkDistanceAtomPairs", &self.etk_distance_atom_pairs)?;
        writer.f32_arrays("etkDistanceBounds", &self.etk_distance_bounds)?;
        writer.u8s("etkDistanceKinds", &self.etk_distance_kinds)?;
        writer.u64s("etkDistanceTermStarts", &self.etk_distance_term_starts)?;
        writer.f32s("etkDistanceWeights", &self.etk_distance_weights)?;
        writer.i8s("formalCharges", &self.formal_charges)?;
        writer.u32_arrays("improperAtomQuads", &self.improper_atom_quads)?;
        writer.u64s("improperTermStarts", &self.improper_term_starts)?;
        writer.f32s("improperWeights", &self.improper_weights)?;
        writer.u64s("moleculeAtomStarts", &self.molecule_atom_starts)?;
        writer.bools("recordValidity", &self.record_validity)?;
        writer.u32_arrays("stereoAtomQuints", &self.stereo_atom_quints)?;
        writer.u64s("stereoCenterStarts", &self.stereo_center_starts)?;
        writer.u8s("stereoFlags", &self.stereo_flags)?;
        writer.u32_arrays("torsionAtomQuads", &self.torsion_atom_quads)?;
        writer.f32_arrays("torsionCoefficients", &self.torsion_coefficients)?;
        writer.i8_arrays("torsionSigns", &self.torsion_signs)?;
        writer.u64s("torsionTermStarts", &self.torsion_term_starts)?;
        writer.finish(expected_bytes)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerPackError(String);

impl ConformerPackError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ConformerPackError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConformerPackError {}

#[derive(Debug)]
pub struct ConformerEnginePackBuilder {
    variant: ConformerVariant,
    maximum_payload_bytes: u64,
    arrays: ConformerEnginePackArrays,
}

impl ConformerEnginePackBuilder {
    pub fn new(variant: ConformerVariant, maximum_payload_bytes: u64) -> Self {
        Self {
            variant,
            maximum_payload_bytes,
            arrays: ConformerEnginePackArrays {
                atomic_numbers: Vec::new(),
                chiral_atom_quads: Vec::new(),
                chiral_term_starts: vec![0],
                chiral_volume_bounds: Vec::new(),
                distance_atom_pairs: Vec::new(),
                distance_bounds_squared: Vec::new(),
                distance_term_starts: vec![0],
                distance_weights: Vec::new(),
                etk_distance_atom_pairs: Vec::new(),
                etk_distance_bounds: Vec::new(),
                etk_distance_kinds: Vec::new(),
                etk_distance_term_starts: vec![0],
                etk_distance_weights: Vec::new(),
                formal_charges: Vec::new(),
                improper_atom_quads: Vec::new(),
                improper_term_starts: vec![0],
                improper_weights: Vec::new(),
                molecule_atom_starts: vec![0],
                record_validity: Vec::new(),
                stereo_atom_quints: Vec::new(),
                stereo_center_starts: vec![0],
                stereo_flags: Vec::new(),
                torsion_atom_quads: Vec::new(),
                torsion_coefficients: Vec::new(),
                torsion_signs: Vec::new(),
                torsion_term_starts: vec![0],
            },
        }
    }

    pub fn append_valid(
        &mut self,
        extracted: ExtractedConformerParameters,
    ) -> Result<(), ConformerPackError> {
        extracted.validate().map_err(|error| {
            ConformerPackError::new(format!("invalid extracted conformer parameters: {error}"))
        })?;
        if extracted.variant != self.variant {
            return Err(ConformerPackError::new(
                "extracted conformer variant differs from the EnginePack variant",
            ));
        }
        let current = Counts::from_arrays(&self.arrays);
        let added = Counts::from_extracted(&extracted);
        let next = current.checked_add(added)?;
        self.admit(next)?;
        if next.atoms > u64::from(u32::MAX) + 1 {
            return Err(ConformerPackError::new(
                "EnginePack atom indices exceed the canonical u32 range",
            ));
        }
        let atom_start = u32::try_from(current.atoms).map_err(|_| {
            ConformerPackError::new("EnginePack atom indices exceed the canonical u32 range")
        })?;

        self.arrays.atomic_numbers.extend(extracted.atomic_numbers);
        self.arrays.formal_charges.extend(extracted.formal_charges);
        append_indices(
            &mut self.arrays.distance_atom_pairs,
            extracted.distance_atom_pairs,
            atom_start,
        )?;
        self.arrays
            .distance_bounds_squared
            .extend(extracted.distance_bounds_squared);
        self.arrays
            .distance_weights
            .extend(extracted.distance_weights);
        append_indices(
            &mut self.arrays.chiral_atom_quads,
            extracted.chiral_atom_quads,
            atom_start,
        )?;
        self.arrays
            .chiral_volume_bounds
            .extend(extracted.chiral_volume_bounds);
        append_indices(
            &mut self.arrays.torsion_atom_quads,
            extracted.torsion_atom_quads,
            atom_start,
        )?;
        self.arrays
            .torsion_coefficients
            .extend(extracted.torsion_coefficients);
        self.arrays.torsion_signs.extend(extracted.torsion_signs);
        append_indices(
            &mut self.arrays.improper_atom_quads,
            extracted.improper_atom_quads,
            atom_start,
        )?;
        self.arrays
            .improper_weights
            .extend(extracted.improper_weights);
        append_indices(
            &mut self.arrays.etk_distance_atom_pairs,
            extracted.etk_distance_atom_pairs,
            atom_start,
        )?;
        self.arrays
            .etk_distance_bounds
            .extend(extracted.etk_distance_bounds);
        self.arrays
            .etk_distance_kinds
            .extend(extracted.etk_distance_kinds);
        self.arrays
            .etk_distance_weights
            .extend(extracted.etk_distance_weights);
        append_indices(
            &mut self.arrays.stereo_atom_quints,
            extracted.stereo_atom_quints,
            atom_start,
        )?;
        self.arrays.stereo_flags.extend(extracted.stereo_flags);
        self.push_starts(next);
        self.arrays.record_validity.push(true);
        Ok(())
    }

    /// Appends one extraction chunk atomically. A rejected record leaves the
    /// canonical arrays at their pre-chunk logical lengths, so the caller may
    /// safely retry the same frozen-source chunk.
    pub fn append_batch(
        &mut self,
        records: Vec<Option<ExtractedConformerParameters>>,
    ) -> Result<(), ConformerPackError> {
        let checkpoint = Counts::from_arrays(&self.arrays);
        for record in records {
            let result = match record {
                Some(extracted) => self.append_valid(extracted),
                None => self.append_invalid(),
            };
            if let Err(error) = result {
                self.truncate(checkpoint);
                return Err(error);
            }
        }
        Ok(())
    }

    pub fn append_invalid(&mut self) -> Result<(), ConformerPackError> {
        let next = Counts::from_arrays(&self.arrays).checked_add(Counts {
            records: 1,
            ..Counts::default()
        })?;
        self.admit(next)?;
        self.push_starts(next);
        self.arrays.record_validity.push(false);
        Ok(())
    }

    pub fn finish(
        self,
        expected_record_count: u64,
    ) -> Result<ConformerEnginePackArrays, ConformerPackError> {
        if self.arrays.record_count() as u64 != expected_record_count {
            return Err(ConformerPackError::new(
                "EnginePack record count differs from its frozen source",
            ));
        }
        self.admit(Counts::from_arrays(&self.arrays))?;
        Ok(self.arrays)
    }

    fn admit(&self, counts: Counts) -> Result<(), ConformerPackError> {
        if payload_bytes(counts)? > self.maximum_payload_bytes {
            return Err(ConformerPackError::new(
                "conformer EnginePack exceeds its admitted payload byte budget",
            ));
        }
        Ok(())
    }

    fn push_starts(&mut self, counts: Counts) {
        self.arrays.molecule_atom_starts.push(counts.atoms);
        self.arrays.distance_term_starts.push(counts.distances);
        self.arrays.chiral_term_starts.push(counts.chiral);
        self.arrays.torsion_term_starts.push(counts.torsions);
        self.arrays.improper_term_starts.push(counts.impropers);
        self.arrays
            .etk_distance_term_starts
            .push(counts.etk_distances);
        self.arrays.stereo_center_starts.push(counts.stereo);
    }

    fn truncate(&mut self, counts: Counts) {
        self.arrays.atomic_numbers.truncate(counts.atoms as usize);
        self.arrays.formal_charges.truncate(counts.atoms as usize);
        self.arrays
            .distance_atom_pairs
            .truncate(counts.distances as usize);
        self.arrays
            .distance_bounds_squared
            .truncate(counts.distances as usize);
        self.arrays
            .distance_weights
            .truncate(counts.distances as usize);
        self.arrays
            .chiral_atom_quads
            .truncate(counts.chiral as usize);
        self.arrays
            .chiral_volume_bounds
            .truncate(counts.chiral as usize);
        self.arrays
            .torsion_atom_quads
            .truncate(counts.torsions as usize);
        self.arrays
            .torsion_coefficients
            .truncate(counts.torsions as usize);
        self.arrays.torsion_signs.truncate(counts.torsions as usize);
        self.arrays
            .improper_atom_quads
            .truncate(counts.impropers as usize);
        self.arrays
            .improper_weights
            .truncate(counts.impropers as usize);
        self.arrays
            .etk_distance_atom_pairs
            .truncate(counts.etk_distances as usize);
        self.arrays
            .etk_distance_bounds
            .truncate(counts.etk_distances as usize);
        self.arrays
            .etk_distance_kinds
            .truncate(counts.etk_distances as usize);
        self.arrays
            .etk_distance_weights
            .truncate(counts.etk_distances as usize);
        self.arrays
            .stereo_atom_quints
            .truncate(counts.stereo as usize);
        self.arrays.stereo_flags.truncate(counts.stereo as usize);
        let starts = counts.records as usize + 1;
        self.arrays.molecule_atom_starts.truncate(starts);
        self.arrays.distance_term_starts.truncate(starts);
        self.arrays.chiral_term_starts.truncate(starts);
        self.arrays.torsion_term_starts.truncate(starts);
        self.arrays.improper_term_starts.truncate(starts);
        self.arrays.etk_distance_term_starts.truncate(starts);
        self.arrays.stereo_center_starts.truncate(starts);
        self.arrays
            .record_validity
            .truncate(counts.records as usize);
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Counts {
    records: u64,
    atoms: u64,
    distances: u64,
    chiral: u64,
    torsions: u64,
    impropers: u64,
    etk_distances: u64,
    stereo: u64,
}

impl Counts {
    fn from_arrays(arrays: &ConformerEnginePackArrays) -> Self {
        Self {
            records: arrays.record_validity.len() as u64,
            atoms: arrays.atomic_numbers.len() as u64,
            distances: arrays.distance_atom_pairs.len() as u64,
            chiral: arrays.chiral_atom_quads.len() as u64,
            torsions: arrays.torsion_atom_quads.len() as u64,
            impropers: arrays.improper_atom_quads.len() as u64,
            etk_distances: arrays.etk_distance_atom_pairs.len() as u64,
            stereo: arrays.stereo_atom_quints.len() as u64,
        }
    }

    fn from_extracted(extracted: &ExtractedConformerParameters) -> Self {
        Self {
            atoms: extracted.atomic_numbers.len() as u64,
            distances: extracted.distance_atom_pairs.len() as u64,
            chiral: extracted.chiral_atom_quads.len() as u64,
            torsions: extracted.torsion_atom_quads.len() as u64,
            impropers: extracted.improper_atom_quads.len() as u64,
            etk_distances: extracted.etk_distance_atom_pairs.len() as u64,
            stereo: extracted.stereo_atom_quints.len() as u64,
            records: 1,
        }
    }

    fn checked_add(self, other: Self) -> Result<Self, ConformerPackError> {
        Ok(Self {
            records: add(self.records, other.records)?,
            atoms: add(self.atoms, other.atoms)?,
            distances: add(self.distances, other.distances)?,
            chiral: add(self.chiral, other.chiral)?,
            torsions: add(self.torsions, other.torsions)?,
            impropers: add(self.impropers, other.impropers)?,
            etk_distances: add(self.etk_distances, other.etk_distances)?,
            stereo: add(self.stereo, other.stereo)?,
        })
    }
}

fn append_indices<const N: usize>(
    output: &mut Vec<[u32; N]>,
    values: Vec<[u32; N]>,
    atom_start: u32,
) -> Result<(), ConformerPackError> {
    for mut value in values {
        for index in &mut value {
            *index = index.checked_add(atom_start).ok_or_else(|| {
                ConformerPackError::new("EnginePack atom index overflowed its canonical u32 range")
            })?;
        }
        output.push(value);
    }
    Ok(())
}

fn payload_bytes(counts: Counts) -> Result<u64, ConformerPackError> {
    let starts = add(counts.records, 1)?;
    let terms = [
        (counts.atoms, 2, 2),
        (counts.chiral, 16, 4),
        (starts, 8, 8),
        (counts.chiral, 8, 4),
        (counts.distances, 8, 4),
        (counts.distances, 8, 4),
        (starts, 8, 8),
        (counts.distances, 4, 4),
        (counts.etk_distances, 8, 4),
        (counts.etk_distances, 8, 4),
        (counts.etk_distances, 1, 1),
        (starts, 8, 8),
        (counts.etk_distances, 4, 4),
        (counts.atoms, 1, 1),
        (counts.impropers, 16, 4),
        (starts, 8, 8),
        (counts.impropers, 4, 4),
        (starts, 8, 8),
        (counts.records, 1, 1),
        (counts.stereo, 20, 4),
        (starts, 8, 8),
        (counts.stereo, 1, 1),
        (counts.torsions, 16, 4),
        (counts.torsions, 24, 4),
        (counts.torsions, 6, 1),
        (starts, 8, 8),
    ];
    terms
        .into_iter()
        .try_fold(0_u64, |total, (count, width, alignment)| {
            let aligned = align(total, alignment)?;
            let bytes = count
                .checked_mul(width)
                .ok_or_else(|| ConformerPackError::new("EnginePack payload size overflowed"))?;
            add(aligned, bytes)
        })
}

fn align(value: u64, alignment: u64) -> Result<u64, ConformerPackError> {
    let remainder = value % alignment;
    if remainder == 0 {
        Ok(value)
    } else {
        add(value, alignment - remainder)
    }
}

fn add(left: u64, right: u64) -> Result<u64, ConformerPackError> {
    left.checked_add(right)
        .ok_or_else(|| ConformerPackError::new("EnginePack count overflowed"))
}

struct BinaryWriter {
    bytes: Vec<u8>,
    arrays: Vec<ConformerPackedArraySpan>,
    maximum_bytes: u64,
}

impl BinaryWriter {
    fn new(maximum_bytes: u64) -> Self {
        Self {
            bytes: Vec::new(),
            arrays: Vec::with_capacity(CONFORMER_ENGINE_ARRAY_NAMES.len()),
            maximum_bytes,
        }
    }

    fn section(
        &mut self,
        name: &'static str,
        alignment: usize,
        byte_length: usize,
        write: impl FnOnce(&mut Vec<u8>),
    ) -> Result<(), ConformerPackError> {
        let padding = (alignment - self.bytes.len() % alignment) % alignment;
        let required = padding
            .checked_add(byte_length)
            .and_then(|additional| self.bytes.len().checked_add(additional))
            .ok_or_else(|| ConformerPackError::new("EnginePack encoding size overflowed"))?;
        if required as u64 > self.maximum_bytes {
            return Err(ConformerPackError::new(
                "conformer EnginePack exceeds its encoded byte budget",
            ));
        }
        self.bytes
            .try_reserve_exact(padding + byte_length)
            .map_err(|_| ConformerPackError::new("cannot allocate conformer EnginePack bytes"))?;
        self.bytes.resize(self.bytes.len() + padding, 0);
        let start = self.bytes.len();
        write(&mut self.bytes);
        if self.bytes.len() != start + byte_length {
            return Err(ConformerPackError::new(
                "EnginePack encoder wrote an inconsistent array length",
            ));
        }
        self.arrays.push(ConformerPackedArraySpan {
            name,
            byte_offset: start as u64,
            byte_length: byte_length as u64,
        });
        Ok(())
    }

    fn u8s(&mut self, name: &'static str, values: &[u8]) -> Result<(), ConformerPackError> {
        self.section(name, 1, values.len(), |bytes| bytes.extend(values))
    }

    fn i8s(&mut self, name: &'static str, values: &[i8]) -> Result<(), ConformerPackError> {
        self.section(name, 1, values.len(), |bytes| {
            bytes.extend(values.iter().map(|value| *value as u8));
        })
    }

    fn bools(&mut self, name: &'static str, values: &[bool]) -> Result<(), ConformerPackError> {
        self.section(name, 1, values.len(), |bytes| {
            bytes.extend(values.iter().map(|value| u8::from(*value)));
        })
    }

    fn u16s(&mut self, name: &'static str, values: &[u16]) -> Result<(), ConformerPackError> {
        self.fixed(name, 2, values.len(), |bytes| {
            for value in values {
                bytes.extend(value.to_le_bytes());
            }
        })
    }

    fn u64s(&mut self, name: &'static str, values: &[u64]) -> Result<(), ConformerPackError> {
        self.fixed(name, 8, values.len(), |bytes| {
            for value in values {
                bytes.extend(value.to_le_bytes());
            }
        })
    }

    fn f32s(&mut self, name: &'static str, values: &[f32]) -> Result<(), ConformerPackError> {
        self.fixed(name, 4, values.len(), |bytes| {
            for value in values {
                bytes.extend(value.to_le_bytes());
            }
        })
    }

    fn u32_arrays<const WIDTH: usize>(
        &mut self,
        name: &'static str,
        values: &[[u32; WIDTH]],
    ) -> Result<(), ConformerPackError> {
        let count = array_element_count::<WIDTH>(values.len())?;
        self.fixed(name, 4, count, |bytes| {
            for value in values.iter().flatten() {
                bytes.extend(value.to_le_bytes());
            }
        })
    }

    fn f32_arrays<const WIDTH: usize>(
        &mut self,
        name: &'static str,
        values: &[[f32; WIDTH]],
    ) -> Result<(), ConformerPackError> {
        let count = array_element_count::<WIDTH>(values.len())?;
        self.fixed(name, 4, count, |bytes| {
            for value in values.iter().flatten() {
                bytes.extend(value.to_le_bytes());
            }
        })
    }

    fn i8_arrays<const WIDTH: usize>(
        &mut self,
        name: &'static str,
        values: &[[i8; WIDTH]],
    ) -> Result<(), ConformerPackError> {
        let count = array_element_count::<WIDTH>(values.len())?;
        self.section(name, 1, count, |bytes| {
            bytes.extend(values.iter().flatten().map(|value| *value as u8));
        })
    }

    fn fixed(
        &mut self,
        name: &'static str,
        width: usize,
        count: usize,
        write: impl FnOnce(&mut Vec<u8>),
    ) -> Result<(), ConformerPackError> {
        let byte_length = count
            .checked_mul(width)
            .ok_or_else(|| ConformerPackError::new("EnginePack array size overflowed"))?;
        self.section(name, width, byte_length, write)
    }

    fn finish(self, expected_bytes: u64) -> Result<ConformerEnginePackBinary, ConformerPackError> {
        if self.bytes.len() as u64 != expected_bytes
            || self.arrays.len() != CONFORMER_ENGINE_ARRAY_NAMES.len()
            || self
                .arrays
                .iter()
                .map(|array| array.name)
                .ne(CONFORMER_ENGINE_ARRAY_NAMES)
        {
            return Err(ConformerPackError::new(
                "EnginePack encoding differs from the canonical v1 layout",
            ));
        }
        Ok(ConformerEnginePackBinary {
            bytes: self.bytes,
            arrays: self.arrays,
        })
    }
}

fn array_element_count<const WIDTH: usize>(count: usize) -> Result<usize, ConformerPackError> {
    count
        .checked_mul(WIDTH)
        .ok_or_else(|| ConformerPackError::new("EnginePack array element count overflowed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extracted(atom: u16) -> ExtractedConformerParameters {
        ExtractedConformerParameters {
            variant: ConformerVariant::EtkdgV3,
            atomic_numbers: vec![atom, 1],
            formal_charges: vec![0, 0],
            distance_atom_pairs: vec![[0, 1]],
            distance_bounds_squared: vec![[1.0, 2.0]],
            distance_weights: vec![1.0],
            chiral_atom_quads: Vec::new(),
            chiral_volume_bounds: Vec::new(),
            torsion_atom_quads: Vec::new(),
            torsion_coefficients: Vec::new(),
            torsion_signs: Vec::new(),
            improper_atom_quads: Vec::new(),
            improper_weights: Vec::new(),
            etk_distance_atom_pairs: Vec::new(),
            etk_distance_bounds: Vec::new(),
            etk_distance_kinds: Vec::new(),
            etk_distance_weights: Vec::new(),
            stereo_atom_quints: Vec::new(),
            stereo_flags: Vec::new(),
        }
    }

    #[test]
    fn assembles_offsets_and_global_atom_indices() {
        let mut builder = ConformerEnginePackBuilder::new(ConformerVariant::EtkdgV3, 1024);
        builder.append_valid(extracted(6)).expect("first molecule");
        builder.append_invalid().expect("invalid record");
        builder.append_valid(extracted(8)).expect("third molecule");
        let arrays = builder.finish(3).expect("complete pack");

        assert_eq!(arrays.record_validity, [true, false, true]);
        assert_eq!(arrays.molecule_atom_starts, [0, 2, 2, 4]);
        assert_eq!(arrays.distance_term_starts, [0, 1, 1, 2]);
        assert_eq!(arrays.distance_atom_pairs, [[0, 1], [2, 3]]);
        assert_eq!(arrays.atomic_numbers, [6, 1, 8, 1]);
        assert_eq!(arrays.payload_bytes().expect("payload bytes"), 288);
        let encoded = arrays.encode_le(288).expect("encoded pack");
        assert_eq!(encoded.bytes.len(), 288);
        assert_eq!(encoded.arrays[0].byte_offset, 0);
        assert_eq!(encoded.arrays[2].byte_offset, 8);
        assert_eq!(encoded.arrays[18].byte_offset, 216);
        assert_eq!(&encoded.bytes[216..219], &[1, 0, 1]);
        assert!(arrays.encode_le(287).is_err());
    }

    #[test]
    fn enforces_variant_budget_and_frozen_record_count() {
        let mut mismatch = extracted(6);
        mismatch.variant = ConformerVariant::Kdg;
        let mut builder = ConformerEnginePackBuilder::new(ConformerVariant::EtkdgV3, 1024);
        assert!(builder.append_valid(mismatch).is_err());
        assert!(builder.finish(1).is_err());

        let mut bounded = ConformerEnginePackBuilder::new(ConformerVariant::EtkdgV3, 75);
        assert!(bounded.append_valid(extracted(6)).is_err());
    }

    #[test]
    fn rejected_batch_rolls_back_every_record() {
        let mut mismatch = extracted(8);
        mismatch.variant = ConformerVariant::Kdg;
        let mut builder = ConformerEnginePackBuilder::new(ConformerVariant::EtkdgV3, 1024);

        assert!(builder
            .append_batch(vec![Some(extracted(6)), None, Some(mismatch)])
            .is_err());

        let arrays = builder.finish(0).expect("rolled-back builder");
        assert!(arrays.atomic_numbers.is_empty());
        assert!(arrays.record_validity.is_empty());
        assert_eq!(arrays.molecule_atom_starts, [0]);
        assert_eq!(arrays.distance_term_starts, [0]);
    }
}
