use burette_compute_core::{
    DistanceConstraint, DistanceGeometryOptimizationOptions, DistanceGeometryOptimizationStatus,
};
use burette_compute_metal::MetalDistanceEmbedding;
use burette_compute_protocol::MAX_PACK_BYTES;

const DG_INPUT_MAGIC: &[u8; 4] = b"BDG1";
const DG_OUTPUT_MAGIC: &[u8; 4] = b"BDO1";
const DG_HEADER_BYTES: u64 = 56;
const SEED_BYTES: u64 = 16;
const CONSTRAINT_BYTES: u64 = 20;
const POSITION_BYTES: u64 = 16;
const RESULT_BYTES: u64 = 16;

pub(super) struct OwnedDistanceInput {
    pub seeds: Vec<[u32; 4]>,
    pub atom_count: u32,
    pub constraints: Vec<DistanceConstraint>,
    pub options: DistanceGeometryOptimizationOptions,
    pub max_memory_bytes: u64,
}

pub(super) fn encode_distance_input(
    seeds: &[[u32; 4]],
    atom_count: u32,
    constraints: &[DistanceConstraint],
    options: DistanceGeometryOptimizationOptions,
    max_memory_bytes: u64,
) -> Result<Vec<u8>, String> {
    options.validate().map_err(|error| error.to_string())?;
    if seeds.is_empty() || atom_count == 0 {
        return Err("distance embedding requires seeds and atoms".into());
    }
    let seed_count = u32::try_from(seeds.len()).map_err(|_| "too many distance seeds")?;
    let constraint_count =
        u32::try_from(constraints.len()).map_err(|_| "too many distance constraints")?;
    let total = distance_input_bytes(seeds.len(), constraints.len())?;
    let mut output = Vec::with_capacity(total as usize);
    output.extend_from_slice(DG_INPUT_MAGIC);
    push_u32(&mut output, atom_count);
    push_u32(&mut output, seed_count);
    push_u32(&mut output, constraint_count);
    push_u32(&mut output, 0);
    push_options(&mut output, options);
    push_u64(&mut output, max_memory_bytes);
    for seed in seeds {
        for word in seed {
            push_u32(&mut output, *word);
        }
    }
    for constraint in constraints {
        push_u32(&mut output, constraint.left_atom);
        push_u32(&mut output, constraint.right_atom);
        push_f32(&mut output, constraint.lower_squared);
        push_f32(&mut output, constraint.upper_squared);
        push_f32(&mut output, constraint.weight);
    }
    Ok(output)
}

pub(super) fn decode_distance_input(input: &[u8]) -> Result<OwnedDistanceInput, String> {
    let mut cursor = Cursor::new(input);
    cursor.magic(DG_INPUT_MAGIC)?;
    let atom_count = cursor.u32()?;
    let seed_count = cursor.u32()? as usize;
    let constraint_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 || atom_count == 0 || seed_count == 0 {
        return Err("distance input header is invalid".into());
    }
    let options = cursor.options()?;
    let max_memory_bytes = cursor.u64()?;
    if input.len() as u64 != distance_input_bytes(seed_count, constraint_count)? {
        return Err("distance input byte length is inconsistent".into());
    }
    let mut seeds = Vec::with_capacity(seed_count);
    for _ in 0..seed_count {
        seeds.push([cursor.u32()?, cursor.u32()?, cursor.u32()?, cursor.u32()?]);
    }
    let mut constraints = Vec::with_capacity(constraint_count);
    for _ in 0..constraint_count {
        let constraint = DistanceConstraint {
            left_atom: cursor.u32()?,
            right_atom: cursor.u32()?,
            lower_squared: cursor.f32()?,
            upper_squared: cursor.f32()?,
            weight: cursor.f32()?,
        };
        if constraint.left_atom >= atom_count
            || constraint.right_atom >= atom_count
            || constraint.left_atom >= constraint.right_atom
            || constraint.lower_squared < 0.0
            || constraint.upper_squared < constraint.lower_squared
            || constraint.weight <= 0.0
        {
            return Err("distance constraint is outside the supported domain".into());
        }
        constraints.push(constraint);
    }
    Ok(OwnedDistanceInput {
        seeds,
        atom_count,
        constraints,
        options,
        max_memory_bytes,
    })
}

