use super::SemiempiricalError;

fn validate_rotation(rotation: &[f64; 9]) -> Result<(), SemiempiricalError> {
    if rotation.iter().any(|value| !value.is_finite()) {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 d rotation must be finite".into(),
        ));
    }
    for left in 0..3 {
        for right in 0..3 {
            let dot = (0..3)
                .map(|axis| rotation[left * 3 + axis] * rotation[right * 3 + axis])
                .sum::<f64>();
            let expected = if left == right { 1.0 } else { 0.0 };
            if (dot - expected).abs() > 1.0e-8 {
                return Err(SemiempiricalError::InvalidInput(
                    "PM6 d rotation must be orthogonal".into(),
                ));
            }
        }
    }
    let determinant = rotation[0] * (rotation[4] * rotation[8] - rotation[5] * rotation[7])
        - rotation[1] * (rotation[3] * rotation[8] - rotation[5] * rotation[6])
        + rotation[2] * (rotation[3] * rotation[7] - rotation[4] * rotation[6]);
    if (determinant - 1.0).abs() > 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 d rotation must be proper".into(),
        ));
    }
    Ok(())
}

/// Real-spherical-harmonic l=2 rotation in `[dz2, dxz, dyz, dx2-y2, dxy]` order.
pub fn pm6_wigner_d_matrix(rotation: &[f64; 9]) -> Result<[f64; 25], SemiempiricalError> {
    validate_rotation(rotation)?;
    let r = |row: usize, column: usize| rotation[row * 3 + column];
    let mut d = [0.0; 25];
    let mut set = |row: usize, column: usize, value: f64| d[row * 5 + column] = value;
    let sqrt3 = 3.0_f64.sqrt();
    set(0, 0, (3.0 * r(2, 2).powi(2) - 1.0) * 0.5);
    set(0, 1, sqrt3 * r(0, 2) * r(2, 2));
    set(0, 2, sqrt3 * r(1, 2) * r(2, 2));
    set(0, 3, sqrt3 * 0.5 * (r(0, 2).powi(2) - r(1, 2).powi(2)));
    set(0, 4, sqrt3 * r(0, 2) * r(1, 2));
    set(1, 0, sqrt3 * r(2, 0) * r(2, 2));
    set(1, 1, r(0, 0) * r(2, 2) + r(2, 0) * r(0, 2));
    set(1, 2, r(1, 0) * r(2, 2) + r(2, 0) * r(1, 2));
    set(1, 3, r(0, 0) * r(0, 2) - r(1, 0) * r(1, 2));
    set(1, 4, r(0, 0) * r(1, 2) + r(1, 0) * r(0, 2));
    set(2, 0, sqrt3 * r(2, 1) * r(2, 2));
    set(2, 1, r(0, 1) * r(2, 2) + r(2, 1) * r(0, 2));
    set(2, 2, r(1, 1) * r(2, 2) + r(2, 1) * r(1, 2));
    set(2, 3, r(0, 1) * r(0, 2) - r(1, 1) * r(1, 2));
    set(2, 4, r(0, 1) * r(1, 2) + r(1, 1) * r(0, 2));
    set(3, 0, sqrt3 * 0.5 * (r(2, 0).powi(2) - r(2, 1).powi(2)));
    set(3, 1, r(0, 0) * r(2, 0) - r(0, 1) * r(2, 1));
    set(3, 2, r(1, 0) * r(2, 0) - r(1, 1) * r(2, 1));
    set(
        3,
        3,
        (r(0, 0).powi(2) - r(0, 1).powi(2) - r(1, 0).powi(2) + r(1, 1).powi(2)) * 0.5,
    );
    set(3, 4, r(0, 0) * r(1, 0) - r(0, 1) * r(1, 1));
    set(4, 0, sqrt3 * r(2, 0) * r(2, 1));
    set(4, 1, r(0, 0) * r(2, 1) + r(0, 1) * r(2, 0));
    set(4, 2, r(1, 0) * r(2, 1) + r(1, 1) * r(2, 0));
    set(4, 3, r(0, 0) * r(0, 1) - r(1, 0) * r(1, 1));
    set(4, 4, r(0, 0) * r(1, 1) + r(0, 1) * r(1, 0));
    Ok(d)
}

