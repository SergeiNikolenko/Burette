use super::{SemiempiricalAtom, SemiempiricalError};

const BOHR_ANGSTROM: f64 = 0.529_177_208_3;
const HARTREE_TO_EV: f64 = 27.211_386_245_988;
const CUTOFF_ANGSTROM: f64 = 15.0;
const ELEMENT_COUNT: usize = 94;
const PAIR_COUNT: usize = ELEMENT_COUNT * ELEMENT_COUNT;
const REFERENCE_COUNT: usize = 64_516;
const HEADER_BYTES: usize = 24;
const RCOV_OFFSET: usize = HEADER_BYTES;
const R0_OFFSET: usize = RCOV_OFFSET + ELEMENT_COUNT * 8;
const OFFSETS_OFFSET: usize = R0_OFFSET + PAIR_COUNT * 8;
const REFERENCES_OFFSET: usize = OFFSETS_OFFSET + (PAIR_COUNT + 1) * 4;
const TABLE: &[u8] = include_bytes!("pm6_d3.generated.bin");

/// PM6-D3H4 zero-damping D3 dispersion over the complete upstream Z=1..=94
/// table, in eV.
pub fn pm6_d3_dispersion_energy(atoms: &[SemiempiricalAtom]) -> Result<f64, SemiempiricalError> {
    validate_table()?;
    if atoms.is_empty()
        || atoms.iter().any(|atom| {
            !(1..=ELEMENT_COUNT as u8).contains(&atom.atomic_number)
                || atom
                    .position_angstrom
                    .iter()
                    .any(|value| !value.is_finite())
        })
    {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 D3 requires finite atoms with atomic numbers 1..=94".into(),
        ));
    }
    let coordination = coordination_numbers(atoms);
    let cutoff_bohr_squared = (CUTOFF_ANGSTROM / BOHR_ANGSTROM).powi(2);
    let mut e6_hartree = 0.0;
    for left in 0..atoms.len() {
        for right in (left + 1)..atoms.len() {
            let delta = subtract(
                atoms[right].position_angstrom,
                atoms[left].position_angstrom,
            );
            let distance_bohr_squared = dot(delta, delta) / BOHR_ANGSTROM.powi(2);
            if distance_bohr_squared == 0.0 {
                return Err(SemiempiricalError::InvalidInput(
                    "PM6 D3 atoms must not overlap".into(),
                ));
            }
            if distance_bohr_squared > cutoff_bohr_squared {
                continue;
            }
            let pair = pair_index(atoms[left].atomic_number, atoms[right].atomic_number);
            let c6 = interpolate_c6(pair, coordination[left], coordination[right]);
            let distance_bohr = distance_bohr_squared.sqrt();
            let damping_ratio = 1.180 * pair_r0(pair) / distance_bohr;
            let damping = 1.0 / (1.0 + 6.0 * damping_ratio.powf(22.0));
            e6_hartree += c6 * damping / distance_bohr_squared.powi(3);
        }
    }
    Ok(-0.880 * e6_hartree * HARTREE_TO_EV)
}

fn validate_table() -> Result<(), SemiempiricalError> {
    let valid = TABLE.len() == REFERENCES_OFFSET + REFERENCE_COUNT * 24
        && &TABLE[..8] == b"BD3V1\0\0\0"
        && read_u32(8) as usize == ELEMENT_COUNT
        && read_u32(12) as usize == PAIR_COUNT
        && read_u32(16) as usize == REFERENCE_COUNT
        && read_u32(20) as usize == PAIR_COUNT + 1
        && read_u32(OFFSETS_OFFSET) == 0
        && read_u32(OFFSETS_OFFSET + PAIR_COUNT * 4) as usize == REFERENCE_COUNT;
    if valid {
        Ok(())
    } else {
        Err(SemiempiricalError::InvalidInput(
            "embedded PM6 D3 table has an invalid layout".into(),
        ))
    }
}

