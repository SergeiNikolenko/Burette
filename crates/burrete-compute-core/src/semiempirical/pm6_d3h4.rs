use super::{SemiempiricalAtom, SemiempiricalError};

const KCAL_MOL_TO_EV: f64 = 1.0 / 23.060_547_830_619;
const HALF_PI: f64 = std::f64::consts::PI / 2.0;

// Rezac-Hobza H4 covalent radii in angstrom. The values are adapted from
// OpenMOPAC H_bonds4.F90 under Apache-2.0; see THIRD_PARTY_NOTICES.md.
const H4_COVALENT_RADII: [f64; 118] = [
    0.37, 0.32, 1.34, 0.90, 0.82, 0.77, 0.75, 0.73, 0.71, 0.69, 1.54, 1.30, 1.18, 1.11, 1.06, 1.02,
    0.99, 0.97, 1.96, 1.74, 1.44, 1.36, 1.25, 1.27, 1.39, 1.25, 1.26, 1.21, 1.38, 1.31, 1.26, 1.22,
    1.19, 1.16, 1.14, 1.10, 2.11, 1.92, 1.62, 1.48, 1.37, 1.45, 1.56, 1.26, 1.35, 1.31, 1.53, 1.48,
    1.44, 1.41, 1.38, 1.35, 1.33, 1.30, 2.25, 1.98, 1.69, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.60, 1.50, 1.38, 1.46, 1.59, 1.28, 1.37, 1.28, 1.44, 1.49,
    0.00, 0.00, 1.46, 0.00, 0.00, 1.45, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
];

#[derive(Clone, Copy, Debug, PartialEq)]
struct H4Parameters {
    oh_o: f64,
    oh_n: f64,
    nh_o: f64,
    nh_n: f64,
    water_oxygen_multiplier: f64,
    ammonium_multiplier: f64,
    carboxylate_multiplier: f64,
}

const PM6_H4: H4Parameters = H4Parameters {
    oh_o: 2.32,
    oh_n: 3.10,
    nh_o: 1.07,
    nh_n: 2.01,
    water_oxygen_multiplier: 0.42,
    ammonium_multiplier: 3.61,
    carboxylate_multiplier: 1.41,
};

/// Rezac-Hobza covalent radius used by the PM6-D3H4 H4 term.
pub fn pm6_h4_covalent_radius(atomic_number: u8) -> Option<f64> {
    atomic_number
        .checked_sub(1)
        .and_then(|index| H4_COVALENT_RADII.get(usize::from(index)))
        .copied()
}

/// PM6-D3H4 Rezac-Hobza hydrogen-bond correction in eV.
pub fn pm6_h4_energy(atoms: &[SemiempiricalAtom]) -> Result<f64, SemiempiricalError> {
    validate_atoms(atoms)?;
    let mut energy_kcal_mol = 0.0;
    for (hydrogen_index, hydrogen) in atoms.iter().enumerate() {
        if hydrogen.atomic_number != 1 {
            continue;
        }
        for left in 0..atoms.len() {
            if !matches!(atoms[left].atomic_number, 7 | 8) {
                continue;
            }
            for right in (left + 1)..atoms.len() {
                if matches!(atoms[right].atomic_number, 7 | 8) {
                    energy_kcal_mol += h4_triple(atoms, hydrogen_index, left, right, PM6_H4);
                }
            }
        }
    }
    Ok(energy_kcal_mol * KCAL_MOL_TO_EV)
}

/// PM6-D3H4 short-range hydrogen-hydrogen repulsion in eV.
pub fn pm6_hh_repulsion_energy(atoms: &[SemiempiricalAtom]) -> Result<f64, SemiempiricalError> {
    validate_atoms(atoms)?;
    let mut energy_kcal_mol = 0.0;
    for left in 0..atoms.len() {
        if atoms[left].atomic_number != 1 {
            continue;
        }
        for right in 0..left {
            if atoms[right].atomic_number == 1 {
                energy_kcal_mol += hh_pair_polynomial(distance(
                    atoms[left].position_angstrom,
                    atoms[right].position_angstrom,
                ));
            }
        }
    }
    Ok(energy_kcal_mol * KCAL_MOL_TO_EV)
}

