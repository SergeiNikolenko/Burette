//! Deterministic bounded L-BFGS reference for distance-geometry embedding.

use std::collections::VecDeque;

use crate::{
    evaluate_distance_constraints, evaluate_etk_geometry, evaluate_mmff, DistanceConstraint,
    DistanceGeometryError, EtkGeometryTerms, MmffParameters,
};

const MAX_OPTIMIZER_ITERATIONS: u32 = 10_000;
const MAX_LINE_SEARCH_STEPS: u8 = 64;
const MAX_HISTORY_SIZE: u8 = 64;
const MIN_CURVATURE: f32 = 1.0e-10;
const MMFF_BFGS_MAX_ATOMS: u32 = 32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DistanceGeometryOptimizationOptions {
    pub max_iterations: u32,
    pub history_size: u8,
    pub gradient_tolerance: f32,
    pub relative_step_tolerance: f32,
    pub armijo_coefficient: f32,
    pub max_line_search_steps: u8,
    pub max_step_factor: f32,
}

impl Default for DistanceGeometryOptimizationOptions {
    fn default() -> Self {
        Self {
            max_iterations: 1_000,
            history_size: 8,
            gradient_tolerance: 1.0e-4,
            relative_step_tolerance: 1.2e-6,
            armijo_coefficient: 1.0e-4,
            max_line_search_steps: 32,
            max_step_factor: 100.0,
        }
    }
}