fn coordination_numbers(atoms: &[SemiempiricalAtom]) -> Vec<f64> {
    let mut values = vec![0.0; atoms.len()];
    for left in 0..atoms.len() {
        for right in 0..atoms.len() {
            if left == right {
                continue;
            }
            let separation_bohr = distance(
                atoms[left].position_angstrom,
                atoms[right].position_angstrom,
            ) / BOHR_ANGSTROM;
            if separation_bohr < 1.0e-12 {
                continue;
            }
            let radius_bohr = (4.0 / 3.0)
                * (covalent_radius(atoms[left].atomic_number)
                    + covalent_radius(atoms[right].atomic_number))
                / BOHR_ANGSTROM;
            values[left] += 1.0 / (1.0 + (-16.0 * (radius_bohr / separation_bohr - 1.0)).exp());
        }
    }
    values
}

fn interpolate_c6(pair: usize, cn_left: f64, cn_right: f64) -> f64 {
    let start = read_u32(OFFSETS_OFFSET + pair * 4) as usize;
    let end = read_u32(OFFSETS_OFFSET + (pair + 1) * 4) as usize;
    let mut fallback = -1.0e99;
    let mut weight_sum = 0.0;
    let mut weighted_c6 = 0.0;
    for reference in start..end {
        let offset = REFERENCES_OFFSET + reference * 24;
        let c6 = read_f64(offset);
        let delta_left = read_f64(offset + 8) - cn_left;
        let delta_right = read_f64(offset + 16) - cn_right;
        fallback = c6;
        let weight = (-4.0 * (delta_left * delta_left + delta_right * delta_right)).exp();
        weight_sum += weight;
        weighted_c6 += weight * c6;
    }
    if weight_sum > 0.0 {
        weighted_c6 / weight_sum
    } else {
        fallback
    }
}

fn pair_index(left: u8, right: u8) -> usize {
    (usize::from(left) - 1) * ELEMENT_COUNT + usize::from(right) - 1
}

fn pair_r0(pair: usize) -> f64 {
    read_f64(R0_OFFSET + pair * 8)
}

fn covalent_radius(atomic_number: u8) -> f64 {
    read_f64(RCOV_OFFSET + (usize::from(atomic_number) - 1) * 8)
}

fn read_u32(offset: usize) -> u32 {
    u32::from_le_bytes(
        TABLE[offset..offset + 4]
            .try_into()
            .expect("bounded D3 u32"),
    )
}

fn read_f64(offset: usize) -> f64 {
    f64::from_le_bytes(
        TABLE[offset..offset + 8]
            .try_into()
            .expect("bounded D3 f64"),
    )
}

fn subtract(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn dot(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn distance(left: [f64; 3], right: [f64; 3]) -> f64 {
    dot(subtract(left, right), subtract(left, right)).sqrt()
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
    fn organic_and_broad_element_cases_match_pinned_d3_oracles() {
        let methane = atoms(
            &[6, 1, 1, 1, 1],
            &[
                [0.0, 0.0, 0.0],
                [0.629, 0.629, 0.629],
                [-0.629, -0.629, 0.629],
                [-0.629, 0.629, -0.629],
                [0.629, -0.629, -0.629],
            ],
        );
        assert!(
            (pm6_d3_dispersion_energy(&methane).unwrap() + 0.303_554_956_774_984_45).abs()
                < 1.0e-12
        );

        let halogens = atoms(
            &[16, 17, 35, 53],
            &[
                [0.0, 0.0, 0.0],
                [2.1, 0.0, 0.0],
                [0.0, 2.6, 0.0],
                [0.0, 0.0, 3.1],
            ],
        );
        assert!(
            (pm6_d3_dispersion_energy(&halogens).unwrap() + 0.741_957_085_936_019_2).abs()
                < 1.0e-12
        );

        let iron_oxide = atoms(
            &[26, 8, 8, 1, 1],
            &[
                [0.0, 0.0, 0.0],
                [1.9, 0.0, 0.0],
                [-1.9, 0.0, 0.0],
                [2.5, 0.6, 0.0],
                [-2.5, -0.6, 0.0],
            ],
        );
        assert!(
            (pm6_d3_dispersion_energy(&iron_oxide).unwrap() + 0.187_022_431_088_046_48).abs()
                < 1.0e-12
        );
    }

    #[test]
    fn rejects_unsupported_elements_and_overlaps() {
        assert!(pm6_d3_dispersion_energy(&[SemiempiricalAtom {
            atomic_number: 95,
            position_angstrom: [0.0; 3],
        }])
        .is_err());
        assert!(pm6_d3_dispersion_energy(&atoms(&[1, 1], &[[0.0; 3], [0.0; 3]])).is_err());
    }
}
