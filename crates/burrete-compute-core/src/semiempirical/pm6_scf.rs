use super::{
    pm6_d_d_pair_integrals, pm6_d_hydrogen_pair_integrals, pm6_d_sp_pair_integrals,
    pm6_full_parameters, pm6_local_d_overlap, pm6_one_center_d_fock, pm6_one_center_w_integrals,
    pm6_two_center_d::pyseqm_orbital_rotation, rm1_rotated_pair_integrals, rm1_sp_overlap,
    semiempirical_nuclear_repulsion_energy,
    solve_closed_shell_scf_with_initial_density_and_eigensolver, symmetric_eigendecomposition,
    Pm6FullElementParameters, Rm1Evaluation, SemiempiricalElementParameters, SemiempiricalError,
    SemiempiricalMethod, SemiempiricalMolecule, SemiempiricalScfOptions,
};

const ANGSTROM_TO_BOHR: f64 = 1.0 / 0.529_167;

#[derive(Clone, Debug, PartialEq)]
pub struct Pm6FockPair {
    pub left_orbital_start: usize,
    pub left_orbital_count: usize,
    pub right_orbital_start: usize,
    pub right_orbital_count: usize,
    pub repulsion_ev: Vec<f64>,
    pub left_core_attraction_ev: Vec<f64>,
    pub right_core_attraction_ev: Vec<f64>,
}

struct PairBlocks {
    repulsion_ev: Vec<f64>,
    left_core_attraction_ev: Vec<f64>,
    right_core_attraction_ev: Vec<f64>,
}

fn as_sp_parameters(value: &Pm6FullElementParameters) -> SemiempiricalElementParameters {
    SemiempiricalElementParameters {
        atomic_number: value.atomic_number,
        symbol: value.symbol,
        orbital_count: value.orbital_count.min(4),
        valence_electrons: value.valence_electrons,
        uss_ev: value.uss_ev,
        upp_ev: value.upp_ev,
        zeta_s_bohr_inv: value.zeta_s_bohr_inv,
        zeta_p_bohr_inv: value.zeta_p_bohr_inv,
        beta_s_ev: value.beta_s_ev,
        beta_p_ev: value.beta_p_ev,
        gss_ev: value.gss_ev,
        gsp_ev: value.gsp_ev,
        gpp_ev: value.gpp_ev,
        gp2_ev: value.gp2_ev,
        hsp_ev: value.hsp_ev,
        alpha_angstrom_inv: value.alpha_angstrom_inv,
        gaussian: value.gaussian,
    }
}

fn index4(a: usize, b: usize, c: usize, d: usize, left: usize, right: usize) -> usize {
    ((a * left + b) * right + c) * right + d
}

