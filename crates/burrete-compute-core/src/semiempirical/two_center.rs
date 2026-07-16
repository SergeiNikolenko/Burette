// Equations adapted from LANL PYSEQM at commit
// 6ced9ea66160428e06d37df18e9f565b8123f84a, BSD-3-Clause.
// Source: seqm/seqm_functions/cal_par.py.
// License: compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt.

use super::{SemiempiricalElementParameters, SemiempiricalError};

const HARTREE_TO_EV_MOPAC: f64 = 27.21;
const ANGSTROM_TO_BOHR_MOPAC: f64 = 1.0 / 0.529_167;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rm1MultipoleParameters {
    pub dipole_separation_bohr: f64,
    pub quadrupole_separation_bohr: f64,
    pub rho_monopole_bohr: f64,
    pub rho_dipole_bohr: f64,
    pub rho_quadrupole_bohr: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Rm1TwoCenterIntegrals {
    HydrogenHydrogen {
        repulsion_ev: [f64; 1],
        core_attraction_ev: [f64; 2],
    },
    HeavyHydrogen {
        heavy_is_left: bool,
        repulsion_ev: [f64; 4],
        /// Four heavy-orbital attractions followed by the hydrogen attraction.
        core_attraction_ev: [f64; 5],
    },
}

pub fn rm1_two_center_integrals(
    left: &SemiempiricalElementParameters,
    right: &SemiempiricalElementParameters,
    distance_angstrom: f64,
) -> Result<Rm1TwoCenterIntegrals, SemiempiricalError> {
    if !distance_angstrom.is_finite() || distance_angstrom <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "two-center distance must be finite and positive".into(),
        ));
    }
    let left_is_hydrogen = left.orbital_count == 1;
    let right_is_hydrogen = right.orbital_count == 1;
    if !left_is_hydrogen && !right_is_hydrogen {
        return Err(SemiempiricalError::InvalidInput(
            "heavy-heavy RM1 two-center integrals are not implemented yet".into(),
        ));
    }

    let distance = distance_angstrom * ANGSTROM_TO_BOHR_MOPAC;
    let left_multipole = rm1_multipole_parameters(left);
    let right_multipole = rm1_multipole_parameters(right);
    let monopole_width =
        (left_multipole.rho_monopole_bohr + right_multipole.rho_monopole_bohr).powi(2);
    let ss_ss = HARTREE_TO_EV_MOPAC / (distance.powi(2) + monopole_width).sqrt();

    if left_is_hydrogen && right_is_hydrogen {
        return Ok(Rm1TwoCenterIntegrals::HydrogenHydrogen {
            repulsion_ev: [ss_ss],
            core_attraction_ev: [
                f64::from(right.valence_electrons) * ss_ss,
                f64::from(left.valence_electrons) * ss_ss,
            ],
        });
    }

    let (heavy, hydrogen, heavy_multipole, hydrogen_multipole, heavy_is_left) = if left_is_hydrogen
    {
        (right, left, right_multipole, left_multipole, false)
    } else {
        (left, right, left_multipole, right_multipole, true)
    };
    let dipole = heavy_multipole.dipole_separation_bohr;
    let quadrupole = 2.0 * heavy_multipole.quadrupole_separation_bohr;
    let dipole_width =
        (heavy_multipole.rho_dipole_bohr + hydrogen_multipole.rho_monopole_bohr).powi(2);
    let quadrupole_width =
        (heavy_multipole.rho_quadrupole_bohr + hydrogen_multipole.rho_monopole_bohr).powi(2);
    let half_ev = HARTREE_TO_EV_MOPAC / 2.0;
    let quarter_ev = HARTREE_TO_EV_MOPAC / 4.0;
    let half_center_quadrupole = half_ev / (distance.powi(2) + quadrupole_width).sqrt();
    let s_sigma_ss = half_ev / ((distance + dipole).powi(2) + dipole_width).sqrt()
        - half_ev / ((distance - dipole).powi(2) + dipole_width).sqrt();
    let sigma_sigma_ss = ss_ss
        + quarter_ev / ((distance + quadrupole).powi(2) + quadrupole_width).sqrt()
        + quarter_ev / ((distance - quadrupole).powi(2) + quadrupole_width).sqrt()
        - half_center_quadrupole;
    let pi_pi_ss = ss_ss
        + half_ev / (distance.powi(2) + quadrupole.powi(2) + quadrupole_width).sqrt()
        - half_center_quadrupole;
    let repulsion_ev = [ss_ss, s_sigma_ss, sigma_sigma_ss, pi_pi_ss];
    let hydrogen_valence = f64::from(hydrogen.valence_electrons);
    Ok(Rm1TwoCenterIntegrals::HeavyHydrogen {
        heavy_is_left,
        repulsion_ev,
        core_attraction_ev: [
            hydrogen_valence * ss_ss,
            hydrogen_valence * s_sigma_ss,
            hydrogen_valence * sigma_sigma_ss,
            hydrogen_valence * pi_pi_ss,
            f64::from(heavy.valence_electrons) * ss_ss,
        ],
    })
}

