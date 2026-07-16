// Parameter data adapted from OpenMOPAC at commit
// 052691223d19935a89f0fe18cd12301bd83e4201, Apache-2.0.
// Source: src/models/parameters_for_RM1_C.F90.
// License: compute/semiempirical/licenses/OPENMOPAC-APACHE-2.0.txt.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SemiempiricalElementParameters {
    pub atomic_number: u8,
    pub symbol: &'static str,
    pub orbital_count: u8,
    pub valence_electrons: u8,
    pub uss_ev: f64,
    pub upp_ev: f64,
    pub zeta_s_bohr_inv: f64,
    pub zeta_p_bohr_inv: f64,
    pub beta_s_ev: f64,
    pub beta_p_ev: f64,
    pub gss_ev: f64,
    pub gsp_ev: f64,
    pub gpp_ev: f64,
    pub gp2_ev: f64,
    pub hsp_ev: f64,
    pub alpha_angstrom_inv: f64,
    /// Each row is `(K, L, M)` for one Gaussian core correction.
    pub gaussian: [[f64; 3]; 4],
}

const fn element(
    atomic_number: u8,
    symbol: &'static str,
    valence_electrons: u8,
    orbital: [f64; 6],
    repulsion: [f64; 6],
    gaussian: [[f64; 3]; 4],
) -> SemiempiricalElementParameters {
    SemiempiricalElementParameters {
        atomic_number,
        symbol,
        orbital_count: if atomic_number == 1 { 1 } else { 4 },
        valence_electrons,
        uss_ev: orbital[0],
        upp_ev: orbital[1],
        zeta_s_bohr_inv: orbital[2],
        zeta_p_bohr_inv: orbital[3],
        beta_s_ev: orbital[4],
        beta_p_ev: orbital[5],
        gss_ev: repulsion[0],
        gsp_ev: repulsion[1],
        gpp_ev: repulsion[2],
        gp2_ev: repulsion[3],
        hsp_ev: repulsion[4],
        alpha_angstrom_inv: repulsion[5],
        gaussian,
    }
}

