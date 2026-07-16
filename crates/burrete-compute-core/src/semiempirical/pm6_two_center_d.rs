use super::{
    pm6_d_multipole_parameters, Pm6FullElementParameters, Rm1MultipoleParameters,
    SemiempiricalError,
};

const EV: f64 = 27.21;
const ANGSTROM_TO_BOHR: f64 = 1.0 / 0.529_167;

include!("pm6_yx_local.generated.rs");

#[derive(Clone, Debug, PartialEq)]
pub struct Pm6DHydrogenPairIntegrals {
    /// Dense `(mu nu | s s)` matrix in PYSEQM's nine-orbital order.
    pub repulsion_ev: [f64; 81],
    pub d_core_attraction_ev: [f64; 81],
    pub hydrogen_core_attraction_ev: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pm6DSpLocalPairIntegrals {
    /// Packed `45 x 10` local-frame extension in the pinned PYSEQM convention.
    pub repulsion_ev: [f64; 450],
}

fn principal_quantum_number(atomic_number: u8) -> f64 {
    f64::from(match atomic_number {
        1..=2 => 1,
        3..=10 => 2,
        11..=18 => 3,
        19..=36 => 4,
        37..=54 => 5,
        _ => 6,
    })
}

fn dipole_equation(value: f64, separation: f64) -> f64 {
    0.5 * value - 0.5 / (4.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
}

fn quadrupole_equation(value: f64, separation: f64) -> f64 {
    0.25 * value - 0.5 / (4.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
        + 0.25 / (8.0 * separation.powi(2) + value.recip().powi(2)).sqrt()
}

fn sp_multipoles(parameters: &Pm6FullElementParameters) -> Rm1MultipoleParameters {
    let rho_monopole_bohr = 0.5 * EV / parameters.gss_ev;
    if parameters.orbital_count == 1 {
        return Rm1MultipoleParameters {
            dipole_separation_bohr: 0.0,
            quadrupole_separation_bohr: 0.0,
            rho_monopole_bohr,
            rho_dipole_bohr: 0.0,
            rho_quadrupole_bohr: 0.0,
        };
    }
    let n = principal_quantum_number(parameters.atomic_number);
    let dipole = (2.0 * n + 1.0)
        * (4.0 * parameters.zeta_s_bohr_inv * parameters.zeta_p_bohr_inv).powf(n + 0.5)
        / (parameters.zeta_s_bohr_inv + parameters.zeta_p_bohr_inv).powf(2.0 * n + 2.0)
        / 3.0_f64.sqrt();
    let quadrupole = ((4.0 * n.powi(2) + 6.0 * n + 2.0) / 20.0).sqrt() / parameters.zeta_p_bohr_inv;
    let hsp = parameters.hsp_ev / EV;
    let mut d1 = (hsp / dipole.powi(2)).abs().cbrt().copysign(hsp);
    let mut d2 = d1 + 0.04;
    for _ in 0..5 {
        let (value1, value2) = (dipole_equation(d1, dipole), dipole_equation(d2, dipole));
        let next = if (value2 - value1).abs() > 1.0e-16 {
            d1 + (d2 - d1) * (hsp - value1) / (value2 - value1)
        } else {
            d2
        };
        d1 = d2;
        d2 = next;
    }
    let hpp = (0.5 * (parameters.gpp_ev - parameters.gp2_ev)).max(0.1) / EV;
    let mut q1 = (hpp / 3.0 / quadrupole.powi(4))
        .abs()
        .powf(0.2)
        .copysign(hpp);
    let mut q2 = q1 + 0.04;
    for _ in 0..5 {
        let (value1, value2) = (
            quadrupole_equation(q1, quadrupole),
            quadrupole_equation(q2, quadrupole),
        );
        let next = if (value2 - value1).abs() > 1.0e-16 {
            q1 + (q2 - q1) * (hpp - value1) / (value2 - value1)
        } else {
            q2
        };
        q1 = q2;
        q2 = next;
    }
    Rm1MultipoleParameters {
        dipole_separation_bohr: dipole,
        quadrupole_separation_bohr: quadrupole,
        rho_monopole_bohr,
        rho_dipole_bohr: 0.5 / d2,
        rho_quadrupole_bohr: 0.5 / q2,
    }
}

/// Computes the exact PYSEQM local YX branch for a d-basis and sp-basis pair.
pub fn pm6_d_sp_local_pair_integrals(
    d_atom: &Pm6FullElementParameters,
    sp_atom: &Pm6FullElementParameters,
    distance_bohr: f64,
) -> Result<Pm6DSpLocalPairIntegrals, SemiempiricalError> {
    if !d_atom.has_d_orbitals() || sp_atom.orbital_count != 4 || sp_atom.has_d_orbitals() {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 YX integrals require a d-basis atom followed by an sp-only heavy atom".into(),
        ));
    }
    if !distance_bohr.is_finite() || distance_bohr <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 YX integrals require a positive finite distance".into(),
        ));
    }
    let a = sp_multipoles(d_atom);
    let b = sp_multipoles(sp_atom);
    let d = pm6_d_multipole_parameters(d_atom)?;
    Ok(Pm6DSpLocalPairIntegrals {
        repulsion_ev: pm6_yx_local(Pm6YxLocalInput {
            r0: distance_bohr,
            da0: a.dipole_separation_bohr,
            db0: b.dipole_separation_bohr,
            qa0: a.quadrupole_separation_bohr,
            qb0: b.quadrupole_separation_bohr,
            dpa0: d.dp,
            dsa0: d.ds,
            dda0: d.d_orbital,
            rho0a: a.rho_monopole_bohr,
            rho0b: b.rho_monopole_bohr,
            rho1a: a.rho_dipole_bohr,
            rho1b: b.rho_dipole_bohr,
            rho2a: a.rho_quadrupole_bohr,
            rho2b: b.rho_quadrupole_bohr,
            rho3a: d.rho3,
            rho4a: d.rho4,
            rho5a: d.rho5,
            rho6a: d.rho6,
        }),
    })
}