pub fn rm1_multipole_parameters(
    parameters: &SemiempiricalElementParameters,
) -> Rm1MultipoleParameters {
    let rho_monopole_bohr = 0.5 * HARTREE_TO_EV_MOPAC / parameters.gss_ev;
    if parameters.orbital_count == 1 {
        return Rm1MultipoleParameters {
            dipole_separation_bohr: 0.0,
            quadrupole_separation_bohr: 0.0,
            rho_monopole_bohr,
            rho_dipole_bohr: 0.0,
            rho_quadrupole_bohr: 0.0,
        };
    }

    let principal = f64::from(principal_quantum_number(parameters.atomic_number));
    let zeta_s = parameters.zeta_s_bohr_inv;
    let zeta_p = parameters.zeta_p_bohr_inv;
    let dipole_separation_bohr = (2.0 * principal + 1.0)
        * (4.0 * zeta_s * zeta_p).powf(principal + 0.5)
        / (zeta_s + zeta_p).powf(2.0 * principal + 2.0)
        / 3.0_f64.sqrt();
    let quadrupole_separation_bohr =
        ((4.0 * principal.powi(2) + 6.0 * principal + 2.0) / 20.0).sqrt() / zeta_p;

    let hsp_atomic = parameters.hsp_ev / HARTREE_TO_EV_MOPAC;
    let mut d1 = (hsp_atomic / dipole_separation_bohr.powi(2)).abs().cbrt();
    if hsp_atomic < 0.0 {
        d1 = -d1;
    }
    let mut d2 = d1 + 0.04;
    for _ in 0..5 {
        let value1 = dipole_additive_equation(d1, dipole_separation_bohr);
        let value2 = dipole_additive_equation(d2, dipole_separation_bohr);
        let next = if (value2 - value1).abs() > 1.0e-16 {
            d1 + (d2 - d1) * (hsp_atomic - value1) / (value2 - value1)
        } else {
            d2
        };
        d1 = d2;
        d2 = next;
    }

    let hpp_atomic = (0.5 * (parameters.gpp_ev - parameters.gp2_ev)).max(0.1) / HARTREE_TO_EV_MOPAC;
    let mut q1 = (hpp_atomic / 3.0 / quadrupole_separation_bohr.powi(4))
        .abs()
        .powf(0.2);
    if hpp_atomic < 0.0 {
        q1 = -q1;
    }
    let mut q2 = q1 + 0.04;
    for _ in 0..5 {
        let value1 = quadrupole_additive_equation(q1, quadrupole_separation_bohr);
        let value2 = quadrupole_additive_equation(q2, quadrupole_separation_bohr);
        let next = if (value2 - value1).abs() > 1.0e-16 {
            q1 + (q2 - q1) * (hpp_atomic - value1) / (value2 - value1)
        } else {
            q2
        };
        q1 = q2;
        q2 = next;
    }

    Rm1MultipoleParameters {
        dipole_separation_bohr,
        quadrupole_separation_bohr,
        rho_monopole_bohr,
        rho_dipole_bohr: 0.5 / d2,
        rho_quadrupole_bohr: 0.5 / q2,
    }
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

fn dipole_additive_equation(value: f64, separation: f64) -> f64 {
    0.5 * value - 0.5 / (4.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
}

fn quadrupole_additive_equation(value: f64, separation: f64) -> f64 {
    0.25 * value - 0.5 / (4.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
        + 0.25 / (8.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rm1_parameters;

    #[test]
    fn multipoles_match_pinned_mlxmolkit_and_pyseqm_known_answers() {
        let expected = [
            (
                6,
                [
                    0.796_757_126_213_299_6,
                    0.692_611_122_570_592_4,
                    1.042_279_195_623_08,
                    0.980_869_909_963_535,
                    0.755_873_551_427_546,
                ],
            ),
            (
                17,
                [
                    0.454_178_842_946_722_9,
                    0.882_584_703_786_303_2,
                    0.885_728_866_968_212,
                    0.667_580_134_293_912,
                    0.648_733_973_254_944,
                ],
            ),
            (
                53,
                [
                    1.296_342_507_678_347,
                    1.108_596_336_068_293,
                    0.680_258_799_147_567,
                    1.345_021_582_756_928,
                    1.423_407_690_127_551,
                ],
            ),
        ];
        for (atomic_number, reference) in expected {
            let value = rm1_multipole_parameters(rm1_parameters(atomic_number).unwrap());
            let actual = [
                value.dipole_separation_bohr,
                value.quadrupole_separation_bohr,
                value.rho_monopole_bohr,
                value.rho_dipole_bohr,
                value.rho_quadrupole_bohr,
            ];
            for (actual, expected) in actual.into_iter().zip(reference) {
                assert!(
                    (actual - expected).abs() < 1.0e-14,
                    "Z={atomic_number}: {actual} != {expected}"
                );
            }
        }
    }

    #[test]
    fn hydrogen_only_has_a_monopole() {
        let value = rm1_multipole_parameters(rm1_parameters(1).unwrap());
        assert_eq!(value.dipole_separation_bohr, 0.0);
        assert_eq!(value.quadrupole_separation_bohr, 0.0);
        assert!((value.rho_monopole_bohr - 0.972_952_353_654_342_6).abs() < 1.0e-15);
    }

    #[test]
    fn hydrogen_and_oxygen_hydrogen_integrals_match_pinned_oracle() {
        let hydrogen = rm1_parameters(1).unwrap();
        let hh = rm1_two_center_integrals(hydrogen, hydrogen, 0.74).unwrap();
        let Rm1TwoCenterIntegrals::HydrogenHydrogen {
            repulsion_ev,
            core_attraction_ev,
        } = hh
        else {
            panic!()
        };
        assert!((repulsion_ev[0] - 11.355_122_297_598_033).abs() < 1.0e-13);
        assert_eq!(repulsion_ev[0], core_attraction_ev[0]);

        let oxygen = rm1_parameters(8).unwrap();
        let oh = rm1_two_center_integrals(oxygen, hydrogen, 0.96).unwrap();
        let Rm1TwoCenterIntegrals::HeavyHydrogen {
            heavy_is_left,
            repulsion_ev,
            core_attraction_ev,
        } = oh
        else {
            panic!()
        };
        assert!(heavy_is_left);
        let expected = [
            10.231_513_433_365_237,
            -1.894_135_654_814_345_3,
            10.526_655_711_091_749,
            9.814_220_437_401_776,
        ];
        for (actual, expected) in repulsion_ev.into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1.0e-13);
        }
        assert!((core_attraction_ev[4] - 61.389_080_600_191_42).abs() < 1.0e-12);
    }

    #[test]
    fn hydrogen_heavy_order_is_explicit_and_invalid_distances_fail() {
        let hydrogen = rm1_parameters(1).unwrap();
        let carbon = rm1_parameters(6).unwrap();
        let value = rm1_two_center_integrals(hydrogen, carbon, 1.09).unwrap();
        assert!(matches!(
            value,
            Rm1TwoCenterIntegrals::HeavyHydrogen {
                heavy_is_left: false,
                ..
            }
        ));
        assert!(rm1_two_center_integrals(hydrogen, carbon, 0.0).is_err());
    }
}