impl DistanceGeometryOptimizationOptions {
    pub fn validate(self) -> Result<Self, DistanceGeometryError> {
        if !(1..=MAX_OPTIMIZER_ITERATIONS).contains(&self.max_iterations) {
            return Err(invalid(format!(
                "distance optimizer maxIterations must be in 1..={MAX_OPTIMIZER_ITERATIONS}"
            )));
        }
        if !(1..=MAX_HISTORY_SIZE).contains(&self.history_size) {
            return Err(invalid(format!(
                "distance optimizer historySize must be in 1..={MAX_HISTORY_SIZE}"
            )));
        }
        if !(1..=MAX_LINE_SEARCH_STEPS).contains(&self.max_line_search_steps) {
            return Err(invalid(format!(
                "distance optimizer maxLineSearchSteps must be in 1..={MAX_LINE_SEARCH_STEPS}"
            )));
        }
        if !self.gradient_tolerance.is_finite()
            || self.gradient_tolerance <= 0.0
            || !self.relative_step_tolerance.is_finite()
            || self.relative_step_tolerance <= 0.0
            || !self.armijo_coefficient.is_finite()
            || !(0.0..0.5).contains(&self.armijo_coefficient)
            || !self.max_step_factor.is_finite()
            || self.max_step_factor <= 0.0
        {
            return Err(invalid(
                "distance optimizer floating options are outside the supported domain",
            ));
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DistanceGeometryOptimizationStatus {
    ConvergedGradient,
    ConvergedStep,
    LineSearchExhausted,
    MaxIterations,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DistanceGeometryOptimization {
    pub positions: Vec<[f32; 4]>,
    pub energy: f32,
    pub scaled_gradient_max: f32,
    pub iterations: u32,
    pub status: DistanceGeometryOptimizationStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MmffOptimizerKind {
    Bfgs,
    Lbfgs,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MmffOptimization {
    pub positions: Vec<[f32; 4]>,
    pub energy: f32,
    pub scaled_gradient_max: f32,
    pub iterations: u32,
    pub status: DistanceGeometryOptimizationStatus,
    pub optimizer: MmffOptimizerKind,
}

#[derive(Clone, Debug)]
struct HistoryEntry {
    step: Vec<f32>,
    gradient_delta: Vec<f32>,
    inverse_curvature: f32,
}

pub fn optimize_distance_geometry(
    initial_positions: &[[f32; 4]],
    constraints: &[DistanceConstraint],
    options: DistanceGeometryOptimizationOptions,
) -> Result<DistanceGeometryOptimization, DistanceGeometryError> {
    optimize_geometry(
        initial_positions,
        options,
        |positions| {
            let evaluation = evaluate_distance_constraints(positions, constraints)?;
            Ok(ObjectiveEvaluation {
                energy: evaluation.total_energy(),
                gradients: evaluation.gradients,
            })
        },
        OptimizerAlgorithm::Lbfgs,
    )
}

pub fn optimize_etk_geometry(
    initial_positions: &[[f32; 4]],
    terms: EtkGeometryTerms<'_>,
    options: DistanceGeometryOptimizationOptions,
) -> Result<DistanceGeometryOptimization, DistanceGeometryError> {
    optimize_geometry(
        initial_positions,
        options,
        |positions| {
            let evaluation =
                evaluate_etk_geometry(positions, terms.torsions, terms.impropers, terms.distances)
                    .map_err(|error| {
                        invalid(format!("ETK optimizer objective is invalid: {error}"))
                    })?;
            Ok(ObjectiveEvaluation {
                energy: evaluation.energy,
                gradients: evaluation.gradients,
            })
        },
        OptimizerAlgorithm::Lbfgs,
    )
}

pub fn optimize_mmff(
    initial_positions: &[[f32; 4]],
    parameters: &MmffParameters,
    options: DistanceGeometryOptimizationOptions,
) -> Result<MmffOptimization, DistanceGeometryError> {
    let optimizer = if parameters.atom_count <= MMFF_BFGS_MAX_ATOMS {
        MmffOptimizerKind::Bfgs
    } else {
        MmffOptimizerKind::Lbfgs
    };
    let result = optimize_geometry(
        initial_positions,
        options,
        |positions| {
            let evaluation = evaluate_mmff(parameters, positions).map_err(|error| {
                invalid(format!("MMFF optimizer objective is invalid: {error}"))
            })?;
            Ok(ObjectiveEvaluation {
                energy: evaluation.energy.total() as f32,
                gradients: evaluation.gradients,
            })
        },
        match optimizer {
            MmffOptimizerKind::Bfgs => OptimizerAlgorithm::Bfgs,
            MmffOptimizerKind::Lbfgs => OptimizerAlgorithm::Lbfgs,
        },
    )?;
    Ok(MmffOptimization {
        positions: result.positions,
        energy: result.energy,
        scaled_gradient_max: result.scaled_gradient_max,
        iterations: result.iterations,
        status: result.status,
        optimizer,
    })
}

struct ObjectiveEvaluation {
    energy: f32,
    gradients: Vec<[f32; 4]>,
}

#[derive(Clone, Copy)]
enum OptimizerAlgorithm {
    Bfgs,
    Lbfgs,
}

fn optimize_geometry(
    initial_positions: &[[f32; 4]],
    options: DistanceGeometryOptimizationOptions,
    evaluate: impl Fn(&[[f32; 4]]) -> Result<ObjectiveEvaluation, DistanceGeometryError>,
    algorithm: OptimizerAlgorithm,
) -> Result<DistanceGeometryOptimization, DistanceGeometryError> {
    let options = options.validate()?;
    let mut positions = initial_positions.to_vec();
    let mut evaluation = evaluate(&positions)?;
    let mut gradient = flatten(&evaluation.gradients);
    let mut energy = evaluation.energy;
    let mut scaled_gradient_max = scaled_gradient_maximum(&positions, &gradient, energy);
    if scaled_gradient_max < options.gradient_tolerance {
        return Ok(result(
            positions,
            energy,
            scaled_gradient_max,
            0,
            DistanceGeometryOptimizationStatus::ConvergedGradient,
        ));
    }

    let mut history = VecDeque::<HistoryEntry>::with_capacity(options.history_size as usize);
    let mut inverse_hessian =
        matches!(algorithm, OptimizerAlgorithm::Bfgs).then(|| identity_matrix(gradient.len()));
    let mut direction = gradient.iter().map(|value| -*value).collect::<Vec<_>>();
    let coordinate_norm = l2_norm(&flatten(&positions));
    let max_step = options.max_step_factor * coordinate_norm.max(gradient.len() as f32);

    for iteration in 1..=options.max_iterations {
        cap_norm(&mut direction, max_step);
        let mut slope = dot(&direction, &gradient);
        if !slope.is_finite() || slope >= 0.0 {
            history.clear();
            if let Some(hessian) = &mut inverse_hessian {
                *hessian = identity_matrix(gradient.len());
            }
            direction.clone_from(&gradient);
            for value in &mut direction {
                *value = -*value;
            }
            slope = -dot(&gradient, &gradient);
        }

        let old_flat = flatten(&positions);
        let old_gradient = gradient.clone();
        let old_energy = energy;
        let relative_direction = direction
            .iter()
            .zip(&old_flat)
            .map(|(step, position)| step.abs() / position.abs().max(1.0))
            .fold(0.0_f32, f32::max);
        if relative_direction == 0.0 {
            return Ok(result(
                positions,
                energy,
                scaled_gradient_max,
                iteration - 1,
                DistanceGeometryOptimizationStatus::ConvergedStep,
            ));
        }
        let minimum_step = options.relative_step_tolerance / relative_direction;
        let mut line_step = 1.0_f32;
        let mut accepted = None;
        for _ in 0..options.max_line_search_steps {
            if line_step < minimum_step {
                break;
            }
            let trial_flat = old_flat
                .iter()
                .zip(&direction)
                .map(|(position, step)| position + line_step * step)
                .collect::<Vec<_>>();
            let trial_positions = unflatten(&trial_flat)?;
            let trial_evaluation = evaluate(&trial_positions)?;
            let trial_energy = trial_evaluation.energy;
            if trial_energy <= old_energy + options.armijo_coefficient * line_step * slope {
                accepted = Some((trial_positions, trial_evaluation, trial_energy));
                break;
            }
            line_step *= 0.5;
        }
        let Some((next_positions, next_evaluation, next_energy)) = accepted else {
            return Ok(result(
                positions,
                energy,
                scaled_gradient_max,
                iteration - 1,
                DistanceGeometryOptimizationStatus::LineSearchExhausted,
            ));
        };

        positions = next_positions;
        evaluation = next_evaluation;
        energy = next_energy;
        gradient = flatten(&evaluation.gradients);
        let next_flat = flatten(&positions);
        let step = difference(&next_flat, &old_flat);
        let relative_step = step
            .iter()
            .zip(&next_flat)
            .map(|(delta, position)| delta.abs() / position.abs().max(1.0))
            .fold(0.0_f32, f32::max);
        scaled_gradient_max = scaled_gradient_maximum(&positions, &gradient, energy);
        if relative_step < options.relative_step_tolerance {
            return Ok(result(
                positions,
                energy,
                scaled_gradient_max,
                iteration,
                DistanceGeometryOptimizationStatus::ConvergedStep,
            ));
        }
        if scaled_gradient_max < options.gradient_tolerance {
            return Ok(result(
                positions,
                energy,
                scaled_gradient_max,
                iteration,
                DistanceGeometryOptimizationStatus::ConvergedGradient,
            ));
        }

        let gradient_delta = difference(&gradient, &old_gradient);
        let curvature = dot(&gradient_delta, &step);
        if curvature.is_finite() && curvature > MIN_CURVATURE {
            if let Some(hessian) = &mut inverse_hessian {
                update_inverse_hessian(hessian, &step, &gradient_delta, curvature);
            } else {
                if history.len() == options.history_size as usize {
                    history.pop_front();
                }
                history.push_back(HistoryEntry {
                    step,
                    gradient_delta,
                    inverse_curvature: 1.0 / curvature,
                });
            }
        }
        direction = if let Some(hessian) = &inverse_hessian {
            matrix_direction(hessian, &gradient)
        } else {
            lbfgs_direction(&gradient, &history)
        };
    }

    Ok(result(
        positions,
        energy,
        scaled_gradient_max,
        options.max_iterations,
        DistanceGeometryOptimizationStatus::MaxIterations,
    ))
}

fn identity_matrix(size: usize) -> Vec<f32> {
    let mut matrix = vec![0.0; size * size];
    for index in 0..size {
        matrix[index * size + index] = 1.0;
    }
    matrix
}

fn update_inverse_hessian(hessian: &mut [f32], step: &[f32], delta: &[f32], curvature: f32) {
    let size = step.len();
    let mut hessian_delta = vec![0.0; size];
    for row in 0..size {
        hessian_delta[row] = hessian[row * size..(row + 1) * size]
            .iter()
            .zip(delta)
            .map(|(value, delta)| value * delta)
            .sum();
    }
    let inverse_curvature = curvature.recip();
    let coefficient = (1.0 + dot(delta, &hessian_delta) * inverse_curvature) * inverse_curvature;
    for row in 0..size {
        for column in 0..size {
            hessian[row * size + column] += coefficient * step[row] * step[column]
                - inverse_curvature
                    * (hessian_delta[row] * step[column] + step[row] * hessian_delta[column]);
        }
    }
}

fn matrix_direction(hessian: &[f32], gradient: &[f32]) -> Vec<f32> {
    let size = gradient.len();
    (0..size)
        .map(|row| {
            -hessian[row * size..(row + 1) * size]
                .iter()
                .zip(gradient)
                .map(|(value, gradient)| value * gradient)
                .sum::<f32>()
        })
        .collect()
}

fn lbfgs_direction(gradient: &[f32], history: &VecDeque<HistoryEntry>) -> Vec<f32> {
    let mut transformed = gradient.to_vec();
    let mut alphas = Vec::with_capacity(history.len());
    for entry in history.iter().rev() {
        let alpha = entry.inverse_curvature * dot(&entry.step, &transformed);
        add_scaled(&mut transformed, &entry.gradient_delta, -alpha);
        alphas.push(alpha);
    }
    if let Some(newest) = history.back() {
        let numerator = dot(&newest.step, &newest.gradient_delta);
        let denominator = dot(&newest.gradient_delta, &newest.gradient_delta);
        if denominator > 0.0 {
            let scale = numerator / denominator;
            for value in &mut transformed {
                *value *= scale;
            }
        }
    }
    for (entry, alpha) in history.iter().zip(alphas.into_iter().rev()) {
        let beta = entry.inverse_curvature * dot(&entry.gradient_delta, &transformed);
        add_scaled(&mut transformed, &entry.step, alpha - beta);
    }
    for value in &mut transformed {
        *value = -*value;
    }
    transformed
}

fn scaled_gradient_maximum(positions: &[[f32; 4]], gradient: &[f32], energy: f32) -> f32 {
    flatten(positions)
        .iter()
        .zip(gradient)
        .map(|(position, gradient)| gradient.abs() * position.abs().max(1.0))
        .fold(0.0_f32, f32::max)
        / energy.abs().max(1.0)
}

fn result(
    positions: Vec<[f32; 4]>,
    energy: f32,
    scaled_gradient_max: f32,
    iterations: u32,
    status: DistanceGeometryOptimizationStatus,
) -> DistanceGeometryOptimization {
    DistanceGeometryOptimization {
        positions,
        energy,
        scaled_gradient_max,
        iterations,
        status,
    }
}

fn flatten(values: &[[f32; 4]]) -> Vec<f32> {
    values
        .iter()
        .flat_map(|value| value.iter().copied())
        .collect()
}

fn unflatten(values: &[f32]) -> Result<Vec<[f32; 4]>, DistanceGeometryError> {
    if values.is_empty() || !values.len().is_multiple_of(4) {
        return Err(invalid(
            "distance optimizer coordinates must contain complete float4 atoms",
        ));
    }
    Ok(values
        .chunks_exact(4)
        .map(|chunk| [chunk[0], chunk[1], chunk[2], chunk[3]])
        .collect())
}

fn difference(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right)
        .map(|(left, right)| left - right)
        .collect()
}

fn add_scaled(target: &mut [f32], source: &[f32], scale: f32) {
    for (target, source) in target.iter_mut().zip(source) {
        *target += scale * source;
    }
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum()
}

fn l2_norm(values: &[f32]) -> f32 {
    dot(values, values).sqrt()
}

fn cap_norm(values: &mut [f32], maximum: f32) {
    let norm = l2_norm(values);
    if norm > maximum {
        let scale = maximum / norm;
        for value in values {
            *value *= scale;
        }
    }
}

fn invalid(message: impl Into<String>) -> DistanceGeometryError {
    DistanceGeometryError::new(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mmff_parameters(atom_count: u32) -> MmffParameters {
        MmffParameters {
            variant: crate::MmffVariant::Mmff94,
            atom_count,
            bonds: Vec::new(),
            angles: Vec::new(),
            stretch_bends: Vec::new(),
            out_of_planes: Vec::new(),
            torsions: Vec::new(),
            van_der_waals: Vec::new(),
            electrostatics: Vec::new(),
        }
    }

    #[test]
    fn lbfgs_converges_into_distance_bounds_deterministically() {
        let positions = [[0.0; 4], [4.0, 1.0, 0.5, 0.0]];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 2.0,
            weight: 1.0,
        }];
        let first = optimize_distance_geometry(
            &positions,
            &constraints,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("optimize distance geometry");
        let second = optimize_distance_geometry(
            &positions,
            &constraints,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("repeat distance geometry");

        assert_eq!(first, second);
        assert!(matches!(
            first.status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
                | DistanceGeometryOptimizationStatus::ConvergedStep
        ));
        assert!(first.energy <= 1.0e-8);
        let delta = first.positions[0]
            .iter()
            .zip(first.positions[1])
            .map(|(left, right)| (left - right) * (left - right))
            .sum::<f32>();
        assert!((1.0..=2.0).contains(&delta));
    }

    #[test]
    fn already_satisfied_positions_finish_without_an_iteration() {
        let result = optimize_distance_geometry(
            &[[0.0; 4], [1.0, 0.0, 0.0, 0.0]],
            &[DistanceConstraint {
                left_atom: 0,
                right_atom: 1,
                lower_squared: 0.5,
                upper_squared: 1.5,
                weight: 1.0,
            }],
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("already satisfied");
        assert_eq!(result.iterations, 0);
        assert_eq!(
            result.status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
        );
        assert_eq!(result.energy, 0.0);
    }

    #[test]
    fn invalid_options_fail_before_optimization() {
        let options = DistanceGeometryOptimizationOptions {
            history_size: 0,
            ..DistanceGeometryOptimizationOptions::default()
        };
        assert!(optimize_distance_geometry(&[[0.0; 4]], &[], options).is_err());
    }

    #[test]
    fn bounded_line_search_reports_exhaustion_without_moving_coordinates() {
        let positions = [[0.0; 4], [4.0, 1.0, 0.5, 0.0]];
        let constraints = [DistanceConstraint {
            left_atom: 0,
            right_atom: 1,
            lower_squared: 1.0,
            upper_squared: 2.0,
            weight: 1.0,
        }];
        let options = DistanceGeometryOptimizationOptions {
            max_line_search_steps: 1,
            ..DistanceGeometryOptimizationOptions::default()
        };
        let result = optimize_distance_geometry(&positions, &constraints, options)
            .expect("bounded line search result");

        assert_eq!(
            result.status,
            DistanceGeometryOptimizationStatus::LineSearchExhausted
        );
        assert_eq!(result.iterations, 0);
        assert_eq!(result.positions, positions);
    }

    #[test]
    fn etk_optimizer_reduces_the_reference_objective_deterministically() {
        let positions = [
            [0.1, 0.2, -0.3, 0.0],
            [1.2, -0.1, 0.4, 0.0],
            [2.0, 0.8, -0.2, 0.0],
            [2.7, 1.1, 0.9, 0.0],
        ];
        let torsions = [crate::EtkTorsionConstraint {
            atoms: [0, 1, 2, 3],
            coefficients: [0.7, 0.3, 0.2, 0.0, 0.1, 0.0],
            signs: [1, -1, 1, 0, -1, 0],
        }];
        let impropers = [crate::EtkImproperConstraint {
            atoms: [3, 2, 1, 0],
            weight: 0.4,
        }];
        let distances = [crate::EtkDistanceConstraint {
            atoms: [0, 3],
            lower: 0.5,
            upper: 1.5,
            weight: 0.8,
        }];
        let terms = EtkGeometryTerms {
            torsions: &torsions,
            impropers: &impropers,
            distances: &distances,
        };
        let initial = evaluate_etk_geometry(&positions, &torsions, &impropers, &distances)
            .expect("initial ETK energy")
            .energy;
        let first = optimize_etk_geometry(
            &positions,
            terms,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("optimize ETK geometry");
        let second = optimize_etk_geometry(
            &positions,
            terms,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("repeat ETK optimization");
        assert_eq!(first, second);
        assert!(first.energy < initial);
        assert!(matches!(
            first.status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
                | DistanceGeometryOptimizationStatus::ConvergedStep
        ));
    }

    #[test]
    fn mmff_uses_full_bfgs_for_small_molecules_and_reduces_energy() {
        let mut parameters = mmff_parameters(2);
        parameters.bonds.push(crate::MmffBondTerm {
            atoms: [0, 1],
            force_constant: 4.0,
            equilibrium_distance: 1.5,
        });
        let positions = [[0.0; 4], [1.7, 0.0, 0.0, 0.0]];
        let initial = evaluate_mmff(&parameters, &positions)
            .expect("initial MMFF energy")
            .energy
            .total();
        let optimized = optimize_mmff(
            &positions,
            &parameters,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("small-molecule MMFF optimization");
        assert_eq!(optimized.optimizer, MmffOptimizerKind::Bfgs);
        assert!(f64::from(optimized.energy) < initial);
        assert!(matches!(
            optimized.status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
                | DistanceGeometryOptimizationStatus::ConvergedStep
        ));
    }

    #[test]
    fn mmff_uses_lbfgs_above_the_dense_hessian_threshold() {
        let parameters = mmff_parameters(MMFF_BFGS_MAX_ATOMS + 1);
        let positions = vec![[0.0; 4]; parameters.atom_count as usize];
        let optimized = optimize_mmff(
            &positions,
            &parameters,
            DistanceGeometryOptimizationOptions::default(),
        )
        .expect("large-molecule MMFF optimization");
        assert_eq!(optimized.optimizer, MmffOptimizerKind::Lbfgs);
        assert_eq!(
            optimized.status,
            DistanceGeometryOptimizationStatus::ConvergedGradient
        );
    }
}
