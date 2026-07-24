//! Decoder for the version-locked native RDKit conformer extractor ABI.

use std::fmt;

use burette_compute_protocol::ConformerVariant;

const HEADER_BYTES: usize = 64;
const ABI_VERSION: u16 = 1;
const RDKIT_RELEASE: u32 = 20_250_304;

#[derive(Clone, Debug, PartialEq)]
pub struct ExtractedConformerParameters {
    pub variant: ConformerVariant,
    pub atomic_numbers: Vec<u16>,
    pub formal_charges: Vec<i8>,
    pub distance_atom_pairs: Vec<[u32; 2]>,
    pub distance_bounds_squared: Vec<[f32; 2]>,
    pub distance_weights: Vec<f32>,
    pub chiral_atom_quads: Vec<[u32; 4]>,
    pub chiral_volume_bounds: Vec<[f32; 2]>,
    pub torsion_atom_quads: Vec<[u32; 4]>,
    pub torsion_coefficients: Vec<[f32; 6]>,
    pub torsion_signs: Vec<[i8; 6]>,
    pub improper_atom_quads: Vec<[u32; 4]>,
    pub improper_weights: Vec<f32>,
    pub etk_distance_atom_pairs: Vec<[u32; 2]>,
    pub etk_distance_bounds: Vec<[f32; 2]>,
    pub etk_distance_kinds: Vec<u8>,
    pub etk_distance_weights: Vec<f32>,
    pub stereo_atom_quints: Vec<[u32; 5]>,
    pub stereo_flags: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerExtractError(String);

impl ConformerExtractError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ConformerExtractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConformerExtractError {}

impl ExtractedConformerParameters {
    pub fn decode(
        bytes: &[u8],
        expected_variant: ConformerVariant,
        maximum_bytes: u64,
    ) -> Result<Self, ConformerExtractError> {
        if bytes.len() < HEADER_BYTES || bytes.len() as u64 > maximum_bytes {
            return Err(invalid(
                "extractor output is outside its admitted byte envelope",
            ));
        }
        if bytes.get(..4) != Some(b"BCEX")
            || read_u16(bytes, 4)? != ABI_VERSION
            || read_u16(bytes, 6)? as usize != HEADER_BYTES
            || bytes[9] != 0
            || read_u16(bytes, 10)? != 0
            || read_u32(bytes, 48)? != RDKIT_RELEASE
        {
            return Err(invalid("extractor header is incompatible with ABI v1"));
        }
        if bytes[52..HEADER_BYTES].iter().any(|byte| *byte != 0) {
            return Err(invalid("extractor reserved header bytes are not zero"));
        }
        let variant = variant_from_tag(bytes[8])?;
        if variant != expected_variant {
            return Err(invalid(
                "extractor variant differs from the requested variant",
            ));
        }
        let counts = [
            read_u32(bytes, 12)?,
            read_u32(bytes, 16)?,
            read_u32(bytes, 20)?,
            read_u32(bytes, 24)?,
            read_u32(bytes, 28)?,
            read_u32(bytes, 32)?,
            read_u32(bytes, 36)?,
        ];
        if counts[0] == 0 {
            return Err(invalid("extractor returned an empty molecule"));
        }
        let payload_bytes = read_u32(bytes, 40)? as usize;
        let total_bytes = read_u32(bytes, 44)? as usize;
        if total_bytes != bytes.len() || payload_bytes != total_bytes.saturating_sub(HEADER_BYTES) {
            return Err(invalid(
                "extractor byte counts differ from the received buffer",
            ));
        }

        let [atoms, distances, chiral, torsions, impropers, etk_distances, stereo] =
            counts.map(|count| count as usize);
        let mut cursor = Cursor::new(bytes, HEADER_BYTES);
        let atomic_numbers = cursor.u16s(atoms, "atomicNumbers")?;
        let formal_charges = cursor.i8s(atoms, "formalCharges")?;
        let distance_atom_pairs = cursor.u32_arrays::<2>(distances, "distanceAtomPairs")?;
        let distance_bounds_squared = cursor.f32_arrays::<2>(distances, "distanceBoundsSquared")?;
        let distance_weights = cursor.f32s(distances, "distanceWeights")?;
        let chiral_atom_quads = cursor.u32_arrays::<4>(chiral, "chiralAtomQuads")?;
        let chiral_volume_bounds = cursor.f32_arrays::<2>(chiral, "chiralVolumeBounds")?;
        let torsion_atom_quads = cursor.u32_arrays::<4>(torsions, "torsionAtomQuads")?;
        let torsion_coefficients = cursor.f32_arrays::<6>(torsions, "torsionCoefficients")?;
        let torsion_signs = cursor.i8_arrays::<6>(torsions, "torsionSigns")?;
        let improper_atom_quads = cursor.u32_arrays::<4>(impropers, "improperAtomQuads")?;
        let improper_weights = cursor.f32s(impropers, "improperWeights")?;
        let etk_distance_atom_pairs =
            cursor.u32_arrays::<2>(etk_distances, "etkDistanceAtomPairs")?;
        let etk_distance_bounds = cursor.f32_arrays::<2>(etk_distances, "etkDistanceBounds")?;
        let etk_distance_kinds = cursor.u8s(etk_distances, "etkDistanceKinds")?;
        let etk_distance_weights = cursor.f32s(etk_distances, "etkDistanceWeights")?;
        let stereo_atom_quints = cursor.u32_arrays::<5>(stereo, "stereoAtomQuints")?;
        let stereo_flags = cursor.u8s(stereo, "stereoFlags")?;
        if cursor.offset != bytes.len() {
            return Err(invalid(
                "extractor output has trailing or missing payload bytes",
            ));
        }

        let result = Self {
            variant,
            atomic_numbers,
            formal_charges,
            distance_atom_pairs,
            distance_bounds_squared,
            distance_weights,
            chiral_atom_quads,
            chiral_volume_bounds,
            torsion_atom_quads,
            torsion_coefficients,
            torsion_signs,
            improper_atom_quads,
            improper_weights,
            etk_distance_atom_pairs,
            etk_distance_bounds,
            etk_distance_kinds,
            etk_distance_weights,
            stereo_atom_quints,
            stereo_flags,
        };
        result.validate()?;
        Ok(result)
    }

