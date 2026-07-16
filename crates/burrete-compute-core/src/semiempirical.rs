use std::{error::Error, fmt};

mod parameters;

pub use parameters::{rm1_parameters, SemiempiricalElementParameters};

const MAX_ORBITALS: usize = 256;

/// Semi-empirical methods exposed by the native compute contract.
///
/// A variant identifies a distinct parameterization and correction model. It
/// does not imply that a production evaluator for that method is available.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SemiempiricalMethod {
    Rm1,
    Am1,
    Pm3,
    Pm6,
    Pm6Sp,
    Pm6D,
    Am1Star,
}

impl SemiempiricalMethod {
    pub const ALL: [Self; 7] = [
        Self::Rm1,
        Self::Am1,
        Self::Pm3,
        Self::Pm6,
        Self::Pm6Sp,
        Self::Pm6D,
        Self::Am1Star,
    ];

    pub const fn wire_id(self) -> &'static str {
        match self {
            Self::Rm1 => "rm1",
            Self::Am1 => "am1",
            Self::Pm3 => "pm3",
            Self::Pm6 => "pm6",
            Self::Pm6Sp => "pm6_sp",
            Self::Pm6D => "pm6_d",
            Self::Am1Star => "am1_star",
        }
    }

    pub const fn uses_d_orbitals(self) -> bool {
        matches!(self, Self::Pm6D | Self::Am1Star)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SemiempiricalScfOptions {
    pub max_iterations: usize,
    pub density_tolerance: f64,
    pub initial_damping: f64,
    pub max_damping: f64,
    pub max_diis_history: usize,
}

impl Default for SemiempiricalScfOptions {
    fn default() -> Self {
        Self {
            max_iterations: 200,
            density_tolerance: 1.0e-8,
            initial_damping: 0.0,
            max_damping: 0.75,
            max_diis_history: 6,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemiempiricalScfStatus {
    Converged,
    MaximumIterations,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SemiempiricalScfResult {
    pub density: Vec<f64>,
    pub orbital_energies: Vec<f64>,
    pub iterations: usize,
    pub density_error: f64,
    pub status: SemiempiricalScfStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SemiempiricalError {
    InvalidInput(String),
    FockBuild(String),
    DiagonalizationFailed,
}

impl fmt::Display for SemiempiricalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => {
                write!(formatter, "invalid semi-empirical input: {message}")
            }
            Self::FockBuild(message) => write!(formatter, "Fock construction failed: {message}"),
            Self::DiagonalizationFailed => {
                formatter.write_str("symmetric eigensolver did not converge")
            }
        }
    }
}

impl Error for SemiempiricalError {}

/// Runs a deterministic restricted, closed-shell SCF cycle.
///
/// Matrices are dense, symmetric, row-major arrays. `build_fock` receives the
/// current density and must return one matrix with the same dimensions. This
/// bounded CPU implementation is the correctness oracle for native kernels.
pub fn solve_closed_shell_scf(
    orbital_count: usize,
    electron_count: usize,
    options: SemiempiricalScfOptions,
    mut build_fock: impl FnMut(&[f64]) -> Result<Vec<f64>, SemiempiricalError>,
) -> Result<SemiempiricalScfResult, SemiempiricalError> {
    validate_inputs(orbital_count, electron_count, options)?;
    let matrix_len = orbital_count * orbital_count;
    let occupied = electron_count / 2;
    let mut density = vec![0.0; matrix_len];
    let mut orbital_energies = vec![0.0; orbital_count];
    let mut previous_error = f64::INFINITY;
    let mut damping = options.initial_damping;
    let mut diis = DiisHistory::new(options.max_diis_history);

    for iteration in 1..=options.max_iterations {
        let mut fock = build_fock(&density)?;
        validate_matrix(&fock, matrix_len, "Fock")?;
        let residual = commutator(&fock, &density, orbital_count);
        diis.push(fock.clone(), residual);
        if let Some(extrapolated) = diis.extrapolate() {
            fock = extrapolated;
        }

        let (energies, coefficients) = symmetric_eigen(&fock, orbital_count)?;
        orbital_energies = energies;
        let target = closed_shell_density(&coefficients, orbital_count, occupied);
        let error = root_mean_square_difference(&target, &density);

        if error <= options.density_tolerance {
            return Ok(SemiempiricalScfResult {
                density: target,
                orbital_energies,
                iterations: iteration,
                density_error: error,
                status: SemiempiricalScfStatus::Converged,
            });
        }

        if error > previous_error * 1.05 {
            damping = if damping == 0.0 {
                0.2
            } else {
                (damping * 1.5).min(options.max_damping)
            };
        } else if error < previous_error {
            damping = (damping * 0.75).max(options.initial_damping);
        }
        for (current, next) in density.iter_mut().zip(target) {
            *current = damping * *current + (1.0 - damping) * next;
        }
        previous_error = error;
    }

    Ok(SemiempiricalScfResult {
        density,
        orbital_energies,
        iterations: options.max_iterations,
        density_error: previous_error,
        status: SemiempiricalScfStatus::MaximumIterations,
    })
}

fn validate_inputs(
    orbital_count: usize,
    electron_count: usize,
    options: SemiempiricalScfOptions,
) -> Result<(), SemiempiricalError> {
    if !(1..=MAX_ORBITALS).contains(&orbital_count) {
        return Err(SemiempiricalError::InvalidInput(format!(
            "orbital_count must be in 1..={MAX_ORBITALS}"
        )));
    }
    if electron_count == 0
        || !electron_count.is_multiple_of(2)
        || electron_count / 2 > orbital_count
    {
        return Err(SemiempiricalError::InvalidInput(
            "electron_count must describe a non-empty closed shell".into(),
        ));
    }
    if options.max_iterations == 0
        || !options.density_tolerance.is_finite()
        || options.density_tolerance <= 0.0
        || !options.initial_damping.is_finite()
        || !options.max_damping.is_finite()
        || !(0.0..1.0).contains(&options.max_damping)
        || !(0.0..=options.max_damping).contains(&options.initial_damping)
        || !(2..=12).contains(&options.max_diis_history)
    {
        return Err(SemiempiricalError::InvalidInput(
            "invalid SCF iteration, tolerance, damping, or DIIS options".into(),
        ));
    }
    Ok(())
}

fn validate_matrix(matrix: &[f64], expected: usize, name: &str) -> Result<(), SemiempiricalError> {
    if matrix.len() != expected || matrix.iter().any(|value| !value.is_finite()) {
        return Err(SemiempiricalError::FockBuild(format!(
            "{name} matrix must contain {expected} finite values"
        )));
    }
    Ok(())
}

fn closed_shell_density(coefficients: &[f64], n: usize, occupied: usize) -> Vec<f64> {
    let mut density = vec![0.0; n * n];
    for row in 0..n {
        for column in 0..n {
            density[row * n + column] = (0..occupied)
                .map(|orbital| {
                    2.0 * coefficients[row * n + orbital] * coefficients[column * n + orbital]
                })
                .sum();
        }
    }
    density
}

fn commutator(left: &[f64], right: &[f64], n: usize) -> Vec<f64> {
    let mut result = vec![0.0; n * n];
    for row in 0..n {
        for column in 0..n {
            for inner in 0..n {
                result[row * n + column] += left[row * n + inner] * right[inner * n + column]
                    - right[row * n + inner] * left[inner * n + column];
            }
        }
    }
    result
}

fn root_mean_square_difference(left: &[f64], right: &[f64]) -> f64 {
    (left
        .iter()
        .zip(right)
        .map(|(a, b)| (a - b).powi(2))
        .sum::<f64>()
        / left.len() as f64)
        .sqrt()
}

fn symmetric_eigen(matrix: &[f64], n: usize) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError> {
    let mut values = matrix.to_vec();
    let mut vectors = vec![0.0; n * n];
    for diagonal in 0..n {
        vectors[diagonal * n + diagonal] = 1.0;
    }

    for _ in 0..(64 * n * n) {
        let mut pivot = (0, 0);
        let mut maximum = 0.0_f64;
        for row in 0..n {
            for column in (row + 1)..n {
                let candidate = values[row * n + column].abs();
                if candidate > maximum {
                    maximum = candidate;
                    pivot = (row, column);
                }
            }
        }
        if maximum <= 1.0e-12 {
            let mut order: Vec<usize> = (0..n).collect();
            order.sort_by(|a, b| values[*a * n + *a].total_cmp(&values[*b * n + *b]));
            let energies = order
                .iter()
                .map(|index| values[*index * n + *index])
                .collect();
            let mut sorted_vectors = vec![0.0; n * n];
            for (new_column, old_column) in order.into_iter().enumerate() {
                for row in 0..n {
                    sorted_vectors[row * n + new_column] = vectors[row * n + old_column];
                }
            }
            return Ok((energies, sorted_vectors));
        }

        let (p, q) = pivot;
        let app = values[p * n + p];
        let aqq = values[q * n + q];
        let apq = values[p * n + q];
        let angle = 0.5 * (2.0 * apq).atan2(aqq - app);
        let (sine, cosine) = angle.sin_cos();
        for index in 0..n {
            let aip = values[index * n + p];
            let aiq = values[index * n + q];
            values[index * n + p] = cosine * aip - sine * aiq;
            values[index * n + q] = sine * aip + cosine * aiq;
        }
        for index in 0..n {
            let api = values[p * n + index];
            let aqi = values[q * n + index];
            values[p * n + index] = cosine * api - sine * aqi;
            values[q * n + index] = sine * api + cosine * aqi;
        }
        for row in 0..n {
            let vip = vectors[row * n + p];
            let viq = vectors[row * n + q];
            vectors[row * n + p] = cosine * vip - sine * viq;
            vectors[row * n + q] = sine * vip + cosine * viq;
        }
    }
    Err(SemiempiricalError::DiagonalizationFailed)
}

struct DiisHistory {
    capacity: usize,
    fock: Vec<Vec<f64>>,
    residual: Vec<Vec<f64>>,
}

impl DiisHistory {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            fock: Vec::new(),
            residual: Vec::new(),
        }
    }

    fn push(&mut self, fock: Vec<f64>, residual: Vec<f64>) {
        if self.fock.len() == self.capacity {
            self.fock.remove(0);
            self.residual.remove(0);
        }
        self.fock.push(fock);
        self.residual.push(residual);
    }

    fn extrapolate(&self) -> Option<Vec<f64>> {
        let count = self.fock.len();
        if count < 2 {
            return None;
        }
        let size = count + 1;
        let mut system = vec![0.0; size * size];
        let mut rhs = vec![0.0; size];
        rhs[count] = -1.0;
        for row in 0..count {
            for column in 0..count {
                system[row * size + column] = dot(&self.residual[row], &self.residual[column]);
            }
            system[row * size + count] = -1.0;
            system[count * size + row] = -1.0;
        }
        let coefficients = solve_linear_system(system, rhs, size)?;
        let mut extrapolated = vec![0.0; self.fock[0].len()];
        for (coefficient, matrix) in coefficients.into_iter().take(count).zip(&self.fock) {
            for (output, value) in extrapolated.iter_mut().zip(matrix) {
                *output += coefficient * value;
            }
        }
        extrapolated
            .iter()
            .all(|value| value.is_finite())
            .then_some(extrapolated)
    }
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn solve_linear_system(mut matrix: Vec<f64>, mut rhs: Vec<f64>, n: usize) -> Option<Vec<f64>> {
    for pivot in 0..n {
        let row = (pivot..n).max_by(|a, b| {
            matrix[*a * n + pivot]
                .abs()
                .total_cmp(&matrix[*b * n + pivot].abs())
        })?;
        if matrix[row * n + pivot].abs() <= 1.0e-14 {
            return None;
        }
        if row != pivot {
            for column in 0..n {
                matrix.swap(pivot * n + column, row * n + column);
            }
            rhs.swap(pivot, row);
        }
        let divisor = matrix[pivot * n + pivot];
        for column in pivot..n {
            matrix[pivot * n + column] /= divisor;
        }
        rhs[pivot] /= divisor;
        for row in 0..n {
            if row == pivot {
                continue;
            }
            let factor = matrix[row * n + pivot];
            for column in pivot..n {
                matrix[row * n + column] -= factor * matrix[pivot * n + column];
            }
            rhs[row] -= factor * rhs[pivot];
        }
    }
    Some(rhs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_wire_ids_are_unique_and_d_orbital_scope_is_explicit() {
        let mut ids: Vec<_> = SemiempiricalMethod::ALL
            .iter()
            .map(|method| method.wire_id())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), SemiempiricalMethod::ALL.len());
        assert!(SemiempiricalMethod::Pm6D.uses_d_orbitals());
        assert!(SemiempiricalMethod::Am1Star.uses_d_orbitals());
        assert!(!SemiempiricalMethod::Pm6.uses_d_orbitals());
    }

    #[test]
    fn closed_shell_scf_has_a_deterministic_known_answer() {
        let core = vec![-1.0, 0.2, 0.2, 0.5];
        let result = solve_closed_shell_scf(2, 2, SemiempiricalScfOptions::default(), |_| {
            Ok(core.clone())
        })
        .unwrap();
        assert_eq!(result.status, SemiempiricalScfStatus::Converged);
        assert!(result.iterations <= 3);
        assert!((result.density[0] - 1.966_234_939_601_246).abs() < 1.0e-10);
        assert!((result.density[1] + 0.257_662_650_560_332).abs() < 1.0e-10);
        assert!((result.density[3] - 0.033_765_060_398_754).abs() < 1.0e-10);
    }

    #[test]
    fn rejects_open_shell_and_non_finite_fock_inputs() {
        assert!(
            solve_closed_shell_scf(2, 3, SemiempiricalScfOptions::default(), |_| Ok(vec![
                0.0;
                4
            ]))
            .is_err()
        );
        assert!(
            solve_closed_shell_scf(2, 2, SemiempiricalScfOptions::default(), |_| Ok(
                vec![f64::NAN; 4]
            ))
            .is_err()
        );
    }
}
