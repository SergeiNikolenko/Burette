// Preserve the exact float64 values decoded from the pinned upstream NPZ tables.
#![allow(clippy::excessive_precision)]

use super::{SemiempiricalAtom, SemiempiricalError};

const BOHR_ANGSTROM: f64 = 0.529_177_208_3;
const HARTREE_TO_EV: f64 = 27.211_386_245_988;
const CUTOFF_ANGSTROM: f64 = 15.0;

#[derive(Clone, Copy)]
struct D3Reference {
    c6: f64,
    cn_left: f64,
    cn_right: f64,
}
const D3_1_1: [D3Reference; 4] = [
    D3Reference {
        c6: 3.0266999999999999,
        cn_left: 0.91180000000000005,
        cn_right: 0.91180000000000005,
    },
    D3Reference {
        c6: 4.7378999999999998,
        cn_left: 0.91180000000000005,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 4.7378999999999998,
        cn_left: 0.0,
        cn_right: 0.91180000000000005,
    },
    D3Reference {
        c6: 7.5915999999999997,
        cn_left: 0.0,
        cn_right: 0.0,
    },
];
const D3_1_6: [D3Reference; 10] = [
    D3Reference {
        c6: 12.1402,
        cn_left: 0.91180000000000005,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 11.3932,
        cn_left: 0.91180000000000005,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 9.4202999999999992,
        cn_left: 0.91180000000000005,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 8.8209999999999997,
        cn_left: 0.91180000000000005,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 7.3662000000000001,
        cn_left: 0.91180000000000005,
        cn_right: 3.9843999999999999,
    },
    D3Reference {
        c6: 19.2653,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 18.057500000000001,
        cn_left: 0.0,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 14.7623,
        cn_left: 0.0,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 13.799200000000001,
        cn_left: 0.0,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 11.3299,
        cn_left: 0.0,
        cn_right: 3.9843999999999999,
    },
];
const D3_1_7: [D3Reference; 8] = [
    D3Reference {
        c6: 8.7171000000000003,
        cn_left: 0.91180000000000005,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 8.1417000000000002,
        cn_left: 0.91180000000000005,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 7.6609999999999996,
        cn_left: 0.91180000000000005,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 6.7746000000000004,
        cn_left: 0.91180000000000005,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 13.516400000000001,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 12.598000000000001,
        cn_left: 0.0,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 11.821400000000001,
        cn_left: 0.0,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 10.3987,
        cn_left: 0.0,
        cn_right: 2.9903,
    },
];
const D3_1_8: [D3Reference; 6] = [
    D3Reference {
        c6: 6.718,
        cn_left: 0.91180000000000005,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 6.0575000000000001,
        cn_left: 0.91180000000000005,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 5.3716999999999997,
        cn_left: 0.91180000000000005,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 10.2371,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 9.1812000000000005,
        cn_left: 0.0,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 8.0847999999999995,
        cn_left: 0.0,
        cn_right: 1.9886999999999999,
    },
];
const D3_6_6: [D3Reference; 25] = [
    D3Reference {
        c6: 49.113,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 46.068100000000001,
        cn_left: 0.0,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 37.841900000000003,
        cn_left: 0.0,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 35.4129,
        cn_left: 0.0,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 29.283000000000001,
        cn_left: 0.0,
        cn_right: 3.9843999999999999,
    },
    D3Reference {
        c6: 46.068100000000001,
        cn_left: 0.98680000000000001,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 43.245199999999997,
        cn_left: 0.98680000000000001,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 35.521900000000002,
        cn_left: 0.98680000000000001,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 33.253999999999998,
        cn_left: 0.98680000000000001,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 27.520600000000002,
        cn_left: 0.98680000000000001,
        cn_right: 3.9843999999999999,
    },
    D3Reference {
        c6: 37.841900000000003,
        cn_left: 1.9984999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 35.521900000000002,
        cn_left: 1.9984999999999999,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 29.360199999999999,
        cn_left: 1.9984999999999999,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 27.5063,
        cn_left: 1.9984999999999999,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 22.951699999999999,
        cn_left: 1.9984999999999999,
        cn_right: 3.9843999999999999,
    },
    D3Reference {
        c6: 35.4129,
        cn_left: 2.9986999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 33.253999999999998,
        cn_left: 2.9986999999999999,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 27.5063,
        cn_left: 2.9986999999999999,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 25.780899999999999,
        cn_left: 2.9986999999999999,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 21.537700000000001,
        cn_left: 2.9986999999999999,
        cn_right: 3.9843999999999999,
    },
    D3Reference {
        c6: 29.283000000000001,
        cn_left: 3.9843999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 27.520600000000002,
        cn_left: 3.9843999999999999,
        cn_right: 0.98680000000000001,
    },
    D3Reference {
        c6: 22.951699999999999,
        cn_left: 3.9843999999999999,
        cn_right: 1.9984999999999999,
    },
    D3Reference {
        c6: 21.537700000000001,
        cn_left: 3.9843999999999999,
        cn_right: 2.9986999999999999,
    },
    D3Reference {
        c6: 18.206700000000001,
        cn_left: 3.9843999999999999,
        cn_right: 3.9843999999999999,
    },
];
const D3_6_7: [D3Reference; 20] = [
    D3Reference {
        c6: 34.814599999999999,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 32.4848,
        cn_left: 0.0,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 30.5305,
        cn_left: 0.0,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 26.935099999999998,
        cn_left: 0.0,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 32.700899999999997,
        cn_left: 0.98680000000000001,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 30.541,
        cn_left: 0.98680000000000001,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 28.6938,
        cn_left: 0.98680000000000001,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 25.331800000000001,
        cn_left: 0.98680000000000001,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 27.170400000000001,
        cn_left: 1.9984999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 25.3827,
        cn_left: 1.9984999999999999,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 23.8965,
        cn_left: 1.9984999999999999,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 21.148800000000001,
        cn_left: 1.9984999999999999,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 25.479900000000001,
        cn_left: 2.9986999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 23.813600000000001,
        cn_left: 2.9986999999999999,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 22.427900000000001,
        cn_left: 2.9986999999999999,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 19.866900000000001,
        cn_left: 2.9986999999999999,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 21.419899999999998,
        cn_left: 3.9843999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 20.046800000000001,
        cn_left: 3.9843999999999999,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 18.917200000000001,
        cn_left: 3.9843999999999999,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 16.8169,
        cn_left: 3.9843999999999999,
        cn_right: 2.9903,
    },
];
const D3_6_8: [D3Reference; 15] = [
    D3Reference {
        c6: 26.5929,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 23.911999999999999,
        cn_left: 0.0,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 21.142800000000001,
        cn_left: 0.0,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 25.009699999999999,
        cn_left: 0.98680000000000001,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 22.517800000000001,
        cn_left: 0.98680000000000001,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 19.908999999999999,
        cn_left: 0.98680000000000001,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 20.959700000000002,
        cn_left: 1.9984999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 18.903400000000001,
        cn_left: 1.9984999999999999,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 16.785499999999999,
        cn_left: 1.9984999999999999,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 19.694299999999998,
        cn_left: 2.9986999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 17.774999999999999,
        cn_left: 2.9986999999999999,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 15.8009,
        cn_left: 2.9986999999999999,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 16.7544,
        cn_left: 3.9843999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 15.1751,
        cn_left: 3.9843999999999999,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 13.5525,
        cn_left: 3.9843999999999999,
        cn_right: 1.9886999999999999,
    },
];
const D3_7_7: [D3Reference; 16] = [
    D3Reference {
        c6: 25.2685,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 23.6295,
        cn_left: 0.0,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 22.279399999999999,
        cn_left: 0.0,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 19.770700000000001,
        cn_left: 0.0,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 23.6295,
        cn_left: 0.99439999999999995,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 22.124099999999999,
        cn_left: 0.99439999999999995,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 20.850100000000001,
        cn_left: 0.99439999999999995,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 18.518000000000001,
        cn_left: 0.99439999999999995,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 22.279399999999999,
        cn_left: 2.0143,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 20.850100000000001,
        cn_left: 2.0143,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 19.6768,
        cn_left: 2.0143,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 17.492799999999999,
        cn_left: 2.0143,
        cn_right: 2.9903,
    },
    D3Reference {
        c6: 19.770700000000001,
        cn_left: 2.9903,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 18.518000000000001,
        cn_left: 2.9903,
        cn_right: 0.99439999999999995,
    },
    D3Reference {
        c6: 17.492799999999999,
        cn_left: 2.9903,
        cn_right: 2.0143,
    },
    D3Reference {
        c6: 15.5817,
        cn_left: 2.9903,
        cn_right: 2.9903,
    },
];
const D3_7_8: [D3Reference; 12] = [
    D3Reference {
        c6: 19.654599999999999,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 17.7698,
        cn_left: 0.0,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 15.836399999999999,
        cn_left: 0.0,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 18.412800000000001,
        cn_left: 0.99439999999999995,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 16.677499999999998,
        cn_left: 0.99439999999999995,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 14.859999999999999,
        cn_left: 0.99439999999999995,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 17.409300000000002,
        cn_left: 2.0143,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 15.7631,
        cn_left: 2.0143,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 14.0807,
        cn_left: 2.0143,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 15.524900000000001,
        cn_left: 2.9903,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 14.0793,
        cn_left: 2.9903,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 12.607699999999999,
        cn_left: 2.9903,
        cn_right: 1.9886999999999999,
    },
];
const D3_8_8: [D3Reference; 9] = [
    D3Reference {
        c6: 15.5059,
        cn_left: 0.0,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 14.0764,
        cn_left: 0.0,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 12.627700000000001,
        cn_left: 0.0,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 14.0764,
        cn_left: 0.99250000000000005,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 12.8161,
        cn_left: 0.99250000000000005,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 11.5009,
        cn_left: 0.99250000000000005,
        cn_right: 1.9886999999999999,
    },
    D3Reference {
        c6: 12.627700000000001,
        cn_left: 1.9886999999999999,
        cn_right: 0.0,
    },
    D3Reference {
        c6: 11.5009,
        cn_left: 1.9886999999999999,
        cn_right: 0.99250000000000005,
    },
    D3Reference {
        c6: 10.370799999999999,
        cn_left: 1.9886999999999999,
        cn_right: 1.9886999999999999,
    },
];