fn pm6_overlap(
    left: &Pm6FullElementParameters,
    right: &Pm6FullElementParameters,
    left_position: [f64; 3],
    right_position: [f64; 3],
) -> Result<Vec<f64>, SemiempiricalError> {
    let (nl, nr) = (
        usize::from(left.orbital_count),
        usize::from(right.orbital_count),
    );
    let mut values = vec![0.0; nl * nr];
    let sp = rm1_sp_overlap(
        &as_sp_parameters(left),
        &as_sp_parameters(right),
        left_position,
        right_position,
    )?;
    for row in 0..sp.rows {
        for column in 0..sp.columns {
            values[row * nr + column] = sp.values[row * sp.columns + column];
        }
    }
    let delta = std::array::from_fn::<_, 3, _>(|axis| right_position[axis] - left_position[axis]);
    let distance = delta.iter().map(|value| value * value).sum::<f64>().sqrt();
    let fill_d_rows = |output: &mut [f64],
                       d_atom: &Pm6FullElementParameters,
                       other: &Pm6FullElementParameters,
                       direction: [f64; 3],
                       transpose: bool|
     -> Result<(), SemiempiricalError> {
        let local = pm6_local_d_overlap(d_atom, other, distance * ANGSTROM_TO_BOHR)?;
        let rotation = pyseqm_orbital_rotation(direction);
        for d in 0..5 {
            let ds = rotation[d + 4][4] * local.ds_sigma;
            if transpose {
                output[4 + d] = ds;
            } else {
                output[(4 + d) * nr] = ds;
            }
            if other.orbital_count > 1 {
                for p in 0..3 {
                    let dp = rotation[d + 4][4] * rotation[p + 1][1] * local.dp_sigma
                        + (rotation[d + 4][5] * rotation[p + 1][2]
                            + rotation[d + 4][6] * rotation[p + 1][3])
                            * local.dp_pi;
                    if transpose {
                        output[(1 + p) * nr + 4 + d] = dp;
                    } else {
                        output[(4 + d) * nr + 1 + p] = dp;
                    }
                }
            }
        }
        if d_atom.has_d_orbitals() && other.has_d_orbitals() && !transpose {
            let diagonal = [
                local.dd_sigma,
                local.dd_pi,
                local.dd_pi,
                local.dd_delta,
                local.dd_delta,
            ];
            for d_left in 0..5 {
                for d_right in 0..5 {
                    output[(4 + d_left) * nr + 4 + d_right] = (0..5)
                        .map(|axis| {
                            rotation[d_left + 4][axis + 4]
                                * diagonal[axis]
                                * rotation[d_right + 4][axis + 4]
                        })
                        .sum();
                }
            }
        }
        Ok(())
    };
    let unit = delta.map(|value| value / distance);
    if left.has_d_orbitals() {
        fill_d_rows(&mut values, left, right, unit, false)?;
    }
    if right.has_d_orbitals() {
        fill_d_rows(&mut values, right, left, unit.map(|value| -value), true)?;
    }
    Ok(values)
}

fn build_pair(
    left: &Pm6FullElementParameters,
    right: &Pm6FullElementParameters,
    left_position: [f64; 3],
    right_position: [f64; 3],
) -> Result<PairBlocks, SemiempiricalError> {
    let nl = usize::from(left.orbital_count);
    let nr = usize::from(right.orbital_count);
    let mut repulsion = vec![0.0; nl * nl * nr * nr];
    let mut left_core = vec![0.0; nl * nl];
    let mut right_core = vec![0.0; nr * nr];

    let sp = rm1_rotated_pair_integrals(
        &as_sp_parameters(left),
        &as_sp_parameters(right),
        left_position,
        right_position,
    )?;
    let left_sp = nl.min(4);
    let right_sp = nr.min(4);
    for a in 0..left_sp {
        for b in 0..left_sp {
            left_core[a * nl + b] = sp.left_core_attraction_ev[a * 4 + b];
            for c in 0..right_sp {
                for d in 0..right_sp {
                    repulsion[index4(a, b, c, d, nl, nr)] =
                        sp.repulsion_ev[((a * 4 + b) * 4 + c) * 4 + d];
                }
            }
        }
    }
    for c in 0..right_sp {
        for d in 0..right_sp {
            right_core[c * nr + d] = sp.right_core_attraction_ev[c * 4 + d];
        }
    }

    match (left.has_d_orbitals(), right.has_d_orbitals()) {
        (false, false) => {}
        (true, false) if right.atomic_number == 1 => {
            let value = pm6_d_hydrogen_pair_integrals(left, right, left_position, right_position)?;
            repulsion.copy_from_slice(&value.repulsion_ev);
            left_core.copy_from_slice(&value.d_core_attraction_ev);
            right_core[0] = value.hydrogen_core_attraction_ev;
        }
        (false, true) if left.atomic_number == 1 => {
            let value = pm6_d_hydrogen_pair_integrals(right, left, right_position, left_position)?;
            for c in 0..9 {
                for d in 0..9 {
                    repulsion[index4(0, 0, c, d, nl, nr)] = value.repulsion_ev[c * 9 + d];
                }
            }
            left_core[0] = value.hydrogen_core_attraction_ev;
            right_core.copy_from_slice(&value.d_core_attraction_ev);
        }
        (true, false) => {
            let value = pm6_d_sp_pair_integrals(left, right, left_position, right_position)?;
            for a in 0..9 {
                for b in 0..9 {
                    left_core[a * 9 + b] += value.d_core_attraction_ev[a * 9 + b];
                    for c in 0..nr {
                        for d in 0..nr {
                            repulsion[index4(a, b, c, d, nl, nr)] +=
                                value.repulsion_ev[((a * 9 + b) * 4 + c) * 4 + d];
                        }
                    }
                }
            }
        }
        (false, true) => {
            let value = pm6_d_sp_pair_integrals(right, left, right_position, left_position)?;
            for a in 0..nl {
                for b in 0..nl {
                    for c in 0..9 {
                        for d in 0..9 {
                            repulsion[index4(a, b, c, d, nl, nr)] +=
                                value.repulsion_ev[((c * 9 + d) * 4 + a) * 4 + b];
                        }
                    }
                }
            }
            for c in 0..9 {
                for d in 0..9 {
                    right_core[c * 9 + d] += value.d_core_attraction_ev[c * 9 + d];
                }
            }
        }
        (true, true) => {
            let value = pm6_d_d_pair_integrals(left, right, left_position, right_position)?;
            for (target, extension) in repulsion.iter_mut().zip(value.repulsion_ev) {
                *target += extension;
            }
            for index in 0..81 {
                left_core[index] += value.left_core_attraction_ev[index];
                right_core[index] += value.right_core_attraction_ev[index];
            }
        }
    }
    Ok(PairBlocks {
        repulsion_ev: repulsion,
        left_core_attraction_ev: left_core,
        right_core_attraction_ev: right_core,
    })
}

