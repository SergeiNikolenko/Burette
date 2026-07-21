"""
One-center two-electron W integrals for d-orbitals (PM6).

243 integrals computed from 11 Slater-Condon radial parameters.
Port of PYSEQM build_two_elec_one_center_int_D.py.

Reference: MOPAC calpar.f90, Thiel & Voityuk 1996.
"""
from __future__ import annotations

import math
import numpy as np

EV = 27.21  # Hartree to eV


def _binom(a: int, b: int) -> float:
    """Binomial coefficient C(a, b) = a! / (b! * (a-b)!)."""
    if b < 0 or b > a:
        return 0.0
    return math.factorial(a) / (math.factorial(b) * math.factorial(a - b))


def slater_condon_parameter(K: int, NA: int, EA: float, NB: int, EB: float,
                            NC: int, EC: float, ND: int, ED: float) -> float:
    """Compute Slater-Condon radial parameter R^K(NA EA, NB EB | NC EC, ND ED).

    Exact port of PYSEQM GetSlaterCondonParameter.

    K: type (0,1,2,3,4)
    NA,NB: principal quantum numbers, electron 1
    EA,EB: Slater exponents, electron 1
    NC,ND: principal quantum numbers, electron 2
    EC,ED: Slater exponents, electron 2
    """
    if EA <= 0 or EB <= 0 or EC <= 0 or ED <= 0:
        return 0.0

    AEA = math.log(EA)
    AEB = math.log(EB)
    AEC = math.log(EC)
    AED = math.log(ED)
    NAB = NA + NB
    NCD = NC + ND
    ECD = EC + ED
    EAB = EA + EB
    E = ECD + EAB
    N = NAB + NCD
    AE = math.log(E)
    A2 = math.log(2)
    ACD = math.log(ECD)
    AAB = math.log(EAB)

    C = math.exp(
        math.log(math.factorial(N - 1))
        + NA * AEA + NB * AEB + NC * AEC + ND * AED
        + 0.5 * (AEA + AEB + AEC + AED) + A2 * (N + 2)
        - 0.5 * (math.log(math.factorial(2 * NA)) + math.log(math.factorial(2 * NB))
                  + math.log(math.factorial(2 * NC)) + math.log(math.factorial(2 * ND)))
        - AE * N
    )
    C *= EV

    S0 = 1.0 / E
    S1 = 0.0
    S2 = 0.0
    M = NCD - K

    for I in range(1, M + 1):
        S0 *= E / ECD
        S1 += S0 * (_binom(NCD - K - 1, I - 1) - _binom(NCD + K, I - 1)) / _binom(N - 1, I - 1)

    M2 = NCD + K + 1
    for I in range(M + 1, M2 + 1):
        S0 *= E / ECD
        S2 += S0 * _binom(M2 - 1, I - 1) / _binom(N - 1, I - 1)

    S3 = math.exp(AE * N - ACD * M2 - AAB * (NAB - K)) / _binom(N - 1, M2 - 1)

    return C * (S1 - S2 + S3)