const RM1: [SemiempiricalElementParameters; 10] = [
    element(
        1,
        "H",
        1,
        [-11.960_677, 0.0, 1.082_673_7, 0.0, -5.765_444_7, 0.0],
        [13.983_213, 0.0, 0.0, 0.0, 0.0, 3.068_359_5],
        [
            [0.102_888_8, 5.901_722_7, 1.175_011_8],
            [0.064_574_5, 6.417_856_7, 1.938_444_8],
            [-0.035_673_9, 2.804_731_3, 1.636_552_4],
            [0.0; 3],
        ],
    ),
    element(
        6,
        "C",
        4,
        [
            -51.725_560_3,
            -39.407_289_4,
            1.850_188,
            1.768_300_9,
            -15.459_324_3,
            -8.236_086_4,
        ],
        [
            13.053_124_4,
            11.334_793_9,
            10.951_137_4,
            9.723_951,
            1.552_151_3,
            2.792_820_8,
        ],
        [
            [0.074_622_7, 5.739_216, 1.043_969_8],
            [0.011_770_5, 6.924_017_3, 1.661_595_7],
            [0.037_206_6, 6.261_589_4, 1.631_587_2],
            [-0.002_706_6, 9.000_037_3, 2.795_579],
        ],
    ),
    element(
        7,
        "N",
        5,
        [
            -70.851_237_2,
            -57.977_309_2,
            2.374_471_6,
            1.978_125_7,
            -20.871_245_5,
            -16.671_718_5,
        ],
        [
            13.087_362_3,
            13.212_268_3,
            13.699_243_2,
            11.941_039_5,
            5.000_008_5,
            2.964_225_4,
        ],
        [
            [0.060_733_8, 4.588_929_5, 1.378_738_8],
            [0.024_385_6, 4.627_305_2, 2.083_707],
            [-0.022_834_3, 2.052_746_6, 1.867_638_2],
            [0.0; 3],
        ],
    ),
    element(
        8,
        "O",
        6,
        [
            -96.949_480_7,
            -77.890_929_8,
            3.179_369_1,
            2.553_619_1,
            -29.851_012_1,
            -29.151_013_1,
        ],
        [
            14.002_427_9,
            14.956_250_4,
            14.145_151_4,
            12.703_255,
            3.932_171_6,
            4.171_967_2,
        ],
        [
            [0.230_935_5, 5.218_287_4, 0.903_635_6],
            [0.058_598_7, 7.429_329_3, 1.517_546_1],
            [0.0; 3],
            [0.0; 3],
        ],
    ),
    element(
        9,
        "F",
        7,
        [
            -134.183_695_9,
            -107.846_609_2,
            4.403_379_1,
            2.648_415_6,
            -70.000_005_1,
            -32.679_827_1,
        ],
        [
            16.720_913_2,
            16.761_426_3,
            15.225_810_3,
            14.865_786_8,
            1.997_661_7,
            6.000_000_6,
        ],
        [
            [0.403_020_3, 7.204_419_6, 0.816_530_1],
            [0.070_858_3, 9.000_015_6, 1.438_023_8],
            [0.0; 3],
            [0.0; 3],
        ],
    ),
    element(
        15,
        "P",
        5,
        [
            -41.815_331_8,
            -34.383_425_3,
            2.122_401_2,
            1.743_279_5,
            -6.135_149_7,
            -5.944_421_3,
        ],
        [
            11.080_592_6,
            5.683_392,
            7.604_175_6,
            7.402_651_8,
            1.161_817_9,
            1.909_932_9,
        ],
        [
            [-0.410_634_7, 6.087_528_3, 1.316_502_6],
            [-0.162_992_9, 7.094_726, 1.907_213_2],
            [-0.048_871_3, 8.999_793_1, 2.658_577_8],
            [0.0; 3],
        ],
    ),
    element(
        16,
        "S",
        6,
        [
            -55.167_751_2,
            -46.529_304_2,
            2.133_443_1,
            1.874_606_5,
            -1.959_107_2,
            -8.774_306_5,
        ],
        [
            12.488_284_1,
            8.569_105_7,
            8.523_011_7,
            7.668_633,
            3.889_789_3,
            2.440_156_4,
        ],
        [
            [-0.746_010_6, 4.810_38, 0.593_801_3],
            [-0.065_192_9, 7.207_608_6, 1.294_920_1],
            [-0.006_559_8, 9.000_001_8, 1.800_601_5],
            [0.0; 3],
        ],
    ),
    element(
        17,
        "Cl",
        7,
        [
            -118.473_069_2,
            -76.353_303_4,
            3.864_910_7,
            1.895_931_4,
            -19.924_304_3,
            -11.529_352,
        ],
        [
            15.360_231,
            13.306_711_7,
            12.565_026_4,
            9.663_970_8,
            1.764_899,
            3.693_588_3,
        ],
        [
            [0.129_471_1, 2.977_244_2, 1.467_497_8],
            [0.002_889, 7.098_275_9, 2.500_027_2],
            [0.0; 3],
            [0.0; 3],
        ],
    ),
    element(
        35,
        "Br",
        7,
        [
            -113.483_981_8,
            -76.187_200_2,
            5.731_572_1,
            2.031_475_8,
            -1.341_398_4,
            -8.202_259_9,
        ],
        [
            17.115_630_7,
            15.624_192_5,
            10.735_462_9,
            8.860_562,
            2.235_127_6,
            2.867_105_3,
        ],
        [
            [0.986_899_4, 4.284_841_9, 2.000_197],
            [-0.927_312_5, 4.540_059_1, 2.016_177],
            [0.0; 3],
            [0.0; 3],
        ],
    ),
    element(
        53,
        "I",
        7,
        [
            -74.899_978_4,
            -51.410_238,
            2.530_037_5,
            2.317_386_8,
            -4.193_161_5,
            -4.400_384_1,
        ],
        [
            19.999_741_3,
            7.689_576_7,
            7.304_883_4,
            6.854_246_1,
            1.416_029_4,
            2.141_570_9,
        ],
        [
            [-0.081_477_2, 1.560_650_7, 2.000_020_6],
            [0.059_149_9, 5.761_112_7, 2.204_888],
            [0.0; 3],
            [0.0; 3],
        ],
    ),
];

pub fn rm1_parameters(atomic_number: u8) -> Option<&'static SemiempiricalElementParameters> {
    RM1.iter()
        .find(|parameters| parameters.atomic_number == atomic_number)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rm1_table_has_the_complete_upstream_element_domain() {
        let supported: Vec<_> = RM1
            .iter()
            .map(|parameters| parameters.atomic_number)
            .collect();
        assert_eq!(supported, [1, 6, 7, 8, 9, 15, 16, 17, 35, 53]);
        assert_eq!(rm1_parameters(1).unwrap().orbital_count, 1);
        assert_eq!(rm1_parameters(6).unwrap().orbital_count, 4);
        assert!(rm1_parameters(14).is_none());
    }

    #[test]
    fn rm1_known_answers_match_the_pinned_openmopac_table() {
        let carbon = rm1_parameters(6).unwrap();
        assert_eq!(carbon.uss_ev, -51.725_560_3);
        assert_eq!(carbon.gaussian[3], [-0.002_706_6, 9.000_037_3, 2.795_579]);
        let iodine = rm1_parameters(53).unwrap();
        assert_eq!(iodine.gss_ev, 19.999_741_3);
        assert_eq!(iodine.zeta_p_bohr_inv, 2.317_386_8);
    }
}