fn validate_atoms(atoms: &[SemiempiricalAtom]) -> Result<(), SemiempiricalError> {
    if atoms.is_empty() {
        return Err(SemiempiricalError::InvalidInput(
            "PM6-D3H4 correction requires at least one atom".into(),
        ));
    }
    if atoms.iter().any(|atom| {
        atom.atomic_number == 0
            || usize::from(atom.atomic_number) > H4_COVALENT_RADII.len()
            || atom
                .position_angstrom
                .iter()
                .any(|value| !value.is_finite())
    }) {
        return Err(SemiempiricalError::InvalidInput(
            "PM6-D3H4 correction requires finite coordinates and atomic numbers 1..=118".into(),
        ));
    }
    Ok(())
}

fn h4_triple(
    atoms: &[SemiempiricalAtom],
    hydrogen: usize,
    left: usize,
    right: usize,
    parameters: H4Parameters,
) -> f64 {
    let left_h = distance(
        atoms[left].position_angstrom,
        atoms[hydrogen].position_angstrom,
    );
    let right_h = distance(
        atoms[right].position_angstrom,
        atoms[hydrogen].position_angstrom,
    );
    let donor_acceptor = distance(
        atoms[left].position_angstrom,
        atoms[right].position_angstrom,
    );
    let left_vector = subtract(
        atoms[left].position_angstrom,
        atoms[hydrogen].position_angstrom,
    );
    let right_vector = subtract(
        atoms[right].position_angstrom,
        atoms[hydrogen].position_angstrom,
    );
    let denominator = (norm(left_vector) * norm(right_vector)).max(1.0e-12);
    let cosine = (dot(left_vector, right_vector) / denominator).clamp(-1.0, 1.0);
    let angle = std::f64::consts::PI - cosine.acos();
    if angle >= HALF_PI {
        return 0.0;
    }

    let (donor, acceptor, donor_h, acceptor_h) = if left_h < right_h {
        (left, right, left_h, right_h)
    } else {
        (right, left, right_h, left_h)
    };
    let radial = -0.003_034_074_074_073_135 * donor_acceptor.powi(7)
        + 0.073_576_296_296_270_92 * donor_acceptor.powi(6)
        - 0.700_871_111_110_828 * donor_acceptor.powi(5)
        + 3.253_096_296_294_617_5 * donor_acceptor.powi(4)
        - 7.206_874_074_068_388 * donor_acceptor.powi(3)
        + 5.317_546_666_655_722 * donor_acceptor.powi(2)
        + 3.407_360_000_011_028 * donor_acceptor
        - 4.685_120_000_004_504;
    let scaled_angle = angle / HALF_PI;
    let angular_polynomial = smooth_polynomial(scaled_angle);
    let angular = 1.0 - angular_polynomial * angular_polynomial;

    let donor_element = atoms[donor].atomic_number;
    let acceptor_element = atoms[acceptor].atomic_number;
    let pair_parameter = match (donor_element, acceptor_element) {
        (8, 8) => parameters.oh_o,
        (8, 7) => parameters.oh_n,
        (7, 8) => parameters.nh_o,
        (7, 7) => parameters.nh_n,
        _ => return 0.0,
    };
    let bond_switch = if donor_h > 1.15 {
        let stretched = donor_h - 1.15;
        let average = (0.5 * donor_h + 0.5 * acceptor_h - 1.15).max(1.0e-12);
        1.0 - smooth_polynomial(stretched / average)
    } else {
        1.0
    };

    let water_scale = water_scale(atoms, donor, donor_element, acceptor_element, parameters);
    let ammonium_scale = ammonium_scale(atoms, donor, donor_element, parameters);
    let carboxylate_scale = carboxylate_scale(atoms, acceptor, acceptor_element, parameters);
    pair_parameter
        * radial
        * angular
        * bond_switch
        * water_scale
        * ammonium_scale
        * carboxylate_scale
}

