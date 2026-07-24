use super::{Pm6FullElementParameters, SemiempiricalError};

const HARTREE_TO_EV_MOPAC: f64 = 27.21;

include!("pm6_w_maps.generated.rs");

fn factorial(value: usize) -> f64 {
    (2..=value).fold(1.0, |result, factor| result * factor as f64)
}

fn binomial(total: isize, selected: isize) -> f64 {
    if total < 0 || selected < 0 || selected > total {
        return 0.0;
    }
    let total = total as usize;
    let selected = selected as usize;
    factorial(total) / (factorial(selected) * factorial(total - selected))
}

pub fn pm6_slater_condon_parameter(kind: usize, orbitals: [(usize, f64); 4]) -> f64 {
    let [(left_n, left_exponent), (right_n, right_exponent), (other_left_n, other_left_exponent), (other_right_n, other_right_exponent)] =
        orbitals;
    if [
        left_exponent,
        right_exponent,
        other_left_exponent,
        other_right_exponent,
    ]
    .into_iter()
    .any(|value| !value.is_finite() || value <= 0.0)
    {
        return 0.0;
    }
    let nab = left_n + right_n;
    let ncd = other_left_n + other_right_n;
    let eab = left_exponent + right_exponent;
    let ecd = other_left_exponent + other_right_exponent;
    let exponent_sum = eab + ecd;
    let n = nab + ncd;
    let coefficient = (factorial(n - 1).ln()
        + left_n as f64 * left_exponent.ln()
        + right_n as f64 * right_exponent.ln()
        + other_left_n as f64 * other_left_exponent.ln()
        + other_right_n as f64 * other_right_exponent.ln()
        + 0.5
            * (left_exponent.ln()
                + right_exponent.ln()
                + other_left_exponent.ln()
                + other_right_exponent.ln())
        + (n + 2) as f64 * 2.0_f64.ln()
        - 0.5
            * (factorial(2 * left_n).ln()
                + factorial(2 * right_n).ln()
                + factorial(2 * other_left_n).ln()
                + factorial(2 * other_right_n).ln())
        - n as f64 * exponent_sum.ln())
    .exp()
        * HARTREE_TO_EV_MOPAC;

    let mut s0 = 1.0 / exponent_sum;
    let mut s1 = 0.0;
    let mut s2 = 0.0;
    let first_limit = ncd as isize - kind as isize;
    for index in 1..=first_limit.max(0) {
        s0 *= exponent_sum / ecd;
        s1 += s0
            * (binomial(first_limit - 1, index - 1) - binomial((ncd + kind) as isize, index - 1))
            / binomial((n - 1) as isize, index - 1);
    }
    let second_limit = ncd + kind + 1;
    for index in (first_limit.max(0) as usize + 1)..=second_limit {
        s0 *= exponent_sum / ecd;
        s2 += s0 * binomial((second_limit - 1) as isize, (index - 1) as isize)
            / binomial((n - 1) as isize, (index - 1) as isize);
    }
    let s3 = (n as f64 * exponent_sum.ln()
        - second_limit as f64 * ecd.ln()
        - (nab - kind) as f64 * eab.ln())
    .exp()
        / binomial((n - 1) as isize, (second_limit - 1) as isize);
    coefficient * (s1 - s2 + s3)
}

fn principal_quantum_numbers(atomic_number: u8) -> Option<(usize, usize)> {
    let sp = match atomic_number {
        1..=2 => 1,
        3..=10 => 2,
        11..=18 => 3,
        19..=36 => 4,
        37..=53 => 5,
        _ => return None,
    };
    let d = match atomic_number {
        13..=30 => 3,
        31..=48 => 4,
        49..=53 => 5,
        _ => return None,
    };
    Some((sp, d))
}