def compute_w_integrals(
    zeta_s: float, zeta_p: float, zeta_d: float,
    qn_sp: int, qn_d: int,
    F0SD: float = 0.0, G2SD: float = 0.0,
) -> np.ndarray:
    """Compute 243 one-center two-electron W integrals.

    Args:
        zeta_s, zeta_p, zeta_d: Slater orbital exponents
        qn_sp: principal quantum number for s/p (2 for C-Cl, 3 for K-Br)
        qn_d: principal quantum number for d (3 for first transition row)
        F0SD, G2SD: override Slater-Condon F0(sd) and G2(sd) if nonzero

    Returns:
        W: (243,) array of W integrals in eV
    """
    SC = slater_condon_parameter

    # Compute 11 Slater-Condon R-parameters
    R016 = SC(0, qn_sp, zeta_s, qn_sp, zeta_s, qn_d, zeta_d, qn_d, zeta_d)
    R066 = SC(0, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d)
    R244 = SC(2, qn_sp, zeta_s, qn_d, zeta_d, qn_sp, zeta_s, qn_d, zeta_d)
    R246 = SC(2, qn_sp, zeta_s, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d)
    R466 = SC(4, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d)
    R266 = SC(2, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d, qn_d, zeta_d)

    R036 = R155 = R125 = R236 = R234 = R355 = 0.0
    if qn_sp > 0 and qn_d > 0 and zeta_p > 0:
        R036 = SC(0, qn_sp, zeta_p, qn_sp, zeta_p, qn_d, zeta_d, qn_d, zeta_d)
        R155 = SC(1, qn_sp, zeta_p, qn_d, zeta_d, qn_sp, zeta_p, qn_d, zeta_d)
        R125 = SC(1, qn_sp, zeta_s, qn_sp, zeta_p, qn_sp, zeta_p, qn_d, zeta_d)
        R236 = SC(2, qn_sp, zeta_p, qn_sp, zeta_p, qn_d, zeta_d, qn_d, zeta_d)
        R234 = SC(2, qn_sp, zeta_p, qn_sp, zeta_p, qn_sp, zeta_s, qn_d, zeta_d)
        R355 = SC(3, qn_sp, zeta_p, qn_d, zeta_d, qn_sp, zeta_p, qn_d, zeta_d)

    # Override with explicit parameters if provided
    if abs(F0SD) > 1e-9:
        R016 = F0SD
    if abs(G2SD) > 1e-9:
        R244 = G2SD

    # Build 52 intermediate integrals from R-parameters
    S3 = math.sqrt(3.0)
    S5 = math.sqrt(5.0)
    S15 = math.sqrt(15.0)

    intg = np.zeros(52)
    intg[0] = R016
    intg[1] = (2.0 / (3.0 * S5)) * R125
    intg[2] = (1.0 / S15) * R125
    intg[3] = (2.0 / (5.0 * S5)) * R234
    intg[4] = R036 + (4.0 / 35.0) * R236
    intg[5] = R036 + (2.0 / 35.0) * R236
    intg[6] = R036 - (4.0 / 35.0) * R236
    intg[7] = -(1.0 / (3.0 * S5)) * R125
    intg[8] = math.sqrt(3.0 / 125.0) * R234
    intg[9] = (S3 / 35.0) * R236
    intg[10] = (3.0 / 35.0) * R236
    intg[11] = -(0.2 / S5) * R234
    intg[12] = R036 - (2.0 / 35.0) * R236
    intg[13] = -(2.0 * S3 / 35.0) * R236
    intg[14] = -intg[2]
    intg[15] = -intg[10]
    intg[16] = -intg[8]
    intg[17] = -intg[13]
    intg[18] = 0.2 * R244
    intg[19] = (2.0 / (7.0 * S5)) * R246
    intg[20] = intg[19] * 0.5
    intg[21] = -intg[19]
    intg[22] = (4.0 / 15.0) * R155 + (27.0 / 245.0) * R355
    intg[23] = (2.0 * S3 / 15.0) * R155 - (9.0 * S3 / 245.0) * R355
    intg[24] = (1.0 / 15.0) * R155 + (18.0 / 245.0) * R355
    intg[25] = -(S3 / 15.0) * R155 + (12.0 * S3 / 245.0) * R355
    intg[26] = -(S3 / 15.0) * R155 - (3.0 * S3 / 245.0) * R355
    intg[27] = -intg[26]
    intg[28] = R066 + (4.0 / 49.0) * R266 + (4.0 / 49.0) * R466
    intg[29] = R066 + (2.0 / 49.0) * R266 - (24.0 / 441.0) * R466
    intg[30] = R066 - (4.0 / 49.0) * R266 + (6.0 / 441.0) * R466
    intg[31] = math.sqrt(3.0 / 245.0) * R246
    intg[32] = 0.2 * R155 + (24.0 / 245.0) * R355
    intg[33] = 0.2 * R155 - (6.0 / 245.0) * R355
    intg[34] = (3.0 / 49.0) * R355
    intg[35] = (1.0 / 49.0) * R266 + (30.0 / 441.0) * R466
    intg[36] = (S3 / 49.0) * R266 - (5.0 * S3 / 441.0) * R466
    intg[37] = R066 - (2.0 / 49.0) * R266 - (4.0 / 441.0) * R466
    intg[38] = -(2.0 * S3 / 49.0) * R266 + (10.0 * S3 / 441.0) * R466
    intg[39] = -intg[31]
    intg[40] = -intg[33]
    intg[41] = -intg[34]
    intg[42] = -intg[36]
    intg[43] = (3.0 / 49.0) * R266 + (20.0 / 441.0) * R466
    intg[44] = -intg[38]
    intg[45] = 0.20 * R155 - (3.0 / 35.0) * R355
    intg[46] = -intg[45]
    intg[47] = (4.0 / 49.0) * R266 + (15.0 / 441.0) * R466
    intg[48] = (3.0 / 49.0) * R266 - (5.0 / 147.0) * R466
    intg[49] = -intg[48]
    intg[50] = R066 + (4.0 / 49.0) * R266 - (34.0 / 441.0) * R466
    intg[51] = (35.0 / 441.0) * R466

    # 243 lookup tables (1-based indices into intg, 0 means skip)
    IntRf1 = [
        19,19,19,19,19, 3, 3, 8, 3, 3,33,33, 8,27,25,35,33,15, 8, 3,
         3,34, 3,27,15,33,35, 8,28,25,33,33, 3, 2, 3, 3,34,24,35, 3,
        41,26,35,35,33, 2,23,33,35, 3,15, 1,32,22,40, 3, 6,11,14, 0,
        15, 6,18,16, 0, 7,11,16,19,33,33,35,29,44,22,48,44,52, 3, 1,
        32,21,32, 3,11, 6,10,11, 7,11,11, 3,11, 6,10,11,34,32,38,37,
        50,19,33,35,33,32,44,29,21,37,36,44,44, 8, 8, 2,22,21, 1,20,
        21,22, 8,14,10,13,14, 8,18,13,10,14, 2,10, 5,10,27,28,22,37,
        31,43,24,21,37,30,39,19,25,25,23,48,36,20,29,36,48, 3, 1,40,
        21,32,11, 7,11, 3,16,11,10, 6, 3,16,10, 6,11,41,40,38,45,49,
        34,38,32,37,26,21,45,30,37,19,35,33,33,40,44,44,21,43,36,29,
        44, 3,32, 1,22, 3, 0,14,11, 6, 3, 0,11,14, 6,11,11, 7,51,35,
        32,49,37,38,27,37,22,31,35,32,50,39,38,19,33,33,35,52,44,22,
        48,44,29]

    # NOTE: PYSEQM's exact IntRf2 table (build_two_elec_one_center_int_D.py
    # lines 148-161). Verified byte-for-byte against the source.
    IntRf2 = [
        19,19,19,19,19, 9, 9,12, 9, 3,33,33, 8,27,25,35,33,17,12, 9,
         9,35, 3,27,15,33,35, 8,28,25,33,33, 9, 4, 9, 3,35,26,34, 3,
        42,24,34,35,33, 2,23,33,35, 3,15,19,32,22,40, 9,33,35,27,47,
        17,33,28,42,46,35,34,41,19,33,33,35,29,44,22,48,44,52, 3,19,
        32,21,32, 9,34,33,26,35,35,34,34, 9,35,33,24,35,35,32,44,39,
         0,19,33,35,33,32,44,29,21,37,36,44,44, 8, 8, 2,22,21,19,20,
        21,22,12,27,24,25,27,12,28,25,24,27, 4,26,23,26,27,28,22,37,
        48,43,26,21,39,36,37,19,25,25,23,48,36,20,29,36,48, 3,19,40,
        21,32,34,35,34, 9,41,35,26,33, 9,42,24,33,35,42,40,44,43, 0,
        35,44,32,37,24,21,43,36,39,19,35,33,33,40,44,44,21,43,36,29,
        44, 3,32,19,22, 9,46,27,35,33, 9,47,35,27,33,34,34,35,52,34,
        32, 0,39,44,27,37,22,48,34,32, 0,37,44,19,33,33,35,52,44,22,
        48,44,29]

    # NOTE: This is PYSEQM's exact IntRep table (build_two_elec_one_center_int_D.py
    # lines 164-177). An earlier copy of this file contained a duplicate of
    # IntRf1 here by mistake, which silently produced W values off by 15-50 eV.
    IntRep = [
         1, 1, 1, 1, 1, 3, 3, 8, 3, 9, 6, 6,12,14,13, 7, 6,15, 8, 3,
         3,11, 9,14,17, 6, 7,12,18,13, 6, 6, 3, 2, 3, 9,11,10,11, 9,
        16,10,11, 7, 6, 4, 5, 6, 7, 9,17,19,32,22,40, 3,33,34,27,46,
        15,33,28,41,47,35,35,42, 1, 6, 6, 7,29,38,22,31,38,51, 9,19,
        32,21,32, 3,35,33,24,34,35,35,35, 3,34,33,26,34,11,32,44,37,
        49, 1, 6, 7, 6,32,38,29,21,39,30,38,38,12,12, 4,22,21,19,20,
        21,22, 8,27,26,25,27, 8,28,25,26,27, 2,24,23,24,14,18,22,39,
        48,45,10,21,37,36,37, 1,13,13, 5,31,30,20,29,30,31, 9,19,40,
        21,32,35,35,35, 3,42,34,24,33, 3,41,26,33,34,16,40,44,43,50,
        11,44,32,39,10,21,43,36,37, 1, 7, 6, 6,40,38,38,21,45,30,29,
        38, 9,32,19,22, 3,47,27,34,33, 3,46,34,27,33,35,35,35,52,11,
        32,50,37,44,14,39,22,48,11,32,49,37,44, 1, 6, 6, 7,51,38,22,
        31,38,29]

    # Build 243 W integrals
    W = np.zeros(243)
    for j in range(243):
        rep = IntRep[j]
        rf1 = IntRf1[j]
        rf2 = IntRf2[j]

        val = intg[rep - 1] if rep > 0 else 0.0
        if rf1 > 0:
            val -= 0.25 * intg[rf1 - 1]
        if rf2 > 0:
            val -= 0.25 * intg[rf2 - 1]
        W[j] = val

    return W
