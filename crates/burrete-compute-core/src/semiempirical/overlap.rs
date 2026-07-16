// Equations adapted from LANL PYSEQM at commit
// 6ced9ea66160428e06d37df18e9f565b8123f84a, BSD-3-Clause.
// Source: seqm/seqm_functions/diat_overlap_PM6_SP.py.
// License: compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt.

use super::{rotation::rotation_matrix, SemiempiricalElementParameters, SemiempiricalError};

const ANGSTROM_TO_BOHR_MOPAC: f64 = 1.0 / 0.529_167;

#[derive(Clone, Debug, PartialEq)]
pub struct Rm1OverlapMatrix {
    pub rows: usize,
    pub columns: usize,
    /// Dense row-major storage; only `rows * columns` entries are active.
    pub values: [f64; 16],
}

pub fn rm1_sp_overlap(
    left: &SemiempiricalElementParameters,
    right: &SemiempiricalElementParameters,
    left_position_angstrom: [f64; 3],
    right_position_angstrom: [f64; 3],
) -> Result<Rm1OverlapMatrix, SemiempiricalError> {
    let qn_left = principal_quantum_number(left.atomic_number);
    let qn_right = principal_quantum_number(right.atomic_number);
    if qn_left > 3 || qn_right > 3 {
        return Err(SemiempiricalError::InvalidInput(
            "RM1 overlap currently supports principal quantum numbers 1-3".into(),
        ));
    }
    if qn_left < qn_right {
        let swapped = rm1_sp_overlap(right, left, right_position_angstrom, left_position_angstrom)?;
        let mut values = [0.0; 16];
        for row in 0..swapped.rows {
            for column in 0..swapped.columns {
                values[column * swapped.rows + row] =
                    swapped.values[row * swapped.columns + column];
            }
        }
        return Ok(Rm1OverlapMatrix {
            rows: swapped.columns,
            columns: swapped.rows,
            values,
        });
    }

    let delta = [
        right_position_angstrom[0] - left_position_angstrom[0],
        right_position_angstrom[1] - left_position_angstrom[1],
        right_position_angstrom[2] - left_position_angstrom[2],
    ];
    let distance_angstrom = delta.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !distance_angstrom.is_finite() || distance_angstrom <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "overlap requires distinct finite coordinates".into(),
        ));
    }
    let distance = distance_angstrom * ANGSTROM_TO_BOHR_MOPAC;
    let jcall = match (qn_left, qn_right) {
        (1, 1) => 2,
        (2, 1) => 3,
        (2, 2) => 4,
        (3, 1) => 431,
        (3, 2) => 5,
        (3, 3) => 6,
        _ => unreachable!(),
    };
    if matches!(jcall, 5 | 6) {
        return Err(SemiempiricalError::InvalidInput(
            "RM1 overlap for two heavy atoms involving the third row is not implemented yet".into(),
        ));
    }
    let integrals = |zeta_left: f64, zeta_right: f64| {
        let alpha = 0.5 * distance * (zeta_left + zeta_right);
        let beta = 0.5 * distance * (zeta_left - zeta_right);
        (a_integrals(alpha), b_integrals(beta))
    };
    let (a_ss, b_ss) = integrals(left.zeta_s_bohr_inv, right.zeta_s_bohr_inv);
    let (a_ps, b_ps) = integrals(left.zeta_p_bohr_inv, right.zeta_s_bohr_inv);
    let (a_sp, b_sp) = integrals(left.zeta_s_bohr_inv, right.zeta_p_bohr_inv);
    let (a_pp, b_pp) = integrals(left.zeta_p_bohr_inv, right.zeta_p_bohr_inv);

    let (s_ss, s_ps, s_sp, s_pp_sigma, s_pp_pi) = match jcall {
        2 => {
            let ss = (left.zeta_s_bohr_inv * right.zeta_s_bohr_inv * distance.powi(2)).powf(1.5)
                * (a_ss[2] * b_ss[0] - b_ss[2] * a_ss[0])
                / 4.0;
            (ss, 0.0, 0.0, 0.0, 0.0)
        }
        3 => {
            let ss = right.zeta_s_bohr_inv.powf(1.5)
                * left.zeta_s_bohr_inv.powf(2.5)
                * distance.powi(4)
                * (a_ss[3] * b_ss[0] - b_ss[3] * a_ss[0] + a_ss[2] * b_ss[1] - b_ss[2] * a_ss[1])
                / (3.0_f64.sqrt() * 8.0);
            let ps = right.zeta_s_bohr_inv.powf(1.5)
                * left.zeta_p_bohr_inv.powf(2.5)
                * distance.powi(4)
                * (a_ps[2] * b_ps[0] - b_ps[2] * a_ps[0] + a_ps[3] * b_ps[1] - b_ps[3] * a_ps[1])
                / 8.0;
            (ss, ps, 0.0, 0.0, 0.0)
        }
        4 => {
            let ss = (left.zeta_s_bohr_inv * right.zeta_s_bohr_inv).powf(2.5)
                * distance.powi(5)
                * (a_ss[4] * b_ss[0] + b_ss[4] * a_ss[0] - 2.0 * a_ss[2] * b_ss[2])
                / 48.0;
            let ps = (right.zeta_s_bohr_inv * left.zeta_p_bohr_inv).powf(2.5)
                * distance.powi(5)
                * (a_ps[3] * (b_ps[0] - b_ps[2]) - a_ps[1] * (b_ps[2] - b_ps[4])
                    + b_ps[3] * (a_ps[0] - a_ps[2])
                    - b_ps[1] * (a_ps[2] - a_ps[4]))
                / (16.0 * 3.0_f64.sqrt());
            let sp = (right.zeta_p_bohr_inv * left.zeta_s_bohr_inv).powf(2.5)
                * distance.powi(5)
                * (a_sp[3] * (b_sp[0] - b_sp[2])
                    - a_sp[1] * (b_sp[2] - b_sp[4])
                    - b_sp[3] * (a_sp[0] - a_sp[2])
                    + b_sp[1] * (a_sp[2] - a_sp[4]))
                / (16.0 * 3.0_f64.sqrt());
            let weight =
                (right.zeta_p_bohr_inv * left.zeta_p_bohr_inv).powf(2.5) * distance.powi(5) / 16.0;
            let sigma = -weight * (b_pp[2] * (a_pp[4] + a_pp[0]) - a_pp[2] * (b_pp[4] + b_pp[0]));
            let pi = 0.5
                * weight
                * (a_pp[4] * (b_pp[0] - b_pp[2])
                    - b_pp[4] * (a_pp[0] - a_pp[2])
                    - a_pp[2] * b_pp[0]
                    + b_pp[2] * a_pp[0]);
            (ss, ps, sp, sigma, pi)
        }
        431 => {
            let ss = right.zeta_s_bohr_inv.powf(1.5)
                * left.zeta_s_bohr_inv.powf(3.5)
                * distance.powi(5)
                * (a_ss[4] * b_ss[0] + 2.0 * b_ss[1] * a_ss[3]
                    - 2.0 * a_ss[1] * b_ss[3]
                    - b_ss[4] * a_ss[0])
                / (10.0_f64.sqrt() * 24.0);
            let ps = right.zeta_s_bohr_inv.powf(1.5)
                * left.zeta_p_bohr_inv.powf(3.5)
                * distance.powi(5)
                * (a_ps[3] * (b_ps[0] + b_ps[2]) - a_ps[1] * (b_ps[4] + b_ps[2])
                    + b_ps[1] * (a_ps[2] + a_ps[4])
                    - b_ps[3] * (a_ps[2] + a_ps[0]))
                / (8.0 * 30.0_f64.sqrt());
            (ss, ps, 0.0, 0.0, 0.0)
        }
        _ => unreachable!(),
    };

    let direction = [
        delta[0] / distance_angstrom,
        delta[1] / distance_angstrom,
        delta[2] / distance_angstrom,
    ];
    let rotation = rotation_matrix(direction);
    let (r0, r1, r2) = (rotation[0], rotation[1], rotation[2]);
    let rows = usize::from(left.orbital_count);
    let columns = usize::from(right.orbital_count);
    let mut values = [0.0; 16];
    values[0] = s_ss;
    if matches!(jcall, 3 | 431) {
        for k in 0..3 {
            values[(k + 1) * columns] = s_ps * r0[k];
        }
    } else if matches!(jcall, 4..=6) {
        for k in 0..3 {
            values[(k + 1) * columns] = s_ps * r0[k];
            values[k + 1] = -s_sp * r0[k];
            for l in 0..3 {
                values[(k + 1) * columns + l + 1] =
                    -s_pp_sigma * r0[k] * r0[l] + s_pp_pi * (r1[k] * r1[l] + r2[k] * r2[l]);
            }
        }
    }
    Ok(Rm1OverlapMatrix {
        rows,
        columns,
        values,
    })
}