pub fn pm6_one_center_w_integrals(
    parameters: &Pm6FullElementParameters,
) -> Result<[f64; 243], SemiempiricalError> {
    if !parameters.has_d_orbitals() {
        return Err(SemiempiricalError::InvalidInput(format!(
            "PM6 W integrals require a d-basis element, got {}",
            parameters.symbol
        )));
    }
    let (qn_sp, qn_d) = principal_quantum_numbers(parameters.atomic_number).ok_or_else(|| {
        SemiempiricalError::InvalidInput(format!(
            "PM6 quantum numbers are unavailable for {}",
            parameters.symbol
        ))
    })?;
    let zeta_s = if parameters.tail_s_bohr_inv > 0.0 {
        parameters.tail_s_bohr_inv
    } else {
        parameters.zeta_s_bohr_inv
    };
    let zeta_p = if parameters.tail_p_bohr_inv > 0.0 {
        parameters.tail_p_bohr_inv
    } else {
        parameters.zeta_p_bohr_inv
    };
    let zeta_d = if parameters.tail_d_bohr_inv > 0.0 {
        parameters.tail_d_bohr_inv
    } else {
        parameters.zeta_d_bohr_inv
    };
    compute_w_integrals(
        zeta_s,
        zeta_p,
        zeta_d,
        qn_sp,
        qn_d,
        parameters.f0sd_ev,
        parameters.g2sd_ev,
    )
}

