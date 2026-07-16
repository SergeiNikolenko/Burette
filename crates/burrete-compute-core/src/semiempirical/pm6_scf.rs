use super::{
    pm6_d_d_pair_integrals, pm6_d_hydrogen_pair_integrals, pm6_d_sp_pair_integrals,
    pm6_full_parameters, rm1_rotated_pair_integrals, Pm6FullElementParameters,
    SemiempiricalElementParameters, SemiempiricalError, SemiempiricalMolecule,
};

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

fn index4(a: usize, b: usize, c: usize, d: usize, right: usize) -> usize {
    ((a * right + b) * right + c) * right + d
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
                    repulsion[index4(a, b, c, d, nr)] =
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
                    repulsion[index4(0, 0, c, d, nr)] = value.repulsion_ev[c * 9 + d];
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
                            repulsion[index4(a, b, c, d, nr)] +=
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
                            repulsion[index4(a, b, c, d, nr)] +=
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
    if density.len() != orbital_count * orbital_count {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 pair contraction requires a square density matrix".into(),
        ));
    }
    let mut contribution = vec![0.0; density.len()];
    for pair in pairs {
        let (nl, nr) = (pair.left_orbital_count, pair.right_orbital_count);
        if pair.repulsion_ev.len() != nl * nl * nr * nr {
            return Err(SemiempiricalError::InvalidInput(
                "PM6 pair tensor has an invalid shape".into(),
            ));
        }
        for a in 0..nl {
            for b in 0..nl {
                for c in 0..nr {
                    for d in 0..nr {
                        let integral = pair.repulsion_ev[index4(a, b, c, d, nr)];
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
}