/// PM6-D3H4 zero-damping D3 dispersion for the parity-gated CHNO domain, in eV.
pub fn pm6_d3_dispersion_energy(atoms: &[SemiempiricalAtom]) -> Result<f64, SemiempiricalError> {
    if atoms.is_empty()
        || atoms.iter().any(|atom| {
            !matches!(atom.atomic_number, 1 | 6 | 7 | 8)
                || atom
                    .position_angstrom
                    .iter()
                    .any(|value| !value.is_finite())
        })
    {
        return Err(SemiempiricalError::InvalidInput(
            "the current PM6 D3 table requires finite CHNO atoms".into(),
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
            let zi = atoms[left].atomic_number;
            let zj = atoms[right].atomic_number;
            let (references, r0_bohr, swapped) = d3_pair(zi, zj).unwrap();
            let (cn_left, cn_right) = if swapped {
                (coordination[right], coordination[left])
            } else {
                (coordination[left], coordination[right])
            };
            let c6 = interpolate_c6(references, cn_left, cn_right);
            let distance_bohr = distance_bohr_squared.sqrt();
            let damping_ratio = 1.180 * r0_bohr / distance_bohr;
            let damping = 1.0 / (1.0 + 6.0 * damping_ratio.powf(22.0));
            e6_hartree += c6 * damping / distance_bohr_squared.powi(3);
        }
    }
    Ok(-0.880 * e6_hartree * HARTREE_TO_EV)
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
                * (d3_covalent_radius(atoms[left].atomic_number)
                    + d3_covalent_radius(atoms[right].atomic_number))
                / BOHR_ANGSTROM;
            values[left] += 1.0 / (1.0 + (-16.0 * (radius_bohr / separation_bohr - 1.0)).exp());
        }
    }
    values
}

