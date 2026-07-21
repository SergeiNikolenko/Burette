use super::SemiempiricalError;

const BASIS_SIZE: usize = 9;
const MATRIX_SIZE: usize = BASIS_SIZE * BASIS_SIZE;
const PACKED_SIZE: usize = BASIS_SIZE * (BASIS_SIZE + 1) / 2;

include!("pm6_fock_map.generated.rs");

fn packed_index(row: usize, column: usize) -> usize {
    row * (row + 1) / 2 + column
}

/// Contracts the 243 PM6 W integrals with one symmetric 9x9 AO density block.
///
/// Both input and output matrices are row-major. Off-diagonal density entries
/// are weighted by two in the lower-triangle contraction, following the pinned
/// PYSEQM/MLXMolKit Fock convention.
pub fn pm6_one_center_d_fock(
    density: &[f64; MATRIX_SIZE],
    w_integrals: &[f64; 243],
) -> Result<[f64; MATRIX_SIZE], SemiempiricalError> {
    if density
        .iter()
        .chain(w_integrals)
        .any(|value| !value.is_finite())
    {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 one-center d Fock input must be finite".into(),
        ));
    }
    let mut packed_density = [0.0; PACKED_SIZE];
    for row in 0..BASIS_SIZE {
        for column in 0..=row {
            let left = density[row * BASIS_SIZE + column];
            let right = density[column * BASIS_SIZE + row];
            if (left - right).abs() > 1.0e-10 {
                return Err(SemiempiricalError::InvalidInput(
                    "PM6 one-center density block must be symmetric".into(),
                ));
            }
            packed_density[packed_index(row, column)] =
                left * if row == column { 1.0 } else { 2.0 };
        }
    }

    let mut packed_fock = [0.0; PACKED_SIZE];
    for (output, value) in packed_fock.iter_mut().enumerate() {
        let start = usize::from(PM6_FOCK_OFFSETS[output]);
        let end = usize::from(PM6_FOCK_OFFSETS[output + 1]);
        for term in start..end {
            *value += w_integrals[usize::from(PM6_FOCK_W_INDICES[term])]
                * packed_density[usize::from(PM6_FOCK_DENSITY_INDICES[term])];
        }
    }

    let mut result = [0.0; MATRIX_SIZE];
    for row in 0..BASIS_SIZE {
        for column in 0..=row {
            let value = packed_fock[packed_index(row, column)];
            result[row * BASIS_SIZE + column] = value;
            result[column * BASIS_SIZE + row] = value;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contraction_matches_the_pinned_upstream_known_answer() {
        let w = std::array::from_fn(|index| (index + 1) as f64 * 0.03125);
        let mut density = [0.0; MATRIX_SIZE];
        for row in 0..BASIS_SIZE {
            for column in 0..=row {
                let value = (row + 1) as f64 * 0.2 + (column + 1) as f64 * 0.03;
                density[row * BASIS_SIZE + column] = value;
                density[column * BASIS_SIZE + row] = value;
            }
        }
        let fock = pm6_one_center_d_fock(&density, &w).unwrap();
        assert!((fock.iter().sum::<f64>() - 4_004.450_937_500_000_2).abs() < 1.0e-10);
        for (index, expected) in [
            (0, 0.826_562_500_000_000_1),
            (9, 2.768_125_000_000_000_4),
            (22, 26.928_75),
            (72, 80.001_875_000_000_01),
            (80, 99.031_875_000_000_03),
        ] {
            assert!((fock[index] - expected).abs() < 1.0e-12);
        }
    }

    #[test]
    fn rejects_nonfinite_or_asymmetric_density() {
        let mut density = [0.0; MATRIX_SIZE];
        density[1] = 1.0;
        assert!(pm6_one_center_d_fock(&density, &[0.0; 243]).is_err());
        density[9] = 1.0;
        density[0] = f64::NAN;
        assert!(pm6_one_center_d_fock(&density, &[0.0; 243]).is_err());
    }
}
