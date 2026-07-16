//! Canonical conformer EnginePack array assembly.

use std::fmt;

use burrete_compute_protocol::ConformerVariant;

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

impl ConformerEnginePackArrays {
    pub fn record_count(&self) -> usize {
        self.record_validity.len()
    }

    pub fn payload_bytes(&self) -> Result<u64, ConformerPackError> {
        payload_bytes(Counts::from_arrays(self))
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
        (counts.atoms, 3),
        (counts.distances, 20),
        (counts.chiral, 24),
        (counts.torsions, 46),
        (counts.impropers, 20),
        (counts.etk_distances, 21),
        (counts.stereo, 21),
        (starts, 56),
        (counts.records, 1),
    ];
    terms.into_iter().try_fold(0_u64, |total, (count, width)| {
        let bytes = count
            .checked_mul(width)
            .ok_or_else(|| ConformerPackError::new("EnginePack payload size overflowed"))?;
        add(total, bytes)
    })
}

fn add(left: u64, right: u64) -> Result<u64, ConformerPackError> {
    left.checked_add(right)
        .ok_or_else(|| ConformerPackError::new("EnginePack count overflowed"))
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
        assert_eq!(arrays.payload_bytes().expect("payload bytes"), 279);
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
}
