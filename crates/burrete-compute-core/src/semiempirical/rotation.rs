// Equations adapted from LANL PYSEQM at commit
// 6ced9ea66160428e06d37df18e9f565b8123f84a, BSD-3-Clause.
// Source: seqm/seqm_functions/two_elec_two_center_int.py.
// License: compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt.

use super::{
    rm1_two_center_integrals, Rm1TwoCenterIntegrals, SemiempiricalElementParameters,
    SemiempiricalError,
};

#[derive(Clone, Debug, PartialEq)]
pub struct Rm1RotatedPairIntegrals {
    /// `(mu, nu | lambda, sigma)` in a dense `4 x 4 x 4 x 4` row-major tensor.
    pub repulsion_ev: [f64; 256],
    /// Electron density on the left atom attracted to the right nucleus.
    pub left_core_attraction_ev: [f64; 16],
    /// Electron density on the right atom attracted to the left nucleus.
    pub right_core_attraction_ev: [f64; 16],
}

pub fn rm1_rotated_pair_integrals(
    left: &SemiempiricalElementParameters,
    right: &SemiempiricalElementParameters,
    left_position_angstrom: [f64; 3],
    right_position_angstrom: [f64; 3],
) -> Result<Rm1RotatedPairIntegrals, SemiempiricalError> {
    let delta = [
        right_position_angstrom[0] - left_position_angstrom[0],
        right_position_angstrom[1] - left_position_angstrom[1],
        right_position_angstrom[2] - left_position_angstrom[2],
    ];
    let distance = delta.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !distance.is_finite() || distance <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "rotated pair requires distinct finite coordinates".into(),
        ));
    }

    if left.orbital_count == 1 && right.orbital_count > 1 {
        let swapped = rm1_rotated_pair_integrals(
            right,
            left,
            right_position_angstrom,
            left_position_angstrom,
        )?;
        let mut transposed = [0.0; 256];
        for mu in 0..4 {
            for nu in 0..4 {
                for lambda in 0..4 {
                    for sigma in 0..4 {
                        transposed[index4(mu, nu, lambda, sigma)] =
                            swapped.repulsion_ev[index4(lambda, sigma, mu, nu)];
                    }
                }
            }
        }
        return Ok(Rm1RotatedPairIntegrals {
            repulsion_ev: transposed,
            left_core_attraction_ev: swapped.right_core_attraction_ev,
            right_core_attraction_ev: swapped.left_core_attraction_ev,
        });
    }

    let local = rm1_two_center_integrals(left, right, distance)?;
    let rotation = rotation_matrix([
        -delta[0] / distance,
        -delta[1] / distance,
        -delta[2] / distance,
    ]);
    let r0 = rotation[0];
    let r1 = rotation[1];
    let r2 = rotation[2];
    let mut result = Rm1RotatedPairIntegrals {
        repulsion_ev: [0.0; 256],
        left_core_attraction_ev: [0.0; 16],
        right_core_attraction_ev: [0.0; 16],
    };

    match local {
        Rm1TwoCenterIntegrals::HydrogenHydrogen { repulsion_ev, .. } => {
            result.repulsion_ev[index4(0, 0, 0, 0)] = repulsion_ev[0];
        }
        Rm1TwoCenterIntegrals::HeavyHydrogen { repulsion_ev, .. } => {
            result.repulsion_ev[index4(0, 0, 0, 0)] = repulsion_ev[0];
            for k in 0..3 {
                let value = repulsion_ev[1] * r0[k];
                result.repulsion_ev[index4(k + 1, 0, 0, 0)] = value;
                result.repulsion_ev[index4(0, k + 1, 0, 0)] = value;
                for l in 0..3 {
                    result.repulsion_ev[index4(k + 1, l + 1, 0, 0)] =
                        repulsion_ev[2] * r0[k] * r0[l]
                            + repulsion_ev[3] * (r1[k] * r1[l] + r2[k] * r2[l]);
                }
            }
        }
        Rm1TwoCenterIntegrals::HeavyHeavy { repulsion_ev, .. } => {
            rotate_heavy_heavy(&mut result.repulsion_ev, &repulsion_ev, r0, r1, r2);
        }
    }

    let left_valence = f64::from(left.valence_electrons);
    let right_valence = f64::from(right.valence_electrons);
    for mu in 0..usize::from(left.orbital_count) {
        for nu in 0..=mu {
            let value = -right_valence * result.repulsion_ev[index4(mu, nu, 0, 0)];
            result.left_core_attraction_ev[index2(mu, nu)] = value;
            result.left_core_attraction_ev[index2(nu, mu)] = value;
        }
    }
    for mu in 0..usize::from(right.orbital_count) {
        for nu in 0..=mu {
            let value = -left_valence * result.repulsion_ev[index4(0, 0, mu, nu)];
            result.right_core_attraction_ev[index2(mu, nu)] = value;
            result.right_core_attraction_ev[index2(nu, mu)] = value;
        }
    }
    Ok(result)
}

