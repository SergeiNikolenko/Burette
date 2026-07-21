"""
PM6 d-orbital one-center Fock matrix contribution using W integrals.

Port of PYSEQM fock.py _d_contrib_one_center.

The 9×9 density matrix P is packed into 45 lower-triangle elements.
Each of the 45 Fock lower-triangle elements is computed as:
  F_packed[col] = Σ W[w_idxs] * P_packed[p_idxs]
using the PM6_FLOCAL_MAP lookup table.
"""
from __future__ import annotations

import numpy as np

# Lower-triangle indices for 9×9 matrix (45 elements)
# Order: (0,0), (1,0), (1,1), (2,0), (2,1), (2,2), ...
_TRIL_I = []
_TRIL_J = []
for i in range(9):
    for j in range(i + 1):
        _TRIL_I.append(i)
        _TRIL_J.append(j)
TRIL_I = np.array(_TRIL_I)
TRIL_J = np.array(_TRIL_J)

# Weight: 1.0 for diagonal, 2.0 for off-diagonal
WEIGHT_45 = np.where(TRIL_I == TRIL_J, 1.0, 2.0)

# PM6 Fock local map: (F_col, [W_indices], [P_indices])
# Exact copy from PYSEQM fock.py
PM6_FLOCAL_MAP = [
    (0, [0, 1, 2, 3, 4], [14, 20, 27, 35, 44]),
    (1, [5, 6, 7, 8], [11, 18, 22, 38]),
    (2, [9, 10, 11, 12, 13, 14, 15, 16], [10, 14, 20, 21, 25, 27, 35, 44]),
    (3, [17, 18, 19, 20], [12, 23, 31, 37]),
    (4, [21, 22, 23], [33, 36, 42]),
    (5, [24, 25, 26, 27, 28, 29, 30, 31], [10, 14, 20, 21, 25, 27, 35, 44]),
    (6, [32, 33, 34], [16, 24, 30]),
    (7, [35, 36, 37, 38], [15, 19, 26, 43]),
    (8, [39, 40, 41, 42], [28, 32, 34, 41]),
    (9, [43, 44, 45, 46, 47, 48], [14, 20, 21, 27, 35, 44]),
    (10, [49, 50, 51, 52, 53, 54], [2, 5, 10, 20, 25, 35]),
    (11, [55, 56, 57, 58, 59], [1, 11, 18, 22, 38]),
    (12, [60, 61, 62, 63, 64], [3, 12, 23, 31, 37]),
    (13, [65, 66, 67], [13, 16, 30]),
    (14, [68, 69, 70, 71, 72, 73, 74, 75, 76, 77], [0, 2, 5, 9, 14, 20, 21, 27, 35, 44]),
    (15, [78, 79, 80, 81, 82], [7, 15, 19, 26, 43]),
    (16, [83, 84, 85, 86, 87], [6, 13, 16, 24, 30]),
    (17, [88, 89, 90], [17, 29, 39]),
    (18, [91, 92, 93, 94, 95], [1, 11, 18, 22, 38]),
    (19, [96, 97, 98, 99, 100], [7, 15, 19, 26, 43]),
    (20, [101,102,103,104,105,106,107,108,109,110,111,112], [0,2,5,9,10,14,20,21,25,27,35,44]),
    (21, [113,114,115,116,117,118,119,120,121], [2,5,9,14,20,21,27,35,44]),
    (22, [122,123,124,125,126], [1,11,18,22,38]),
    (23, [127,128,129,130,131], [3,12,23,31,37]),
    (24, [132,133,134,135], [6,16,24,30]),
    (25, [136,137,138,139,140,141], [2,5,10,20,25,35]),
    (26, [142,143,144,145,146], [7,15,19,26,43]),
    (27, [147,148,149,150,151,152,153,154,155,156], [0,2,5,9,14,20,21,27,35,44]),
    (28, [157,158,159,160,161], [8,28,32,34,41]),
    (29, [162,163,164], [17,29,39]),
    (30, [165,166,167,168,169], [6,13,16,24,30]),
    (31, [170,171,172,173,174], [3,12,23,31,37]),
    (32, [175,176,177,178,179], [8,28,32,34,41]),
    (33, [180,181,182,183], [4,33,36,42]),
    (34, [184,185,186,187,188], [8,28,32,34,41]),
    (35, [189,190,191,192,193,194,195,196,197,198,199,200], [0,2,5,9,10,14,20,21,25,27,35,44]),
    (36, [201,202,203,204], [4,33,36,42]),
    (37, [205,206,207,208,209], [3,12,23,31,37]),
    (38, [210,211,212,213,214], [1,11,18,22,38]),
    (39, [215,216,217], [17,29,39]),
    (40, [218], [40]),
    (41, [219,220,221,222,223], [8,28,32,34,41]),
    (42, [224,225,226,227], [4,33,36,42]),
    (43, [228,229,230,231,232], [7,15,19,26,43]),
    (44, [233,234,235,236,237,238,239,240,241,242], [0,2,5,9,14,20,21,27,35,44]),
]


def fock_d_one_center(F: np.ndarray, P: np.ndarray, W: np.ndarray,
                      atom_start: int, n_basis: int = 9) -> np.ndarray:
    """Add d-orbital one-center two-electron contribution to Fock matrix.

    Args:
        F: (n_total, n_total) Fock matrix (modified in-place)
        P: (n_total, n_total) density matrix
        W: (243,) W integrals for this atom
        atom_start: starting basis index for this atom
        n_basis: 9 for spd atoms

    Returns:
        F: modified Fock matrix
    """
    s = atom_start

    # Pack P into lower-triangle (45 elements)
    P_packed = np.zeros(45)
    for k in range(45):
        i, j = TRIL_I[k], TRIL_J[k]
        P_packed[k] = P[s + i, s + j] * WEIGHT_45[k]

    # Compute Fock lower-triangle contributions
    F_packed = np.zeros(45)
    for col, w_idxs, p_idxs in PM6_FLOCAL_MAP:
        val = 0.0
        for wi, pi in zip(w_idxs, p_idxs):
            val += W[wi] * P_packed[pi]
        F_packed[col] = val

    # Unpack into F (lower triangle → full symmetric)
    for k in range(45):
        i, j = TRIL_I[k], TRIL_J[k]
        F[s + i, s + j] += F_packed[k]
        if i != j:
            F[s + j, s + i] += F_packed[k]

    return F