fn pyseqm_orbital_rotation(unit_d_to_h: [f64; 3]) -> [[f64; 9]; 9] {
    let [x, y, z] = unit_d_to_h.map(|value| -value);
    let xy = (x * x + y * y).sqrt();
    let sign_z = z.signum();
    let has_xy = xy >= 1.0e-10;
    let ca = if has_xy { x / xy } else { sign_z };
    let cb = if has_xy { z } else { sign_z };
    let sa = if has_xy { y / xy } else { 0.0 };
    let sb = if has_xy { xy } else { 0.0 };
    let (c2a, c2b, s2a, s2b) = (
        2.0 * ca * ca - 1.0,
        2.0 * cb * cb - 1.0,
        2.0 * sa * ca,
        2.0 * sb * cb,
    );
    let p = [
        [ca * sb, ca * cb, -sa],
        [sa * sb, sa * cb, ca],
        [cb, -sb, 0.0],
    ];
    let h3 = 0.866_025_403_784_1;
    let d = [
        [
            h3 * c2a * sb * sb,
            h3 * ca * s2b,
            cb * cb - 0.5 * sb * sb,
            h3 * sa * s2b,
            h3 * s2a * sb * sb,
        ],
        [
            0.5 * c2a * s2b,
            ca * c2b,
            -h3 * s2b,
            sa * c2b,
            0.5 * s2a * s2b,
        ],
        [-s2a * sb, -sa * cb, 0.0, ca * cb, c2a * sb],
        [
            c2a * (cb * cb + 0.5 * sb * sb),
            -0.5 * ca * s2b,
            h3 * sb * sb,
            -0.5 * sa * s2b,
            s2a * (cb * cb + 0.5 * sb * sb),
        ],
        [-s2a * cb, sa * sb, 0.0, -ca * sb, c2a * cb],
    ];
    let mut rotation = [[0.0; 9]; 9];
    rotation[0][0] = 1.0;
    for row in 0..3 {
        for column in 0..3 {
            rotation[row + 1][column + 1] = p[row][column];
        }
    }
    for row in 0..5 {
        for column in 0..5 {
            rotation[row + 4][column + 4] = d[column][row];
        }
    }
    rotation
}

