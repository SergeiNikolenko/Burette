//! Validated in-memory view of the canonical conformer EnginePack distance data.

use std::fmt;

use crate::DistanceConstraint;

#[derive(Clone, Debug, PartialEq)]
pub struct ConformerDistanceEngine {
    record_validity: Vec<bool>,
    molecule_atom_starts: Vec<u64>,
    atomic_numbers: Vec<u16>,
    formal_charges: Vec<i8>,
    distance_term_starts: Vec<u64>,
    distance_atom_pairs: Vec<[u32; 2]>,
    distance_bounds_squared: Vec<[f32; 2]>,
    distance_weights: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConformerDistanceMolecule<'a> {
    pub record_index: u64,
    pub atom_start: u64,
    pub atomic_numbers: &'a [u16],
    pub formal_charges: &'a [i8],
    pub distance_atom_pairs: &'a [[u32; 2]],
    pub distance_bounds_squared: &'a [[f32; 2]],
    pub distance_weights: &'a [f32],
}

impl ConformerDistanceMolecule<'_> {
    pub fn local_distance_constraints(&self) -> Vec<DistanceConstraint> {
        self.distance_atom_pairs
            .iter()
            .zip(self.distance_bounds_squared)
            .zip(self.distance_weights)
            .map(|((pair, bounds), weight)| DistanceConstraint {
                left_atom: u32::try_from(u64::from(pair[0]) - self.atom_start)
                    .expect("validated molecule-local atom index"),
                right_atom: u32::try_from(u64::from(pair[1]) - self.atom_start)
                    .expect("validated molecule-local atom index"),
                lower_squared: bounds[0],
                upper_squared: bounds[1],
                weight: *weight,
            })
            .collect()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerEngineError(String);

impl ConformerEngineError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ConformerEngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConformerEngineError {}

impl ConformerDistanceEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        record_validity: Vec<bool>,
        molecule_atom_starts: Vec<u64>,
        atomic_numbers: Vec<u16>,
        formal_charges: Vec<i8>,
        distance_term_starts: Vec<u64>,
        distance_atom_pairs: Vec<[u32; 2]>,
        distance_bounds_squared: Vec<[f32; 2]>,
        distance_weights: Vec<f32>,
    ) -> Result<Self, ConformerEngineError> {
        let engine = Self {
            record_validity,
            molecule_atom_starts,
            atomic_numbers,
            formal_charges,
            distance_term_starts,
            distance_atom_pairs,
            distance_bounds_squared,
            distance_weights,
        };
        engine.validate()?;
        Ok(engine)
    }

    pub fn record_count(&self) -> u64 {
        self.record_validity.len() as u64
    }

    pub fn valid_record_count(&self) -> u64 {
        self.record_validity.iter().filter(|valid| **valid).count() as u64
    }

    pub fn total_atom_count(&self) -> u64 {
        self.atomic_numbers.len() as u64
    }

    pub fn total_distance_constraint_count(&self) -> u64 {
        self.distance_atom_pairs.len() as u64
    }

    pub fn record_validity(&self) -> &[bool] {
        &self.record_validity
    }

    pub fn molecule_atom_starts(&self) -> &[u64] {
        &self.molecule_atom_starts
    }

    pub fn distance_term_starts(&self) -> &[u64] {
        &self.distance_term_starts
    }

    pub fn molecule(
        &self,
        record_index: u64,
    ) -> Result<Option<ConformerDistanceMolecule<'_>>, ConformerEngineError> {
        let index = usize::try_from(record_index)
            .ok()
            .filter(|index| *index < self.record_validity.len())
            .ok_or_else(|| ConformerEngineError::new("conformer record index is out of bounds"))?;
        if !self.record_validity[index] {
            return Ok(None);
        }
        let atom_start = self.molecule_atom_starts[index];
        let atom_end = self.molecule_atom_starts[index + 1];
        let term_start = self.distance_term_starts[index];
        let term_end = self.distance_term_starts[index + 1];
        let atom_range = checked_range(atom_start, atom_end, "molecule atom range")?;
        let term_range = checked_range(term_start, term_end, "distance term range")?;
        Ok(Some(ConformerDistanceMolecule {
            record_index,
            atom_start,
            atomic_numbers: &self.atomic_numbers[atom_range.clone()],
            formal_charges: &self.formal_charges[atom_range],
            distance_atom_pairs: &self.distance_atom_pairs[term_range.clone()],
            distance_bounds_squared: &self.distance_bounds_squared[term_range.clone()],
            distance_weights: &self.distance_weights[term_range],
        }))
    }

    fn validate(&self) -> Result<(), ConformerEngineError> {
        if self.record_validity.is_empty() {
            return Err(ConformerEngineError::new(
                "conformer EnginePack requires at least one record",
            ));
        }
        let expected_starts = self
            .record_validity
            .len()
            .checked_add(1)
            .ok_or_else(|| ConformerEngineError::new("conformer record count overflowed"))?;
        validate_starts(
            "moleculeAtomStarts",
            &self.molecule_atom_starts,
            expected_starts,
            self.atomic_numbers.len(),
        )?;
        validate_starts(
            "distanceTermStarts",
            &self.distance_term_starts,
            expected_starts,
            self.distance_atom_pairs.len(),
        )?;
        if self.formal_charges.len() != self.atomic_numbers.len() {
            return Err(ConformerEngineError::new(
                "atomicNumbers and formalCharges lengths differ",
            ));
        }
        if self.atomic_numbers.iter().any(|number| !(1..=118).contains(number)) {
            return Err(ConformerEngineError::new(
                "atomicNumbers contains an unsupported element",
            ));
        }
        if self.distance_bounds_squared.len() != self.distance_atom_pairs.len()
            || self.distance_weights.len() != self.distance_atom_pairs.len()
        {
            return Err(ConformerEngineError::new(
                "distance constraint arrays have inconsistent lengths",
            ));
        }

        for record in 0..self.record_validity.len() {
            let atom_start = self.molecule_atom_starts[record];
            let atom_end = self.molecule_atom_starts[record + 1];
            let term_start = self.distance_term_starts[record];
            let term_end = self.distance_term_starts[record + 1];
            if self.record_validity[record] {
                if atom_start == atom_end {
                    return Err(ConformerEngineError::new(
                        "valid conformer record contains no atoms",
                    ));
                }
            } else if atom_start != atom_end || term_start != term_end {
                return Err(ConformerEngineError::new(
                    "invalid conformer record owns atom or distance payload",
                ));
            }
            let terms = checked_range(term_start, term_end, "distance term range")?;
            let mut previous = None;
            for term in terms {
                let pair = self.distance_atom_pairs[term];
                let left = u64::from(pair[0]);
                let right = u64::from(pair[1]);
                if left < atom_start || right >= atom_end || left >= right {
                    return Err(ConformerEngineError::new(
                        "distance atom pair is outside its molecule or is not canonical",
                    ));
                }
                if previous.is_some_and(|previous| previous >= pair) {
                    return Err(ConformerEngineError::new(
                        "distance atom pairs must be strictly sorted within each molecule",
                    ));
                }
                previous = Some(pair);
                let [lower, upper] = self.distance_bounds_squared[term];
                let weight = self.distance_weights[term];
                if !lower.is_finite()
                    || !upper.is_finite()
                    || lower < 0.0
                    || upper <= 0.0
                    || upper < lower
                    || !weight.is_finite()
                    || weight < 0.0
                {
                    return Err(ConformerEngineError::new(
                        "distance bound or weight is outside the supported domain",
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validate_starts(
    label: &str,
    starts: &[u64],
    expected_len: usize,
    payload_len: usize,
) -> Result<(), ConformerEngineError> {
    if starts.len() != expected_len
        || starts.first() != Some(&0)
        || starts.windows(2).any(|pair| pair[0] > pair[1])
        || starts.last().copied() != u64::try_from(payload_len).ok()
    {
        return Err(ConformerEngineError::new(format!(
            "{label} is not a canonical offset vector"
        )));
    }
    Ok(())
}

fn checked_range(
    start: u64,
    end: u64,
    label: &str,
) -> Result<std::ops::Range<usize>, ConformerEngineError> {
    let start = usize::try_from(start)
        .map_err(|_| ConformerEngineError::new(format!("{label} exceeds address space")))?;
    let end = usize::try_from(end)
        .map_err(|_| ConformerEngineError::new(format!("{label} exceeds address space")))?;
    Ok(start..end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> ConformerDistanceEngine {
        ConformerDistanceEngine::new(
            vec![true, false, true],
            vec![0, 2, 2, 5],
            vec![6, 8, 6, 6, 1],
            vec![0, 0, 0, 0, 0],
            vec![0, 1, 1, 3],
            vec![[0, 1], [2, 3], [3, 4]],
            vec![[1.0, 2.0], [1.5, 2.5], [0.5, 1.5]],
            vec![1.0, 1.0, 2.0],
        )
        .expect("valid conformer distance engine")
    }

    #[test]
    fn validates_and_slices_canonical_engine_data() {
        let engine = engine();
        assert_eq!(engine.record_count(), 3);
        assert_eq!(engine.valid_record_count(), 2);
        assert_eq!(engine.total_atom_count(), 5);
        assert_eq!(engine.total_distance_constraint_count(), 3);
        assert!(engine.molecule(1).expect("invalid record lookup").is_none());
        let molecule = engine
            .molecule(2)
            .expect("molecule lookup")
            .expect("valid molecule");
        assert_eq!(molecule.atom_start, 2);
        assert_eq!(molecule.atomic_numbers, [6, 6, 1]);
        assert_eq!(
            molecule.local_distance_constraints(),
            vec![
                DistanceConstraint {
                    left_atom: 0,
                    right_atom: 1,
                    lower_squared: 1.5,
                    upper_squared: 2.5,
                    weight: 1.0,
                },
                DistanceConstraint {
                    left_atom: 1,
                    right_atom: 2,
                    lower_squared: 0.5,
                    upper_squared: 1.5,
                    weight: 2.0,
                },
            ]
        );
    }

    #[test]
    fn rejects_cross_molecule_unsorted_and_invalid_record_payloads() {
        let mut cross = engine();
        cross.distance_atom_pairs[1] = [1, 3];
        assert!(cross.validate().is_err());

        let mut unsorted = engine();
        unsorted.distance_atom_pairs[1..].swap(0, 1);
        assert!(unsorted.validate().is_err());

        let mut invalid_payload = engine();
        invalid_payload.record_validity[0] = false;
        assert!(invalid_payload.validate().is_err());
    }

    #[test]
    fn rejects_malformed_offsets_elements_and_bounds() {
        let mut offsets = engine();
        offsets.molecule_atom_starts[2] = 4;
        assert!(offsets.validate().is_err());

        let mut element = engine();
        element.atomic_numbers[0] = 0;
        assert!(element.validate().is_err());

        let mut bounds = engine();
        bounds.distance_bounds_squared[0][1] = f32::NAN;
        assert!(bounds.validate().is_err());
    }
}
