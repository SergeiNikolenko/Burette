use burette_compute_core::{
    validate_stereo_constraints, ChiralVolumeConstraint, TetrahedralConstraint,
};
use burette_compute_metal::MetalStereoValidation;
use burette_compute_protocol::MAX_PACK_BYTES;

const INPUT_MAGIC: &[u8; 4] = b"BST1";
const OUTPUT_MAGIC: &[u8; 4] = b"BSV1";
const INPUT_HEADER_BYTES: u64 = 32;
const OUTPUT_HEADER_BYTES: u64 = 12;
const POSITION_BYTES: u64 = 16;
const CHIRAL_BYTES: u64 = 24;
const TETRAHEDRAL_BYTES: u64 = 24;

pub(super) struct OwnedInput {
    pub positions: Vec<[f32; 4]>,
    pub atom_count: u32,
    pub chiral: Vec<ChiralVolumeConstraint>,
    pub tetrahedral: Vec<TetrahedralConstraint>,
    pub max_memory_bytes: u64,
}

pub(super) fn encode_input(
    positions: &[[f32; 4]],
    atom_count: u32,
    chiral: &[ChiralVolumeConstraint],
    tetrahedral: &[TetrahedralConstraint],
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    validate_shape(positions, atom_count)?;
    validate_stereo_constraints(atom_count as usize, chiral, tetrahedral)
        .map_err(|error| error.to_string())?;
    let bytes = input_bound(positions.len(), chiral.len(), tetrahedral.len())?;
    let mut output = Vec::with_capacity(bytes as usize);
    output.extend_from_slice(INPUT_MAGIC);
    push_u32(&mut output, atom_count);
    push_u32(&mut output, count(positions.len(), "stereo positions")?);
    push_u32(&mut output, count(chiral.len(), "chiral constraints")?);
    push_u32(
        &mut output,
        count(tetrahedral.len(), "tetrahedral constraints")?,
    );
    push_u32(&mut output, 0);
    push_u64(&mut output, max_memory_bytes);
    for position in positions {
        for value in position {
            push_f32(&mut output, *value);
        }
    }
    for constraint in chiral {
        for atom in constraint.atoms {
            push_u32(&mut output, atom);
        }
        push_f32(&mut output, constraint.lower);
        push_f32(&mut output, constraint.upper);
    }
    for constraint in tetrahedral {
        for atom in constraint.atoms {
            push_u32(&mut output, atom);
        }
        push_u32(&mut output, u32::from(constraint.in_fused_small_ring));
    }
    Ok(output)
}

pub(super) fn decode_input(input: &[u8]) -> Result<OwnedInput, String> {
    let mut cursor = Cursor::new(input);
    cursor.magic(INPUT_MAGIC)?;
    let atom_count = cursor.u32()?;
    let position_count = cursor.u32()? as usize;
    let chiral_count = cursor.u32()? as usize;
    let tetrahedral_count = cursor.u32()? as usize;
    if cursor.u32()? != 0
        || input.len() as u64 != input_bound(position_count, chiral_count, tetrahedral_count)?
    {
        return Err("stereo input header is invalid".into());
    }
    let max_memory_bytes = cursor.u64()?;
    let mut positions = Vec::with_capacity(position_count);
    for _ in 0..position_count {
        positions.push(cursor.position()?);
    }
    let mut chiral = Vec::with_capacity(chiral_count);
    for _ in 0..chiral_count {
        chiral.push(ChiralVolumeConstraint {
            atoms: cursor.u32_array()?,
            lower: cursor.f32()?,
            upper: cursor.f32()?,
        });
    }
    let mut tetrahedral = Vec::with_capacity(tetrahedral_count);
    for _ in 0..tetrahedral_count {
        let atoms = cursor.u32_array()?;
        let in_fused_small_ring = match cursor.u32()? {
            0 => false,
            1 => true,
            _ => return Err("tetrahedral flag is invalid".into()),
        };
        tetrahedral.push(TetrahedralConstraint {
            atoms,
            in_fused_small_ring,
        });
    }
    validate_shape(&positions, atom_count)?;
    validate_stereo_constraints(atom_count as usize, &chiral, &tetrahedral)
        .map_err(|error| error.to_string())?;
    Ok(OwnedInput {
        positions,
        atom_count,
        chiral,
        tetrahedral,
        max_memory_bytes,
    })
}

pub(super) fn output_bound(conformer_count: usize) -> Result<u64, String> {
    OUTPUT_HEADER_BYTES
        .checked_add(
            (conformer_count as u64)
                .checked_mul(4)
                .ok_or("stereo output overflow")?,
        )
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "stereo output exceeds the compute exchange bound".into())
}

