use super::{overlap::reduced_sto_overlap, Pm6FullElementParameters, SemiempiricalError};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pm6LocalDOverlap {
    pub ds_sigma: f64,
    pub dp_sigma: f64,
    pub dp_pi: f64,
    pub dd_sigma: f64,
    pub dd_pi: f64,
    pub dd_delta: f64,
}

fn sp_quantum_number(atomic_number: u8) -> Option<u8> {
    Some(match atomic_number {
        1..=2 => 1,
        3..=10 => 2,
        11..=18 => 3,
        19..=36 => 4,
        37..=54 => 5,
        _ => return None,
    })
}

fn d_quantum_number(atomic_number: u8) -> Option<u8> {
    Some(match atomic_number {
        13..=30 => 3,
        31..=48 => 4,
        49..=54 => 5,
        _ => return None,
    })
}

/// Local bond-frame d-to-s/p/d STO overlaps for the complete PM6 basis domain.
pub fn pm6_local_d_overlap(
    left: &Pm6FullElementParameters,
    right: &Pm6FullElementParameters,
    distance_bohr: f64,
) -> Result<Pm6LocalDOverlap, SemiempiricalError> {
    if !left.has_d_orbitals() || !distance_bohr.is_finite() || distance_bohr <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 local d overlap requires a d-basis left atom and positive finite distance".into(),
        ));
    }
    let left_d_n = d_quantum_number(left.atomic_number).ok_or_else(|| {
        SemiempiricalError::InvalidInput("PM6 d-shell quantum number is unavailable".into())
    })?;
    let right_sp_n = sp_quantum_number(right.atomic_number).ok_or_else(|| {
        SemiempiricalError::InvalidInput("PM6 sp-shell quantum number is unavailable".into())
    })?;
    let reduced = |right_l, magnetic, right_zeta| {
        reduced_sto_overlap(
            left_d_n,
            2,
            right_sp_n,
            right_l,
            magnetic,
            left.zeta_d_bohr_inv,
            right_zeta,
            distance_bohr,
        )
    };
    let (dd_sigma, dd_pi, dd_delta) = if right.has_d_orbitals() {
        let right_d_n = d_quantum_number(right.atomic_number).unwrap();
        (
            reduced_sto_overlap(
                left_d_n,
                2,
                right_d_n,
                2,
                0,
                left.zeta_d_bohr_inv,
                right.zeta_d_bohr_inv,
                distance_bohr,
            ),
            reduced_sto_overlap(
                left_d_n,
                2,
                right_d_n,
                2,
                1,
                left.zeta_d_bohr_inv,
                right.zeta_d_bohr_inv,
                distance_bohr,
            ),
            reduced_sto_overlap(
                left_d_n,
                2,
                right_d_n,
                2,
                2,
                left.zeta_d_bohr_inv,
                right.zeta_d_bohr_inv,
                distance_bohr,
            ),
        )
    } else {
        (0.0, 0.0, 0.0)
    };
    let (dp_sigma, dp_pi) = if right.orbital_count > 1 {
        (
            reduced(1, 0, right.zeta_p_bohr_inv),
            reduced(1, 1, right.zeta_p_bohr_inv),
        )
    } else {
        (0.0, 0.0)
    };
    Ok(Pm6LocalDOverlap {
        ds_sigma: reduced(0, 0, right.zeta_s_bohr_inv),
        dp_sigma,
        dp_pi,
        dd_sigma,
        dd_pi,
        dd_delta,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pm6_full_parameters;

    #[test]
    fn sulfur_oxygen_and_sulfur_chlorine_match_high_order_oracles() {
        let sulfur = pm6_full_parameters(16).unwrap();
        let oxygen = pm6_full_parameters(8).unwrap();
        let so = pm6_local_d_overlap(sulfur, oxygen, 3.2).unwrap();
        assert!((so.ds_sigma - 0.019_294_431_719_008_194).abs() < 2.0e-10);
        assert!((so.dp_sigma - 0.113_630_408_414_487_5).abs() < 2.0e-10);
        assert!((so.dp_pi - 0.047_286_113_174_711_57).abs() < 2.0e-10);

        let chlorine = pm6_full_parameters(17).unwrap();
        let scl = pm6_local_d_overlap(sulfur, chlorine, 4.1).unwrap();
        assert!((scl.dd_sigma - 0.075_095_862_180_970_35).abs() < 2.0e-10);
        assert!((scl.dd_pi - 0.088_387_484_022_441_79).abs() < 2.0e-10);
        assert!((scl.dd_delta - 0.024_446_753_327_218_955).abs() < 2.0e-10);
    }

    #[test]
    fn iodine_uses_the_general_qn5_path() {
        let iodine = pm6_full_parameters(53).unwrap();
        let carbon = pm6_full_parameters(6).unwrap();
        let overlap = pm6_local_d_overlap(iodine, carbon, 4.0).unwrap();
        assert!((overlap.ds_sigma - 0.365_534_561_631_211_73).abs() < 2.0e-10);
        assert!((overlap.dp_sigma - 0.241_112_315_851_794_96).abs() < 2.0e-10);
        assert!((overlap.dp_pi - 0.248_239_072_800_587_3).abs() < 2.0e-10);
        assert!(pm6_local_d_overlap(carbon, iodine, 4.0).is_err());
    }

    #[test]
    fn hydrogen_has_only_the_d_to_s_channel() {
        let sulfur = pm6_full_parameters(16).unwrap();
        let hydrogen = pm6_full_parameters(1).unwrap();
        let overlap = pm6_local_d_overlap(sulfur, hydrogen, 2.6).unwrap();
        assert!(overlap.ds_sigma.is_finite());
        assert_eq!(overlap.dp_sigma, 0.0);
        assert_eq!(overlap.dp_pi, 0.0);
        assert_eq!(overlap.dd_sigma, 0.0);
        assert_eq!(overlap.dd_pi, 0.0);
        assert_eq!(overlap.dd_delta, 0.0);
    }
}
