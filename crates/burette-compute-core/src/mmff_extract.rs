//! Strict decoder for the pinned native RDKit BMFX parameter ABI.

use crate::{
    validate_mmff_parameters, MmffAngleTerm, MmffBondTerm, MmffElectrostaticTerm,
    MmffOutOfPlaneTerm, MmffParameters, MmffStretchBendTerm, MmffTorsionTerm, MmffVanDerWaalsTerm,
    MmffVariant,
};

const MAGIC: &[u8; 4] = b"BMFX";
const VERSION: u16 = 1;
const HEADER_BYTES: usize = 64;
const RDKIT_RELEASE: u32 = 20_250_304;
const TERM_BYTES: usize = 48;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeMmffParameters {
    pub parameters: MmffParameters,
    pub partial_charges: Vec<f32>,
}

pub fn decode_native_mmff_parameters(
    bytes: &[u8],
    maximum_bytes: usize,
) -> Result<NativeMmffParameters, MmffExtractError> {
    if bytes.len() < HEADER_BYTES || bytes.len() > maximum_bytes {
        return invalid("MMFF extractor output is outside its admitted byte envelope");
    }
    if bytes.get(..4) != Some(MAGIC)
        || read_u16(bytes, 4)? != VERSION
        || read_u16(bytes, 6)? as usize != HEADER_BYTES
        || read_u32(bytes, 52)? != RDKIT_RELEASE
        || bytes[9..12]
            .iter()
            .chain(&bytes[56..64])
            .any(|byte| *byte != 0)
    {
        return invalid("MMFF extractor header is incompatible with BMFX v1");
    }
    let variant = match bytes[8] {
        0 => MmffVariant::Mmff94,
        1 => MmffVariant::Mmff94s,
        _ => return invalid("MMFF extractor variant is unsupported"),
    };
    let atom_count = read_u32(bytes, 12)?;
    if atom_count == 0 {
        return invalid("MMFF extractor returned an empty molecule");
    }
    let counts = std::array::from_fn::<_, 7, _>(|index| {
        read_u32(bytes, 16 + index * 4).map(|value| value as usize)
    });
    let counts = counts.into_iter().collect::<Result<Vec<_>, _>>()?;
    let payload_bytes = read_u32(bytes, 44)? as usize;
    let total_bytes = read_u32(bytes, 48)? as usize;
    if total_bytes != bytes.len() || payload_bytes != bytes.len() - HEADER_BYTES {
        return invalid("MMFF extractor byte counts differ from the received buffer");
    }
    let charge_bytes = (atom_count as usize)
        .checked_mul(size_of::<f32>())
        .ok_or_else(overflow)?;
    let term_count = counts
        .iter()
        .try_fold(0_usize, |total, count| total.checked_add(*count))
        .ok_or_else(overflow)?;
    let expected = align16(
        HEADER_BYTES
            .checked_add(charge_bytes)
            .ok_or_else(overflow)?,
    )?
    .checked_add(term_count.checked_mul(TERM_BYTES).ok_or_else(overflow)?)
    .ok_or_else(overflow)?;
    if expected != bytes.len() {
        return invalid("MMFF extractor payload shape differs from its counts");
    }

    let mut partial_charges = Vec::with_capacity(atom_count as usize);
    for index in 0..atom_count as usize {
        partial_charges.push(read_f32(bytes, HEADER_BYTES + index * 4)?);
    }
    if partial_charges.iter().any(|value| !value.is_finite()) {
        return invalid("MMFF extractor partial charges must be finite");
    }
    let mut cursor = align16(HEADER_BYTES + charge_bytes)?;
    let mut groups = Vec::with_capacity(7);
    for count in counts {
        let mut terms = Vec::with_capacity(count);
        for _ in 0..count {
            terms.push(read_term(bytes, cursor)?);
            cursor += TERM_BYTES;
        }
        groups.push(terms);
    }
    let [bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics]: [Vec<RawTerm>; 7] =
        groups.try_into().expect("seven BMFX term groups");
    let parameters = MmffParameters {
        variant,
        atom_count,
        bonds: bonds
            .into_iter()
            .map(|term| {
                require_zero(&term, &[2, 3], &[2, 3], &[0, 1, 2, 3])?;
                Ok(MmffBondTerm {
                    atoms: [term.atoms[0], term.atoms[1]],
                    force_constant: term.parameters0[0],
                    equilibrium_distance: term.parameters0[1],
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        angles: angles
            .into_iter()
            .map(|term| {
                require_zero(&term, &[3], &[3], &[0, 1, 2, 3])?;
                let linear = exact_flag(term.parameters0[2])?;
                Ok(MmffAngleTerm {
                    atoms: [term.atoms[0], term.atoms[1], term.atoms[2]],
                    force_constant: term.parameters0[0],
                    equilibrium_degrees: term.parameters0[1],
                    linear,
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        stretch_bends: stretch_bends
            .into_iter()
            .map(|term| {
                require_zero(&term, &[3], &[], &[1, 2, 3])?;
                Ok(MmffStretchBendTerm {
                    atoms: [term.atoms[0], term.atoms[1], term.atoms[2]],
                    force_ij: term.parameters0[0],
                    force_kj: term.parameters0[1],
                    equilibrium_ij: term.parameters0[2],
                    equilibrium_kj: term.parameters0[3],
                    equilibrium_degrees: term.parameters1[0],
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        out_of_planes: out_of_planes
            .into_iter()
            .map(|term| {
                require_zero(&term, &[], &[1, 2, 3], &[0, 1, 2, 3])?;
                Ok(MmffOutOfPlaneTerm {
                    atoms: term.atoms,
                    force_constant: term.parameters0[0],
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        torsions: torsions
            .into_iter()
            .map(|term| {
                require_zero(&term, &[], &[3], &[0, 1, 2, 3])?;
                Ok(MmffTorsionTerm {
                    atoms: term.atoms,
                    v1: term.parameters0[0],
                    v2: term.parameters0[1],
                    v3: term.parameters0[2],
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        van_der_waals: van_der_waals
            .into_iter()
            .map(|term| {
                require_zero(&term, &[2, 3], &[2, 3], &[0, 1, 2, 3])?;
                Ok(MmffVanDerWaalsTerm {
                    atoms: [term.atoms[0], term.atoms[1]],
                    r_star: term.parameters0[0],
                    epsilon: term.parameters0[1],
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
        electrostatics: electrostatics
            .into_iter()
            .map(|term| {
                require_zero(&term, &[2, 3], &[2, 3], &[0, 1, 2, 3])?;
                let is_one_four = exact_flag(term.parameters0[1])?;
                Ok(MmffElectrostaticTerm {
                    atoms: [term.atoms[0], term.atoms[1]],
                    charge_product: term.parameters0[0],
                    is_one_four,
                })
            })
            .collect::<Result<_, MmffExtractError>>()?,
    };
    validate_mmff_parameters(&parameters).map_err(|error| MmffExtractError(error.to_string()))?;
    Ok(NativeMmffParameters {
        parameters,
        partial_charges,
    })
}

#[derive(Clone, Copy, Debug)]
struct RawTerm {
    atoms: [u32; 4],
    parameters0: [f32; 4],
    parameters1: [f32; 4],
}

fn read_term(bytes: &[u8], offset: usize) -> Result<RawTerm, MmffExtractError> {
    let mut atoms = [0_u32; 4];
    let mut parameters0 = [0.0_f32; 4];
    let mut parameters1 = [0.0_f32; 4];
    for index in 0..4 {
        atoms[index] = read_u32(bytes, offset + index * 4)?;
        parameters0[index] = read_f32(bytes, offset + 16 + index * 4)?;
        parameters1[index] = read_f32(bytes, offset + 32 + index * 4)?;
    }
    Ok(RawTerm {
        atoms,
        parameters0,
        parameters1,
    })
}

fn require_zero(
    term: &RawTerm,
    zero_atoms: &[usize],
    zero_parameters0: &[usize],
    zero_parameters1: &[usize],
) -> Result<(), MmffExtractError> {
    if zero_atoms.iter().any(|index| term.atoms[*index] != 0)
        || zero_parameters0
            .iter()
            .any(|index| term.parameters0[*index] != 0.0)
        || zero_parameters1
            .iter()
            .any(|index| term.parameters1[*index] != 0.0)
    {
        return invalid("MMFF extractor term contains nonzero reserved values");
    }
    Ok(())
}

fn exact_flag(value: f32) -> Result<bool, MmffExtractError> {
    match value {
        0.0 => Ok(false),
        1.0 => Ok(true),
        _ => invalid("MMFF extractor term contains a non-binary flag"),
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, MmffExtractError> {
    Ok(u16::from_le_bytes(read_array(bytes, offset)?))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, MmffExtractError> {
    Ok(u32::from_le_bytes(read_array(bytes, offset)?))
}

fn read_f32(bytes: &[u8], offset: usize) -> Result<f32, MmffExtractError> {
    Ok(f32::from_le_bytes(read_array(bytes, offset)?))
}

fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], MmffExtractError> {
    bytes
        .get(offset..offset + N)
        .ok_or_else(|| MmffExtractError("MMFF extractor payload is truncated".into()))?
        .try_into()
        .map_err(|_| MmffExtractError("MMFF extractor payload is truncated".into()))
}

fn align16(value: usize) -> Result<usize, MmffExtractError> {
    value
        .checked_add(15)
        .map(|value| value / 16 * 16)
        .ok_or_else(overflow)
}

fn overflow() -> MmffExtractError {
    MmffExtractError("MMFF extractor payload size overflowed".into())
}

fn invalid<T>(message: impl Into<String>) -> Result<T, MmffExtractError> {
    Err(MmffExtractError(message.into()))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MmffExtractError(String);

impl std::fmt::Display for MmffExtractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for MmffExtractError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_known_bmfx_parameter_pack() {
        let mut bytes = header(2, [1, 0, 0, 0, 0, 0, 0], 128);
        bytes.extend_from_slice(&0.1_f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.1_f32).to_le_bytes());
        bytes.resize(80, 0);
        push_term(&mut bytes, [0, 1, 0, 0], [4.0, 1.2, 0.0, 0.0], [0.0; 4]);
        let decoded = decode_native_mmff_parameters(&bytes, bytes.len()).unwrap();
        assert_eq!(decoded.parameters.variant, MmffVariant::Mmff94s);
        assert_eq!(decoded.parameters.bonds.len(), 1);
        assert_eq!(decoded.partial_charges, [0.1, -0.1]);
    }

    #[test]
    fn rejects_reserved_values_and_size_mismatch() {
        let mut bytes = header(1, [0; 7], 80);
        bytes.extend_from_slice(&0.0_f32.to_le_bytes());
        bytes.resize(80, 0);
        bytes[9] = 1;
        assert!(decode_native_mmff_parameters(&bytes, bytes.len()).is_err());
        bytes[9] = 0;
        bytes[48..52].copy_from_slice(&79_u32.to_le_bytes());
        assert!(decode_native_mmff_parameters(&bytes, bytes.len()).is_err());
    }

    fn header(atom_count: u32, counts: [u32; 7], total: u32) -> Vec<u8> {
        let mut bytes = vec![0_u8; HEADER_BYTES];
        bytes[..4].copy_from_slice(MAGIC);
        bytes[4..6].copy_from_slice(&VERSION.to_le_bytes());
        bytes[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
        bytes[8] = 1;
        bytes[12..16].copy_from_slice(&atom_count.to_le_bytes());
        for (index, count) in counts.into_iter().enumerate() {
            bytes[16 + index * 4..20 + index * 4].copy_from_slice(&count.to_le_bytes());
        }
        bytes[44..48].copy_from_slice(&(total - HEADER_BYTES as u32).to_le_bytes());
        bytes[48..52].copy_from_slice(&total.to_le_bytes());
        bytes[52..56].copy_from_slice(&RDKIT_RELEASE.to_le_bytes());
        bytes
    }

    fn push_term(bytes: &mut Vec<u8>, atoms: [u32; 4], p0: [f32; 4], p1: [f32; 4]) {
        for value in atoms {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in p0 {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in p1 {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
}