fn rotation_matrix(vector: [f64; 3]) -> [[f64; 3]; 3] {
    let [vx, vy, vz] = vector;
    let w = 1.0 + vx;
    if w.abs() < 1.0e-7 {
        return [[-1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]];
    }
    let norm = (vz * vz + vy * vy + w * w).sqrt();
    let qy = vz / norm;
    let qz = -vy / norm;
    let qw = w / norm;
    [
        [
            1.0 - 2.0 * (qy * qy + qz * qz),
            -2.0 * qz * qw,
            2.0 * qy * qw,
        ],
        [2.0 * qz * qw, 1.0 - 2.0 * qz * qz, 2.0 * qy * qz],
        [-2.0 * qy * qw, 2.0 * qy * qz, 1.0 - 2.0 * qy * qy],
    ]
}

fn rotate_heavy_heavy(
    output: &mut [f64; 256],
    ri: &[f64; 22],
    r0: [f64; 3],
    r1: [f64; 3],
    r2: [f64; 3],
) {
    for kk in 0_usize..4 {
        for ll in 0..=kk {
            for mm in 0_usize..4 {
                for nn in 0..=mm {
                    let k = kk.saturating_sub(1);
                    let l = ll.saturating_sub(1);
                    let m = mm.saturating_sub(1);
                    let n = nn.saturating_sub(1);
                    let value = if kk == 0 {
                        if mm == 0 {
                            ri[0]
                        } else if nn == 0 {
                            ri[4] * r0[m]
                        } else {
                            ri[10] * r0[m] * r0[n] + ri[11] * (r1[m] * r1[n] + r2[m] * r2[n])
                        }
                    } else if ll == 0 {
                        if mm == 0 {
                            ri[1] * r0[k]
                        } else if nn == 0 {
                            ri[5] * r0[k] * r0[m] + ri[6] * (r1[k] * r1[m] + r2[k] * r2[m])
                        } else {
                            let sigma = r0[k] * r0[m] * r0[n];
                            let pi = (r1[m] * r1[n] + r2[m] * r2[n]) * r0[k];
                            let mix = r1[k] * (r1[n] * r0[m] + r1[m] * r0[n])
                                + r2[k] * (r2[m] * r0[n] + r2[n] * r0[m]);
                            ri[12] * sigma + ri[13] * pi + ri[14] * mix
                        }
                    } else if mm == 0 {
                        ri[2] * r0[k] * r0[l] + ri[3] * (r1[k] * r1[l] + r2[k] * r2[l])
                    } else if nn == 0 {
                        let sigma = r0[k] * r0[l] * r0[m];
                        let pi = (r1[k] * r1[l] + r2[k] * r2[l]) * r0[m];
                        let mix_l = r1[l] * r1[m] + r2[l] * r2[m];
                        let mix_k = r1[k] * r1[m] + r2[k] * r2[m];
                        ri[7] * sigma + ri[8] * pi + ri[9] * (r0[k] * mix_l + r0[l] * mix_k)
                    } else {
                        let sigma = r0[k] * r0[l] * r0[m] * r0[n];
                        let left_pi = (r1[k] * r1[l] + r2[k] * r2[l]) * r0[m] * r0[n];
                        let right_pi = (r1[m] * r1[n] + r2[m] * r2[n]) * r0[k] * r0[l];
                        let pure_pi = r1[k] * r1[l] * r1[m] * r1[n] + r2[k] * r2[l] * r2[m] * r2[n];
                        let coupled = r0[k]
                            * (r0[m] * (r1[l] * r1[n] + r2[l] * r2[n])
                                + r0[n] * (r1[l] * r1[m] + r2[l] * r2[m]))
                            + r0[l]
                                * (r0[m] * (r1[k] * r1[n] + r2[k] * r2[n])
                                    + r0[n] * (r1[k] * r1[m] + r2[k] * r2[m]));
                        let cross_pi =
                            r1[k] * r1[l] * r2[m] * r2[n] + r2[k] * r2[l] * r1[m] * r1[n];
                        let exchange =
                            (r1[k] * r2[l] + r2[k] * r1[l]) * (r1[m] * r2[n] + r2[m] * r1[n]);
                        ri[15] * sigma
                            + ri[16] * left_pi
                            + ri[17] * right_pi
                            + ri[18] * pure_pi
                            + ri[19] * coupled
                            + ri[20] * cross_pi
                            + ri[21] * exchange
                    };
                    for (a, b, c, d) in [
                        (kk, ll, mm, nn),
                        (ll, kk, mm, nn),
                        (kk, ll, nn, mm),
                        (ll, kk, nn, mm),
                    ] {
                        output[index4(a, b, c, d)] = value;
                    }
                }
            }
        }
    }
}

