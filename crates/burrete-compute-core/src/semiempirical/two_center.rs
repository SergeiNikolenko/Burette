// Equations adapted from LANL PYSEQM at commit
// 6ced9ea66160428e06d37df18e9f565b8123f84a, BSD-3-Clause.
// Source: seqm/seqm_functions/cal_par.py.
// License: compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt.

use super::SemiempiricalElementParameters;

const HARTREE_TO_EV_MOPAC: f64 = 27.21;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rm1MultipoleParameters {
    pub dipole_separation_bohr: f64,
    pub quadrupole_separation_bohr: f64,
    pub rho_monopole_bohr: f64,
    pub rho_dipole_bohr: f64,
    pub rho_quadrupole_bohr: f64,
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
}