fn a_integrals(alpha: f64) -> [f64; 7] {
    let mut values = [0.0; 7];
    values[0] = (-alpha).exp() / alpha;
    for index in 1..7 {
        values[index] = values[0] + index as f64 * values[index - 1] / alpha;
    }
    values
}

fn b_integrals(beta: f64) -> [f64; 7] {
    let mut values = [0.0; 7];
    if beta.abs() <= 1.0e-6 {
        for index in (0..7).step_by(2) {
            values[index] = 2.0 / (index + 1) as f64;
        }
        return values;
    }
    if beta.abs() <= 0.5 {
        let x2 = beta * beta;
        let x3 = beta * x2;
        let x4 = x2 * x2;
        let x5 = x2 * x3;
        let x6 = x2 * x4;
        let even = [
            (2.0, 1.0 / 3.0, 1.0 / 60.0, 1.0 / 2520.0),
            (2.0 / 3.0, 1.0 / 5.0, 1.0 / 84.0, 1.0 / 3240.0),
            (2.0 / 5.0, 1.0 / 7.0, 1.0 / 108.0, 1.0 / 3960.0),
            (2.0 / 7.0, 1.0 / 9.0, 1.0 / 132.0, 1.0 / 4680.0),
        ];
        let odd = [
            (-2.0 / 3.0, -1.0 / 15.0, -1.0 / 420.0),
            (-2.0 / 5.0, -1.0 / 21.0, -1.0 / 540.0),
            (-2.0 / 7.0, -1.0 / 27.0, -1.0 / 660.0),
        ];
        for index in 0..7 {
            values[index] = if index % 2 == 0 {
                let c = even[index / 2];
                c.0 + c.1 * x2 + c.2 * x4 + c.3 * x6
            } else {
                let c = odd[index / 2];
                c.0 * beta + c.1 * x3 + c.2 * x5
            };
        }
        return values;
    }
    let bounded = beta.clamp(-500.0, 500.0);
    let positive = bounded.exp() / beta;
    let negative = -(-bounded).exp() / beta;
    values[0] = positive + negative;
    let mut sign = 1.0;
    for index in 1..7 {
        sign = -sign;
        values[index] = sign * positive + negative + index as f64 * values[index - 1] / beta;
    }
    values
}