pub(super) fn encode_output(result: &MetalStereoValidation) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(output_bound(result.failure_flags.len())? as usize);
    output.extend_from_slice(OUTPUT_MAGIC);
    push_u32(
        &mut output,
        count(result.failure_flags.len(), "stereo results")?,
    );
    push_u32(&mut output, 0);
    for flag in &result.failure_flags {
        push_u32(&mut output, *flag);
    }
    Ok(output)
}

pub(super) fn decode_output(
    output: &[u8],
    gpu_time_ms: u64,
) -> Result<MetalStereoValidation, String> {
    let mut cursor = Cursor::new(output);
    cursor.magic(OUTPUT_MAGIC)?;
    let conformer_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 || conformer_count == 0 {
        return Err("stereo output header is invalid".into());
    }
    if output.len() as u64 != output_bound(conformer_count)? {
        return Err("stereo output byte length is inconsistent".into());
    }
    let mut failure_flags = Vec::with_capacity(conformer_count);
    for _ in 0..conformer_count {
        failure_flags.push(cursor.u32()?);
    }
    Ok(MetalStereoValidation {
        failure_flags,
        gpu_time_ms,
    })
}

fn validate_shape(positions: &[[f32; 4]], atom_count: u32) -> Result<(), String> {
    if atom_count == 0
        || positions.is_empty()
        || !positions.len().is_multiple_of(atom_count as usize)
        || positions.iter().flatten().any(|value| !value.is_finite())
    {
        Err("stereo positions are not a finite conformer batch".into())
    } else {
        Ok(())
    }
}

fn input_bound(positions: usize, chiral: usize, tetrahedral: usize) -> Result<u64, String> {
    let mut bytes = INPUT_HEADER_BYTES;
    for (count, width) in [
        (positions, POSITION_BYTES),
        (chiral, CHIRAL_BYTES),
        (tetrahedral, TETRAHEDRAL_BYTES),
    ] {
        bytes = bytes
            .checked_add(
                (count as u64)
                    .checked_mul(width)
                    .ok_or("stereo input overflow")?,
            )
            .ok_or("stereo input overflow")?;
    }
    (bytes <= MAX_PACK_BYTES)
        .then_some(bytes)
        .ok_or_else(|| "stereo input exceeds the compute exchange bound".into())
}

fn count(value: usize, label: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("too many {label}"))
}
fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn push_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn push_f32(output: &mut Vec<u8>, value: f32) {
    output.extend_from_slice(&value.to_le_bytes());
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self
            .offset
            .checked_add(N)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("stereo payload is truncated")?;
        let value = self.bytes[self.offset..end]
            .try_into()
            .expect("fixed slice");
        self.offset = end;
        Ok(value)
    }
    fn magic(&mut self, expected: &[u8; 4]) -> Result<(), String> {
        if self.array::<4>()? == *expected {
            Ok(())
        } else {
            Err("stereo operation magic is invalid".into())
        }
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let value = f32::from_le_bytes(self.array()?);
        value
            .is_finite()
            .then_some(value)
            .ok_or_else(|| "stereo payload contains a non-finite float".into())
    }
    fn position(&mut self) -> Result<[f32; 4], String> {
        Ok([self.f32()?, self.f32()?, self.f32()?, self.f32()?])
    }
    fn u32_array<const N: usize>(&mut self) -> Result<[u32; N], String> {
        let mut values = [0; N];
        for value in &mut values {
            *value = self.u32()?;
        }
        Ok(values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exchange_round_trips() {
        let positions = vec![[0.0; 4]; 5];
        let chiral = [ChiralVolumeConstraint {
            atoms: [0, 1, 2, 3],
            lower: -1.0,
            upper: 1.0,
        }];
        let tetrahedral = [TetrahedralConstraint {
            atoms: [0, 1, 2, 3, 4],
            in_fused_small_ring: true,
        }];
        let encoded = encode_input(&positions, 5, &chiral, &tetrahedral, 4096).unwrap();
        let decoded = decode_input(&encoded).unwrap();
        assert_eq!(decoded.positions, positions);
        assert_eq!(decoded.chiral, chiral);
        assert_eq!(decoded.tetrahedral, tetrahedral);

        let expected = MetalStereoValidation {
            failure_flags: vec![3],
            gpu_time_ms: 7,
        };
        let output = encode_output(&expected).unwrap();
        assert_eq!(decode_output(&output, 7).unwrap(), expected);
    }

    #[test]
    fn rejects_noncanonical_boolean() {
        let positions = vec![[0.0; 4]; 5];
        let tetrahedral = [TetrahedralConstraint {
            atoms: [0, 1, 2, 3, 4],
            in_fused_small_ring: false,
        }];
        let mut encoded = encode_input(&positions, 5, &[], &tetrahedral, 1).unwrap();
        let last = encoded.len() - 4;
        encoded[last..].copy_from_slice(&2_u32.to_le_bytes());
        assert!(decode_input(&encoded).is_err());
    }
}
