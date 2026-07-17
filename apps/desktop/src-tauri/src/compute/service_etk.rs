use burrete_compute_core::{
    validate_etk_geometry_constraints, DistanceGeometryOptimizationOptions,
    DistanceGeometryOptimizationStatus, EtkDistanceConstraint, EtkGeometryTerms,
    EtkImproperConstraint, EtkTorsionConstraint,
};
use burrete_compute_metal::MetalDistanceOptimization;
use burrete_compute_protocol::MAX_PACK_BYTES;

const INPUT_MAGIC: &[u8; 4] = b"BEK1";
const OUTPUT_MAGIC: &[u8; 4] = b"BEO1";
const INPUT_HEADER_BYTES: u64 = 64;
const OUTPUT_HEADER_BYTES: u64 = 16;
const POSITION_BYTES: u64 = 16;
const TORSION_BYTES: u64 = 48;
const IMPROPER_BYTES: u64 = 20;
const DISTANCE_BYTES: u64 = 20;
const RESULT_BYTES: u64 = 16;

pub(super) struct OwnedInput {
    pub positions: Vec<[f32; 4]>,
    pub atom_count: u32,
    pub torsions: Vec<EtkTorsionConstraint>,
    pub impropers: Vec<EtkImproperConstraint>,
    pub distances: Vec<EtkDistanceConstraint>,
    pub options: DistanceGeometryOptimizationOptions,
    pub max_memory_bytes: u64,
}

impl OwnedInput {
    pub fn terms(&self) -> EtkGeometryTerms<'_> {
        EtkGeometryTerms {
            torsions: &self.torsions,
            impropers: &self.impropers,
            distances: &self.distances,
        }
    }
}

pub(super) fn encode_input(
    positions: &[[f32; 4]],
    atom_count: u32,
    terms: EtkGeometryTerms<'_>,
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    options.validate().map_err(|error| error.to_string())?;
    validate_shape(positions, atom_count)?;
    validate_etk_geometry_constraints(
        atom_count as usize,
        terms.torsions,
        terms.impropers,
        terms.distances,
    )
    .map_err(|error| error.to_string())?;
    let position_count = count(positions.len(), "ETK positions")?;
    let torsion_count = count(terms.torsions.len(), "ETK torsions")?;
    let improper_count = count(terms.impropers.len(), "ETK impropers")?;
    let distance_count = count(terms.distances.len(), "ETK distances")?;
    let bytes = input_bound(
        positions.len(),
        terms.torsions.len(),
        terms.impropers.len(),
        terms.distances.len(),
    )?;
    let mut output = Vec::with_capacity(bytes as usize);
    output.extend_from_slice(INPUT_MAGIC);
    push_u32(&mut output, atom_count);
    push_u32(&mut output, position_count);
    push_u32(&mut output, torsion_count);
    push_u32(&mut output, improper_count);
    push_u32(&mut output, distance_count);
    push_u32(&mut output, 0);
    push_options(&mut output, options);
    push_u64(&mut output, max_memory_bytes);
    for position in positions {
        for value in position {
            push_f32(&mut output, *value);
        }
    }
    for term in terms.torsions {
        for atom in term.atoms {
            push_u32(&mut output, atom);
        }
        for coefficient in term.coefficients {
            push_f32(&mut output, coefficient);
        }
        for sign in term.signs {
            output.push(sign as u8);
        }
        output.extend_from_slice(&[0; 2]);
    }
    for term in terms.impropers {
        for atom in term.atoms {
            push_u32(&mut output, atom);
        }
        push_f32(&mut output, term.weight);
    }
    for term in terms.distances {
        for atom in term.atoms {
            push_u32(&mut output, atom);
        }
        push_f32(&mut output, term.lower);
        push_f32(&mut output, term.upper);
        push_f32(&mut output, term.weight);
    }
    Ok(output)
}

