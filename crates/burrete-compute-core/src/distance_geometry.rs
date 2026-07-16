//! Distance-bound objective and gradient reference for conformer embedding.

use std::{error::Error, fmt};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DistanceConstraint {
    pub left_atom: u32,
    pub right_atom: u32,
    pub lower_squared: f32,
    pub upper_squared: f32,
    pub weight: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DistanceConstraintEvaluation {
    pub atom_energies: Vec<f32>,
    pub gradients: Vec<[f32; 4]>,
}

impl DistanceConstraintEvaluation {
    pub fn total_energy(&self) -> f32 {
        self.atom_energies.iter().copied().sum()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DistanceGeometryError(String);

impl DistanceGeometryError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for DistanceGeometryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for DistanceGeometryError {}

pub fn evaluate_distance_constraints(
    positions: &[[f32; 4]],
    constraints: &[DistanceConstraint],
) -> Result<DistanceConstraintEvaluation, DistanceGeometryError> {
    if positions.is_empty() || positions.iter().flatten().any(|value| !value.is_finite()) {
        return Err(invalid(
            "distance geometry positions must be non-empty and finite",
        ));
    }
    let atom_count = u32::try_from(positions.len())
        .map_err(|_| invalid("distance geometry atom count exceeds uint32"))?;
    for constraint in constraints {
        if constraint.left_atom >= atom_count
            || constraint.right_atom >= atom_count
            || constraint.left_atom == constraint.right_atom
            || !constraint.lower_squared.is_finite()
            || !constraint.upper_squared.is_finite()
            || constraint.lower_squared < 0.0
            || constraint.upper_squared <= 0.0
            || constraint.upper_squared < constraint.lower_squared
            || !constraint.weight.is_finite()
            || constraint.weight < 0.0
        {
            return Err(invalid(
                "distance constraint is outside the supported domain",
            ));
        }
    }

    let mut atom_energies = vec![0.0; positions.len()];
    let mut gradients = vec![[0.0; 4]; positions.len()];
    for atom in 0..atom_count {
        for constraint in constraints {
            let is_left = constraint.left_atom == atom;
            let is_right = constraint.right_atom == atom;
            if !is_left && !is_right {
                continue;
            }
            let left = positions[constraint.left_atom as usize];
            let right = positions[constraint.right_atom as usize];
            let delta =
                std::array::from_fn::<_, 4, _>(|dimension| left[dimension] - right[dimension]);
            let distance_squared = delta.iter().map(|value| value * value).sum::<f32>();
            let (term_energy, derivative_scale) = if distance_squared > constraint.upper_squared {
                let normalized = distance_squared / constraint.upper_squared - 1.0;
                (
                    constraint.weight * normalized * normalized,
                    4.0 * constraint.weight * normalized / constraint.upper_squared,
                )
            } else if distance_squared < constraint.lower_squared {
                let denominator = constraint.lower_squared + distance_squared;
                let normalized = 2.0 * constraint.lower_squared / denominator - 1.0;
                (
                    constraint.weight * normalized * normalized,
                    8.0 * constraint.weight
                        * constraint.lower_squared
                        * (1.0 - 2.0 * constraint.lower_squared / denominator)
                        / (denominator * denominator),
                )
            } else {
                (0.0, 0.0)
            };
            if term_energy == 0.0 {
                continue;
            }
            // Each term is gathered once by each endpoint. Splitting its
            // energy evenly preserves an exact total without atomics.
            atom_energies[atom as usize] += 0.5 * term_energy;
            let direction = if is_left { 1.0 } else { -1.0 };
            let scale = derivative_scale * direction;
            for dimension in 0..4 {
                gradients[atom as usize][dimension] += scale * delta[dimension];
            }
        }
    }
    Ok(DistanceConstraintEvaluation {
        atom_energies,
        gradients,
    })
}

fn invalid(message: impl Into<String>) -> DistanceGeometryError {
    DistanceGeometryError(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_objective_gradient_matches_central_difference() {
        let positions = [[0.0, 0.0, 0.0, 0.0], [2.0, 0.5, 0.0, 0.0]];
        let constraint = DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 4.0,
            weight: 0.75,
        };
        let evaluation = evaluate_distance_constraints(&positions, &[constraint]).expect("energy");
        assert!(evaluation.total_energy() > 0.0);
        for atom in 0..2 {
            for dimension in 0..4 {
                let epsilon = 0.001;
                let mut plus = positions;
                plus[atom][dimension] += epsilon;
                let mut minus = positions;
                minus[atom][dimension] -= epsilon;
                let numerical = (evaluate_distance_constraints(&plus, &[constraint])
                    .expect("plus")
                    .total_energy()
                    - evaluate_distance_constraints(&minus, &[constraint])
                        .expect("minus")
                        .total_energy())
                    / (2.0 * epsilon);
                assert!((evaluation.gradients[atom][dimension] - numerical).abs() < 0.002);
            }
        }
    }

    #[test]
    fn satisfied_bounds_have_zero_energy_and_invalid_terms_are_rejected() {
        let positions = [[0.0; 4], [1.0, 0.0, 0.0, 0.0]];
        let valid = DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 0.5,
            upper_squared: 1.5,
            weight: 1.0,
        };
        assert_eq!(
            evaluate_distance_constraints(&positions, &[valid])
                .expect("satisfied")
                .total_energy(),
            0.0
        );
        assert!(evaluate_distance_constraints(
            &positions,
            &[DistanceConstraint {
                right_atom: 2,
                ..valid
            }]
        )
        .is_err());
    }

    #[test]
    fn normalized_upper_and_rational_lower_penalties_match_known_answers() {
        let upper = evaluate_distance_constraints(
            &[[0.0; 4], [2.0, 0.5, 0.0, 0.0]],
            &[DistanceConstraint {
                left_atom: 0,
                right_atom: 1,
                lower_squared: 1.0,
                upper_squared: 4.0,
                weight: 0.75,
            }],
        )
        .expect("upper-bound penalty");
        assert!((upper.total_energy() - 0.002_929_687_5).abs() < 1e-8);
        assert!((upper.gradients[0][0] + 0.093_75).abs() < 1e-7);
        assert!((upper.gradients[0][1] + 0.023_437_5).abs() < 1e-7);

        let lower = evaluate_distance_constraints(
            &[[0.0; 4], [0.5, 0.0, 0.0, 0.0]],
            &[DistanceConstraint {
                left_atom: 0,
                right_atom: 1,
                lower_squared: 1.0,
                upper_squared: 4.0,
                weight: 2.0,
            }],
        )
        .expect("lower-bound penalty");
        assert!((lower.total_energy() - 0.72).abs() < 1e-7);
        assert!((lower.gradients[0][0] - 3.072).abs() < 1e-6);
    }
}