fn compute_w_integrals(
    zeta_s: f64,
    zeta_p: f64,
    zeta_d: f64,
    qn_sp: usize,
    qn_d: usize,
    f0sd: f64,
    g2sd: f64,
) -> Result<[f64; 243], SemiempiricalError> {
    if [zeta_s, zeta_p, zeta_d]
        .into_iter()
        .any(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 W integrals require positive finite Slater exponents".into(),
        ));
    }
    let sc = |kind, orbitals| pm6_slater_condon_parameter(kind, orbitals);
    let sp_s = (qn_sp, zeta_s);
    let sp_p = (qn_sp, zeta_p);
    let d = (qn_d, zeta_d);
    let mut r016 = sc(0, [sp_s, sp_s, d, d]);
    let r066 = sc(0, [d, d, d, d]);
    let mut r244 = sc(2, [sp_s, d, sp_s, d]);
    let r246 = sc(2, [sp_s, d, d, d]);
    let r466 = sc(4, [d, d, d, d]);
    let r266 = sc(2, [d, d, d, d]);
    let r036 = sc(0, [sp_p, sp_p, d, d]);
    let r155 = sc(1, [sp_p, d, sp_p, d]);
    let r125 = sc(1, [sp_s, sp_p, sp_p, d]);
    let r236 = sc(2, [sp_p, sp_p, d, d]);
    let r234 = sc(2, [sp_p, sp_p, sp_s, d]);
    let r355 = sc(3, [sp_p, d, sp_p, d]);
    if f0sd.abs() > 1.0e-9 {
        r016 = f0sd;
    }
    if g2sd.abs() > 1.0e-9 {
        r244 = g2sd;
    }
    let (s3, s5, s15) = (3.0_f64.sqrt(), 5.0_f64.sqrt(), 15.0_f64.sqrt());
    let mut integral = [0.0; 52];
    integral[0] = r016;
    integral[1] = 2.0 / (3.0 * s5) * r125;
    integral[2] = r125 / s15;
    integral[3] = 2.0 / (5.0 * s5) * r234;
    integral[4] = r036 + 4.0 / 35.0 * r236;
    integral[5] = r036 + 2.0 / 35.0 * r236;
    integral[6] = r036 - 4.0 / 35.0 * r236;
    integral[7] = -r125 / (3.0 * s5);
    integral[8] = (3.0_f64 / 125.0).sqrt() * r234;
    integral[9] = s3 / 35.0 * r236;
    integral[10] = 3.0 / 35.0 * r236;
    integral[11] = -0.2 / s5 * r234;
    integral[12] = r036 - 2.0 / 35.0 * r236;
    integral[13] = -2.0 * s3 / 35.0 * r236;
    integral[14] = -integral[2];
    integral[15] = -integral[10];
    integral[16] = -integral[8];
    integral[17] = -integral[13];
    integral[18] = 0.2 * r244;
    integral[19] = 2.0 / (7.0 * s5) * r246;
    integral[20] = integral[19] * 0.5;
    integral[21] = -integral[19];
    integral[22] = 4.0 / 15.0 * r155 + 27.0 / 245.0 * r355;
    integral[23] = 2.0 * s3 / 15.0 * r155 - 9.0 * s3 / 245.0 * r355;
    integral[24] = r155 / 15.0 + 18.0 / 245.0 * r355;
    integral[25] = -s3 / 15.0 * r155 + 12.0 * s3 / 245.0 * r355;
    integral[26] = -s3 / 15.0 * r155 - 3.0 * s3 / 245.0 * r355;
    integral[27] = -integral[26];
    integral[28] = r066 + 4.0 / 49.0 * r266 + 4.0 / 49.0 * r466;
    integral[29] = r066 + 2.0 / 49.0 * r266 - 24.0 / 441.0 * r466;
    integral[30] = r066 - 4.0 / 49.0 * r266 + 6.0 / 441.0 * r466;
    integral[31] = (3.0_f64 / 245.0).sqrt() * r246;
    integral[32] = 0.2 * r155 + 24.0 / 245.0 * r355;
    integral[33] = 0.2 * r155 - 6.0 / 245.0 * r355;
    integral[34] = 3.0 / 49.0 * r355;
    integral[35] = r266 / 49.0 + 30.0 / 441.0 * r466;
    integral[36] = s3 / 49.0 * r266 - 5.0 * s3 / 441.0 * r466;
    integral[37] = r066 - 2.0 / 49.0 * r266 - 4.0 / 441.0 * r466;
    integral[38] = -2.0 * s3 / 49.0 * r266 + 10.0 * s3 / 441.0 * r466;
    integral[39] = -integral[31];
    integral[40] = -integral[33];
    integral[41] = -integral[34];
    integral[42] = -integral[36];
    integral[43] = 3.0 / 49.0 * r266 + 20.0 / 441.0 * r466;
    integral[44] = -integral[38];
    integral[45] = 0.2 * r155 - 3.0 / 35.0 * r355;
    integral[46] = -integral[45];
    integral[47] = 4.0 / 49.0 * r266 + 15.0 / 441.0 * r466;
    integral[48] = 3.0 / 49.0 * r266 - 5.0 / 147.0 * r466;
    integral[49] = -integral[48];
    integral[50] = r066 + 4.0 / 49.0 * r266 - 34.0 / 441.0 * r466;
    integral[51] = 35.0 / 441.0 * r466;

    let mut result = [0.0; 243];
    for index in 0..243 {
        let lookup =
            |table_index: u8| (table_index > 0).then(|| integral[usize::from(table_index - 1)]);
        result[index] = lookup(INT_REP[index]).unwrap_or(0.0)
            - 0.25 * lookup(INT_RF1[index]).unwrap_or(0.0)
            - 0.25 * lookup(INT_RF2[index]).unwrap_or(0.0);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pm6_full_parameters;

    #[test]
    fn sulfur_w_integrals_match_the_pinned_upstream_oracle() {
        let values = pm6_one_center_w_integrals(pm6_full_parameters(16).unwrap()).unwrap();
        for (index, expected) in [
            (0, 4.349_991_689_934_826),
            (18, -0.030_383_047_097_611_738),
            (40, -0.082_524_436_177_414_35),
            (100, 0.781_222_344_405_534_4),
            (218, -7.085_449_929_715_576),
            (242, 16.242_322_742_325_82),
        ] {
            assert!((values[index] - expected).abs() < 1.0e-12);
        }
        assert!((values.iter().sum::<f64>() - 879.067_125_046_385_4).abs() < 1.0e-10);
    }

    #[test]
    fn transition_metal_overrides_and_invalid_domains_are_explicit() {
        let values = pm6_one_center_w_integrals(pm6_full_parameters(26).unwrap()).unwrap();
        assert!((values[0] - 9.140_025).abs() < 1.0e-12);
        assert!((values[218] + 3.547_935_494_063_093_4).abs() < 1.0e-12);
        assert!(pm6_one_center_w_integrals(pm6_full_parameters(6).unwrap()).is_err());
    }
}