pub(super) fn decode_input(input: &[u8]) -> Result<OwnedInput, String> {
    let mut cursor = Cursor::new(input);
    cursor.magic(INPUT_MAGIC)?;
    let atom_count = cursor.u32()?;
    let position_count = cursor.u32()? as usize;
    let torsion_count = cursor.u32()? as usize;
    let improper_count = cursor.u32()? as usize;
    let distance_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 {
        return Err("ETK input header is invalid".into());
    }
    let options = cursor.options()?;
    let max_memory_bytes = cursor.u64()?;
    validate_input_length(
        input,
        position_count,
        torsion_count,
        improper_count,
        distance_count,
    )?;
    let mut positions = Vec::with_capacity(position_count);
    for _ in 0..position_count {
        positions.push(cursor.position()?);
    }
    let mut torsions = Vec::with_capacity(torsion_count);
    for _ in 0..torsion_count {
        let atoms = cursor.u32_array()?;
        let coefficients = cursor.f32_array()?;
        let signs = cursor.i8_array()?;
        if cursor.array::<2>()? != [0; 2] || signs.iter().any(|sign| !matches!(sign, -1 | 0 | 1)) {
            return Err("ETK torsion encoding is invalid".into());
        }
        torsions.push(EtkTorsionConstraint {
            atoms,
            coefficients,
            signs,
        });
    }
    let mut impropers = Vec::with_capacity(improper_count);
    for _ in 0..improper_count {
        impropers.push(EtkImproperConstraint {
            atoms: cursor.u32_array()?,
            weight: cursor.f32()?,
        });
    }
    let mut distances = Vec::with_capacity(distance_count);
    for _ in 0..distance_count {
        distances.push(EtkDistanceConstraint {
            atoms: [cursor.u32()?, cursor.u32()?],
            lower: cursor.f32()?,
            upper: cursor.f32()?,
            weight: cursor.f32()?,
        });
    }
    validate_shape(&positions, atom_count)?;
    validate_etk_geometry_constraints(atom_count as usize, &torsions, &impropers, &distances)
        .map_err(|error| error.to_string())?;
    Ok(OwnedInput {
        positions,
        atom_count,
        torsions,
        impropers,
        distances,
        options,
        max_memory_bytes,
    })
}

pub(super) fn output_bound(position_count: usize, conformer_count: usize) -> Result<u64, String> {
    OUTPUT_HEADER_BYTES
        .checked_add(
            (position_count as u64)
                .checked_mul(POSITION_BYTES)
                .ok_or("ETK output overflow")?,
        )
        .and_then(|value| value.checked_add((conformer_count as u64).checked_mul(RESULT_BYTES)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "ETK output exceeds the compute exchange bound".into())
}

pub(super) fn encode_output(
    result: &MetalDistanceOptimization,
    atom_count: u32,
) -> Result<Vec<u8>, String> {
    let conformer_count = result.energies.len();
    if result.positions.len()
        != conformer_count
            .checked_mul(atom_count as usize)
            .ok_or("ETK output overflow")?
        || result.scaled_gradient_maxima.len() != conformer_count
        || result.iterations.len() != conformer_count
        || result.statuses.len() != conformer_count
    {
        return Err("ETK output arrays are inconsistent".into());
    }
    let mut output =
        Vec::with_capacity(output_bound(result.positions.len(), conformer_count)? as usize);
    output.extend_from_slice(OUTPUT_MAGIC);
    push_u32(&mut output, atom_count);
    push_u32(&mut output, count(conformer_count, "ETK conformers")?);
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
    }
    Ok(output)
}

pub(super) fn decode_output(
    output: &[u8],
    gpu_time_ms: u64,
) -> Result<MetalDistanceOptimization, String> {
    let mut cursor = Cursor::new(output);
    cursor.magic(OUTPUT_MAGIC)?;
    let atom_count = cursor.u32()? as usize;
    let conformer_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 || atom_count == 0 || conformer_count == 0 {
        return Err("ETK output header is invalid".into());
    }
    let position_count = atom_count
        .checked_mul(conformer_count)
        .ok_or("ETK output overflow")?;
    if output.len() as u64 != output_bound(position_count, conformer_count)? {
        return Err("ETK output byte length is inconsistent".into());
    }
    let mut positions = Vec::with_capacity(position_count);
    for _ in 0..position_count {
        positions.push(cursor.position()?);
    }
    let mut energies = Vec::with_capacity(conformer_count);
    let mut scaled_gradient_maxima = Vec::with_capacity(conformer_count);
    let mut iterations = Vec::with_capacity(conformer_count);
    let mut statuses = Vec::with_capacity(conformer_count);
    for _ in 0..conformer_count {
        energies.push(cursor.f32()?);
        scaled_gradient_maxima.push(cursor.f32()?);
        iterations.push(cursor.u32()?);
        statuses.push(status(cursor.u32()?)?);
    }
    Ok(MetalDistanceOptimization {
        positions,
        energies,
        scaled_gradient_maxima,
        iterations,
        statuses,
        gpu_time_ms,
    })
}