    pub fn validate(&self) -> Result<(), ConformerExtractError> {
        let atoms = self.atomic_numbers.len();
        if atoms == 0
            || self.formal_charges.len() != atoms
            || self.distance_bounds_squared.len() != self.distance_atom_pairs.len()
            || self.distance_weights.len() != self.distance_atom_pairs.len()
            || self.chiral_volume_bounds.len() != self.chiral_atom_quads.len()
            || self.torsion_coefficients.len() != self.torsion_atom_quads.len()
            || self.torsion_signs.len() != self.torsion_atom_quads.len()
            || self.improper_weights.len() != self.improper_atom_quads.len()
            || self.etk_distance_bounds.len() != self.etk_distance_atom_pairs.len()
            || self.etk_distance_kinds.len() != self.etk_distance_atom_pairs.len()
            || self.etk_distance_weights.len() != self.etk_distance_atom_pairs.len()
            || self.stereo_flags.len() != self.stereo_atom_quints.len()
        {
            return Err(invalid(
                "extractor arrays differ from their canonical term counts",
            ));
        }
        if self
            .atomic_numbers
            .iter()
            .any(|number| !(1..=118).contains(number))
        {
            return Err(invalid("extractor returned an unsupported atomic number"));
        }
        validate_indices("distanceAtomPairs", &self.distance_atom_pairs, atoms)?;
        validate_indices("chiralAtomQuads", &self.chiral_atom_quads, atoms)?;
        validate_indices("torsionAtomQuads", &self.torsion_atom_quads, atoms)?;
        validate_indices("improperAtomQuads", &self.improper_atom_quads, atoms)?;
        validate_indices("etkDistanceAtomPairs", &self.etk_distance_atom_pairs, atoms)?;
        validate_indices("stereoAtomQuints", &self.stereo_atom_quints, atoms)?;
        validate_pairs(
            "distance",
            &self.distance_atom_pairs,
            &self.distance_bounds_squared,
        )?;
        validate_pairs(
            "ETK distance",
            &self.etk_distance_atom_pairs,
            &self.etk_distance_bounds,
        )?;
        for (label, values) in [
            ("distanceWeights", self.distance_weights.as_slice()),
            ("improperWeights", self.improper_weights.as_slice()),
            ("etkDistanceWeights", self.etk_distance_weights.as_slice()),
        ] {
            if values
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
            {
                return Err(invalid(format!(
                    "extractor {label} contains an invalid weight"
                )));
            }
        }
        if flatten(&self.chiral_volume_bounds).any(|value| !value.is_finite())
            || self
                .chiral_volume_bounds
                .iter()
                .any(|bounds| bounds[0] > bounds[1])
        {
            return Err(invalid("extractor returned invalid chiral bounds"));
        }
        if flatten(&self.torsion_coefficients).any(|value| !value.is_finite())
            || flatten(&self.torsion_signs).any(|sign| !(-1..=1).contains(&sign))
            || self.etk_distance_kinds.contains(&0)
            || self.stereo_flags.iter().any(|flags| *flags > 1)
        {
            return Err(invalid("extractor returned unsupported term metadata"));
        }
        Ok(())
    }
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8], offset: usize) -> Self {
        Self { bytes, offset }
    }

    fn take(
        &mut self,
        count: usize,
        width: usize,
        alignment: usize,
        label: &str,
    ) -> Result<&'a [u8], ConformerExtractError> {
        self.offset = self
            .offset
            .checked_add(alignment - 1)
            .map(|offset| offset / alignment * alignment)
            .ok_or_else(|| invalid(format!("extractor {label} alignment overflowed")))?;
        let byte_count = count
            .checked_mul(width)
            .ok_or_else(|| invalid(format!("extractor {label} byte count overflowed")))?;
        let end = self
            .offset
            .checked_add(byte_count)
            .ok_or_else(|| invalid(format!("extractor {label} range overflowed")))?;
        let result = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| invalid(format!("extractor {label} exceeds its buffer")))?;
        self.offset = end;
        Ok(result)
    }

    fn u8s(&mut self, count: usize, label: &str) -> Result<Vec<u8>, ConformerExtractError> {
        Ok(self.take(count, 1, 1, label)?.to_vec())
    }

    fn i8s(&mut self, count: usize, label: &str) -> Result<Vec<i8>, ConformerExtractError> {
        Ok(self
            .take(count, 1, 1, label)?
            .iter()
            .map(|value| *value as i8)
            .collect())
    }

    fn u16s(&mut self, count: usize, label: &str) -> Result<Vec<u16>, ConformerExtractError> {
        Ok(self
            .take(count, 2, 2, label)?
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect())
    }

    fn f32s(&mut self, count: usize, label: &str) -> Result<Vec<f32>, ConformerExtractError> {
        Ok(self
            .take(count, 4, 4, label)?
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four-byte chunk")))
            .collect())
    }

    fn u32_arrays<const WIDTH: usize>(
        &mut self,
        count: usize,
        label: &str,
    ) -> Result<Vec<[u32; WIDTH]>, ConformerExtractError> {
        let elements = count
            .checked_mul(WIDTH)
            .ok_or_else(|| invalid(format!("extractor {label} element count overflowed")))?;
        let values: Vec<u32> = self
            .take(elements, 4, 4, label)?
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes(chunk.try_into().expect("four-byte chunk")))
            .collect();
        Ok(values
            .chunks_exact(WIDTH)
            .map(|chunk| chunk.try_into().expect("fixed-width chunk"))
            .collect())
    }

    fn f32_arrays<const WIDTH: usize>(
        &mut self,
        count: usize,
        label: &str,
    ) -> Result<Vec<[f32; WIDTH]>, ConformerExtractError> {
        let elements = count
            .checked_mul(WIDTH)
            .ok_or_else(|| invalid(format!("extractor {label} element count overflowed")))?;
        Ok(self
            .f32s(elements, label)?
            .chunks_exact(WIDTH)
            .map(|chunk| chunk.try_into().expect("fixed-width chunk"))
            .collect())
    }

    fn i8_arrays<const WIDTH: usize>(
        &mut self,
        count: usize,
        label: &str,
    ) -> Result<Vec<[i8; WIDTH]>, ConformerExtractError> {
        let elements = count
            .checked_mul(WIDTH)
            .ok_or_else(|| invalid(format!("extractor {label} element count overflowed")))?;
        Ok(self
            .i8s(elements, label)?
            .chunks_exact(WIDTH)
            .map(|chunk| chunk.try_into().expect("fixed-width chunk"))
            .collect())
    }
}