pub(super) fn distance_output_bound(
    atom_count: usize,
    conformer_count: usize,
) -> Result<u64, String> {
    let positions = atom_count
        .checked_mul(conformer_count)
        .ok_or("distance output position count overflow")?;
    DG_OUTPUT_HEADER_BYTES
        .checked_add(
            (positions as u64)
                .checked_mul(POSITION_BYTES)
                .ok_or("distance output position bytes overflow")?,
        )
        .and_then(|value| value.checked_add((conformer_count as u64).checked_mul(RESULT_BYTES)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "distance output exceeds the compute exchange bound".into())
}

const DG_OUTPUT_HEADER_BYTES: u64 = 16;

pub(super) fn encode_distance_output(
    result: &MetalDistanceEmbedding,
    atom_count: u32,
) -> Result<Vec<u8>, String> {
    let conformer_count = result.energies.len();
    let expected_positions = conformer_count
        .checked_mul(atom_count as usize)
        .ok_or("distance output count overflow")?;
    if result.positions.len() != expected_positions
        || result.scaled_gradient_maxima.len() != conformer_count
        || result.iterations.len() != conformer_count
        || result.statuses.len() != conformer_count
    {
        return Err("distance output arrays are inconsistent".into());
    }
    let mut output =
        Vec::with_capacity(distance_output_bound(atom_count as usize, conformer_count)? as usize);
    output.extend_from_slice(DG_OUTPUT_MAGIC);
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
    }
    Ok(output)
}