pub fn pm6_rotate_dd_overlap(
    local: [f64; 3],
    rotation: &[f64; 9],
) -> Result<[f64; 25], SemiempiricalError> {
    let d = pm6_wigner_d_matrix(rotation)?;
    let diagonal = [local[0], local[1], local[1], local[2], local[2]];
    Ok(std::array::from_fn(|index| {
        let row = index / 5;
        let column = index % 5;
        (0..5)
            .map(|axis| d[row * 5 + axis] * diagonal[axis] * d[column * 5 + axis])
            .sum()
    }))
}

pub fn pm6_rotate_ds_overlap(
    local_sigma: f64,
    rotation: &[f64; 9],
) -> Result<[f64; 5], SemiempiricalError> {
    let d = pm6_wigner_d_matrix(rotation)?;
    Ok(std::array::from_fn(|row| d[row * 5] * local_sigma))
}

pub fn pm6_rotate_dp_overlap(
    local_sigma: f64,
    local_pi: f64,
    rotation: &[f64; 9],
) -> Result<[f64; 15], SemiempiricalError> {
    let d = pm6_wigner_d_matrix(rotation)?;
    Ok(std::array::from_fn(|index| {
        let d_orbital = index / 3;
        let p_orbital = index % 3;
        d[d_orbital * 5] * rotation[p_orbital] * local_sigma
            + (d[d_orbital * 5 + 1] * rotation[3 + p_orbital]
                + d[d_orbital * 5 + 2] * rotation[6 + p_orbital])
                * local_pi
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    const ROTATION: [f64; 9] = [
        0.781_639_173_907_025_1,
        -0.482_929_284_214_212_2,
        0.394_739_798_173_799_8,
        0.550_117_230_704_358_4,
        0.832_030_133_774_634_6,
        -0.071_392_499_417_875_86,
        -0.293_957_878_438_580_57,
        0.272_956_338_888_314_33,
        0.916_015_066_887_317_3,
    ];

    #[test]
    fn wigner_and_overlap_blocks_match_the_pinned_oracle() {
        let d = pm6_wigner_d_matrix(&ROTATION).unwrap();
        assert!((d[0] - 0.758_625_404_146_864_3).abs() < 1.0e-14);
        assert!((d[19] - 0.831_804_894_708_214_6).abs() < 1.0e-14);
        assert!((d[24] - 0.384_679_625_971_396_54).abs() < 1.0e-14);
        let dd = pm6_rotate_dd_overlap([1.2, -0.4, 0.7], &ROTATION).unwrap();
        assert!((dd[0] - 0.542_182_627_799_052_9).abs() < 1.0e-14);
        assert!((dd[24] - 0.560_976_653_278_045_5).abs() < 1.0e-14);
        let ds = pm6_rotate_ds_overlap(0.33, &ROTATION).unwrap();
        assert!((ds[1] + 0.153_908_387_709_100_04).abs() < 1.0e-14);
        let dp = pm6_rotate_dp_overlap(0.5, -0.2, &ROTATION).unwrap();
        assert!((dp[0] - 0.220_919_956_108_560_83).abs() < 1.0e-14);
        assert!((dp[14] + 0.005_057_538_755_925_749).abs() < 1.0e-14);
    }

    #[test]
    fn rejects_reflection_and_nonorthogonal_input() {
        let mut reflection = ROTATION;
        for value in &mut reflection[0..3] {
            *value = -*value;
        }
        assert!(pm6_wigner_d_matrix(&reflection).is_err());
        assert!(pm6_wigner_d_matrix(&[1.0; 9]).is_err());
    }
}