pub fn pm6_fock_pairs(
    molecule: &SemiempiricalMolecule,
) -> Result<Vec<Pm6FockPair>, SemiempiricalError> {
    let mut result = Vec::new();
    for left_index in 0..molecule.atoms.len() {
        for right_index in (left_index + 1)..molecule.atoms.len() {
            let left_atom = &molecule.atoms[left_index];
            let right_atom = &molecule.atoms[right_index];
            let left = pm6_full_parameters(left_atom.atomic_number).unwrap();
            let right = pm6_full_parameters(right_atom.atomic_number).unwrap();
            let blocks = build_pair(
                left,
                right,
                left_atom.position_angstrom,
                right_atom.position_angstrom,
            )?;
            result.push(Pm6FockPair {
                left_orbital_start: molecule.orbital_offsets[left_index],
                left_orbital_count: usize::from(left.orbital_count),
                right_orbital_start: molecule.orbital_offsets[right_index],
                right_orbital_count: usize::from(right.orbital_count),
                repulsion_ev: blocks.repulsion_ev,
                left_core_attraction_ev: blocks.left_core_attraction_ev,
                right_core_attraction_ev: blocks.right_core_attraction_ev,
            });
        }
    }
    Ok(result)
}

pub fn contract_pm6_pair_fock(
    orbital_count: usize,
    density: &[f64],
    pairs: &[Pm6FockPair],
) -> Result<Vec<f64>, SemiempiricalError> {
    if orbital_count == 0
        || density.len() != orbital_count * orbital_count
        || density.iter().any(|value| !value.is_finite())
    {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 pair contraction requires a finite square non-empty density matrix".into(),
        ));
    }
    let mut contribution = vec![0.0; density.len()];
    for pair in pairs {
        let (nl, nr) = (pair.left_orbital_count, pair.right_orbital_count);
        if !matches!(nl, 1 | 4 | 9)
            || !matches!(nr, 1 | 4 | 9)
            || pair.left_orbital_start + nl > orbital_count
            || pair.right_orbital_start + nr > orbital_count
            || pair.repulsion_ev.len() != nl * nl * nr * nr
            || pair.repulsion_ev.iter().any(|value| !value.is_finite())
        {
            return Err(SemiempiricalError::InvalidInput(
                "PM6 pair contraction received an invalid orbital span or tensor".into(),
            ));
        }
        for a in 0..nl {
            for b in 0..nl {
                for c in 0..nr {
                    for d in 0..nr {
                        let integral = pair.repulsion_ev[index4(a, b, c, d, nl, nr)];
                        let la = pair.left_orbital_start + a;
                        let lb = pair.left_orbital_start + b;
                        let rc = pair.right_orbital_start + c;
                        let rd = pair.right_orbital_start + d;
                        contribution[la * orbital_count + lb] +=
                            density[rc * orbital_count + rd] * integral;
                        contribution[rc * orbital_count + rd] +=
                            density[la * orbital_count + lb] * integral;
                        let exchange = -0.5 * density[lb * orbital_count + rd] * integral;
                        contribution[la * orbital_count + rc] += exchange;
                        contribution[rc * orbital_count + la] += exchange;
                    }
                }
            }
        }
    }
    Ok(contribution)
}

