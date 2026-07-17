//! Deterministic mapped rigid alignment and fixed-pose molecular scoring.
//!
//! Callers supply Gaussian atom parameters and an explicit atom mapping. This
//! keeps chemistry typing outside the numeric kernel and prevents an implicit
//! equal-order assumption from becoming part of the public contract.

use std::{collections::HashSet, fmt};

const EPSILON: f64 = 1.0e-12;
const SCORE_EPSILON: f64 = 1.0e-8;
const POWER_ITERATIONS: usize = 48;
const ESP_A: [f64; 9] = [
    15.90600036,
    3.95348310,
    17.61453176,
    3.95348310,
    5.21580206,
    1.91045387,
    17.61453176,
    1.91045387,
    238.75820253,
];
const ESP_B: [f64; 9] = [
    -0.02495000,
    -0.04539319,
    -0.00247124,
    -0.04539319,
    -0.25130000,
    -0.00258662,
    -0.00247124,
    -0.00258662,
    -0.00130000,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AlignmentAtom {
    pub position: [f32; 4],
    pub gaussian_exponent: f32,
    pub gaussian_amplitude: f32,
    pub partial_charge: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AtomMapping {
    pub probe_atom: u32,
    pub reference_atom: u32,
    pub weight: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlignmentMode {
    FixedPose,
    MappedHorn,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidTransform {
    /// Row-vector rotation: `aligned = position * rotation + translation`.
    pub rotation: [[f32; 3]; 3],
    pub translation: [f32; 3],
}

impl RigidTransform {
    pub const IDENTITY: Self = Self {
        rotation: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        translation: [0.0; 3],
    };

    pub fn apply(self, position: [f32; 4]) -> [f32; 4] {
        let point = [
            f64::from(position[0]),
            f64::from(position[1]),
            f64::from(position[2]),
        ];
        let mut aligned = [0.0_f32; 4];
        for (column, output) in aligned[..3].iter_mut().enumerate() {
            *output = (f64::from(self.translation[column])
                + (0..3)
                    .map(|row| point[row] * f64::from(self.rotation[row][column]))
                    .sum::<f64>()) as f32;
        }
        aligned
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AlignmentScores {
    pub rmsd: Option<f32>,
    pub shape_overlap: f32,
    pub shape_tanimoto: f32,
    pub shape_carbo: f32,
    pub electrostatic_overlap: f32,
    pub electrostatic_carbo: f32,
    pub electrostatic_tanimoto: f32,
    pub electrostatic_available: bool,
    pub combined_similarity: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AlignmentResult {
    pub transform: RigidTransform,
    pub scores: AlignmentScores,
    pub aligned_probe_positions: Vec<[f32; 4]>,
}

pub fn align_and_score(
    probe: &[AlignmentAtom],
    reference: &[AlignmentAtom],
    mapping: &[AtomMapping],
    mode: AlignmentMode,
) -> Result<AlignmentResult, AlignmentError> {
    validate_atoms("probe", probe)?;
    validate_atoms("reference", reference)?;
    let transform = match mode {
        AlignmentMode::FixedPose => {
            if !mapping.is_empty() {
                return Err(invalid(
                    "fixed-pose scoring must not provide an atom mapping",
                ));
            }
            RigidTransform::IDENTITY
        }
        AlignmentMode::MappedHorn => mapped_horn_transform(probe, reference, mapping)?,
    };
    let aligned_probe_positions = probe
        .iter()
        .map(|atom| transform.apply(atom.position))
        .collect::<Vec<_>>();
    let rmsd = match mode {
        AlignmentMode::FixedPose => None,
        AlignmentMode::MappedHorn => {
            Some(mapped_rmsd(&aligned_probe_positions, reference, mapping)?)
        }
    };
    let scores = score_positions(probe, &aligned_probe_positions, reference, rmsd)?;
    Ok(AlignmentResult {
        transform,
        scores,
        aligned_probe_positions,
    })
}

fn mapped_horn_transform(
    probe: &[AlignmentAtom],
    reference: &[AlignmentAtom],
    mapping: &[AtomMapping],
) -> Result<RigidTransform, AlignmentError> {
    validate_mapping(probe.len(), reference.len(), mapping)?;
    let weight_sum = mapping
        .iter()
        .map(|entry| f64::from(entry.weight))
        .sum::<f64>();
    let mut probe_centroid = [0.0_f64; 3];
    let mut reference_centroid = [0.0_f64; 3];
    for entry in mapping {
        let weight = f64::from(entry.weight) / weight_sum;
        let probe_position = probe[entry.probe_atom as usize].position;
        let reference_position = reference[entry.reference_atom as usize].position;
        for coordinate in 0..3 {
            probe_centroid[coordinate] += weight * f64::from(probe_position[coordinate]);
            reference_centroid[coordinate] += weight * f64::from(reference_position[coordinate]);
        }
    }
    let mut covariance = [[0.0_f64; 3]; 3];
    for entry in mapping {
        let weight = f64::from(entry.weight) / weight_sum;
        let probe_position = probe[entry.probe_atom as usize].position;
        let reference_position = reference[entry.reference_atom as usize].position;
        for reference_axis in 0..3 {
            for probe_axis in 0..3 {
                covariance[reference_axis][probe_axis] += weight
                    * (f64::from(reference_position[reference_axis])
                        - reference_centroid[reference_axis])
                    * (f64::from(probe_position[probe_axis]) - probe_centroid[probe_axis]);
            }
        }
    }
    let quaternion = dominant_quaternion(horn_key(covariance));
    let rotation64 = quaternion_rotation(quaternion);
    let mut translation = [0.0_f32; 3];
    for column in 0..3 {
        let rotated_centroid = (0..3)
            .map(|row| probe_centroid[row] * rotation64[row][column])
            .sum::<f64>();
        translation[column] = (reference_centroid[column] - rotated_centroid) as f32;
    }
    let rotation = rotation64.map(|row| row.map(|value| value as f32));
    Ok(RigidTransform {
        rotation,
        translation,
    })
}

fn dominant_quaternion(matrix: [[f64; 4]; 4]) -> [f64; 4] {
    const STARTS: [[f64; 4]; 5] = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
        [0.5, 0.5, 0.5, 0.5],
    ];
    let shift = matrix
        .iter()
        .map(|row| row.iter().map(|value| value.abs()).sum::<f64>())
        .fold(0.0_f64, f64::max)
        + 1.0;
    let mut best = STARTS[0];
    let mut best_value = f64::NEG_INFINITY;
    for mut candidate in STARTS {
        for _ in 0..POWER_ITERATIONS {
            let mut next = [0.0_f64; 4];
            for row in 0..4 {
                next[row] = (0..4)
                    .map(|column| matrix[row][column] * candidate[column])
                    .sum::<f64>()
                    + shift * candidate[row];
            }
            candidate = normalize4(next);
        }
        let value = (0..4)
            .map(|row| {
                candidate[row]
                    * (0..4)
                        .map(|column| matrix[row][column] * candidate[column])
                        .sum::<f64>()
            })
            .sum::<f64>();
        if value > best_value {
            best_value = value;
            best = candidate;
        }
    }
    if best
        .iter()
        .find(|value| value.abs() > EPSILON)
        .is_some_and(|value| *value < 0.0)
    {
        best.map(|value| -value)
    } else {
        best
    }
}

fn horn_key(covariance: [[f64; 3]; 3]) -> [[f64; 4]; 4] {
    let [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = covariance;
    [
        [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
        [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
        [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
        [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
    ]
}

fn quaternion_rotation(quaternion: [f64; 4]) -> [[f64; 3]; 3] {
    let [w, x, y, z] = normalize4(quaternion);
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
        ],
        [
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
        ],
        [
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ]
}

fn normalize4(vector: [f64; 4]) -> [f64; 4] {
    let norm = vector.iter().map(|value| value * value).sum::<f64>().sqrt();
    if norm <= EPSILON {
        [1.0, 0.0, 0.0, 0.0]
    } else {
        vector.map(|value| value / norm)
    }
}

fn mapped_rmsd(
    aligned_probe: &[[f32; 4]],
    reference: &[AlignmentAtom],
    mapping: &[AtomMapping],
) -> Result<f32, AlignmentError> {
    let weight_sum = mapping
        .iter()
        .map(|entry| f64::from(entry.weight))
        .sum::<f64>();
    let squared = mapping
        .iter()
        .map(|entry| {
            let probe = aligned_probe[entry.probe_atom as usize];
            let target = reference[entry.reference_atom as usize].position;
            f64::from(entry.weight)
                * (0..3)
                    .map(|axis| {
                        let delta = f64::from(probe[axis]) - f64::from(target[axis]);
                        delta * delta
                    })
                    .sum::<f64>()
        })
        .sum::<f64>()
        / weight_sum;
    let rmsd = squared.max(0.0).sqrt() as f32;
    if !rmsd.is_finite() {
        return Err(invalid("mapped alignment produced a non-finite RMSD"));
    }
    Ok(rmsd)
}

fn score_positions(
    probe: &[AlignmentAtom],
    aligned_probe: &[[f32; 4]],
    reference: &[AlignmentAtom],
    rmsd: Option<f32>,
) -> Result<AlignmentScores, AlignmentError> {
    let shape_overlap = gaussian_overlap(probe, aligned_probe, probe, aligned_probe);
    let reference_positions = reference
        .iter()
        .map(|atom| atom.position)
        .collect::<Vec<_>>();
    let cross_shape = gaussian_overlap(probe, aligned_probe, reference, &reference_positions);
    let reference_shape = gaussian_overlap(
        reference,
        &reference_positions,
        reference,
        &reference_positions,
    );
    let shape_tanimoto = bounded_ratio(
        cross_shape,
        shape_overlap + reference_shape - cross_shape,
        0.0,
        1.0,
    );
    let shape_carbo = bounded_ratio(
        cross_shape,
        (shape_overlap.max(SCORE_EPSILON) * reference_shape.max(SCORE_EPSILON)).sqrt(),
        0.0,
        1.0,
    );
    let probe_esp = electrostatic_overlap(probe, aligned_probe, probe, aligned_probe);
    let cross_esp = electrostatic_overlap(probe, aligned_probe, reference, &reference_positions);
    let reference_esp = electrostatic_overlap(
        reference,
        &reference_positions,
        reference,
        &reference_positions,
    );
    let electrostatic_available = probe_esp > SCORE_EPSILON && reference_esp > SCORE_EPSILON;
    let electrostatic_carbo = if electrostatic_available {
        bounded_ratio(cross_esp, (probe_esp * reference_esp).sqrt(), -1.0, 1.0)
    } else {
        0.0
    };
    let electrostatic_tanimoto = if electrostatic_available {
        bounded_ratio(
            cross_esp,
            probe_esp + reference_esp - cross_esp,
            -1.0 / 3.0,
            1.0,
        )
    } else {
        0.0
    };
    let combined = if electrostatic_available {
        0.5 * (shape_tanimoto + (electrostatic_carbo + 1.0) * 0.5)
    } else {
        shape_tanimoto
    };
    let values = [
        cross_shape,
        shape_tanimoto,
        shape_carbo,
        cross_esp,
        electrostatic_carbo,
        electrostatic_tanimoto,
        combined,
    ];
    if values.iter().any(|value| !value.is_finite()) {
        return Err(invalid("alignment scoring produced a non-finite value"));
    }
    Ok(AlignmentScores {
        rmsd,
        shape_overlap: cross_shape as f32,
        shape_tanimoto: shape_tanimoto as f32,
        shape_carbo: shape_carbo as f32,
        electrostatic_overlap: cross_esp as f32,
        electrostatic_carbo: electrostatic_carbo as f32,
        electrostatic_tanimoto: electrostatic_tanimoto as f32,
        electrostatic_available,
        combined_similarity: combined as f32,
    })
}

fn gaussian_overlap(
    left_atoms: &[AlignmentAtom],
    left_positions: &[[f32; 4]],
    right_atoms: &[AlignmentAtom],
    right_positions: &[[f32; 4]],
) -> f64 {
    left_atoms
        .iter()
        .zip(left_positions)
        .flat_map(|(left_atom, left_position)| {
            right_atoms
                .iter()
                .zip(right_positions)
                .map(move |(right_atom, right_position)| {
                    let left_exponent = f64::from(left_atom.gaussian_exponent);
                    let right_exponent = f64::from(right_atom.gaussian_exponent);
                    let exponent_sum = left_exponent + right_exponent;
                    let mixed = left_exponent * right_exponent / exponent_sum;
                    let distance_squared = squared_distance(*left_position, *right_position);
                    f64::from(left_atom.gaussian_amplitude)
                        * f64::from(right_atom.gaussian_amplitude)
                        * (std::f64::consts::PI / exponent_sum).powf(1.5)
                        * (-mixed * distance_squared).exp()
                })
        })
        .sum()
}

fn electrostatic_overlap(
    left_atoms: &[AlignmentAtom],
    left_positions: &[[f32; 4]],
    right_atoms: &[AlignmentAtom],
    right_positions: &[[f32; 4]],
) -> f64 {
    left_atoms
        .iter()
        .zip(left_positions)
        .flat_map(|(left_atom, left_position)| {
            right_atoms
                .iter()
                .zip(right_positions)
                .map(move |(right_atom, right_position)| {
                    let distance_squared = squared_distance(*left_position, *right_position);
                    let kernel = ESP_A
                        .iter()
                        .zip(ESP_B)
                        .map(|(amplitude, exponent)| {
                            amplitude * (exponent * distance_squared).exp()
                        })
                        .sum::<f64>();
                    f64::from(left_atom.partial_charge)
                        * f64::from(right_atom.partial_charge)
                        * kernel
                })
        })
        .sum()
}

fn squared_distance(left: [f32; 4], right: [f32; 4]) -> f64 {
    (0..3)
        .map(|axis| {
            let delta = f64::from(left[axis]) - f64::from(right[axis]);
            delta * delta
        })
        .sum()
}

fn bounded_ratio(numerator: f64, denominator: f64, minimum: f64, maximum: f64) -> f64 {
    if denominator.abs() <= SCORE_EPSILON {
        0.0
    } else {
        (numerator / denominator).clamp(minimum, maximum)
    }
}

fn validate_atoms(label: &str, atoms: &[AlignmentAtom]) -> Result<(), AlignmentError> {
    if atoms.is_empty() {
        return Err(invalid(format!("{label} atom list must not be empty")));
    }
    if atoms.iter().any(|atom| {
        atom.position[..3].iter().any(|value| !value.is_finite())
            || !atom.gaussian_exponent.is_finite()
            || atom.gaussian_exponent <= 0.0
            || !atom.gaussian_amplitude.is_finite()
            || atom.gaussian_amplitude <= 0.0
            || !atom.partial_charge.is_finite()
    }) {
        return Err(invalid(format!(
            "{label} atoms require finite coordinates, positive Gaussian parameters, and finite charges"
        )));
    }
    Ok(())
}

fn validate_mapping(
    probe_count: usize,
    reference_count: usize,
    mapping: &[AtomMapping],
) -> Result<(), AlignmentError> {
    if mapping.is_empty() {
        return Err(invalid(
            "mapped Horn alignment requires at least one atom pair",
        ));
    }
    let mut probe_seen = HashSet::with_capacity(mapping.len());
    let mut reference_seen = HashSet::with_capacity(mapping.len());
    for entry in mapping {
        if entry.probe_atom as usize >= probe_count
            || entry.reference_atom as usize >= reference_count
            || !entry.weight.is_finite()
            || entry.weight <= 0.0
            || !probe_seen.insert(entry.probe_atom)
            || !reference_seen.insert(entry.reference_atom)
        {
            return Err(invalid(
                "atom mapping must contain unique in-range pairs with positive finite weights",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlignmentError {
    message: String,
}

impl AlignmentError {
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for AlignmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AlignmentError {}

fn invalid(message: impl Into<String>) -> AlignmentError {
    AlignmentError {
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horn_recovers_known_proper_transform_and_scores_identical_fields() {
        let probe = atoms(&[
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 2.0, 0.0, 0.0],
            [0.2, 0.4, 1.0, 0.0],
        ]);
        let reference_positions = probe
            .iter()
            .map(|atom| {
                let [x, y, z, _] = atom.position;
                [2.0 - y, -1.0 + x, 0.5 + z, 0.0]
            })
            .collect::<Vec<_>>();
        let reference = atoms(&reference_positions);
        let mapping = (0..probe.len())
            .map(|index| AtomMapping {
                probe_atom: index as u32,
                reference_atom: index as u32,
                weight: 1.0,
            })
            .collect::<Vec<_>>();
        let result = align_and_score(&probe, &reference, &mapping, AlignmentMode::MappedHorn)
            .expect("known transform");

        assert!(result.scores.rmsd.expect("mapped RMSD") < 1.0e-5);
        assert!((result.scores.shape_tanimoto - 1.0).abs() < 1.0e-5);
        assert!((result.scores.electrostatic_carbo - 1.0).abs() < 1.0e-5);
        assert!((result.scores.combined_similarity - 1.0).abs() < 1.0e-5);
        for (observed, expected) in result
            .aligned_probe_positions
            .iter()
            .zip(reference_positions)
        {
            for axis in 0..3 {
                assert!((observed[axis] - expected[axis]).abs() < 1.0e-5);
            }
        }
    }

    #[test]
    fn fixed_pose_scores_are_symmetric_and_inverted_charges_are_negative() {
        let left = atoms(&[[0.0, 0.0, 0.0, 0.0], [1.5, 0.0, 0.0, 0.0]]);
        let mut right = left.clone();
        for atom in &mut right {
            atom.partial_charge = -atom.partial_charge;
        }
        let forward =
            align_and_score(&left, &right, &[], AlignmentMode::FixedPose).expect("fixed pose");
        let reverse = align_and_score(&right, &left, &[], AlignmentMode::FixedPose)
            .expect("reverse fixed pose");

        assert_eq!(forward.scores.rmsd, None);
        assert!((forward.scores.shape_tanimoto - 1.0).abs() < 1.0e-6);
        assert!((forward.scores.electrostatic_carbo + 1.0).abs() < 1.0e-6);
        assert!(
            (forward.scores.electrostatic_carbo - reverse.scores.electrostatic_carbo).abs()
                < 1.0e-6
        );
    }

    #[test]
    fn pinned_mlxmolkit_cheese_fixture_recovers_overlay_and_charge_sign() {
        // Reference fixture: mlxmolkit/tests/test_cheese.py at
        // 9e7337f6f93c40a39ad0187991151944a4f1e274. The numeric kernel is
        // independently implemented; these values are retained only as a
        // deterministic parity corpus under the upstream MIT license.
        let atomic_numbers = [6_u8, 7, 8, 16, 1];
        let reference_positions = [
            [0.00, 0.00, 0.00, 0.0],
            [1.42, 0.13, -0.18, 0.0],
            [-0.38, 1.21, 0.32, 0.0],
            [0.23, -0.44, 1.71, 0.0],
            [1.91, 0.78, 0.65, 0.0],
        ];
        let charges = [-0.12_f32, -0.34, -0.46, 0.28, 0.64];
        let rotation = row_rotation_z(19.0);
        let translation = [-2.3_f32, 0.7, 3.1];
        let probe_positions = reference_positions.map(|position| {
            let mut transformed = [0.0_f32; 4];
            for column in 0..3 {
                transformed[column] = translation[column]
                    + (0..3)
                        .map(|row| position[row] * rotation[row][column])
                        .sum::<f32>();
            }
            transformed
        });
        let reference = cheese_atoms(&atomic_numbers, &reference_positions, &charges);
        let inverted_charges = charges.map(|charge| -charge);
        let probe = cheese_atoms(&atomic_numbers, &probe_positions, &inverted_charges);
        let mapping = (0..probe.len())
            .map(|index| AtomMapping {
                probe_atom: index as u32,
                reference_atom: index as u32,
                weight: 1.0,
            })
            .collect::<Vec<_>>();

        let result = align_and_score(&probe, &reference, &mapping, AlignmentMode::MappedHorn)
            .expect("pinned mlxmolkit CHEESE transform");

        assert!(result.scores.rmsd.expect("mapped RMSD") < 5.0e-3);
        assert!(result.scores.shape_tanimoto > 0.999);
        assert!(result.scores.electrostatic_carbo < -0.99);
        assert!(result.scores.combined_similarity > 0.45);
        assert!(result.scores.combined_similarity < 0.55);
    }

    #[test]
    fn rejects_implicit_or_duplicate_mapping() {
        let atoms = atoms(&[[0.0, 0.0, 0.0, 0.0]]);
        assert!(align_and_score(&atoms, &atoms, &[], AlignmentMode::MappedHorn).is_err());
        let duplicate = [
            AtomMapping {
                probe_atom: 0,
                reference_atom: 0,
                weight: 1.0,
            },
            AtomMapping {
                probe_atom: 0,
                reference_atom: 0,
                weight: 1.0,
            },
        ];
        assert!(align_and_score(&atoms, &atoms, &duplicate, AlignmentMode::MappedHorn).is_err());
    }

    fn atoms(positions: &[[f32; 4]]) -> Vec<AlignmentAtom> {
        positions
            .iter()
            .enumerate()
            .map(|(index, position)| AlignmentAtom {
                position: *position,
                gaussian_exponent: 0.8 + index as f32 * 0.1,
                gaussian_amplitude: 1.2 + index as f32 * 0.2,
                partial_charge: if index.is_multiple_of(2) { 0.3 } else { -0.2 },
            })
            .collect()
    }

    fn cheese_atoms(
        atomic_numbers: &[u8],
        positions: &[[f32; 4]],
        charges: &[f32],
    ) -> Vec<AlignmentAtom> {
        atomic_numbers
            .iter()
            .zip(positions)
            .zip(charges)
            .map(|((&atomic_number, &position), &partial_charge)| {
                let radius = match atomic_number {
                    1 => 1.20_f32,
                    6 => 1.70,
                    7 => 1.55,
                    8 => 1.52,
                    16 => 1.80,
                    _ => unreachable!("fixture atomic number"),
                };
                let gaussian_exponent = 2.7 / (radius * radius);
                let gaussian_amplitude = (4.0 / 3.0)
                    * std::f32::consts::PI
                    * radius.powi(3)
                    * (gaussian_exponent / std::f32::consts::PI).powf(1.5);
                AlignmentAtom {
                    position,
                    gaussian_exponent,
                    gaussian_amplitude,
                    partial_charge,
                }
            })
            .collect()
    }

    fn row_rotation_z(degrees: f32) -> [[f32; 3]; 3] {
        let theta = degrees.to_radians();
        let (sine, cosine) = theta.sin_cos();
        [[cosine, sine, 0.0], [-sine, cosine, 0.0], [0.0, 0.0, 1.0]]
    }
}