fn principal_quantum_number(atomic_number: u8) -> u8 {
    match atomic_number {
        1..=2 => 1,
        3..=10 => 2,
        11..=18 => 3,
        19..=36 => 4,
        37..=54 => 5,
        _ => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rm1_parameters;

    #[test]
    fn organic_overlap_matrices_match_pinned_oracle() {
        let oxygen_hydrogen = rm1_sp_overlap(
            rm1_parameters(8).unwrap(),
            rm1_parameters(1).unwrap(),
            [0.0; 3],
            [0.96, 0.0, 0.0],
        )
        .unwrap();
        assert_eq!((oxygen_hydrogen.rows, oxygen_hydrogen.columns), (4, 1));
        assert!((oxygen_hydrogen.values[0] - 0.350_187_056_984_342).abs() < 1.0e-14);
        assert!((oxygen_hydrogen.values[1] - 0.311_750_384_601_171).abs() < 1.0e-14);

        let carbon_oxygen = rm1_sp_overlap(
            rm1_parameters(6).unwrap(),
            rm1_parameters(8).unwrap(),
            [0.0; 3],
            [1.0, 1.0, 0.3],
        )
        .unwrap();
        let expected = [
            0.136_662_800_279_058,
            -0.130_464_281_865_673,
            -0.130_464_281_865_673,
            -0.039_139_284_559_702,
            0.153_721_375_166_471,
            -0.066_904_711_352_402,
            -0.162_631_323_120_11,
            -0.048_789_396_936_033,
            0.153_721_375_166_471,
            -0.162_631_323_120_11,
            -0.066_904_711_352_402,
            -0.048_789_396_936_033,
            0.046_116_412_549_941,
            -0.048_789_396_936_033,
            -0.048_789_396_936_033,
            0.081_089_792_686_898,
        ];
        for (actual, expected) in carbon_oxygen.values.into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1.0e-13);
        }
    }

    #[test]
    fn third_row_hydrogen_matches_oracle_and_higher_period_is_explicit() {
        let sulfur_hydrogen = rm1_sp_overlap(
            rm1_parameters(16).unwrap(),
            rm1_parameters(1).unwrap(),
            [0.0; 3],
            [0.97, 0.0, 0.93],
        )
        .unwrap();
        let expected = [
            0.425_317_728_696_987,
            0.345_070_299_767_074,
            0.0,
            0.330_840_596_683_895,
        ];
        for (actual, expected) in sulfur_hydrogen.values[..4].iter().zip(expected) {
            assert!((*actual - expected).abs() < 1.0e-13);
        }
        assert!(rm1_sp_overlap(
            rm1_parameters(35).unwrap(),
            rm1_parameters(1).unwrap(),
            [0.0; 3],
            [1.0, 0.0, 0.0]
        )
        .is_err());
    }
}