const fn index4(mu: usize, nu: usize, lambda: usize, sigma: usize) -> usize {
    ((mu * 4 + nu) * 4 + lambda) * 4 + sigma
}

const fn index2(row: usize, column: usize) -> usize {
    row * 4 + column
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rm1_parameters;

    #[test]
    fn arbitrary_carbon_oxygen_rotation_matches_pinned_oracle() {
        let value = rm1_rotated_pair_integrals(
            rm1_parameters(6).unwrap(),
            rm1_parameters(8).unwrap(),
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 0.3],
        )
        .unwrap();
        let checks = [
            ((0, 0, 0, 0), 8.016_965_003_558_912),
            ((1, 0, 0, 0), 1.089_764_713_363_376),
            ((2, 0, 3, 0), -0.112_195_766_389_262),
            ((1, 1, 2, 2), 8.100_896_873_650_802),
            ((1, 2, 1, 3), 0.023_467_578_285_669),
            ((3, 3, 3, 3), 7.576_419_185_402_041),
        ];
        for ((a, b, c, d), expected) in checks {
            let actual = value.repulsion_ev[index4(a, b, c, d)];
            assert!(
                (actual - expected).abs() < 1.0e-12,
                "{a}{b}{c}{d}: {actual} != {expected}"
            );
        }
        assert!(
            (value.left_core_attraction_ev[index2(1, 2)] + 2.182_806_639_616_31).abs() < 1.0e-12
        );
        assert!(
            (value.right_core_attraction_ev[index2(1, 3)] + 0.244_949_175_134_616).abs() < 1.0e-12
        );
    }

    #[test]
    fn hydrogen_heavy_swap_transposes_the_pair_tensor() {
        let hydrogen = rm1_parameters(1).unwrap();
        let oxygen = rm1_parameters(8).unwrap();
        let forward =
            rm1_rotated_pair_integrals(oxygen, hydrogen, [0.0; 3], [0.8, 0.4, 0.2]).unwrap();
        let reverse =
            rm1_rotated_pair_integrals(hydrogen, oxygen, [0.8, 0.4, 0.2], [0.0; 3]).unwrap();
        for a in 0..4 {
            for b in 0..4 {
                for c in 0..4 {
                    for d in 0..4 {
                        assert!(
                            (forward.repulsion_ev[index4(a, b, c, d)]
                                - reverse.repulsion_ev[index4(c, d, a, b)])
                            .abs()
                                < 1.0e-14
                        );
                    }
                }
            }
        }
    }
}