pub(super) fn decode_distance_output(
    output: &[u8],
    gpu_time_ms: u64,
) -> Result<MetalDistanceEmbedding, String> {
    let mut cursor = Cursor::new(output);
    cursor.magic(DG_OUTPUT_MAGIC)?;
    let atom_count = cursor.u32()? as usize;
    let conformer_count = cursor.u32()? as usize;
    if cursor.u32()? != 0 || atom_count == 0 || conformer_count == 0 {
        return Err("distance output header is invalid".into());
    }
    if output.len() as u64 != distance_output_bound(atom_count, conformer_count)? {
        return Err("distance output byte length is inconsistent".into());
    }
    let position_count = atom_count
        .checked_mul(conformer_count)
        .ok_or("distance output position count overflow")?;
    let mut positions = Vec::with_capacity(position_count);
    for _ in 0..position_count {
        positions.push([cursor.f32()?, cursor.f32()?, cursor.f32()?, cursor.f32()?]);
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
    Ok(MetalDistanceEmbedding {
        positions,
        energies,
        scaled_gradient_maxima,
        iterations,
        statuses,
        gpu_time_ms,
    })
}

fn distance_input_bytes(seeds: usize, constraints: usize) -> Result<u64, String> {
    DG_HEADER_BYTES
        .checked_add(
            (seeds as u64)
                .checked_mul(SEED_BYTES)
                .ok_or("distance seed byte length overflow")?,
        )
        .and_then(|value| value.checked_add((constraints as u64).checked_mul(CONSTRAINT_BYTES)?))
        .filter(|value| *value <= MAX_PACK_BYTES)
        .ok_or_else(|| "distance input exceeds the compute exchange bound".into())
}

fn push_options(output: &mut Vec<u8>, options: DistanceGeometryOptimizationOptions) {
    push_u32(output, options.max_iterations);
    push_u32(output, options.history_size.into());
    push_u32(output, options.max_line_search_steps.into());
    push_f32(output, options.gradient_tolerance);
    push_f32(output, options.relative_step_tolerance);
    push_f32(output, options.armijo_coefficient);
    push_f32(output, options.max_step_factor);
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
fn status_tag(status: DistanceGeometryOptimizationStatus) -> u32 {
    match status {
        DistanceGeometryOptimizationStatus::ConvergedGradient => 0,
        DistanceGeometryOptimizationStatus::ConvergedStep => 1,
        DistanceGeometryOptimizationStatus::LineSearchExhausted => 2,
        DistanceGeometryOptimizationStatus::MaxIterations => 3,
    }
}
fn status(tag: u32) -> Result<DistanceGeometryOptimizationStatus, String> {
    match tag {
        0 => Ok(DistanceGeometryOptimizationStatus::ConvergedGradient),
        1 => Ok(DistanceGeometryOptimizationStatus::ConvergedStep),
        2 => Ok(DistanceGeometryOptimizationStatus::LineSearchExhausted),
        3 => Ok(DistanceGeometryOptimizationStatus::MaxIterations),
        _ => Err("distance optimization status is invalid".into()),
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
            .ok_or("distance payload is truncated")?;
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
            Err("distance operation magic is invalid".into())
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
            .ok_or_else(|| "distance payload contains a non-finite float".into())
    }
    fn options(&mut self) -> Result<DistanceGeometryOptimizationOptions, String> {
        let max_iterations = self.u32()?;
        let history_size = u8::try_from(self.u32()?).map_err(|_| "distance history is invalid")?;
        let max_line_search_steps =
            u8::try_from(self.u32()?).map_err(|_| "distance line search is invalid")?;
        DistanceGeometryOptimizationOptions {
            max_iterations,
            history_size,
            gradient_tolerance: self.f32()?,
            relative_step_tolerance: self.f32()?,
            armijo_coefficient: self.f32()?,
            max_line_search_steps,
            max_step_factor: self.f32()?,
        }
        .validate()
        .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_exchange_round_trips() {
        let seeds = [[1, 2, 3, 4], [5, 6, 7, 8]];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 2.0,
            weight: 1.5,
        }];
        let options = DistanceGeometryOptimizationOptions::default();
        let input = encode_distance_input(&seeds, 2, &constraints, options, 64 * 1024 * 1024)
            .expect("encode distance input");
        let decoded = decode_distance_input(&input).expect("decode distance input");
        assert_eq!(decoded.seeds, seeds);
        assert_eq!(decoded.constraints, constraints);
        assert_eq!(decoded.options, options);

        let expected = MetalDistanceEmbedding {
            positions: vec![[0.0; 4]; 4],
            energies: vec![0.0, 0.1],
            scaled_gradient_maxima: vec![0.0, 0.01],
            iterations: vec![0, 4],
            statuses: vec![
                DistanceGeometryOptimizationStatus::ConvergedGradient,
                DistanceGeometryOptimizationStatus::ConvergedStep,
            ],
            gpu_time_ms: 9,
        };
        let output = encode_distance_output(&expected, 2).expect("encode output");
        assert_eq!(
            decode_distance_output(&output, 9).expect("decode output"),
            expected
        );
    }

    #[test]
    fn distance_exchange_rejects_truncated_and_non_finite_payloads() {
        let seeds = [[1, 2, 3, 4]];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 2.0,
            weight: 1.0,
        }];
        let mut input = encode_distance_input(
            &seeds,
            2,
            &constraints,
            DistanceGeometryOptimizationOptions::default(),
            1024,
        )
        .expect("encode distance input");
        input.pop();
        assert!(decode_distance_input(&input).is_err());

        let mut output = Vec::new();
        output.extend_from_slice(DG_OUTPUT_MAGIC);
        push_u32(&mut output, 1);
        push_u32(&mut output, 1);
        push_u32(&mut output, 0);
        push_f32(&mut output, f32::NAN);
        output.extend_from_slice(&[0; 12 + RESULT_BYTES as usize]);
        assert!(decode_distance_output(&output, 0).is_err());
    }
}