fn water_scale(
    atoms: &[SemiempiricalAtom],
    donor: usize,
    donor_element: u8,
    acceptor_element: u8,
    parameters: H4Parameters,
) -> f64 {
    if donor_element != 8 || acceptor_element != 8 {
        return 1.0;
    }
    let hydrogens: f64 = atoms
        .iter()
        .enumerate()
        .filter(|(_, atom)| atom.atomic_number == 1)
        .map(|(index, _)| covalent_contribution(atoms, donor, index))
        .sum();
    let others: f64 = atoms
        .iter()
        .enumerate()
        .filter(|(_, atom)| atom.atomic_number != 1)
        .map(|(index, _)| covalent_contribution(atoms, donor, index))
        .sum();
    if hydrogens < 1.0 {
        return 1.0;
    }
    let valence_factor = if hydrogens > 1.0 && hydrogens <= 2.0 {
        hydrogens - 1.0
    } else if hydrogens > 2.0 && hydrogens < 3.0 {
        3.0 - hydrogens
    } else {
        0.0
    };
    1.0 + (parameters.water_oxygen_multiplier - 1.0) * valence_factor * (1.0 - others).max(0.0)
}

fn ammonium_scale(
    atoms: &[SemiempiricalAtom],
    donor: usize,
    donor_element: u8,
    parameters: H4Parameters,
) -> f64 {
    if donor_element != 7 {
        return 1.0;
    }
    let valence: f64 = (0..atoms.len())
        .map(|index| covalent_contribution(atoms, donor, index))
        .sum();
    1.0 + (parameters.ammonium_multiplier - 1.0) * (valence - 3.0).max(0.0)
}