fn validate_shape(positions: &[[f32; 4]], atom_count: u32) -> Result<(), String> {
    if atom_count == 0
        || positions.is_empty()
        || positions.len() % atom_count as usize != 0
        || positions.iter().flatten().any(|value| !value.is_finite())
    {
        Err("ETK positions are not a finite conformer batch".into())
    } else {
        Ok(())
    }
}
fn validate_input_length(
    input: &[u8],
    p: usize,
    t: usize,
    i: usize,
    d: usize,
) -> Result<(), String> {
    if input.len() as u64 == input_bound(p, t, i, d)? {
        Ok(())
    } else {
        Err("ETK input byte length is inconsistent".into())
    }
}
fn input_bound(p: usize, t: usize, i: usize, d: usize) -> Result<u64, String> {
    let mut bytes = INPUT_HEADER_BYTES;
    for (count, width) in [
        (p, POSITION_BYTES),
        (t, TORSION_BYTES),
        (i, IMPROPER_BYTES),
        (d, DISTANCE_BYTES),
    ] {
        bytes = bytes
            .checked_add(
                (count as u64)
                    .checked_mul(width)
                    .ok_or("ETK input overflow")?,
            )
            .ok_or("ETK input overflow")?;
    }
    (bytes <= MAX_PACK_BYTES)
        .then_some(bytes)
        .ok_or_else(|| "ETK input exceeds the compute exchange bound".into())
}
fn count(value: usize, label: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("too many {label}"))
}
fn push_options(o: &mut Vec<u8>, v: DistanceGeometryOptimizationOptions) {
    push_u32(o, v.max_iterations);
    push_u32(o, v.history_size.into());
    push_u32(o, v.max_line_search_steps.into());
    push_f32(o, v.gradient_tolerance);
    push_f32(o, v.relative_step_tolerance);
    push_f32(o, v.armijo_coefficient);
    push_f32(o, v.max_step_factor);
}
fn push_u32(o: &mut Vec<u8>, v: u32) {
    o.extend_from_slice(&v.to_le_bytes());
}
fn push_u64(o: &mut Vec<u8>, v: u64) {
    o.extend_from_slice(&v.to_le_bytes());
}
fn push_f32(o: &mut Vec<u8>, v: f32) {
    o.extend_from_slice(&v.to_le_bytes());
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
        _ => Err("ETK status is invalid".into()),
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
            .filter(|v| *v <= self.bytes.len())
            .ok_or("ETK payload is truncated")?;
        let value = self.bytes[self.offset..end]
            .try_into()
            .expect("fixed slice");
        self.offset = end;
        Ok(value)
    }
    fn magic(&mut self, v: &[u8; 4]) -> Result<(), String> {
        if self.array::<4>()? == *v {
            Ok(())
        } else {
            Err("ETK operation magic is invalid".into())
        }
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let v = f32::from_le_bytes(self.array()?);
        v.is_finite()
            .then_some(v)
            .ok_or_else(|| "ETK payload contains a non-finite float".into())
    }
    fn position(&mut self) -> Result<[f32; 4], String> {
        Ok([self.f32()?, self.f32()?, self.f32()?, self.f32()?])
    }
    fn u32_array<const N: usize>(&mut self) -> Result<[u32; N], String> {
        let mut v = [0; N];
        for item in &mut v {
            *item = self.u32()?;
        }
        Ok(v)
    }
    fn f32_array<const N: usize>(&mut self) -> Result<[f32; N], String> {
        let mut v = [0.0; N];
        for item in &mut v {
            *item = self.f32()?;
        }
        Ok(v)
    }
    fn i8_array<const N: usize>(&mut self) -> Result<[i8; N], String> {
        Ok(self.array::<N>()?.map(|v| v as i8))
    }
    fn options(&mut self) -> Result<DistanceGeometryOptimizationOptions, String> {
        let v = DistanceGeometryOptimizationOptions {
            max_iterations: self.u32()?,
            history_size: u8::try_from(self.u32()?).map_err(|_| "ETK history is invalid")?,
            max_line_search_steps: u8::try_from(self.u32()?)
                .map_err(|_| "ETK line search is invalid")?,
            gradient_tolerance: self.f32()?,
            relative_step_tolerance: self.f32()?,
            armijo_coefficient: self.f32()?,
            max_step_factor: self.f32()?,
        };
        v.validate().map_err(|e| e.to_string())?;
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exchange_round_trips() {
        let positions = vec![[0.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]];
        let distances = [EtkDistanceConstraint {
            atoms: [0, 1],
            lower: 0.9,
            upper: 1.1,
            weight: 1.0,
        }];
        let terms = EtkGeometryTerms {
            torsions: &[],
            impropers: &[],
            distances: &distances,
        };
        let encoded = encode_input(
            &positions,
            2,
            terms,
            DistanceGeometryOptimizationOptions::default(),
            4096,
        )
        .unwrap();
        let decoded = decode_input(&encoded).unwrap();
        assert_eq!(decoded.positions, positions);
        assert_eq!(decoded.distances, distances);
        let expected = MetalDistanceOptimization {
            positions,
            energies: vec![0.0],
            scaled_gradient_maxima: vec![0.0],
            iterations: vec![0],
            statuses: vec![DistanceGeometryOptimizationStatus::ConvergedGradient],
            gpu_time_ms: 4,
        };
        let output = encode_output(&expected, 2).unwrap();
        assert_eq!(decode_output(&output, 4).unwrap(), expected);
    }
    #[test]
    fn rejects_truncated_payload() {
        let positions = vec![[0.0; 4]];
        let terms = EtkGeometryTerms {
            torsions: &[],
            impropers: &[],
            distances: &[],
        };
        let mut encoded = encode_input(
            &positions,
            1,
            terms,
            DistanceGeometryOptimizationOptions::default(),
            1,
        )
        .unwrap();
        encoded.pop();
        assert!(decode_input(&encoded).is_err());
    }
}
