// NDDO contractions adapted from LANL PYSEQM at commit
// 6ced9ea66160428e06d37df18e9f565b8123f84a, BSD-3-Clause.
// Sources: seqm/seqm_functions/fock.py and energy.py.
// License: compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt.

use super::{
    rm1_nuclear_repulsion_energy, rm1_parameters, rm1_rotated_pair_integrals, rm1_sp_overlap,
    solve_closed_shell_scf_with_eigensolver, symmetric_eigendecomposition, SemiempiricalError,
    SemiempiricalMolecule, SemiempiricalScfOptions, SemiempiricalScfResult,
};

#[derive(Clone, Debug, PartialEq)]
pub struct Rm1Evaluation {
    pub electronic_energy_ev: f64,
    pub nuclear_energy_ev: f64,
    pub total_energy_ev: f64,
    pub atomic_charges: Vec<f64>,
    pub scf: SemiempiricalScfResult,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rm1FockPair {
    pub left_orbital_start: usize,
    pub left_orbital_count: usize,
    pub right_orbital_start: usize,
    pub right_orbital_count: usize,
    pub repulsion_ev: Vec<f64>,
    pub left_core_attraction_ev: [f64; 16],
    pub right_core_attraction_ev: [f64; 16],
}

pub fn rm1_fock_pairs(
    molecule: &SemiempiricalMolecule,
) -> Result<Vec<Rm1FockPair>, SemiempiricalError> {
    let mut pairs = Vec::with_capacity(
        molecule
            .atoms
            .len()
            .saturating_mul(molecule.atoms.len().saturating_sub(1))
            / 2,
    );
    for left_index in 0..molecule.atoms.len() {
        for right_index in (left_index + 1)..molecule.atoms.len() {
            let left_atom = &molecule.atoms[left_index];
            let right_atom = &molecule.atoms[right_index];
            let left = rm1_parameters(left_atom.atomic_number).unwrap();
            let right = rm1_parameters(right_atom.atomic_number).unwrap();
            let pair = rm1_rotated_pair_integrals(
                left,
                right,
                left_atom.position_angstrom,
                right_atom.position_angstrom,
            )?;
            pairs.push(Rm1FockPair {
                left_orbital_start: molecule.orbital_offsets[left_index],
                left_orbital_count: usize::from(left.orbital_count),
                right_orbital_start: molecule.orbital_offsets[right_index],
                right_orbital_count: usize::from(right.orbital_count),
                repulsion_ev: pair.repulsion_ev.to_vec(),
                left_core_attraction_ev: pair.left_core_attraction_ev,
                right_core_attraction_ev: pair.right_core_attraction_ev,
            });
        }
    }
    Ok(pairs)
}

pub fn contract_rm1_pair_fock(
    orbital_count: usize,
    density: &[f64],
    pairs: &[Rm1FockPair],
) -> Result<Vec<f64>, SemiempiricalError> {
    if orbital_count == 0 || density.len() != orbital_count * orbital_count {
        return Err(SemiempiricalError::InvalidInput(
            "RM1 pair contraction requires a square non-empty density matrix".into(),
        ));
    }
    let mut contribution = vec![0.0; density.len()];
    for pair in pairs {
        if pair.repulsion_ev.len() != 256
            || pair.left_orbital_count == 0
            || pair.left_orbital_count > 4
            || pair.right_orbital_count == 0
            || pair.right_orbital_count > 4
            || pair.left_orbital_start + pair.left_orbital_count > orbital_count
            || pair.right_orbital_start + pair.right_orbital_count > orbital_count
        {
            return Err(SemiempiricalError::InvalidInput(
                "RM1 pair contraction received an invalid orbital span or tensor".into(),
            ));
        }
        for a in 0..pair.left_orbital_count {
            for b in 0..pair.left_orbital_count {
                for c in 0..pair.right_orbital_count {
                    for d in 0..pair.right_orbital_count {
                        let integral = pair.repulsion_ev[((a * 4 + b) * 4 + c) * 4 + d];
                        contribution[(pair.left_orbital_start + a) * orbital_count
                            + pair.left_orbital_start
                            + b] += density[(pair.right_orbital_start + c) * orbital_count
                            + pair.right_orbital_start
                            + d]
                            * integral;
                        contribution[(pair.right_orbital_start + c) * orbital_count
                            + pair.right_orbital_start
                            + d] += density[(pair.left_orbital_start + a) * orbital_count
                            + pair.left_orbital_start
                            + b]
                            * integral;
                        let exchange = -0.5
                            * density[(pair.left_orbital_start + b) * orbital_count
                                + pair.right_orbital_start
                                + d]
                            * integral;
                        contribution[(pair.left_orbital_start + a) * orbital_count
                            + pair.right_orbital_start
                            + c] += exchange;
                        contribution[(pair.right_orbital_start + c) * orbital_count
                            + pair.left_orbital_start
                            + a] += exchange;
                    }
                }
            }
        }
    }
    Ok(contribution)
}

pub fn evaluate_rm1(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    evaluate_rm1_with_pair_contractor(molecule, options, contract_rm1_pair_fock)
}

pub fn evaluate_rm1_with_pair_contractor(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
    contract_pairs: impl FnMut(
        usize,
        &[f64],
        &[Rm1FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    evaluate_rm1_with_accelerators(
        molecule,
        options,
        contract_pairs,
        symmetric_eigendecomposition,
    )
}

pub fn evaluate_rm1_with_accelerators(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
    contract_pairs: impl FnMut(
        usize,
        &[f64],
        &[Rm1FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
    diagonalize: impl FnMut(&[f64], usize) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError>,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    let pairs = rm1_fock_pairs(molecule)?;
    evaluate_rm1_with_prepared_pairs_and_accelerators(
        molecule,
        options,
        &pairs,
        contract_pairs,
        diagonalize,
    )
}

pub fn evaluate_rm1_with_prepared_pairs_and_accelerators(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
    pairs: &[Rm1FockPair],
    mut contract_pairs: impl FnMut(
        usize,
        &[f64],
        &[Rm1FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
    diagonalize: impl FnMut(&[f64], usize) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError>,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    let expected_pair_count = molecule
        .atoms
        .len()
        .saturating_mul(molecule.atoms.len().saturating_sub(1))
        / 2;
    if pairs.len() != expected_pair_count {
        return Err(SemiempiricalError::InvalidInput(
            "RM1 prepared pair pack does not match the molecule".into(),
        ));
    }
    let core = build_core_hamiltonian(molecule, pairs)?;
    let scf = solve_closed_shell_scf_with_eigensolver(
        molecule.orbital_count,
        molecule.electron_count,
        options,
        |density| build_fock(molecule, &core, density, &pairs, &mut contract_pairs),
        diagonalize,
    )?;
    let final_fock = build_fock(
        molecule,
        &core,
        &scf.density,
        &pairs,
        &mut contract_pairs,
    )?;
    let electronic_energy_ev = 0.5
        * scf
            .density
            .iter()
            .zip(core.iter().zip(&final_fock))
            .map(|(density, (core, fock))| density * (core + fock))
            .sum::<f64>();
    let nuclear_energy_ev = rm1_nuclear_repulsion_energy(molecule)?;
    Ok(Rm1Evaluation {
        electronic_energy_ev,
        nuclear_energy_ev,
        total_energy_ev: electronic_energy_ev + nuclear_energy_ev,
        atomic_charges: molecule.atomic_charges(&scf.density)?,
        scf,
    })
}

fn build_core_hamiltonian(
    molecule: &SemiempiricalMolecule,
    pairs: &[Rm1FockPair],
) -> Result<Vec<f64>, SemiempiricalError> {
    let n = molecule.orbital_count;
    let mut core = vec![0.0; n * n];
    for (atom_index, atom) in molecule.atoms.iter().enumerate() {
        let parameters = rm1_parameters(atom.atomic_number).unwrap();
        let start = molecule.orbital_offsets[atom_index];
        core[start * n + start] = parameters.uss_ev;
        for orbital in 1..usize::from(parameters.orbital_count) {
            core[(start + orbital) * n + start + orbital] = parameters.upp_ev;
        }
    }

    let mut pair_index = 0;
    for left_index in 0..molecule.atoms.len() {
        for right_index in (left_index + 1)..molecule.atoms.len() {
            let left_atom = &molecule.atoms[left_index];
            let right_atom = &molecule.atoms[right_index];
            let left = rm1_parameters(left_atom.atomic_number).unwrap();
            let right = rm1_parameters(right_atom.atomic_number).unwrap();
            let left_start = molecule.orbital_offsets[left_index];
            let right_start = molecule.orbital_offsets[right_index];
            let overlap = rm1_sp_overlap(
                left,
                right,
                left_atom.position_angstrom,
                right_atom.position_angstrom,
            )?;
            for left_orbital in 0..overlap.rows {
                let left_beta = if left_orbital == 0 {
                    left.beta_s_ev
                } else {
                    left.beta_p_ev
                };
                for right_orbital in 0..overlap.columns {
                    let right_beta = if right_orbital == 0 {
                        right.beta_s_ev
                    } else {
                        right.beta_p_ev
                    };
                    let value = 0.5
                        * (left_beta + right_beta)
                        * overlap.values[left_orbital * overlap.columns + right_orbital];
                    core[(left_start + left_orbital) * n + right_start + right_orbital] = value;
                    core[(right_start + right_orbital) * n + left_start + left_orbital] = value;
                }
            }

            let pair = &pairs[pair_index];
            pair_index += 1;
            if pair.left_orbital_start != left_start
                || pair.left_orbital_count != usize::from(left.orbital_count)
                || pair.right_orbital_start != right_start
                || pair.right_orbital_count != usize::from(right.orbital_count)
                || pair.repulsion_ev.len() != 256
            {
                return Err(SemiempiricalError::InvalidInput(
                    "RM1 prepared pair pack has an invalid canonical span".into(),
                ));
            }
            for row in 0..usize::from(left.orbital_count) {
                for column in 0..usize::from(left.orbital_count) {
                    core[(left_start + row) * n + left_start + column] +=
                        pair.left_core_attraction_ev[row * 4 + column];
                }
            }
            for row in 0..usize::from(right.orbital_count) {
                for column in 0..usize::from(right.orbital_count) {
                    core[(right_start + row) * n + right_start + column] +=
                        pair.right_core_attraction_ev[row * 4 + column];
                }
            }
        }
    }
    Ok(core)
}

fn build_fock(
    molecule: &SemiempiricalMolecule,
    core: &[f64],
    density: &[f64],
    pairs: &[Rm1FockPair],
    contract_pairs: &mut impl FnMut(
        usize,
        &[f64],
        &[Rm1FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
) -> Result<Vec<f64>, SemiempiricalError> {
    let n = molecule.orbital_count;
    let mut fock = core.to_vec();
    for (atom_index, atom) in molecule.atoms.iter().enumerate() {
        let parameters = rm1_parameters(atom.atomic_number).unwrap();
        let start = molecule.orbital_offsets[atom_index];
        let p_ss = density[start * n + start];
        if parameters.orbital_count == 1 {
            fock[start * n + start] += 0.5 * p_ss * parameters.gss_ev;
            continue;
        }
        let p_total: f64 = (1..4)
            .map(|orbital| density[(start + orbital) * n + start + orbital])
            .sum();
        fock[start * n + start] += 0.5 * p_ss * parameters.gss_ev
            + p_total * (parameters.gsp_ev - 0.5 * parameters.hsp_ev);
        let sp_diagonal = parameters.gsp_ev - 0.5 * parameters.hsp_ev;
        let sp_off_diagonal = 1.5 * parameters.hsp_ev - 0.5 * parameters.gsp_ev;
        let pp_other = 1.25 * parameters.gp2_ev - 0.25 * parameters.gpp_ev;
        let pp_off_diagonal = 0.75 * parameters.gpp_ev - 1.25 * parameters.gp2_ev;
        for orbital in 1..4 {
            let index = start + orbital;
            let p_diagonal = density[index * n + index];
            fock[index * n + index] += p_ss * sp_diagonal
                + 0.5 * p_diagonal * parameters.gpp_ev
                + (p_total - p_diagonal) * pp_other;
            fock[start * n + index] += density[start * n + index] * sp_off_diagonal;
            fock[index * n + start] += density[index * n + start] * sp_off_diagonal;
        }
        for left in 1..4 {
            for right in (left + 1)..4 {
                let a = start + left;
                let b = start + right;
                fock[a * n + b] += density[a * n + b] * pp_off_diagonal;
                fock[b * n + a] += density[b * n + a] * pp_off_diagonal;
            }
        }
    }

    for (target, pair) in fock
        .iter_mut()
        .zip(contract_pairs(n, density, pairs)?)
    {
        *target += pair;
    }
    Ok(fock)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SemiempiricalAtom, SemiempiricalScfStatus};

    fn molecule(atoms: &[(u8, [f64; 3])]) -> SemiempiricalMolecule {
        SemiempiricalMolecule::rm1(
            atoms
                .iter()
                .map(|(atomic_number, position_angstrom)| SemiempiricalAtom {
                    atomic_number: *atomic_number,
                    position_angstrom: *position_angstrom,
                })
                .collect(),
            0,
        )
        .unwrap()
    }

    #[test]
    fn hydrogen_energy_matches_pyseqm_reference() {
        let hydrogen = molecule(&[(1, [0.0, 0.0, 0.0]), (1, [0.74, 0.0, 0.0])]);
        let result = evaluate_rm1(&hydrogen, SemiempiricalScfOptions::default()).unwrap();
        assert_eq!(result.scf.status, SemiempiricalScfStatus::Converged);
        assert!((result.electronic_energy_ev + 42.279_154).abs() < 1.0e-5);
        assert!((result.nuclear_energy_ev - 13.780_913_698_216_068).abs() < 1.0e-12);
        assert!((result.total_energy_ev + 28.498_242).abs() < 1.0e-5);
        assert!(result
            .atomic_charges
            .iter()
            .all(|charge| charge.abs() < 1.0e-12));
    }

    #[test]
    fn water_energy_and_charge_conservation_match_reference() {
        let water = molecule(&[
            (8, [0.0, 0.0, 0.0]),
            (1, [0.9584, 0.0, 0.0]),
            (1, [-0.2396, 0.9275, 0.0]),
        ]);
        let result = evaluate_rm1(&water, SemiempiricalScfOptions::default()).unwrap();
        assert_eq!(result.scf.status, SemiempiricalScfStatus::Converged);
        assert!(
            (result.electronic_energy_ev + 488.951_381).abs() < 1.0e-4,
            "{result:?}"
        );
        assert!((result.nuclear_energy_ev - 143.380_852).abs() < 1.0e-4);
        assert!(result.atomic_charges.iter().sum::<f64>().abs() < 1.0e-10);
    }

    #[test]
    fn sulfur_hydride_uses_the_third_row_hydrogen_overlap() {
        let hydrogen_sulfide = molecule(&[
            (16, [0.0, 0.0, 0.0]),
            (1, [0.97, 0.0, 0.93]),
            (1, [-0.97, 0.0, 0.93]),
        ]);
        let result = evaluate_rm1(&hydrogen_sulfide, SemiempiricalScfOptions::default()).unwrap();
        assert_eq!(result.scf.status, SemiempiricalScfStatus::Converged);
        assert!(result.total_energy_ev.is_finite());
        assert!(result.atomic_charges.iter().sum::<f64>().abs() < 1.0e-10);
    }

    #[test]
    fn methyl_iodide_converges_with_the_general_qn5_overlap() {
        let methyl_iodide = molecule(&[
            (6, [0.0, 0.0, 0.0]),
            (53, [2.14, 0.0, 0.0]),
            (1, [-0.63, 0.63, 0.63]),
            (1, [-0.63, -0.63, 0.63]),
            (1, [-0.63, 0.0, -0.89]),
        ]);
        let result = evaluate_rm1(&methyl_iodide, SemiempiricalScfOptions::default()).unwrap();
        assert_eq!(result.scf.status, SemiempiricalScfStatus::Converged);
        assert!(result.total_energy_ev.is_finite());
        assert!(result.atomic_charges.iter().sum::<f64>().abs() < 1.0e-9);
    }
}