fn carboxylate_scale(
    atoms: &[SemiempiricalAtom],
    acceptor: usize,
    acceptor_element: u8,
    parameters: H4Parameters,
) -> f64 {
    if acceptor_element != 8 {
        return 1.0;
    }
    let acceptor_valence: f64 = (0..atoms.len())
        .map(|index| covalent_contribution(atoms, acceptor, index))
        .sum();
    let carbon = (0..atoms.len())
        .filter(|&index| atoms[index].atomic_number == 6)
        .filter_map(|index| {
            (covalent_contribution(atoms, acceptor, index) > 0.0).then_some((
                index,
                distance(
                    atoms[index].position_angstrom,
                    atoms[acceptor].position_angstrom,
                ),
            ))
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(index, _)| index);
    let Some(carbon) = carbon else {
        return 1.0;
    };
    let carbon_valence: f64 = (0..atoms.len())
        .map(|index| covalent_contribution(atoms, carbon, index))
        .sum();
    let second_oxygen = (0..atoms.len())
        .filter(|&index| index != acceptor && atoms[index].atomic_number == 8)
        .filter_map(|index| {
            (covalent_contribution(atoms, carbon, index) > 0.0).then_some((
                index,
                distance(
                    atoms[index].position_angstrom,
                    atoms[carbon].position_angstrom,
                ),
            ))
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(index, _)| index);
    let Some(second_oxygen) = second_oxygen else {
        return 1.0;
    };
    let second_oxygen_valence: f64 = (0..atoms.len())
        .map(|index| covalent_contribution(atoms, second_oxygen, index))
        .sum();
    let first_factor = (1.0 - (1.0 - acceptor_valence).abs()).max(0.0);
    let second_factor = (1.0 - (1.0 - second_oxygen_valence).abs()).max(0.0);
    let carbon_factor = (1.0 - (3.0 - carbon_valence).abs()).max(0.0);
    1.0 + (parameters.carboxylate_multiplier - 1.0) * first_factor * second_factor * carbon_factor
}

fn covalent_contribution(atoms: &[SemiempiricalAtom], left: usize, right: usize) -> f64 {
    let left_radius = H4_COVALENT_RADII[usize::from(atoms[left].atomic_number) - 1];
    let right_radius = H4_COVALENT_RADII[usize::from(atoms[right].atomic_number) - 1];
    let covalent_distance = left_radius + right_radius;
    let cutoff = covalent_distance * 1.6;
    let separation = distance(
        atoms[left].position_angstrom,
        atoms[right].position_angstrom,
    );
    if separation == 0.0 || separation >= cutoff {
        0.0
    } else if separation <= covalent_distance {
        1.0
    } else {
        let x = (separation - covalent_distance) / (cutoff - covalent_distance);
        1.0 - smooth_polynomial(x)
    }
}

fn smooth_polynomial(x: f64) -> f64 {
    -20.0 * x.powi(7) + 70.0 * x.powi(6) - 84.0 * x.powi(5) + 35.0 * x.powi(4)
}

fn hh_pair_polynomial(distance_angstrom: f64) -> f64 {
    if distance_angstrom <= 1.0 {
        25.462_936_031_476_93
    } else if distance_angstrom < 1.5 {
        -2_714.952_351_603_469_7 * distance_angstrom.powi(5)
            + 17_103.650_110_591_705 * distance_angstrom.powi(4)
            - 42_511.857_982_217_96 * distance_angstrom.powi(3)
            + 52_063.196_799_138_34 * distance_angstrom.powi(2)
            - 31_430.658_335_972_29 * distance_angstrom
            + 7_516.084_696_095_14
    } else {
        118.7326 * (-1.53965 * distance_angstrom.powf(1.72905)).exp()
    }
}

fn subtract(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn dot(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn norm(vector: [f64; 3]) -> f64 {
    dot(vector, vector).sqrt()
}

fn distance(left: [f64; 3], right: [f64; 3]) -> f64 {
    norm(subtract(left, right))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atoms(elements: &[u8], positions: &[[f64; 3]]) -> Vec<SemiempiricalAtom> {
        elements
            .iter()
            .zip(positions)
            .map(|(&atomic_number, &position_angstrom)| SemiempiricalAtom {
                atomic_number,
                position_angstrom,
            })
            .collect()
    }

    #[test]
    fn water_dimer_matches_pinned_h4_and_hh_oracle() {
        let molecule = atoms(
            &[8, 1, 1, 8, 1, 1],
            &[
                [0.0, 0.0, 0.0],
                [-0.586, 0.756, 0.0],
                [0.957, 0.0, 0.0],
                [2.91, 0.0, 0.0],
                [3.28, 0.756, 0.0],
                [3.28, -0.756, 0.0],
            ],
        );
        let h4_kcal = pm6_h4_energy(&molecule).unwrap() / KCAL_MOL_TO_EV;
        let hh_kcal = pm6_hh_repulsion_energy(&molecule).unwrap() / KCAL_MOL_TO_EV;
        assert!((h4_kcal - -0.968_014_408_809_544_9).abs() < 1.0e-12);
        assert!((hh_kcal - 7.621_743_243_963_625).abs() < 1.0e-12);
    }

    #[test]
    fn methane_has_no_h4_and_matches_hh_oracle() {
        let molecule = atoms(
            &[6, 1, 1, 1, 1],
            &[
                [0.0, 0.0, 0.0],
                [0.629, 0.629, 0.629],
                [-0.629, -0.629, 0.629],
                [-0.629, 0.629, -0.629],
                [0.629, -0.629, -0.629],
            ],
        );
        assert_eq!(pm6_h4_energy(&molecule).unwrap(), 0.0);
        let hh_kcal = pm6_hh_repulsion_energy(&molecule).unwrap() / KCAL_MOL_TO_EV;
        assert!((hh_kcal - 11.020_100_401_947_241).abs() < 1.0e-12);
    }

    #[test]
    fn invalid_correction_input_is_rejected() {
        assert!(pm6_h4_energy(&[]).is_err());
        assert!(pm6_hh_repulsion_energy(&[SemiempiricalAtom {
            atomic_number: 1,
            position_angstrom: [f64::NAN, 0.0, 0.0],
        }])
        .is_err());
    }
}