fn validate_pairs(
    label: &str,
    pairs: &[[u32; 2]],
    bounds: &[[f32; 2]],
) -> Result<(), ConformerExtractError> {
    let mut previous = None;
    for (pair, bounds) in pairs.iter().zip(bounds) {
        if pair[0] >= pair[1]
            || previous.is_some_and(|previous| previous >= *pair)
            || !bounds[0].is_finite()
            || !bounds[1].is_finite()
            || bounds[0] < 0.0
            || bounds[1] <= 0.0
            || bounds[0] > bounds[1]
        {
            return Err(invalid(format!(
                "extractor {label} pair or bounds are outside their canonical domain"
            )));
        }
        previous = Some(*pair);
    }
    Ok(())
}

fn validate_indices<const WIDTH: usize>(
    label: &str,
    values: &[[u32; WIDTH]],
    atom_count: usize,
) -> Result<(), ConformerExtractError> {
    if flatten(values).any(|index| index as usize >= atom_count) {
        return Err(invalid(format!(
            "extractor {label} contains an out-of-range atom index"
        )));
    }
    Ok(())
}

fn flatten<T, const WIDTH: usize>(values: &[[T; WIDTH]]) -> impl Iterator<Item = T> + '_
where
    T: Copy,
{
    values.iter().flat_map(|value| value.iter().copied())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ConformerExtractError> {
    Ok(u16::from_le_bytes(
        bytes
            .get(offset..offset + 2)
            .ok_or_else(|| invalid("extractor header is truncated"))?
            .try_into()
            .expect("two-byte header field"),
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ConformerExtractError> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or_else(|| invalid("extractor header is truncated"))?
            .try_into()
            .expect("four-byte header field"),
    ))
}

fn variant_from_tag(tag: u8) -> Result<ConformerVariant, ConformerExtractError> {
    ConformerVariant::ALL
        .get(tag as usize)
        .copied()
        .ok_or_else(|| invalid("extractor variant tag is outside ABI v1"))
}

fn invalid(message: impl Into<String>) -> ConformerExtractError {
    ConformerExtractError::new(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_minimal_known_answer() {
        let bytes = minimal_fixture();
        let decoded = ExtractedConformerParameters::decode(
            &bytes,
            ConformerVariant::EtkdgV3,
            bytes.len() as u64,
        )
        .expect("valid fixture");
        assert_eq!(decoded.atomic_numbers, [6, 8]);
        assert_eq!(decoded.formal_charges, [0, -1]);
        assert_eq!(decoded.distance_atom_pairs, [[0, 1]]);
        assert_eq!(decoded.distance_bounds_squared, [[1.0, 2.25]]);
    }

    #[test]
    fn rejects_identity_and_domain_mismatches() {
        let bytes = minimal_fixture();
        assert!(ExtractedConformerParameters::decode(
            &bytes,
            ConformerVariant::Dg,
            bytes.len() as u64
        )
        .is_err());

        let mut decoded =
            ExtractedConformerParameters::decode(&minimal_fixture(), ConformerVariant::EtkdgV3, 92)
                .expect("valid fixture");
        decoded.distance_weights.clear();
        assert!(decoded.validate().is_err());
        let mut invalid = bytes;
        invalid[80..84].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(ExtractedConformerParameters::decode(
            &invalid,
            ConformerVariant::EtkdgV3,
            invalid.len() as u64
        )
        .is_err());
    }

    fn minimal_fixture() -> Vec<u8> {
        let mut bytes = vec![0_u8; 92];
        bytes[..4].copy_from_slice(b"BCEX");
        bytes[4..6].copy_from_slice(&ABI_VERSION.to_le_bytes());
        bytes[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
        bytes[8] = 6;
        bytes[12..16].copy_from_slice(&2_u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&1_u32.to_le_bytes());
        bytes[40..44].copy_from_slice(&28_u32.to_le_bytes());
        bytes[44..48].copy_from_slice(&92_u32.to_le_bytes());
        bytes[48..52].copy_from_slice(&RDKIT_RELEASE.to_le_bytes());
        bytes[64..66].copy_from_slice(&6_u16.to_le_bytes());
        bytes[66..68].copy_from_slice(&8_u16.to_le_bytes());
        bytes[69] = (-1_i8) as u8;
        bytes[76..80].copy_from_slice(&1_u32.to_le_bytes());
        bytes[80..84].copy_from_slice(&1.0_f32.to_le_bytes());
        bytes[84..88].copy_from_slice(&2.25_f32.to_le_bytes());
        bytes[88..92].copy_from_slice(&1.0_f32.to_le_bytes());
        bytes
    }
}
