use std::{error::Error, fmt};

mod overlap;
mod parameters;
mod rm1;
mod rotation;
mod two_center;

pub use overlap::{rm1_sp_overlap, Rm1OverlapMatrix};
pub use parameters::{rm1_parameters, semiempirical_parameters, SemiempiricalElementParameters};
pub use rm1::{
    contract_rm1_pair_fock, evaluate_rm1, evaluate_rm1_with_accelerators, evaluate_semiempirical,
    evaluate_rm1_with_pair_contractor, evaluate_rm1_with_prepared_pairs_and_accelerators,
    rm1_fock_pairs, Rm1Evaluation, Rm1FockPair,
};
pub use rotation::{rm1_rotated_pair_integrals, Rm1RotatedPairIntegrals};
pub use two_center::{
    rm1_multipole_parameters, rm1_two_center_integrals, Rm1MultipoleParameters,
    Rm1TwoCenterIntegrals,
};

const MAX_ATOMS: usize = 128;
const MAX_ORBITALS: usize = 256;
const HARTREE_TO_EV_MOPAC: f64 = 27.21;
const ANGSTROM_TO_BOHR_MOPAC: f64 = 1.0 / 0.529_167;

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

#[derive(Clone, Debug, PartialEq)]
pub struct SemiempiricalAtom {
    pub atomic_number: u8,
    pub position_angstrom: [f64; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct SemiempiricalMolecule {
    pub method: SemiempiricalMethod,
    pub atoms: Vec<SemiempiricalAtom>,
    pub charge: i32,
    pub orbital_offsets: Vec<usize>,
    pub orbital_count: usize,
    pub electron_count: usize,
}

impl SemiempiricalMolecule {
    pub fn rm1(atoms: Vec<SemiempiricalAtom>, charge: i32) -> Result<Self, SemiempiricalError> {
        Self::new(SemiempiricalMethod::Rm1, atoms, charge)
    }

    pub fn new(
        method: SemiempiricalMethod,
        atoms: Vec<SemiempiricalAtom>,
        charge: i32,
    ) -> Result<Self, SemiempiricalError> {
        if atoms.is_empty() || atoms.len() > MAX_ATOMS {
            return Err(SemiempiricalError::InvalidInput(format!(
                "{} molecule must contain 1..={MAX_ATOMS} atoms",
                method.wire_id()
            )));
        }

        let mut orbital_offsets = Vec::with_capacity(atoms.len() + 1);
        orbital_offsets.push(0);
        let mut valence_electrons = 0_usize;
        for atom in &atoms {
            if atom
                .position_angstrom
                .iter()
                .any(|value| !value.is_finite())
            {
                return Err(SemiempiricalError::InvalidInput(
                    "atom coordinates must be finite".into(),
                ));
            }
            let parameters = semiempirical_parameters(method, atom.atomic_number).ok_or_else(|| {
                SemiempiricalError::InvalidInput(format!(
                    "atomic number {} is not parameterized for {}",
                    atom.atomic_number,
                    method.wire_id()
                ))
            })?;
            valence_electrons += usize::from(parameters.valence_electrons);
            orbital_offsets.push(
                orbital_offsets.last().copied().unwrap() + usize::from(parameters.orbital_count),
            );
        }
        let electron_count = i64::try_from(valence_electrons).unwrap() - i64::from(charge);
        let orbital_count = *orbital_offsets.last().unwrap();
        if electron_count <= 0
            || electron_count & 1 != 0
            || usize::try_from(electron_count).unwrap() > orbital_count * 2
        {
            return Err(SemiempiricalError::InvalidInput(
                format!(
                    "{} currently requires a non-empty closed-shell electron configuration",
                    method.wire_id()
                ),
            ));
        }
        if orbital_count > MAX_ORBITALS {
            return Err(SemiempiricalError::InvalidInput(format!(
                "molecule requires {orbital_count} orbitals, maximum is {MAX_ORBITALS}"
            )));
        }

        Ok(Self {
            method,
            atoms,
            charge,
            orbital_offsets,
            orbital_count,
            electron_count: usize::try_from(electron_count).unwrap(),
        })
    }

    /// Returns valence-population charges from a converged AO density matrix.
    pub fn atomic_charges(&self, density: &[f64]) -> Result<Vec<f64>, SemiempiricalError> {
        let matrix_len = self.orbital_count * self.orbital_count;
        if density.len() != matrix_len || density.iter().any(|value| !value.is_finite()) {
            return Err(SemiempiricalError::InvalidInput(format!(
                "density matrix must contain {matrix_len} finite values"
            )));
        }
        Ok(self
            .atoms
            .iter()
            .enumerate()
            .map(|(atom_index, atom)| {
                let parameters = semiempirical_parameters(self.method, atom.atomic_number).unwrap();
                let population: f64 = (self.orbital_offsets[atom_index]
                    ..self.orbital_offsets[atom_index + 1])
                    .map(|orbital| density[orbital * self.orbital_count + orbital])
                    .sum();
                f64::from(parameters.valence_electrons) - population
            })
            .collect())
    }
}

/// RM1 core-core energy, including the method's Gaussian corrections.
pub fn rm1_nuclear_repulsion_energy(
    molecule: &SemiempiricalMolecule,
) -> Result<f64, SemiempiricalError> {
    semiempirical_nuclear_repulsion_energy(molecule)
}

pub fn semiempirical_nuclear_repulsion_energy(
    molecule: &SemiempiricalMolecule,
) -> Result<f64, SemiempiricalError> {
    let mut energy = 0.0;
    for left_index in 0..molecule.atoms.len() {
        for right_index in (left_index + 1)..molecule.atoms.len() {
            let left_atom = &molecule.atoms[left_index];
            let right_atom = &molecule.atoms[right_index];
            let left = semiempirical_parameters(molecule.method, left_atom.atomic_number).unwrap();
            let right = semiempirical_parameters(molecule.method, right_atom.atomic_number).unwrap();
            let displacement = [
                left_atom.position_angstrom[0] - right_atom.position_angstrom[0],
                left_atom.position_angstrom[1] - right_atom.position_angstrom[1],
                left_atom.position_angstrom[2] - right_atom.position_angstrom[2],
            ];
            let distance = displacement
                .iter()
                .map(|value| value * value)
                .sum::<f64>()
                .sqrt();
            if distance <= 1.0e-8 {
                return Err(SemiempiricalError::InvalidInput(format!(
                    "atoms {left_index} and {right_index} overlap"
                )));
            }
            let distance_bohr = distance * ANGSTROM_TO_BOHR_MOPAC;
            let rho_left = 0.5 * HARTREE_TO_EV_MOPAC / left.gss_ev;
            let rho_right = 0.5 * HARTREE_TO_EV_MOPAC / right.gss_ev;
            let ssss = HARTREE_TO_EV_MOPAC
                / (distance_bohr.powi(2) + (rho_left + rho_right).powi(2)).sqrt();
            let valence_product =
                f64::from(left.valence_electrons) * f64::from(right.valence_electrons);

            let gaussian = |parameters: &SemiempiricalElementParameters| {
                parameters
                    .gaussian
                    .iter()
                    .map(|term| term[0] * (-term[1] * (distance - term[2]).powi(2)).exp())
                    .sum::<f64>()
            };
            if matches!(
                molecule.method,
                SemiempiricalMethod::Pm6 | SemiempiricalMethod::Pm6Sp | SemiempiricalMethod::Pm6D
            ) {
                let (chi, pair_alpha) = pm6_pwcct_parameters(
                    left.atomic_number,
                    right.atomic_number,
                )
                .ok_or_else(|| {
                    SemiempiricalError::InvalidInput(format!(
                        "PM6 PWCCT parameters are unavailable for atomic numbers {} and {}",
                        left.atomic_number, right.atomic_number
                    ))
                })?;
                let atomic_radius_sum = f64::from(left.atomic_number).cbrt()
                    + f64::from(right.atomic_number).cbrt();
                let unpolarized_core = 1.0e-8 * (atomic_radius_sum / distance).powi(12);
                let special_xh = (matches!(left.atomic_number, 6..=8)
                    && right.atomic_number == 1)
                    || (matches!(right.atomic_number, 6..=8) && left.atomic_number == 1);
                let decay_distance = if special_xh {
                    distance.powi(2)
                } else {
                    distance + 0.0003 * distance.powi(6)
                };
                let mut pair_energy = unpolarized_core
                    + valence_product
                        * ssss
                        * (1.0 + 2.0 * chi * (-pair_alpha * decay_distance).exp());
                if left.atomic_number == 6 && right.atomic_number == 6 {
                    pair_energy += valence_product * ssss * 9.28 * (-5.98 * distance).exp();
                }
                energy += pair_energy
                    + valence_product / distance * (gaussian(left) + gaussian(right));
                continue;
            }

            let left_decay = (-left.alpha_angstrom_inv * distance).exp()
                * if matches!(left.atomic_number, 7 | 8) && right.atomic_number == 1 {
                    distance
                } else {
                    1.0
                };
            let right_decay = (-right.alpha_angstrom_inv * distance).exp()
                * if matches!(right.atomic_number, 7 | 8) && left.atomic_number == 1 {
                    distance
                } else {
                    1.0
                };
            energy += valence_product * ssss * (1.0 + left_decay + right_decay)
                + valence_product / distance * (gaussian(left) + gaussian(right));
        }
    }
    Ok(energy)
}

fn pm6_pwcct_parameters(left: u8, right: u8) -> Option<(f64, f64)> {
    let pair = if left <= right { (left, right) } else { (right, left) };
    Some(match pair {
        (1, 1) => (2.24359, 3.54094),
        (1, 6) => (0.21651, 1.02781),
        (1, 7) => (0.17551, 0.96941),
        (1, 8) => (0.19229, 1.26094),
        (6, 6) => (0.81351, 2.61371),
        (6, 7) => (0.85995, 2.68611),
        (6, 8) => (0.99021, 2.88961),
        (7, 7) => (0.67531, 2.5745),
        (7, 8) => (0.76476, 2.78429),
        (8, 8) => (0.535112, 2.623998),
        _ => return None,
    })
}

/// Runs a deterministic restricted, closed-shell SCF cycle.
///
/// Matrices are dense, symmetric, row-major arrays. `build_fock` receives the
/// current density and must return one matrix with the same dimensions. This
/// bounded CPU implementation is the correctness oracle for native kernels.
pub fn solve_closed_shell_scf(
    orbital_count: usize,
    electron_count: usize,
    options: SemiempiricalScfOptions,
    build_fock: impl FnMut(&[f64]) -> Result<Vec<f64>, SemiempiricalError>,
) -> Result<SemiempiricalScfResult, SemiempiricalError> {
    solve_closed_shell_scf_with_eigensolver(
        orbital_count,
        electron_count,
        options,
        build_fock,
        symmetric_eigendecomposition,
    )
}

pub fn solve_closed_shell_scf_with_eigensolver(
    orbital_count: usize,
    electron_count: usize,
    options: SemiempiricalScfOptions,
    mut build_fock: impl FnMut(&[f64]) -> Result<Vec<f64>, SemiempiricalError>,
    mut diagonalize: impl FnMut(&[f64], usize) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError>,
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
        if dot(&residual, &residual) > 1.0e-28 {
            diis.push(fock.clone(), residual);
            if let Some(extrapolated) = diis.extrapolate() {
                fock = extrapolated;
            }
        }

        let (energies, coefficients) = diagonalize(&fock, orbital_count)?;
        validate_matrix(&energies, orbital_count, "eigenvalue")?;
        validate_matrix(&coefficients, matrix_len, "eigenvector")?;
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

pub fn symmetric_eigendecomposition(
    matrix: &[f64],
    n: usize,
) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError> {
    validate_matrix(matrix, n.saturating_mul(n), "symmetric eigensolver input")?;
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

    #[test]
    fn rm1_molecule_builds_a_stable_basis_and_population_charges() {
        let water = SemiempiricalMolecule::rm1(
            vec![
                SemiempiricalAtom {
                    atomic_number: 8,
                    position_angstrom: [0.0, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.96, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [-0.24, 0.93, 0.0],
                },
            ],
            0,
        )
        .unwrap();
        assert_eq!(water.orbital_offsets, [0, 4, 5, 6]);
        assert_eq!(water.orbital_count, 6);
        assert_eq!(water.electron_count, 8);

        let mut density = vec![0.0; 36];
        for (orbital, population) in [1.8, 1.8, 1.3, 1.3, 0.9, 0.9].into_iter().enumerate() {
            density[orbital * 6 + orbital] = population;
        }
        let charges = water.atomic_charges(&density).unwrap();
        assert_eq!(charges.len(), 3);
        assert!(charges.iter().sum::<f64>().abs() < 1.0e-12);
        assert!((charges[0] + 0.2).abs() < 1.0e-12);
        assert!((charges[1] - 0.1).abs() < 1.0e-12);
    }

    #[test]
    fn rm1_molecule_rejects_unsupported_elements_and_open_shells() {
        assert!(SemiempiricalMolecule::rm1(
            vec![SemiempiricalAtom {
                atomic_number: 14,
                position_angstrom: [0.0; 3],
            }],
            0,
        )
        .is_err());
        assert!(SemiempiricalMolecule::rm1(
            vec![SemiempiricalAtom {
                atomic_number: 1,
                position_angstrom: [0.0; 3],
            }],
            0,
        )
        .is_err());
    }

    #[test]
    fn rm1_hydrogen_nuclear_energy_matches_the_pinned_reference() {
        let hydrogen = SemiempiricalMolecule::rm1(
            vec![
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.0, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.74, 0.0, 0.0],
                },
            ],
            0,
        )
        .unwrap();
        let energy = rm1_nuclear_repulsion_energy(&hydrogen).unwrap();
        assert!((energy - 13.780_913_698_216_068).abs() < 1.0e-12);
    }

    #[test]
    fn rm1_nuclear_energy_rejects_overlapping_atoms() {
        let hydrogen = SemiempiricalMolecule::rm1(
            vec![
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.0; 3],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [0.0; 3],
                },
            ],
            0,
        )
        .unwrap();
        assert!(rm1_nuclear_repulsion_energy(&hydrogen).is_err());
    }
}
