use burrete_compute_core::{
    DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus, MmffAngleTerm,
    MmffBondTerm, MmffElectrostaticTerm, MmffOptimizerKind, MmffOutOfPlaneTerm, MmffParameters,
    MmffStretchBendTerm, MmffTorsionTerm, MmffVanDerWaalsTerm, MmffVariant,
};
use burrete_compute_metal::MetalMmffOptimization;
use burrete_compute_protocol::MAX_PACK_BYTES;

const INPUT_MAGIC: &[u8; 4] = b"BMF1";
const OUTPUT_MAGIC: &[u8; 4] = b"BMO1";
const INPUT_HEADER_BYTES: u64 = 112;
const OUTPUT_HEADER_BYTES: u64 = 16;
const TERM_BYTES: u64 = 48;
const POSITION_BYTES: u64 = 16;
const RESULT_BYTES: u64 = 20;

pub(super) struct OwnedMmffInput {
    pub positions: Vec<[f32; 4]>,
    pub parameters: MmffParameters,
    pub options: DistanceGeometryOptimizationOptions,
    pub max_memory_bytes: u64,
}

pub(super) fn encode_input(
    positions: &[[f32; 4]],
    parameters: &MmffParameters,
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    options.validate().map_err(|error| error.to_string())?;
    let atom_count = parameters.atom_count as usize;
    if atom_count == 0 || positions.is_empty() || !positions.len().is_multiple_of(atom_count) {
        return Err("MMFF positions do not contain complete conformers".into());
    }
    let conformer_count = positions.len() / atom_count;
    let counts = term_counts(parameters);
    let total = input_bytes(positions.len(), counts)?;
    let mut output = Vec::with_capacity(total as usize);
    output.extend_from_slice(INPUT_MAGIC);
    push_u32(&mut output, variant_tag(parameters.variant));
    push_u32(&mut output, parameters.atom_count);
    push_u32(&mut output, conformer_count as u32);
    push_u32(&mut output, options.max_iterations);
    push_u32(&mut output, options.history_size.into());
    push_u32(&mut output, options.max_line_search_steps.into());
    push_u32(&mut output, 0);
    push_f32(&mut output, options.gradient_tolerance);
    push_f32(&mut output, options.relative_step_tolerance);
    push_f32(&mut output, options.armijo_coefficient);
    push_f32(&mut output, options.max_step_factor);
    push_u64(&mut output, max_memory_bytes);
    for count in counts {
        push_u64(&mut output, count);
    }
    for position in positions {
        for value in position {
            push_f32(&mut output, *value);
        }
    }
    for term in &parameters.bonds {
        push_term(
            &mut output,
            [term.atoms[0], term.atoms[1], 0, 0],
            [
                term.force_constant,
                term.equilibrium_distance,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ],
        );
    }
    for term in &parameters.angles {
        push_term(
            &mut output,
            [term.atoms[0], term.atoms[1], term.atoms[2], 0],
            [
                term.force_constant,
                term.equilibrium_degrees,
                if term.linear { 1.0 } else { 0.0 },
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ],
        );
    }
    for term in &parameters.stretch_bends {
        push_term(
            &mut output,
            [term.atoms[0], term.atoms[1], term.atoms[2], 0],
            [
                term.force_ij,
                term.force_kj,
                term.equilibrium_ij,
                term.equilibrium_kj,
                term.equilibrium_degrees,
                0.0,
                0.0,
                0.0,
            ],
        );
    }
    for term in &parameters.out_of_planes {
        push_term(
            &mut output,
            term.atoms,
            [term.force_constant, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        );
    }
    for term in &parameters.torsions {
        push_term(
            &mut output,
            term.atoms,
            [term.v1, term.v2, term.v3, 0.0, 0.0, 0.0, 0.0, 0.0],
        );
    }
    for term in &parameters.van_der_waals {
        push_term(
            &mut output,
            [term.atoms[0], term.atoms[1], 0, 0],
            [term.r_star, term.epsilon, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        );
    }
    for term in &parameters.electrostatics {
        push_term(
            &mut output,
            [term.atoms[0], term.atoms[1], 0, 0],
            [
                term.charge_product,
                if term.is_one_four { 1.0 } else { 0.0 },
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ],
        );
    }
    Ok(output)
}

pub(super) fn decode_input(input: &[u8]) -> Result<OwnedMmffInput, String> {
    let mut cursor = Cursor::new(input);
    cursor.magic(INPUT_MAGIC)?;
    let variant = variant(cursor.u32()?)?;
    let atom_count = cursor.u32()?;
    let conformer_count = cursor.u32()?;
    let max_iterations = cursor.u32()?;
    let history_size = u8::try_from(cursor.u32()?).map_err(|_| "MMFF history size is invalid")?;
    let max_line_search_steps =
        u8::try_from(cursor.u32()?).map_err(|_| "MMFF line-search limit is invalid")?;
    if cursor.u32()? != 0 {
        return Err("MMFF input reserved field is non-zero".into());
    }
    let options = DistanceGeometryOptimizationOptions {
        max_iterations,
        history_size,
        gradient_tolerance: cursor.f32()?,
        relative_step_tolerance: cursor.f32()?,
        armijo_coefficient: cursor.f32()?,
        max_line_search_steps,
        max_step_factor: cursor.f32()?,
    }
    .validate()
    .map_err(|error| error.to_string())?;
    let max_memory_bytes = cursor.u64()?;
    let mut counts = [0_u64; 7];
    for count in &mut counts {
        *count = cursor.u64()?;
    }
    let position_count = u64::from(atom_count)
        .checked_mul(u64::from(conformer_count))
        .ok_or("MMFF position count overflow")?;
    if input.len() as u64 != input_bytes(position_count as usize, counts)? {
        return Err("MMFF input byte length is inconsistent".into());
    }
    let mut positions = Vec::with_capacity(position_count as usize);
    for _ in 0..position_count {
        positions.push([cursor.f32()?, cursor.f32()?, cursor.f32()?, cursor.f32()?]);
    }
    let mut groups = Vec::with_capacity(7);
    for count in counts {
        let mut group = Vec::with_capacity(count as usize);
        for _ in 0..count {
            group.push(cursor.term()?);
        }
        groups.push(group);
    }
    let [bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics]: [Vec<RawTerm>; 7] =
        groups.try_into().expect("seven MMFF groups");
    let parameters = MmffParameters {
        variant,
        atom_count,
        bonds: bonds
            .into_iter()
            .map(|t| MmffBondTerm {
                atoms: [t.atoms[0], t.atoms[1]],
                force_constant: t.values[0],
                equilibrium_distance: t.values[1],
            })
            .collect(),
        angles: angles
            .into_iter()
            .map(|t| {
                Ok(MmffAngleTerm {
                    atoms: [t.atoms[0], t.atoms[1], t.atoms[2]],
                    force_constant: t.values[0],
                    equilibrium_degrees: t.values[1],
                    linear: bool_value(t.values[2])?,
                })
            })
            .collect::<Result<_, String>>()?,
        stretch_bends: stretch_bends
            .into_iter()
            .map(|t| MmffStretchBendTerm {
                atoms: [t.atoms[0], t.atoms[1], t.atoms[2]],
                force_ij: t.values[0],
                force_kj: t.values[1],
                equilibrium_ij: t.values[2],
                equilibrium_kj: t.values[3],
                equilibrium_degrees: t.values[4],
            })
            .collect(),
        out_of_planes: out_of_planes
            .into_iter()
            .map(|t| MmffOutOfPlaneTerm {
                atoms: t.atoms,
                force_constant: t.values[0],
            })
            .collect(),
        torsions: torsions
            .into_iter()
            .map(|t| MmffTorsionTerm {
                atoms: t.atoms,
                v1: t.values[0],
                v2: t.values[1],
                v3: t.values[2],
            })
            .collect(),
        van_der_waals: van_der_waals
            .into_iter()
            .map(|t| MmffVanDerWaalsTerm {
                atoms: [t.atoms[0], t.atoms[1]],
                r_star: t.values[0],
                epsilon: t.values[1],
            })
            .collect(),
        electrostatics: electrostatics
            .into_iter()
            .map(|t| {
                Ok(MmffElectrostaticTerm {
                    atoms: [t.atoms[0], t.atoms[1]],
                    charge_product: t.values[0],
                    is_one_four: bool_value(t.values[1])?,
                })
            })
            .collect::<Result<_, String>>()?,
    };
    Ok(OwnedMmffInput {
        positions,
        parameters,
        options,
        max_memory_bytes,
    })
}

pub(super) fn output_bound(position_count: usize, conformer_count: usize) -> Result<u64, String> {
    OUTPUT_HEADER_BYTES
        .checked_add(
            (position_count as u64)
                .checked_mul(POSITION_BYTES)
                .ok_or("MMFF output overflow")?,
        )
        .and_then(|value| value.checked_add((conformer_count as u64).checked_mul(RESULT_BYTES)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "MMFF output exceeds the compute exchange bound".into())
}

pub(super) fn encode_output(
    result: &MetalMmffOptimization,
    atom_count: u32,
) -> Result<Vec<u8>, String> {
    let conformer_count = result.energies.len();
    let expected_positions = conformer_count
        .checked_mul(atom_count as usize)
        .ok_or("MMFF output count overflow")?;
    if result.positions.len() != expected_positions
        || result.statuses.len() != conformer_count
        || result.optimizers.len() != conformer_count
        || result.iterations.len() != conformer_count
        || result.scaled_gradient_maxima.len() != conformer_count
    {
        return Err("MMFF output arrays are inconsistent".into());
    }
    let mut output =
        Vec::with_capacity(output_bound(result.positions.len(), conformer_count)? as usize);
    output.extend_from_slice(OUTPUT_MAGIC);
    push_u32(&mut output, atom_count);
    push_u32(&mut output, conformer_count as u32);
    push_u32(&mut output, 0);
    for position in &result.positions {
        for value in position {
            push_f32(&mut output, *value);
        }
    }
    for index in 0..conformer_count {
        push_f32(&mut output, result.energies[index]);
        push_f32(&mut output, result.scaled_gradient_maxima[index]);
        push_u32(&mut output, result.iterations[index]);
        push_u32(&mut output, status_tag(result.statuses[index]));
        push_u32(&mut output, optimizer_tag(result.optimizers[index]));
    }
    Ok(output)
}

pub(super) fn decode_output(
    output: &[u8],
    gpu_time_ms: u64,
) -> Result<MetalMmffOptimization, String> {
    let mut cursor = Cursor::new(output);
    cursor.magic(OUTPUT_MAGIC)?;
    let atom_count = cursor.u32()? as usize;
    let conformer_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 || atom_count == 0 || conformer_count == 0 {
        return Err("MMFF output header is invalid".into());
    }
    let position_count = atom_count
        .checked_mul(conformer_count)
        .ok_or("MMFF output count overflow")?;
    if output.len() as u64 != output_bound(position_count, conformer_count)? {
        return Err("MMFF output byte length is inconsistent".into());
    }
    let mut positions = Vec::with_capacity(position_count);
    for _ in 0..position_count {
        positions.push([cursor.f32()?, cursor.f32()?, cursor.f32()?, cursor.f32()?]);
    }
    let mut energies = Vec::with_capacity(conformer_count);
    let mut scaled_gradient_maxima = Vec::with_capacity(conformer_count);
    let mut iterations = Vec::with_capacity(conformer_count);
    let mut statuses = Vec::with_capacity(conformer_count);
    let mut optimizers = Vec::with_capacity(conformer_count);
    for _ in 0..conformer_count {
        energies.push(cursor.f32()?);
        scaled_gradient_maxima.push(cursor.f32()?);
        iterations.push(cursor.u32()?);
        statuses.push(status(cursor.u32()?)?);
        optimizers.push(optimizer(cursor.u32()?)?);
    }
    Ok(MetalMmffOptimization {
        positions,
        energies,
        scaled_gradient_maxima,
        iterations,
        statuses,
        optimizers,
        gpu_time_ms,
    })
}

#[derive(Clone, Copy, Debug)]
struct RawTerm {
    atoms: [u32; 4],
    values: [f32; 8],
}
fn term_counts(p: &MmffParameters) -> [u64; 7] {
    [
        p.bonds.len() as u64,
        p.angles.len() as u64,
        p.stretch_bends.len() as u64,
        p.out_of_planes.len() as u64,
        p.torsions.len() as u64,
        p.van_der_waals.len() as u64,
        p.electrostatics.len() as u64,
    ]
}
fn input_bytes(positions: usize, counts: [u64; 7]) -> Result<u64, String> {
    let terms = counts
        .into_iter()
        .try_fold(0_u64, |sum, count| sum.checked_add(count))
        .ok_or("MMFF term count overflow")?;
    INPUT_HEADER_BYTES
        .checked_add(
            (positions as u64)
                .checked_mul(POSITION_BYTES)
                .ok_or("MMFF position bytes overflow")?,
        )
        .and_then(|v| v.checked_add(terms.checked_mul(TERM_BYTES)?))
        .filter(|v| *v <= MAX_PACK_BYTES)
        .ok_or_else(|| "MMFF input exceeds the compute exchange bound".into())
}
fn push_term(out: &mut Vec<u8>, atoms: [u32; 4], values: [f32; 8]) {
    for v in atoms {
        push_u32(out, v);
    }
    for v in values {
        push_f32(out, v);
    }
}
fn push_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn push_u64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn push_f32(out: &mut Vec<u8>, v: f32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn bool_value(v: f32) -> Result<bool, String> {
    if v == 0.0 {
        Ok(false)
    } else if v == 1.0 {
        Ok(true)
    } else {
        Err("MMFF boolean field is invalid".into())
    }
}
fn variant_tag(v: MmffVariant) -> u32 {
    match v {
        MmffVariant::Mmff94 => 0,
        MmffVariant::Mmff94s => 1,
    }
}
fn variant(v: u32) -> Result<MmffVariant, String> {
    match v {
        0 => Ok(MmffVariant::Mmff94),
        1 => Ok(MmffVariant::Mmff94s),
        _ => Err("MMFF variant is invalid".into()),
    }
}
fn status_tag(v: DistanceGeometryOptimizationStatus) -> u32 {
    match v {
        DistanceGeometryOptimizationStatus::ConvergedGradient => 0,
        DistanceGeometryOptimizationStatus::ConvergedStep => 1,
        DistanceGeometryOptimizationStatus::LineSearchExhausted => 2,
        DistanceGeometryOptimizationStatus::MaxIterations => 3,
    }
}
fn status(v: u32) -> Result<DistanceGeometryOptimizationStatus, String> {
    match v {
        0 => Ok(DistanceGeometryOptimizationStatus::ConvergedGradient),
        1 => Ok(DistanceGeometryOptimizationStatus::ConvergedStep),
        2 => Ok(DistanceGeometryOptimizationStatus::LineSearchExhausted),
        3 => Ok(DistanceGeometryOptimizationStatus::MaxIterations),
        _ => Err("MMFF status is invalid".into()),
    }
}
fn optimizer_tag(v: MmffOptimizerKind) -> u32 {
    match v {
        MmffOptimizerKind::Bfgs => 0,
        MmffOptimizerKind::Lbfgs => 1,
    }
}
fn optimizer(v: u32) -> Result<MmffOptimizerKind, String> {
    match v {
        0 => Ok(MmffOptimizerKind::Bfgs),
        1 => Ok(MmffOptimizerKind::Lbfgs),
        _ => Err("MMFF optimizer is invalid".into()),
    }
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
            .ok_or("MMFF payload is truncated")?;
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
            Err("MMFF operation magic is invalid".into())
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
            .ok_or_else(|| "MMFF payload contains non-finite float".into())
    }
    fn term(&mut self) -> Result<RawTerm, String> {
        let mut atoms = [0; 4];
        for atom in &mut atoms {
            *atom = self.u32()?;
        }
        let mut values = [0.0; 8];
        for value in &mut values {
            *value = self.f32()?;
        }
        Ok(RawTerm { atoms, values })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parameters() -> MmffParameters {
        MmffParameters {
            variant: MmffVariant::Mmff94s,
            atom_count: 2,
            bonds: vec![MmffBondTerm {
                atoms: [0, 1],
                force_constant: 4.0,
                equilibrium_distance: 1.25,
            }],
            angles: Vec::new(),
            stretch_bends: Vec::new(),
            out_of_planes: Vec::new(),
            torsions: Vec::new(),
            van_der_waals: vec![MmffVanDerWaalsTerm {
                atoms: [0, 1],
                r_star: 3.0,
                epsilon: 0.1,
            }],
            electrostatics: vec![MmffElectrostaticTerm {
                atoms: [0, 1],
                charge_product: -0.25,
                is_one_four: true,
            }],
        }
    }

    #[test]
    fn input_and_output_round_trip_exactly() {
        let positions = [[0.0, 0.0, 0.0, 0.0], [1.5, 0.0, 0.0, 0.0]];
        let options = DistanceGeometryOptimizationOptions::default();
        let encoded = encode_input(&positions, &parameters(), options, 64 * 1024 * 1024)
            .expect("encode MMFF input");
        let decoded = decode_input(&encoded).expect("decode MMFF input");
        assert_eq!(decoded.positions, positions);
        assert_eq!(decoded.parameters, parameters());
        assert_eq!(decoded.options, options);
        assert_eq!(decoded.max_memory_bytes, 64 * 1024 * 1024);

        let expected = MetalMmffOptimization {
            positions: positions.to_vec(),
            energies: vec![-1.0],
            scaled_gradient_maxima: vec![0.01],
            iterations: vec![7],
            statuses: vec![DistanceGeometryOptimizationStatus::ConvergedGradient],
            optimizers: vec![MmffOptimizerKind::Bfgs],
            gpu_time_ms: 13,
        };
        let output = encode_output(&expected, 2).expect("encode MMFF output");
        assert_eq!(decode_output(&output, 13).expect("decode output"), expected);
    }

    #[test]
    fn rejects_noncanonical_boolean_and_truncated_payload() {
        let positions = [[0.0, 0.0, 0.0, 0.0], [1.5, 0.0, 0.0, 0.0]];
        let mut encoded = encode_input(
            &positions,
            &parameters(),
            DistanceGeometryOptimizationOptions::default(),
            64 * 1024 * 1024,
        )
        .expect("encode MMFF input");
        assert!(decode_input(&encoded[..encoded.len() - 1]).is_err());
        let electrostatic_boolean = INPUT_HEADER_BYTES as usize
            + positions.len() * POSITION_BYTES as usize
            + 2 * TERM_BYTES as usize
            + 16
            + 4;
        encoded[electrostatic_boolean..electrostatic_boolean + 4]
            .copy_from_slice(&2.0_f32.to_le_bytes());
        assert!(decode_input(&encoded).is_err());
    }
}
