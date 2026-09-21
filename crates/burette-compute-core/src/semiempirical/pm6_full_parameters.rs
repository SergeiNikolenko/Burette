// Generated numeric data is sourced from the pinned mlxmolkit PM6 table.
// Upstream: mlxmolkit/rm1/data/parameters_PM6_MOPAC.csv at
// 9e7337f6f93c40a39ad0187991151944a4f1e274 (MIT).

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pm6FullElementParameters {
    pub atomic_number: u8,
    pub symbol: &'static str,
    pub orbital_count: u8,
    pub valence_electrons: u8,
    pub uss_ev: f64,
    pub upp_ev: f64,
    pub udd_ev: f64,
    pub zeta_s_bohr_inv: f64,
    pub zeta_p_bohr_inv: f64,
    pub zeta_d_bohr_inv: f64,
    pub beta_s_ev: f64,
    pub beta_p_ev: f64,
    pub beta_d_ev: f64,
    pub tail_s_bohr_inv: f64,
    pub tail_p_bohr_inv: f64,
    pub tail_d_bohr_inv: f64,
    pub gss_ev: f64,
    pub gsp_ev: f64,
    pub gpp_ev: f64,
    pub gp2_ev: f64,
    pub hsp_ev: f64,
    pub f0sd_ev: f64,
    pub g2sd_ev: f64,
    pub rho_core: f64,
    pub alpha_angstrom_inv: f64,
    pub isolated_atom_energy_ev: f64,
    pub gaussian: [[f64; 3]; 4],
    pub effective_charge_s: f64,
    pub effective_charge_p: f64,
    pub effective_charge_d: f64,
}

impl Pm6FullElementParameters {
    pub const fn has_d_orbitals(self) -> bool {
        self.orbital_count == 9
    }
}

include!("pm6_full_parameters.generated.rs");

pub fn pm6_full_parameters(atomic_number: u8) -> Option<&'static Pm6FullElementParameters> {
    PM6_FULL
        .iter()
        .find(|parameters| parameters.atomic_number == atomic_number)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_has_the_complete_pinned_parameterized_domain() {
        let atomic_numbers = PM6_FULL
            .iter()
            .map(|parameters| parameters.atomic_number)
            .collect::<Vec<_>>();
        assert_eq!(atomic_numbers.len(), 40);
        assert_eq!(atomic_numbers.first(), Some(&1));
        assert_eq!(atomic_numbers.last(), Some(&53));
        assert!(atomic_numbers.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            PM6_FULL
                .iter()
                .filter(|entry| entry.has_d_orbitals())
                .count(),
            18
        );
    }

    #[test]
    fn sp_and_spd_known_answers_match_the_pinned_csv() {
        let carbon = pm6_full_parameters(6).unwrap();
        assert_eq!(carbon.orbital_count, 4);
        assert_eq!(carbon.uss_ev, -51.08965);
        assert_eq!(carbon.gaussian[0], [0.0463, 2.10021, 1.33396]);

        let sulfur = pm6_full_parameters(16).unwrap();
        assert!(sulfur.has_d_orbitals());
        assert_eq!(sulfur.udd_ev, -46.306944);
        assert_eq!(sulfur.zeta_d_bohr_inv, 3.109401);
        assert_eq!(sulfur.beta_d_ev, -9.986172);

        let iodine = pm6_full_parameters(53).unwrap();
        assert!(iodine.has_d_orbitals());
        assert_eq!(iodine.udd_ev, -28.822603);
        assert_eq!(iodine.zeta_d_bohr_inv, 1.875175);
        assert_eq!(iodine.beta_d_ev, -7.676107);
        assert!(pm6_full_parameters(2).is_none());
    }
}
