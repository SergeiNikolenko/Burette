//! Deterministic MMFF94/MMFF94s reference energy evaluation.
//!
//! The parameter values are supplied by a versioned RDKit extraction adapter;
//! the evaluator itself has no RDKit, Python, MLX, or platform dependency.

use std::fmt;

const MDYNE_ANGSTROM_TO_KCAL_MOL: f64 = 143.9325;
const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
const STRETCH_BEND_FACTOR: f64 = 2.51210;
const ELECTROSTATIC_FACTOR: f64 = 332.0716;
const MIN_NORM_SQUARED: f64 = 1.0e-20;
const REFERENCE_GRADIENT_STEP: f64 = 1.0e-3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MmffVariant {
    Mmff94,
    Mmff94s,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffBondTerm {
    pub atoms: [u32; 2],
    pub force_constant: f32,
    pub equilibrium_distance: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffAngleTerm {
    pub atoms: [u32; 3],
    pub force_constant: f32,
    pub equilibrium_degrees: f32,
    pub linear: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffStretchBendTerm {
    pub atoms: [u32; 3],
    pub force_ij: f32,
    pub force_kj: f32,
    pub equilibrium_ij: f32,
    pub equilibrium_kj: f32,
    pub equilibrium_degrees: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffOutOfPlaneTerm {
    pub atoms: [u32; 4],
    pub force_constant: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffTorsionTerm {
    pub atoms: [u32; 4],
    pub v1: f32,
    pub v2: f32,
    pub v3: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffVanDerWaalsTerm {
    pub atoms: [u32; 2],
    pub r_star: f32,
    pub epsilon: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MmffElectrostaticTerm {
    pub atoms: [u32; 2],
    pub charge_product: f32,
    pub is_one_four: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MmffParameters {
    pub variant: MmffVariant,
    pub atom_count: u32,
    pub bonds: Vec<MmffBondTerm>,
    pub angles: Vec<MmffAngleTerm>,
    pub stretch_bends: Vec<MmffStretchBendTerm>,
    pub out_of_planes: Vec<MmffOutOfPlaneTerm>,
    pub torsions: Vec<MmffTorsionTerm>,
    pub van_der_waals: Vec<MmffVanDerWaalsTerm>,
    pub electrostatics: Vec<MmffElectrostaticTerm>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MmffEnergyBreakdown {
    pub bond_stretch: f64,
    pub angle_bend: f64,
    pub stretch_bend: f64,
    pub out_of_plane: f64,
    pub torsion: f64,
    pub van_der_waals: f64,
    pub electrostatic: f64,
}

impl MmffEnergyBreakdown {
    pub fn total(self) -> f64 {
        self.bond_stretch
            + self.angle_bend
            + self.stretch_bend
            + self.out_of_plane
            + self.torsion
            + self.van_der_waals
            + self.electrostatic
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MmffEvaluation {
    pub energy: MmffEnergyBreakdown,
    pub gradients: Vec<[f32; 4]>,
}

pub fn evaluate_mmff_energy(
    parameters: &MmffParameters,
    positions: &[[f32; 4]],
) -> Result<MmffEnergyBreakdown, MmffError> {
    validate(parameters, positions)?;
    evaluate_unchecked(parameters, positions)
}

pub fn validate_mmff_parameters(parameters: &MmffParameters) -> Result<(), MmffError> {
    if parameters.atom_count == 0 {
        return Err(MmffError::new("MMFF parameter atom count must be positive"));
    }
    validate_terms(parameters)
}

/// Evaluates the bounded CPU reference gradient using central differences.
///
/// Keeping this path mathematically independent makes it useful for startup
/// known-answer tests and term-by-term parity fixtures. It is not an analytic
/// production optimizer gradient.
pub fn evaluate_mmff(
    parameters: &MmffParameters,
    positions: &[[f32; 4]],
) -> Result<MmffEvaluation, MmffError> {
    let energy = evaluate_mmff_energy(parameters, positions)?;
    let mut gradients = vec![[0.0_f32; 4]; positions.len()];
    let mut displaced = positions.to_vec();
    for atom in 0..positions.len() {
        for coordinate in 0..3 {
            let original = f64::from(positions[atom][coordinate]);
            displaced[atom][coordinate] = (original + REFERENCE_GRADIENT_STEP) as f32;
            let plus = evaluate_unchecked(parameters, &displaced)?.total();
            displaced[atom][coordinate] = (original - REFERENCE_GRADIENT_STEP) as f32;
            let minus = evaluate_unchecked(parameters, &displaced)?.total();
            displaced[atom][coordinate] = positions[atom][coordinate];
            gradients[atom][coordinate] = ((plus - minus) / (2.0 * REFERENCE_GRADIENT_STEP)) as f32;
        }
    }
    if gradients.iter().flatten().any(|value| !value.is_finite()) {
        return Err(MmffError::new(
            "MMFF reference evaluation produced a non-finite gradient",
        ));
    }
    Ok(MmffEvaluation { energy, gradients })
}

fn evaluate_unchecked(
    parameters: &MmffParameters,
    positions: &[[f32; 4]],
) -> Result<MmffEnergyBreakdown, MmffError> {
    let mut result = MmffEnergyBreakdown::default();
    for term in &parameters.bonds {
        let distance = distance(positions, term.atoms);
        let delta = distance - f64::from(term.equilibrium_distance);
        let delta_squared = delta * delta;
        result.bond_stretch += MDYNE_ANGSTROM_TO_KCAL_MOL
            * f64::from(term.force_constant)
            * delta_squared
            * 0.5
            * (1.0 - 2.0 * delta + (7.0 / 3.0) * delta_squared);
    }
    for term in &parameters.angles {
        let angle = angle_radians(positions, term.atoms);
        if term.linear {
            result.angle_bend +=
                MDYNE_ANGSTROM_TO_KCAL_MOL * f64::from(term.force_constant) * (1.0 + angle.cos());
        } else {
            let delta = angle * RAD_TO_DEG - f64::from(term.equilibrium_degrees);
            result.angle_bend += 0.5
                * MDYNE_ANGSTROM_TO_KCAL_MOL
                * DEG_TO_RAD
                * DEG_TO_RAD
                * f64::from(term.force_constant)
                * delta
                * delta
                * (1.0 - 0.4 * DEG_TO_RAD * delta);
        }
    }
    for term in &parameters.stretch_bends {
        let distance_ij = distance(positions, [term.atoms[0], term.atoms[1]]);
        let distance_kj = distance(positions, [term.atoms[2], term.atoms[1]]);
        let angle = angle_radians(positions, term.atoms) * RAD_TO_DEG;
        result.stretch_bend += STRETCH_BEND_FACTOR
            * (angle - f64::from(term.equilibrium_degrees))
            * (f64::from(term.force_ij) * (distance_ij - f64::from(term.equilibrium_ij))
                + f64::from(term.force_kj) * (distance_kj - f64::from(term.equilibrium_kj)));
    }
    for term in &parameters.out_of_planes {
        let chi_degrees = out_of_plane_radians(positions, term.atoms) * RAD_TO_DEG;
        result.out_of_plane += 0.5
            * MDYNE_ANGSTROM_TO_KCAL_MOL
            * DEG_TO_RAD
            * DEG_TO_RAD
            * f64::from(term.force_constant)
            * chi_degrees
            * chi_degrees;
    }
    for term in &parameters.torsions {
        let cosine = dihedral_radians(positions, term.atoms).cos();
        let cosine_two = 2.0 * cosine * cosine - 1.0;
        let cosine_three = cosine * (4.0 * cosine * cosine - 3.0);
        result.torsion += 0.5
            * (f64::from(term.v1) * (1.0 + cosine)
                + f64::from(term.v2) * (1.0 - cosine_two)
                + f64::from(term.v3) * (1.0 + cosine_three));
    }
    for term in &parameters.van_der_waals {
        let rho = distance(positions, term.atoms) / f64::from(term.r_star);
        let buffered = 1.07 / (rho + 0.07);
        result.van_der_waals +=
            f64::from(term.epsilon) * buffered.powi(7) * (1.12 / (rho.powi(7) + 0.12) - 2.0);
    }
    for term in &parameters.electrostatics {
        let scale = if term.is_one_four { 0.75 } else { 1.0 };
        result.electrostatic += scale * ELECTROSTATIC_FACTOR * f64::from(term.charge_product)
            / (distance(positions, term.atoms) + 0.05);
    }
    if [
        result.bond_stretch,
        result.angle_bend,
        result.stretch_bend,
        result.out_of_plane,
        result.torsion,
        result.van_der_waals,
        result.electrostatic,
    ]
    .into_iter()
    .any(|value| !value.is_finite())
    {
        return Err(MmffError::new(
            "MMFF reference evaluation produced non-finite energy",
        ));
    }
    Ok(result)
}

fn validate(parameters: &MmffParameters, positions: &[[f32; 4]]) -> Result<(), MmffError> {
    validate_mmff_parameters(parameters)?;
    if parameters.atom_count as usize != positions.len()
        || positions.iter().flatten().any(|value| !value.is_finite())
    {
        return Err(MmffError::new(
            "MMFF positions must be finite and match the positive parameter atom count",
        ));
    }
    Ok(())
}

fn validate_terms(parameters: &MmffParameters) -> Result<(), MmffError> {
    let atom_count = parameters.atom_count as usize;
    for term in &parameters.bonds {
        validate_atoms(atom_count, &term.atoms)?;
        validate_positive(&[term.force_constant, term.equilibrium_distance])?;
    }
    for term in &parameters.angles {
        validate_atoms(atom_count, &term.atoms)?;
        validate_positive(&[term.force_constant])?;
        validate_angle(term.equilibrium_degrees)?;
    }
    for term in &parameters.stretch_bends {
        validate_atoms(atom_count, &term.atoms)?;
        validate_finite(&[term.force_ij, term.force_kj])?;
        validate_positive(&[term.equilibrium_ij, term.equilibrium_kj])?;
        validate_angle(term.equilibrium_degrees)?;
    }
    for term in &parameters.out_of_planes {
        validate_atoms(atom_count, &term.atoms)?;
        validate_finite(&[term.force_constant])?;
    }
    for term in &parameters.torsions {
        validate_atoms(atom_count, &term.atoms)?;
        validate_finite(&[term.v1, term.v2, term.v3])?;
    }
    for term in &parameters.van_der_waals {
        validate_atoms(atom_count, &term.atoms)?;
        validate_positive(&[term.r_star, term.epsilon])?;
    }
    for term in &parameters.electrostatics {
        validate_atoms(atom_count, &term.atoms)?;
        validate_finite(&[term.charge_product])?;
    }
    Ok(())
}

fn validate_atoms(atom_count: usize, atoms: &[u32]) -> Result<(), MmffError> {
    if atoms.iter().any(|atom| *atom as usize >= atom_count) {
        return Err(MmffError::new("MMFF term atom index is out of range"));
    }
    Ok(())
}

fn validate_finite(values: &[f32]) -> Result<(), MmffError> {
    if values.iter().any(|value| !value.is_finite()) {
        return Err(MmffError::new("MMFF term contains a non-finite parameter"));
    }
    Ok(())
}

fn validate_positive(values: &[f32]) -> Result<(), MmffError> {
    validate_finite(values)?;
    if values.iter().any(|value| *value <= 0.0) {
        return Err(MmffError::new("MMFF term requires positive parameters"));
    }
    Ok(())
}

fn validate_angle(value: f32) -> Result<(), MmffError> {
    if !value.is_finite() || !(0.0..=180.0).contains(&value) {
        return Err(MmffError::new(
            "MMFF equilibrium angle must be in 0..=180 degrees",
        ));
    }
    Ok(())
}

fn distance(positions: &[[f32; 4]], atoms: [u32; 2]) -> f64 {
    norm(sub(
        position(positions, atoms[0]),
        position(positions, atoms[1]),
    ))
}

fn angle_radians(positions: &[[f32; 4]], atoms: [u32; 3]) -> f64 {
    let first = sub(position(positions, atoms[0]), position(positions, atoms[1]));
    let second = sub(position(positions, atoms[2]), position(positions, atoms[1]));
    (dot(first, second) / (norm(first) * norm(second)))
        .clamp(-1.0, 1.0)
        .acos()
}

fn out_of_plane_radians(positions: &[[f32; 4]], atoms: [u32; 4]) -> f64 {
    let first = normalize(sub(
        position(positions, atoms[0]),
        position(positions, atoms[1]),
    ));
    let third = normalize(sub(
        position(positions, atoms[2]),
        position(positions, atoms[1]),
    ));
    let fourth = normalize(sub(
        position(positions, atoms[3]),
        position(positions, atoms[1]),
    ));
    dot(normalize(cross(scale(first, -1.0), third)), fourth)
        .clamp(-1.0, 1.0)
        .asin()
}

fn dihedral_radians(positions: &[[f32; 4]], atoms: [u32; 4]) -> f64 {
    let p = atoms.map(|atom| position(positions, atom));
    let first = sub(p[1], p[0]);
    let middle = sub(p[2], p[1]);
    let last = sub(p[3], p[2]);
    let normal_first = cross(first, middle);
    let normal_last = cross(middle, last);
    let middle_unit = normalize(middle);
    let denominator = (norm(normal_first) * norm(normal_last)).max(MIN_NORM_SQUARED.sqrt());
    let cosine = (dot(normal_first, normal_last) / denominator).clamp(-1.0, 1.0);
    let sine = dot(cross(normal_first, middle_unit), normal_last) / denominator;
    sine.atan2(cosine)
}

fn position(positions: &[[f32; 4]], atom: u32) -> [f64; 3] {
    let value = positions[atom as usize];
    [
        f64::from(value[0]),
        f64::from(value[1]),
        f64::from(value[2]),
    ]
}

fn sub(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn dot(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn norm(value: [f64; 3]) -> f64 {
    dot(value, value).max(MIN_NORM_SQUARED).sqrt()
}

fn normalize(value: [f64; 3]) -> [f64; 3] {
    scale(value, norm(value).recip())
}

fn cross(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn scale(value: [f64; 3], factor: f64) -> [f64; 3] {
    [value[0] * factor, value[1] * factor, value[2] * factor]
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MmffError(String);

impl MmffError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for MmffError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for MmffError {}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitMmffFixture {
        rdkit_version: String,
        rdkit_commit: String,
        cases: Vec<RdkitMmffCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RdkitMmffCase {
        name: String,
        variant: String,
        positions: Vec<[f32; 4]>,
        expected_energy_kcal_mol: f64,
        bmfx_base64: String,
    }

    fn empty(atom_count: u32) -> MmffParameters {
        MmffParameters {
            variant: MmffVariant::Mmff94,
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
    fn all_seven_terms_are_reported_independently() {
        let mut parameters = empty(4);
        parameters.bonds.push(MmffBondTerm {
            atoms: [0, 1],
            force_constant: 4.0,
            equilibrium_distance: 1.2,
        });
        parameters.angles.push(MmffAngleTerm {
            atoms: [0, 1, 2],
            force_constant: 0.8,
            equilibrium_degrees: 109.5,
            linear: false,
        });
        parameters.stretch_bends.push(MmffStretchBendTerm {
            atoms: [0, 1, 2],
            force_ij: 0.2,
            force_kj: 0.3,
            equilibrium_ij: 1.2,
            equilibrium_kj: 1.3,
            equilibrium_degrees: 109.5,
        });
        parameters.out_of_planes.push(MmffOutOfPlaneTerm {
            atoms: [0, 1, 2, 3],
            force_constant: 0.5,
        });
        parameters.torsions.push(MmffTorsionTerm {
            atoms: [0, 1, 2, 3],
            v1: 0.2,
            v2: 0.4,
            v3: 0.6,
        });
        parameters.van_der_waals.push(MmffVanDerWaalsTerm {
            atoms: [0, 3],
            r_star: 3.5,
            epsilon: 0.08,
        });
        parameters.electrostatics.push(MmffElectrostaticTerm {
            atoms: [0, 3],
            charge_product: -0.12,
            is_one_four: true,
        });
        let positions = [
            [0.0, 0.0, 0.0, 0.0],
            [1.4, 0.0, 0.0, 0.0],
            [1.8, 1.1, 0.0, 0.0],
            [2.4, 1.1, 0.7, 0.0],
        ];
        let result = evaluate_mmff(&parameters, &positions).unwrap();
        assert!(result.energy.bond_stretch != 0.0);
        assert!(result.energy.angle_bend != 0.0);
        assert!(result.energy.stretch_bend != 0.0);
        assert!(result.energy.out_of_plane != 0.0);
        assert!(result.energy.torsion != 0.0);
        assert!(result.energy.van_der_waals != 0.0);
        assert!(result.energy.electrostatic != 0.0);
        assert!(result.energy.total().is_finite());
        assert!(result
            .gradients
            .iter()
            .flatten()
            .all(|value| value.is_finite()));
        for coordinate in 0..3 {
            let net = result
                .gradients
                .iter()
                .map(|gradient| gradient[coordinate])
                .sum::<f32>();
            assert!(
                net.abs() < 0.05,
                "coordinate {coordinate} net gradient {net}"
            );
        }
    }

    #[test]
    fn equilibrium_bond_has_zero_energy_and_gradient() {
        let mut parameters = empty(2);
        parameters.bonds.push(MmffBondTerm {
            atoms: [0, 1],
            force_constant: 5.0,
            equilibrium_distance: 1.5,
        });
        let result =
            evaluate_mmff(&parameters, &[[0.0, 0.0, 0.0, 0.0], [1.5, 0.0, 0.0, 0.0]]).unwrap();
        assert_eq!(result.energy.total(), 0.0);
        assert!(result
            .gradients
            .iter()
            .flatten()
            .all(|value| value.abs() < 2.0e-3));
    }

    #[test]
    fn rejects_out_of_range_term_indices() {
        let mut parameters = empty(2);
        parameters.bonds.push(MmffBondTerm {
            atoms: [0, 2],
            force_constant: 1.0,
            equilibrium_distance: 1.0,
        });
        assert!(
            evaluate_mmff_energy(&parameters, &[[0.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]],)
                .is_err()
        );
    }

    #[test]
    fn matches_pinned_rdkit_energy_corpus() {
        let fixture: RdkitMmffFixture = serde_json::from_str(include_str!(
            "../../../compute/rdkit-conformer/fixtures/mmff-rdkit-2025.03.4.json"
        ))
        .expect("decode pinned RDKit MMFF corpus");
        assert_eq!(fixture.rdkit_version, "2025.03.4");
        assert_eq!(
            fixture.rdkit_commit,
            "276b5a662302c6a548ac4f1363c066f3258e3a20"
        );
        assert_eq!(fixture.cases.len(), 24);
        for case in fixture.cases {
            let bytes = STANDARD
                .decode(&case.bmfx_base64)
                .expect("decode BMFX fixture");
            let native = crate::decode_native_mmff_parameters(&bytes, bytes.len())
                .unwrap_or_else(|error| panic!("{} {} BMFX: {error}", case.name, case.variant));
            let observed = evaluate_mmff_energy(&native.parameters, &case.positions)
                .expect("evaluate native MMFF corpus case")
                .total();
            assert!(
                (observed - case.expected_energy_kcal_mol).abs() <= 2.0e-3,
                "{} {} native={observed} RDKit={}",
                case.name,
                case.variant,
                case.expected_energy_kcal_mol
            );
        }
    }
}
