use super::{pm6_slater_condon_parameter, Pm6FullElementParameters, SemiempiricalError};

const HARTREE_TO_EV_MOPAC: f64 = 27.21;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pm6DMultipoleParameters {
    pub dp: f64,
    pub ds: f64,
    pub d_orbital: f64,
    pub rho3: f64,
    pub rho4: f64,
    pub rho5: f64,
    pub rho6: f64,
}

fn quantum_numbers(atomic_number: u8) -> Option<(usize, usize)> {
    let sp = match atomic_number {
        1..=2 => 1,
        3..=10 => 2,
        11..=18 => 3,
        19..=36 => 4,
        37..=54 => 5,
        _ => return None,
    };
    let d = match atomic_number {
        13..=30 => 3,
        31..=48 => 4,
        49..=54 => 5,
        _ => return None,
    };
    Some((sp, d))
}

fn is_transition_metal_category(atomic_number: u8) -> bool {
    matches!(atomic_number, 21..=29 | 39..=47 | 57 | 71..=79)
}

fn aijl(zeta_left: f64, zeta_right: f64, n_left: usize, n_right: usize, l: usize) -> f64 {
    if zeta_left <= 0.0 || zeta_right <= 0.0 {
        return 0.0;
    }
    let factorial = |value: usize| (2..=value).fold(1.0, |result, item| result * item as f64);
    let sum = zeta_left + zeta_right;
    factorial(n_left + n_right + l) / (factorial(2 * n_left) * factorial(2 * n_right)).sqrt()
        * (2.0 * zeta_left / sum).powi(n_left as i32)
        * (2.0 * zeta_left / sum).sqrt()
        * (2.0 * zeta_right / sum).powi(n_right as i32)
        * (2.0 * zeta_right / sum).sqrt()
        / sum.powi(l as i32)
}

fn poij(l: usize, separation: f64, target: f64) -> f64 {
    if target == 0.0 {
        return 0.0;
    }
    if l == 0 {
        return 0.5 * HARTREE_TO_EV_MOPAC / target;
    }
    let separation_squared = separation * separation;
    let objective = |rho: f64| {
        let value = match l {
            1 => {
                HARTREE_TO_EV_MOPAC / 4.0
                    * (1.0 / rho - 1.0 / (rho * rho + separation_squared).sqrt())
            }
            2 => {
                HARTREE_TO_EV_MOPAC / 8.0
                    * (1.0 / rho - 2.0 / (rho * rho + 0.5 * separation_squared).sqrt()
                        + 1.0 / (rho * rho + separation_squared).sqrt())
            }
            _ => return f64::INFINITY,
        };
        (value - target).powi(2)
    };
    let (mut lower, mut upper) = (0.1, 5.0);
    let (golden_lower, golden_upper) = (0.3820, 0.6180);
    let (mut lower_value, mut upper_value) = (0.0, 0.0);
    for _ in 0..100 {
        let width = upper - lower;
        if width < 1.0e-8 {
            return if lower_value >= upper_value {
                upper
            } else {
                lower
            };
        }
        let trial_lower = lower + width * golden_lower;
        let trial_upper = lower + width * golden_upper;
        lower_value = objective(trial_lower);
        upper_value = objective(trial_upper);
        if lower_value < upper_value {
            upper = trial_upper;
        } else {
            lower = trial_lower;
        }
    }
    if lower_value >= upper_value {
        upper
    } else {
        lower
    }
}