fn build_core(
    molecule: &SemiempiricalMolecule,
    pairs: &[Pm6FockPair],
) -> Result<Vec<f64>, SemiempiricalError> {
    let n = molecule.orbital_count;
    let mut core = vec![0.0; n * n];
    for (atom_index, atom) in molecule.atoms.iter().enumerate() {
        let parameters = pm6_full_parameters(atom.atomic_number).unwrap();
        let start = molecule.orbital_offsets[atom_index];
        core[start * n + start] = parameters.uss_ev;
        for orbital in 1..usize::from(parameters.orbital_count.min(4)) {
            core[(start + orbital) * n + start + orbital] = parameters.upp_ev;
        }
        for orbital in 4..usize::from(parameters.orbital_count) {
            core[(start + orbital) * n + start + orbital] = parameters.udd_ev;
        }
    }
    for pair in pairs {
        for row in 0..pair.left_orbital_count {
            for column in 0..pair.left_orbital_count {
                let target = (pair.left_orbital_start + row) * n + pair.left_orbital_start + column;
                core[target] +=
                    pair.left_core_attraction_ev[row * pair.left_orbital_count + column];
            }
        }
        for row in 0..pair.right_orbital_count {
            for column in 0..pair.right_orbital_count {
                let target =
                    (pair.right_orbital_start + row) * n + pair.right_orbital_start + column;
                core[target] +=
                    pair.right_core_attraction_ev[row * pair.right_orbital_count + column];
            }
        }
    }
    let mut pair_index = 0;
    for left_index in 0..molecule.atoms.len() {
        for right_index in (left_index + 1)..molecule.atoms.len() {
            let left_atom = &molecule.atoms[left_index];
            let right_atom = &molecule.atoms[right_index];
            let left = pm6_full_parameters(left_atom.atomic_number).unwrap();
            let right = pm6_full_parameters(right_atom.atomic_number).unwrap();
            let overlap = pm6_overlap(
                left,
                right,
                left_atom.position_angstrom,
                right_atom.position_angstrom,
            )?;
            let pair = &pairs[pair_index];
            pair_index += 1;
            for a in 0..pair.left_orbital_count {
                let beta_a = if a == 0 {
                    left.beta_s_ev
                } else if a < 4 {
                    left.beta_p_ev
                } else {
                    left.beta_d_ev
                };
                for b in 0..pair.right_orbital_count {
                    let beta_b = if b == 0 {
                        right.beta_s_ev
                    } else if b < 4 {
                        right.beta_p_ev
                    } else {
                        right.beta_d_ev
                    };
                    let value = 0.5 * (beta_a + beta_b) * overlap[a * pair.right_orbital_count + b];
                    let global_a = pair.left_orbital_start + a;
                    let global_b = pair.right_orbital_start + b;
                    core[global_a * n + global_b] = value;
                    core[global_b * n + global_a] = value;
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
    pairs: &[Pm6FockPair],
    contract_pairs: &mut impl FnMut(
        usize,
        &[f64],
        &[Pm6FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
    contract_one_center: &mut impl FnMut(
        &[f64; 81],
        &[f64; 243],
    ) -> Result<[f64; 81], SemiempiricalError>,
) -> Result<Vec<f64>, SemiempiricalError> {
    let n = molecule.orbital_count;
    let mut fock = core.to_vec();
    for (atom_index, atom) in molecule.atoms.iter().enumerate() {
        let parameters = pm6_full_parameters(atom.atomic_number).unwrap();
        let start = molecule.orbital_offsets[atom_index];
        let p_ss = density[start * n + start];
        if parameters.orbital_count == 1 {
            fock[start * n + start] += 0.5 * p_ss * parameters.gss_ev;
            continue;
        }
        let p_total = (1..4)
            .map(|orbital| density[(start + orbital) * n + start + orbital])
            .sum::<f64>();
        fock[start * n + start] += 0.5 * p_ss * parameters.gss_ev
            + p_total * (parameters.gsp_ev - 0.5 * parameters.hsp_ev);
        for orbital in 1..4 {
            let index = start + orbital;
            let p_diagonal = density[index * n + index];
            fock[index * n + index] += p_ss * (parameters.gsp_ev - 0.5 * parameters.hsp_ev)
                + 0.5 * p_diagonal * parameters.gpp_ev
                + (p_total - p_diagonal) * (1.25 * parameters.gp2_ev - 0.25 * parameters.gpp_ev);
            let sp =
                density[start * n + index] * (1.5 * parameters.hsp_ev - 0.5 * parameters.gsp_ev);
            fock[start * n + index] += sp;
            fock[index * n + start] += sp;
        }
        for left in 1..4 {
            for right in (left + 1)..4 {
                let (a, b) = (start + left, start + right);
                let value =
                    density[a * n + b] * (0.75 * parameters.gpp_ev - 1.25 * parameters.gp2_ev);
                fock[a * n + b] += value;
                fock[b * n + a] += value;
            }
        }
        if parameters.has_d_orbitals() {
            let block = std::array::from_fn(|index| {
                let row = index / 9;
                let column = index % 9;
                density[(start + row) * n + start + column]
            });
            let w = pm6_one_center_w_integrals(parameters)?;
            let one_center = contract_one_center(&block, &w)?;
            for row in 0..9 {
                for column in 0..9 {
                    fock[(start + row) * n + start + column] += one_center[row * 9 + column];
                }
            }
        }
    }
    for (target, contribution) in fock.iter_mut().zip(contract_pairs(n, density, pairs)?) {
        *target += contribution;
    }
    Ok(fock)
}

pub fn evaluate_pm6(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    evaluate_pm6_with_accelerators(
        molecule,
        options,
        contract_pm6_pair_fock,
        pm6_one_center_d_fock,
        symmetric_eigendecomposition,
    )
}

pub fn evaluate_pm6_with_accelerators(
    molecule: &SemiempiricalMolecule,
    options: SemiempiricalScfOptions,
    mut contract_pairs: impl FnMut(
        usize,
        &[f64],
        &[Pm6FockPair],
    ) -> Result<Vec<f64>, SemiempiricalError>,
    mut contract_one_center: impl FnMut(
        &[f64; 81],
        &[f64; 243],
    ) -> Result<[f64; 81], SemiempiricalError>,
    diagonalize: impl FnMut(&[f64], usize) -> Result<(Vec<f64>, Vec<f64>), SemiempiricalError>,
) -> Result<Rm1Evaluation, SemiempiricalError> {
    if !matches!(
        molecule.method,
        SemiempiricalMethod::Pm6 | SemiempiricalMethod::Pm6D | SemiempiricalMethod::Pm6D3H4
    ) {
        return Err(SemiempiricalError::InvalidInput(
            "full PM6 evaluation requires PM6, PM6_D, or PM6_D3H4".into(),
        ));
    }
    let pairs = pm6_fock_pairs(molecule)?;
    let core = build_core(molecule, &pairs)?;
    let mut initial_density = vec![0.0; molecule.orbital_count * molecule.orbital_count];
    for (atom_index, atom) in molecule.atoms.iter().enumerate() {
        let parameters = pm6_full_parameters(atom.atomic_number).unwrap();
        let start = molecule.orbital_offsets[atom_index];
        if parameters.orbital_count == 1 {
            initial_density[start * molecule.orbital_count + start] =
                f64::from(parameters.valence_electrons);
        } else {
            let sp_population = f64::from(parameters.valence_electrons) / 4.0;
            for orbital in 0..4 {
                initial_density[(start + orbital) * molecule.orbital_count + start + orbital] =
                    sp_population;
            }
        }
    }
    let pm6_options = SemiempiricalScfOptions {
        initial_damping: options.initial_damping.max(0.7),
        max_damping: options.max_damping.max(0.95),
        ..options
    };
    let scf = solve_closed_shell_scf_with_initial_density_and_eigensolver(
        molecule.orbital_count,
        molecule.electron_count,
        pm6_options,
        initial_density,
        |density| {
            build_fock(
                molecule,
                &core,
                density,
                &pairs,
                &mut contract_pairs,
                &mut contract_one_center,
            )
        },
        diagonalize,
    )?;
    let final_fock = build_fock(
        molecule,
        &core,
        &scf.density,
        &pairs,
        &mut contract_pairs,
        &mut contract_one_center,
    )?;
    let electronic_energy_ev = 0.5
        * scf
            .density
            .iter()
            .zip(core.iter().zip(&final_fock))
            .map(|(density, (core, fock))| density * (core + fock))
            .sum::<f64>();
    let nuclear_energy_ev = semiempirical_nuclear_repulsion_energy(molecule)?;
    let correction_ev = if molecule.method == SemiempiricalMethod::Pm6D3H4 {
        super::pm6_d3_dispersion_energy(&molecule.atoms)?
            + super::pm6_h4_energy(&molecule.atoms)?
            + super::pm6_hh_repulsion_energy(&molecule.atoms)?
    } else {
        0.0
    };
    Ok(Rm1Evaluation {
        electronic_energy_ev,
        nuclear_energy_ev,
        total_energy_ev: electronic_energy_ev + nuclear_energy_ev + correction_ev,
        atomic_charges: molecule.atomic_charges(&scf.density)?,
        scf,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SemiempiricalAtom, SemiempiricalMethod};

    #[test]
    fn sulfur_oxygen_pair_has_the_complete_variable_basis_shape() {
        let molecule = SemiempiricalMolecule::new(
            SemiempiricalMethod::Pm6,
            vec![
                SemiempiricalAtom {
                    atomic_number: 16,
                    position_angstrom: [0.0; 3],
                },
                SemiempiricalAtom {
                    atomic_number: 8,
                    position_angstrom: [1.1, -0.4, 0.7],
                },
            ],
            0,
        )
        .unwrap();
        assert_eq!(molecule.orbital_count, 13);
        let pair = pm6_fock_pairs(&molecule).unwrap().pop().unwrap();
        assert_eq!(pair.repulsion_ev.len(), 9 * 9 * 4 * 4);
        assert_eq!(pair.left_core_attraction_ev.len(), 81);
        assert_eq!(pair.right_core_attraction_ev.len(), 16);
    }

    #[test]
    fn pair_contraction_rejects_invalid_variable_basis_descriptors() {
        let pair = Pm6FockPair {
            left_orbital_start: 0,
            left_orbital_count: 9,
            right_orbital_start: 9,
            right_orbital_count: 1,
            repulsion_ev: vec![0.0; 81],
            left_core_attraction_ev: vec![0.0; 81],
            right_core_attraction_ev: vec![0.0],
        };
        assert!(contract_pm6_pair_fock(9, &[0.0; 81], std::slice::from_ref(&pair)).is_err());
        let mut invalid_shape = pair;
        invalid_shape.repulsion_ev.pop();
        assert!(contract_pm6_pair_fock(10, &[0.0; 100], &[invalid_shape]).is_err());
        assert!(contract_pm6_pair_fock(1, &[f64::NAN], &[]).is_err());
    }

    #[test]
    fn hydrogen_sulfide_matches_the_pinned_pm6_d_oracle() {
        let molecule = SemiempiricalMolecule::new(
            SemiempiricalMethod::Pm6,
            vec![
                SemiempiricalAtom {
                    atomic_number: 16,
                    position_angstrom: [0.0; 3],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [1.336, 0.0, 0.0],
                },
                SemiempiricalAtom {
                    atomic_number: 1,
                    position_angstrom: [-0.445, 1.26, 0.0],
                },
            ],
            0,
        )
        .unwrap();
        let pairs = pm6_fock_pairs(&molecule).unwrap();
        let core = build_core(&molecule, &pairs).unwrap();
        for (row, column, expected) in [
            (4, 9, -1.154_280_026_953_004),
            (6, 9, 0.666_423_884_281_525_4),
            (4, 10, 0.897_900_850_236_752_9),
            (6, 10, 0.666_156_118_423_803_4),
            (8, 10, 0.724_614_370_189_082_9),
        ] {
            assert!(
                (core[row * 11 + column] - expected).abs() < 3.0e-8,
                "core {row},{column}: {} != {expected}",
                core[row * 11 + column]
            );
        }
        let mut initial = vec![0.0; 121];
        for orbital in 0..4 {
            initial[orbital * 11 + orbital] = 1.5;
        }
        initial[9 * 11 + 9] = 1.0;
        initial[10 * 11 + 10] = 1.0;
        let initial_fock = build_fock(
            &molecule,
            &core,
            &initial,
            &pairs,
            &mut contract_pm6_pair_fock,
            &mut pm6_one_center_d_fock,
        )
        .unwrap();
        for (index, expected) in [
            (0, -25.165_770_500_000_008),
            (4, 1.359_236_901_988_588),
            (8, 1.359_236_901_988_602_1),
            (9, -5.037_853_373_115_732),
            (10, -5.037_103_774_601_833_5),
        ] {
            assert!(
                (initial_fock[index * 11 + index] - expected).abs() < 3.0e-8,
                "initial F {index}: {} != {expected}",
                initial_fock[index * 11 + index]
            );
        }
        let result = evaluate_pm6(&molecule, SemiempiricalScfOptions::default()).unwrap();
        assert_eq!(
            result.scf.status,
            super::super::SemiempiricalScfStatus::Converged
        );
        assert!(
            (result.electronic_energy_ev + 309.058_588_626_738_07).abs() < 2.0e-6,
            "electronic {}, charges {:?}, eigen {:?}",
            result.electronic_energy_ev,
            result.atomic_charges,
            result.scf.orbital_energies
        );
        assert!((result.nuclear_energy_ev - 107.464_533_271_339_69).abs() < 2.0e-8);
        for (actual, expected) in result.atomic_charges.iter().zip([
            -0.389_993_784_183_554_1,
            0.194_971_735_613_984_73,
            0.195_022_048_569_566_84,
        ]) {
            assert!((actual - expected).abs() < 2.0e-6, "{actual} != {expected}");
        }
    }

    #[test]
    fn d3h4_is_a_post_scf_energy_only_correction() {
        let atoms = vec![
            SemiempiricalAtom {
                atomic_number: 6,
                position_angstrom: [0.0, 0.0, 0.0],
            },
            SemiempiricalAtom {
                atomic_number: 1,
                position_angstrom: [0.629, 0.629, 0.629],
            },
            SemiempiricalAtom {
                atomic_number: 1,
                position_angstrom: [-0.629, -0.629, 0.629],
            },
            SemiempiricalAtom {
                atomic_number: 1,
                position_angstrom: [-0.629, 0.629, -0.629],
            },
            SemiempiricalAtom {
                atomic_number: 1,
                position_angstrom: [0.629, -0.629, -0.629],
            },
        ];
        let plain = evaluate_pm6(
            &SemiempiricalMolecule::new(SemiempiricalMethod::Pm6D, atoms.clone(), 0).unwrap(),
            SemiempiricalScfOptions::default(),
        )
        .unwrap();
        let corrected = evaluate_pm6(
            &SemiempiricalMolecule::new(SemiempiricalMethod::Pm6D3H4, atoms, 0).unwrap(),
            SemiempiricalScfOptions::default(),
        )
        .unwrap();
        assert_eq!(plain.scf.density, corrected.scf.density);
        assert_eq!(plain.atomic_charges, corrected.atomic_charges);
        assert_eq!(plain.electronic_energy_ev, corrected.electronic_energy_ev);
        assert_eq!(plain.nuclear_energy_ev, corrected.nuclear_energy_ev);
        assert!(
            (corrected.total_energy_ev - plain.total_energy_ev - 0.174_321_825_810_168_7).abs()
                < 1.0e-12
        );
    }
}