/// Computes the exact PYSEQM YH branch for one PM6 d-basis atom and hydrogen.
pub fn pm6_d_hydrogen_pair_integrals(
    d_atom: &Pm6FullElementParameters,
    hydrogen: &Pm6FullElementParameters,
    d_position_angstrom: [f64; 3],
    hydrogen_position_angstrom: [f64; 3],
) -> Result<Pm6DHydrogenPairIntegrals, SemiempiricalError> {
    if !d_atom.has_d_orbitals() || hydrogen.atomic_number != 1 || hydrogen.orbital_count != 1 {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 YH integrals require a d-basis atom followed by hydrogen".into(),
        ));
    }
    let delta = std::array::from_fn::<_, 3, _>(|axis| {
        hydrogen_position_angstrom[axis] - d_position_angstrom[axis]
    });
    let distance_angstrom = delta.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !distance_angstrom.is_finite() || distance_angstrom <= 1.0e-8 {
        return Err(SemiempiricalError::InvalidInput(
            "PM6 YH integrals require distinct finite coordinates".into(),
        ));
    }
    let distance = distance_angstrom * ANGSTROM_TO_BOHR;
    let sp = sp_multipoles(d_atom);
    let h_sp = sp_multipoles(hydrogen);
    let d = pm6_d_multipole_parameters(d_atom)?;
    let inv = |longitudinal: f64, transverse_squared: f64, rho_squared: f64| {
        (longitudinal * longitudinal + transverse_squared + rho_squared)
            .sqrt()
            .recip()
    };
    let (half, quarter) = (EV / 2.0, EV / 4.0);
    let rho = |left: f64| (left + h_sp.rho_monopole_bohr).powi(2);
    let ss = EV * inv(distance, 0.0, rho(sp.rho_monopole_bohr));
    let ps =
        half * inv(
            distance + sp.dipole_separation_bohr,
            0.0,
            rho(sp.rho_dipole_bohr),
        ) - half
            * inv(
                distance - sp.dipole_separation_bohr,
                0.0,
                rho(sp.rho_dipole_bohr),
            );
    let q = 2.0 * sp.quadrupole_separation_bohr;
    let pp_center = half * inv(distance, 0.0, rho(sp.rho_quadrupole_bohr));
    let pp_sigma = ss
        + quarter * inv(distance - q, 0.0, rho(sp.rho_quadrupole_bohr))
        + quarter * inv(distance + q, 0.0, rho(sp.rho_quadrupole_bohr))
        - pp_center;
    let pp_pi = ss + half * inv(distance, q * q, rho(sp.rho_quadrupole_bohr)) - pp_center;
    let ddq_s = EV * inv(distance, 0.0, rho(d.rho3));
    let dpu_s = half * inv(distance + d.dp, 0.0, rho(d.rho4))
        - half * inv(distance - d.dp, 0.0, rho(d.rho4));
    let dsq_s = quarter * inv(distance - d.ds, 0.0, rho(d.rho5))
        + quarter * inv(distance + d.ds, 0.0, rho(d.rho5))
        - half * inv(distance, d.ds * d.ds, rho(d.rho5));
    let dd_quad_s = quarter * inv(distance - d.d_orbital, 0.0, rho(d.rho6))
        + quarter * inv(distance + d.d_orbital, 0.0, rho(d.rho6))
        - half * inv(distance, d.d_orbital * d.d_orbital, rho(d.rho6));

    let mut local = [[0.0; 9]; 9];
    local[0][0] = ss;
    local[1][0] = ps;
    local[0][1] = ps;
    local[1][1] = pp_sigma;
    local[2][2] = pp_pi;
    local[3][3] = pp_pi;
    let (d_delta, d_pi, d_sigma) = (
        ddq_s - 1.333_333 * dd_quad_s,
        ddq_s + 0.666_667 * dd_quad_s,
        ddq_s + 1.333_333 * dd_quad_s,
    );
    for (orbital, value) in [
        (4, d_sigma),
        (5, d_pi),
        (6, d_pi),
        (7, d_delta),
        (8, d_delta),
    ] {
        local[orbital][orbital] = value;
    }
    for (left, right, value) in [
        (4, 0, 1.154_701 * dsq_s),
        (4, 1, 1.154_701 * dpu_s),
        (5, 2, dpu_s),
        (6, 3, dpu_s),
    ] {
        local[left][right] = value;
        local[right][left] = value;
    }
    let unit = delta.map(|value| value / distance_angstrom);
    let rotation = pyseqm_orbital_rotation(unit);
    let mut repulsion_ev = [0.0; 81];
    for mu in 0..9 {
        for nu in 0..9 {
            for left in 0..9 {
                for right in 0..9 {
                    repulsion_ev[mu * 9 + nu] +=
                        rotation[mu][left] * local[left][right] * rotation[nu][right];
                }
            }
        }
    }
    Ok(Pm6DHydrogenPairIntegrals {
        d_core_attraction_ev: repulsion_ev.map(|value| -value),
        hydrogen_core_attraction_ev: -f64::from(d_atom.valence_electrons) * ss,
        repulsion_ev,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pm6_full_parameters;

    #[test]
    fn sulfur_hydrogen_matrix_matches_the_pinned_pyseqm_port() {
        let result = pm6_d_hydrogen_pair_integrals(
            pm6_full_parameters(16).unwrap(),
            pm6_full_parameters(1).unwrap(),
            [0.0, 0.0, 0.0],
            [1.1, -0.4, 0.7],
        )
        .unwrap();
        for (row, column, expected) in [
            (0, 0, 7.688_772_330_826_99),
            (0, 3, 1.317_813_729_295_457_5),
            (0, 6, -0.005_015_778_031_195_017),
            (1, 1, 7.792_657_824_941_370_5),
            (2, 5, -6.001_265_473_454_254e-8),
            (3, 6, 0.366_375_929_356_238_7),
            (4, 4, 9.326_713_116_840_885),
            (4, 8, 3.322_076_547_185_304e-8),
            (6, 6, 9.257_168_423_916_173),
            (8, 8, 9.326_713_128_637_135),
        ] {
            let actual = result.repulsion_ev[row * 9 + column];
            assert!(
                (actual - expected).abs() < 2.0e-10,
                "{row},{column}: {actual} != {expected}"
            );
        }
        assert!((result.repulsion_ev.iter().sum::<f64>() - 86.904_559_160_853_47).abs() < 2.0e-10);
        assert_eq!(result.d_core_attraction_ev[0], -result.repulsion_ev[0]);
    }

    #[test]
    fn rejects_wrong_domains_and_overlapping_atoms() {
        let (s, h, c) = (
            pm6_full_parameters(16).unwrap(),
            pm6_full_parameters(1).unwrap(),
            pm6_full_parameters(6).unwrap(),
        );
        assert!(pm6_d_hydrogen_pair_integrals(c, h, [0.0; 3], [1.0, 0.0, 0.0]).is_err());
        assert!(pm6_d_hydrogen_pair_integrals(s, c, [0.0; 3], [1.0, 0.0, 0.0]).is_err());
        assert!(pm6_d_hydrogen_pair_integrals(s, h, [0.0; 3], [0.0; 3]).is_err());
    }

    #[test]
    fn sulfur_oxygen_local_yx_matches_the_pinned_pyseqm_port() {
        let result = pm6_d_sp_local_pair_integrals(
            pm6_full_parameters(16).unwrap(),
            pm6_full_parameters(8).unwrap(),
            3.4,
        )
        .unwrap();
        for (index, expected) in [
            (10, 0.044_359_772_787_406_916),
            (17, -0.473_691_280_708_426_37),
            (20, 7.280_047_176_274_072),
            (44, 7.034_156_470_891_105),
            (62, -0.054_156_960_094_592_366),
            (125, 7.317_757_243_524_676),
            (245, 7.100_976_308_876_957),
            (304, 0.026_197_836_561_692_167),
            (349, 0.032_829_309_458_778_044),
            (449, 6.892_355_978_224_002_5),
        ] {
            let actual = result.repulsion_ev[index];
            assert!(
                (actual - expected).abs() < 2.0e-10,
                "{index}: {actual} != {expected}"
            );
        }
        assert_eq!(
            result
                .repulsion_ev
                .iter()
                .filter(|value| **value != 0.0)
                .count(),
            84
        );
        assert!((result.repulsion_ev.iter().sum::<f64>() - 140.633_643_038_500_96).abs() < 2.0e-10);
    }
}