fn interpolate_c6(references: &[D3Reference], cn_left: f64, cn_right: f64) -> f64 {
    let mut fallback = -1.0e99;
    let mut weight_sum = 0.0;
    let mut weighted_c6 = 0.0;
    for reference in references {
        fallback = reference.c6;
        let delta_left = reference.cn_left - cn_left;
        let delta_right = reference.cn_right - cn_right;
        let weight = (-4.0 * (delta_left * delta_left + delta_right * delta_right)).exp();
        weight_sum += weight;
        weighted_c6 += weight * reference.c6;
    }
    if weight_sum > 0.0 {
        weighted_c6 / weight_sum
    } else {
        fallback
    }
}

fn d3_covalent_radius(atomic_number: u8) -> f64 {
    match atomic_number {
        1 => 0.32,
        6 => 0.75,
        7 => 0.71,
        8 => 0.63,
        _ => unreachable!(),
    }
}

fn d3_pair(left: u8, right: u8) -> Option<(&'static [D3Reference], f64, bool)> {
    let (first, second, swapped) = if left <= right {
        (left, right, false)
    } else {
        (right, left, true)
    };
    let (references, r0) = match (first, second) {
        (1, 1) => (&D3_1_1[..], 2.1823000000000001),
        (1, 6) => (&D3_1_6[..], 2.4491999999999998),
        (1, 7) => (&D3_1_7[..], 2.3666999999999998),
        (1, 8) => (&D3_1_8[..], 2.1768000000000001),
        (6, 6) => (&D3_6_6[..], 2.9102999999999999),
        (6, 7) => (&D3_6_7[..], 2.7063000000000001),
        (6, 8) => (&D3_6_8[..], 2.5697000000000001),
        (7, 7) => (&D3_7_7[..], 2.6225000000000001),
        (7, 8) => (&D3_7_8[..], 2.4845999999999999),
        (8, 8) => (&D3_8_8[..], 2.4817),
        _ => return None,
    };
    Some((references, r0, swapped))
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
    fn methane_and_water_dimer_match_pinned_d3_oracles() {
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
        let water_dimer = atoms(
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
        let methane_kcal = pm6_d3_dispersion_energy(&methane).unwrap() / (1.0 / 23.060_547_830_619);
        let dimer_kcal =
            pm6_d3_dispersion_energy(&water_dimer).unwrap() / (1.0 / 23.060_547_830_619);
        assert!((methane_kcal - -7.000_143_599_931_012).abs() < 1.0e-11);
        assert!((dimer_kcal - -5.254_895_475_320_264).abs() < 1.0e-11);
    }

    #[test]
    fn rejects_unsupported_elements_and_overlaps() {
        assert!(pm6_d3_dispersion_energy(&[SemiempiricalAtom {
            atomic_number: 16,
            position_angstrom: [0.0; 3]
        }])
        .is_err());
        assert!(pm6_d3_dispersion_energy(&atoms(&[1, 1], &[[0.0; 3], [0.0; 3]])).is_err());
    }
}
