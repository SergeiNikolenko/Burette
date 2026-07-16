const MIN_NORM_SQUARED: f32 = 1.0e-12;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EtkTorsionConstraint {
    pub atoms: [u32; 4],
    pub coefficients: [f32; 6],
    pub signs: [i8; 6],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EtkImproperConstraint {
    pub atoms: [u32; 4],
    pub weight: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EtkDistanceConstraint {
    pub atoms: [u32; 2],
    pub lower: f32,
    pub upper: f32,
    pub weight: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EtkGeometryEvaluation {
    pub energy: f32,
    pub gradients: Vec<[f32; 4]>,
}

#[derive(Clone, Copy, Debug)]
pub struct EtkGeometryTerms<'a> {
    pub torsions: &'a [EtkTorsionConstraint],
    pub impropers: &'a [EtkImproperConstraint],
    pub distances: &'a [EtkDistanceConstraint],
}

pub fn evaluate_etk_geometry(
    positions: &[[f32; 4]],
    torsions: &[EtkTorsionConstraint],
    impropers: &[EtkImproperConstraint],
    distances: &[EtkDistanceConstraint],
) -> Result<EtkGeometryEvaluation, EtkGeometryError> {
    validate_etk_geometry_constraints(positions.len(), torsions, impropers, distances)?;
    if positions.is_empty() || positions.iter().flatten().any(|value| !value.is_finite()) {
        return Err(EtkGeometryError::new(
            "ETK geometry positions must be finite and non-empty",
        ));
    }
    let mut energy = 0.0_f32;
    let mut gradients = vec![[0.0_f32; 4]; positions.len()];
    for term in torsions {
        let geometry = dihedral_geometry(positions, term.atoms);
        let mut derivative = 0.0_f32;
        for harmonic in 0..6 {
            let coefficient = term.coefficients[harmonic];
            let sign = f32::from(term.signs[harmonic]);
            let order = (harmonic + 1) as f32;
            energy += coefficient * (1.0 + sign * (order * geometry.angle).cos()) * 0.5;
            derivative += coefficient * (-sign * order * (order * geometry.angle).sin()) * 0.5;
        }
        accumulate_dihedral_gradient(&mut gradients, term.atoms, geometry, derivative);
    }
    for term in impropers {
        let geometry = dihedral_geometry(positions, term.atoms);
        energy += term.weight * (1.0 - (2.0 * geometry.angle).cos());
        let derivative = 2.0 * term.weight * (2.0 * geometry.angle).sin();
        accumulate_dihedral_gradient(&mut gradients, term.atoms, geometry, derivative);
    }
    for term in distances {
        let [left, right] = term.atoms.map(|atom| atom as usize);
        let delta = xyz_sub(positions[left], positions[right]);
        let distance = dot(delta, delta).max(MIN_NORM_SQUARED).sqrt();
        let violation = if distance < term.lower {
            distance - term.lower
        } else if distance > term.upper {
            distance - term.upper
        } else {
            0.0
        };
        if violation == 0.0 {
            continue;
        }
        energy += term.weight * violation * violation;
        let scale = 2.0 * term.weight * violation / distance;
        for coordinate in 0..3 {
            let value = scale * delta[coordinate];
            gradients[left][coordinate] += value;
            gradients[right][coordinate] -= value;
        }
    }
    if !energy.is_finite() || gradients.iter().flatten().any(|value| !value.is_finite()) {
        return Err(EtkGeometryError::new(
            "ETK geometry evaluation produced non-finite output",
        ));
    }
    Ok(EtkGeometryEvaluation { energy, gradients })
}

pub fn validate_etk_geometry_constraints(
    atom_count: usize,
    torsions: &[EtkTorsionConstraint],
    impropers: &[EtkImproperConstraint],
    distances: &[EtkDistanceConstraint],
) -> Result<(), EtkGeometryError> {
    for term in torsions {
        if term.atoms.iter().any(|atom| *atom as usize >= atom_count)
            || term.coefficients.iter().any(|value| !value.is_finite())
            || term.signs.iter().any(|value| !(-1..=1).contains(value))
        {
            return Err(EtkGeometryError::new(
                "ETK torsion constraint is outside the supported domain",
            ));
        }
    }
    for term in impropers {
        if term.atoms.iter().any(|atom| *atom as usize >= atom_count)
            || !term.weight.is_finite()
            || term.weight < 0.0
        {
            return Err(EtkGeometryError::new(
                "ETK improper constraint is outside the supported domain",
            ));
        }
    }
    for term in distances {
        if term.atoms.iter().any(|atom| *atom as usize >= atom_count)
            || term.atoms[0] == term.atoms[1]
            || !term.lower.is_finite()
            || !term.upper.is_finite()
            || term.lower < 0.0
            || term.upper < term.lower
            || !term.weight.is_finite()
            || term.weight < 0.0
        {
            return Err(EtkGeometryError::new(
                "ETK distance constraint is outside the supported domain",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct DihedralGeometry {
    angle: f32,
    derivatives: [[f32; 3]; 4],
}

fn dihedral_geometry(positions: &[[f32; 4]], atoms: [u32; 4]) -> DihedralGeometry {
    let [p0, p1, p2, p3] = atoms.map(|atom| positions[atom as usize]);
    let b1 = xyz_sub(p1, p0);
    let b2 = xyz_sub(p2, p1);
    let b3 = xyz_sub(p3, p2);
    let n1 = cross(b1, b2);
    let n2 = cross(b2, b3);
    let n1_squared = dot(n1, n1).max(MIN_NORM_SQUARED);
    let n2_squared = dot(n2, n2).max(MIN_NORM_SQUARED);
    let b2_squared = dot(b2, b2).max(MIN_NORM_SQUARED);
    let b2_length = b2_squared.sqrt();
    let inverse_norms = (n1_squared * n2_squared).sqrt().recip();
    let b2_unit = scale(b2, b2_length.recip());
    let cosine = (dot(n1, n2) * inverse_norms).clamp(-1.0, 1.0);
    let sine = dot(cross(n1, b2_unit), n2) * inverse_norms;
    // The atan2 convention above is the negative of the common
    // cross(n1,n2) convention. The two projection vectors also point away
    // from the central bond (p0-p1 and p2-p3), hence both dot products negate
    // the b1/b3 definitions used to construct the normals.
    let d0 = scale(n1, b2_length / n1_squared);
    let d3 = scale(n2, -b2_length / n2_squared);
    let first_projection = -dot(b1, b2) / b2_squared;
    let last_projection = -dot(b3, b2) / b2_squared;
    let d1 = add(
        scale(d0, first_projection - 1.0),
        scale(d3, -last_projection),
    );
    let d2 = add(
        scale(d3, last_projection - 1.0),
        scale(d0, -first_projection),
    );
    DihedralGeometry {
        angle: sine.atan2(cosine),
        derivatives: [d0, d1, d2, d3],
    }
}

fn accumulate_dihedral_gradient(
    gradients: &mut [[f32; 4]],
    atoms: [u32; 4],
    geometry: DihedralGeometry,
    derivative: f32,
) {
    for (atom, values) in atoms.into_iter().zip(geometry.derivatives) {
        for coordinate in 0..3 {
            gradients[atom as usize][coordinate] += derivative * values[coordinate];
        }
    }
}

fn xyz_sub(left: [f32; 4], right: [f32; 4]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn dot(left: [f32; 3], right: [f32; 3]) -> f32 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn cross(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn scale(value: [f32; 3], factor: f32) -> [f32; 3] {
    [value[0] * factor, value[1] * factor, value[2] * factor]
}

fn add(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EtkGeometryError {
    message: String,
}

impl EtkGeometryError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for EtkGeometryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for EtkGeometryError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analytic_gradient_matches_central_difference_for_all_etk_terms() {
        let positions = [
            [0.1, 0.2, -0.3, 0.0],
            [1.2, -0.1, 0.4, 0.0],
            [2.0, 0.8, -0.2, 0.0],
            [2.7, 1.1, 0.9, 0.0],
        ];
        let torsions = [EtkTorsionConstraint {
            atoms: [0, 1, 2, 3],
            coefficients: [0.7, 0.3, 0.2, 0.0, 0.1, 0.0],
            signs: [1, -1, 1, 0, -1, 0],
        }];
        let impropers = [EtkImproperConstraint {
            atoms: [3, 2, 1, 0],
            weight: 0.4,
        }];
        let distances = [EtkDistanceConstraint {
            atoms: [0, 3],
            lower: 0.5,
            upper: 1.5,
            weight: 0.8,
        }];
        let analytic = evaluate_etk_geometry(&positions, &torsions, &impropers, &distances)
            .expect("valid ETK evaluation");
        let epsilon = 1.0e-3_f32;
        for atom in 0..positions.len() {
            for coordinate in 0..3 {
                let mut lower = positions;
                let mut upper = positions;
                lower[atom][coordinate] -= epsilon;
                upper[atom][coordinate] += epsilon;
                let lower_energy = evaluate_etk_geometry(&lower, &torsions, &impropers, &distances)
                    .unwrap()
                    .energy;
                let upper_energy = evaluate_etk_geometry(&upper, &torsions, &impropers, &distances)
                    .unwrap()
                    .energy;
                let numeric = (upper_energy - lower_energy) / (2.0 * epsilon);
                assert!(
                    (analytic.gradients[atom][coordinate] - numeric).abs() < 3.0e-3,
                    "atom {atom} coordinate {coordinate}: analytic={} numeric={numeric}",
                    analytic.gradients[atom][coordinate]
                );
            }
        }
    }

    #[test]
    fn flat_bottom_distance_has_zero_energy_inside_bounds() {
        let positions = [[0.0; 4], [1.0, 0.0, 0.0, 0.0]];
        let result = evaluate_etk_geometry(
            &positions,
            &[],
            &[],
            &[EtkDistanceConstraint {
                atoms: [0, 1],
                lower: 0.9,
                upper: 1.1,
                weight: 100.0,
            }],
        )
        .expect("valid distance term");
        assert_eq!(result.energy, 0.0);
        assert_eq!(result.gradients, [[0.0; 4], [0.0; 4]]);
    }
}