/// Derives the PM6 d-basis charge separations and additive terms used by TETCI.
pub fn pm6_d_multipole_parameters(
    parameters: &Pm6FullElementParameters,
) -> Result<Pm6DMultipoleParameters, SemiempiricalError> {
    if !parameters.has_d_orbitals() {
        return Err(SemiempiricalError::InvalidInput(format!(
            "PM6 d multipoles require a d-basis element, got {}",
            parameters.symbol
        )));
    }
    let (sp_n, d_n) = quantum_numbers(parameters.atomic_number).ok_or_else(|| {
        SemiempiricalError::InvalidInput(format!(
            "PM6 quantum numbers are unavailable for {}",
            parameters.symbol
        ))
    })?;
    let tail = |candidate: f64, main: f64| if candidate > 0.0 { candidate } else { main };
    let tail_s = tail(parameters.tail_s_bohr_inv, parameters.zeta_s_bohr_inv);
    let tail_p = tail(parameters.tail_p_bohr_inv, parameters.zeta_p_bohr_inv);
    let tail_d = tail(parameters.tail_d_bohr_inv, parameters.zeta_d_bohr_inv);
    let sc = |kind, orbitals| pm6_slater_condon_parameter(kind, orbitals);
    let s = (sp_n, tail_s);
    let p = (sp_n, tail_p);
    let d = (d_n, tail_d);
    let ds_add =
        if is_transition_metal_category(parameters.atomic_number) && parameters.g2sd_ev > 1.0e-9 {
            0.2 * parameters.g2sd_ev
        } else {
            0.2 * sc(2, [s, d, s, d])
        };
    let dp_add = 4.0 / 15.0 * sc(1, [p, d, p, d]);
    let dd_add = 4.0 / 49.0 * sc(2, [d, d, d, d]);
    let dd0_add = sc(0, [d, d, d, d]);
    let dd4 = sc(4, [d, d, d, d]);
    let dp3 = 27.0 / 245.0 * sc(3, [p, d, p, d]);

    let aij52 = aijl(
        parameters.zeta_p_bohr_inv,
        parameters.zeta_d_bohr_inv,
        sp_n,
        d_n,
        1,
    );
    let aij43 = aijl(
        parameters.zeta_s_bohr_inv,
        parameters.zeta_d_bohr_inv,
        sp_n,
        d_n,
        2,
    );
    let aij63 = aijl(
        parameters.zeta_d_bohr_inv,
        parameters.zeta_d_bohr_inv,
        d_n,
        d_n,
        2,
    );
    let dp = aij52 / 5.0_f64.sqrt();
    let ds = (aij43 * (1.0_f64 / 15.0).sqrt()).sqrt() * 2.0_f64.sqrt();
    let d_orbital = (2.0 * aij63 / 7.0).sqrt();

    let fg = dd0_add + dd_add + 4.0 / 49.0 * dd4;
    let fg1 = dd0_add + 0.5 * dd_add - 24.0 / 441.0 * dd4;
    let fg2 = dd0_add - dd_add + 6.0 / 441.0 * dd4;
    let rho3 = poij(0, 1.0, 0.2 * (fg + 2.0 * fg1 + 2.0 * fg2));
    let rho4 = poij(
        1,
        dp,
        dp_add + dp3 - 1.8 * (3.0 / 49.0 * 245.0 / 27.0 * dp3),
    );
    let rho5 = poij(2, ds, ds_add);
    let rho6 = poij(
        2,
        d_orbital,
        3.0 / 4.0 * dd_add + 20.0 / 441.0 * dd4 - 20.0 / 35.0 * (35.0 / 441.0 * dd4),
    );
    let result = Pm6DMultipoleParameters {
        dp,
        ds,
        d_orbital,
        rho3,
        rho4,
        rho5,
        rho6,
    };
    if [dp, ds, d_orbital, rho3, rho4, rho5, rho6]
        .into_iter()
        .any(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(SemiempiricalError::InvalidInput(format!(
            "PM6 d multipole derivation failed for {}",
            parameters.symbol
        )));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pm6_full_parameters;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 2.0e-10,
            "{actual} != {expected}"
        );
    }

    #[test]
    fn main_group_and_transition_metal_values_match_pyseqm() {
        let cases = [
            (
                16,
                [
                    0.498_616_280_922_821_95,
                    0.961_767_161_868_983_3,
                    0.643_210_701_996_944_1,
                    0.448_630_401_045_99,
                    1.892_167_475_183_265_3,
                    3.230_242_108_006_324,
                    0.488_811_256_541_658_25,
                ],
            ),
            (
                26,
                [
                    0.079_679_301_175_297_92,
                    2.372_532_077_570_125,
                    1.850_566_736_062_919,
                    0.895_943_077_003_220_4,
                    0.294_743_463_949_352_25,
                    1.695_822_427_930_184_3,
                    1.244_923_922_238_366_6,
                ],
            ),
            (
                53,
                [
                    1.296_342_474_633_778_6,
                    0.777_471_133_993_885_1,
                    1.637_499_377_026_119_5,
                    0.800_393_062_559_134_1,
                    1.200_977_629_355_478_6,
                    0.716_352_178_828_383_3,
                    1.065_836_824_149_381_4,
                ],
            ),
        ];
        for (atomic_number, expected) in cases {
            let actual =
                pm6_d_multipole_parameters(pm6_full_parameters(atomic_number).unwrap()).unwrap();
            for (actual, expected) in [
                actual.dp,
                actual.ds,
                actual.d_orbital,
                actual.rho3,
                actual.rho4,
                actual.rho5,
                actual.rho6,
            ]
            .into_iter()
            .zip(expected)
            {
                assert_close(actual, expected);
            }
        }
    }

    #[test]
    fn every_parameterized_d_element_has_finite_multipoles() {
        for atomic_number in 1..=53 {
            let Some(parameters) = pm6_full_parameters(atomic_number) else {
                continue;
            };
            if parameters.has_d_orbitals() {
                pm6_d_multipole_parameters(parameters).unwrap();
            } else {
                assert!(pm6_d_multipole_parameters(parameters).is_err());
            }
        }
    }
}
