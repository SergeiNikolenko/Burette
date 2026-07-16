"""
5×5 Wigner D-matrix for real spherical harmonic d-orbital rotation.

Converts d-orbitals from local frame (bond axis = z for Wigner, x for MOPAC)
to molecular frame using the 3×3 rotation matrix.

d-orbital order: [dz², dxz, dyz, dx²-y², dxy]
  (same as MOPAC/PYSEQM convention: indices 4-8 in 9-basis)

The 5×5 rotation matrix D² is built from the 3×3 rotation R as:
  D²[m,m'] = f(R) where f depends on the specific (m,m') combination.

Reference: Ivanic & Ruedenberg, J. Phys. Chem. 100, 6342 (1996).
"""
from __future__ import annotations

import numpy as np


def wigner_d_matrix(R: np.ndarray) -> np.ndarray:
    """Build 5×5 rotation matrix for real d-orbitals from 3×3 rotation.

    Args:
        R: (3, 3) rotation matrix (orthogonal, det=+1)

    Returns:
        D: (5, 5) d-orbital rotation matrix

    d-orbital order: dz², dxz, dyz, dx²-y², dxy
    """
    # Extract rotation matrix elements
    r = R  # r[i][j] = R_ij

    D = np.zeros((5, 5))

    # dz² (m=0)
    D[0, 0] = (3 * r[2, 2]**2 - 1) / 2
    D[0, 1] = np.sqrt(3) * r[0, 2] * r[2, 2]
    D[0, 2] = np.sqrt(3) * r[1, 2] * r[2, 2]
    D[0, 3] = np.sqrt(3) / 2 * (r[0, 2]**2 - r[1, 2]**2)
    D[0, 4] = np.sqrt(3) * r[0, 2] * r[1, 2]

    # dxz (m=1c)
    D[1, 0] = np.sqrt(3) * r[2, 0] * r[2, 2]
    D[1, 1] = r[0, 0] * r[2, 2] + r[2, 0] * r[0, 2]
    D[1, 2] = r[1, 0] * r[2, 2] + r[2, 0] * r[1, 2]
    D[1, 3] = r[0, 0] * r[0, 2] - r[1, 0] * r[1, 2]
    D[1, 4] = r[0, 0] * r[1, 2] + r[1, 0] * r[0, 2]

    # dyz (m=1s)
    D[2, 0] = np.sqrt(3) * r[2, 1] * r[2, 2]
    D[2, 1] = r[0, 1] * r[2, 2] + r[2, 1] * r[0, 2]
    D[2, 2] = r[1, 1] * r[2, 2] + r[2, 1] * r[1, 2]
    D[2, 3] = r[0, 1] * r[0, 2] - r[1, 1] * r[1, 2]
    D[2, 4] = r[0, 1] * r[1, 2] + r[1, 1] * r[0, 2]

    # dx²-y² (m=2c)
    D[3, 0] = np.sqrt(3) / 2 * (r[2, 0]**2 - r[2, 1]**2)
    D[3, 1] = r[0, 0] * r[2, 0] - r[0, 1] * r[2, 1]
    D[3, 2] = r[1, 0] * r[2, 0] - r[1, 1] * r[2, 1]
    D[3, 3] = (r[0, 0]**2 - r[0, 1]**2 - r[1, 0]**2 + r[1, 1]**2) / 2
    D[3, 4] = r[0, 0] * r[1, 0] - r[0, 1] * r[1, 1]

    # dxy (m=2s)
    D[4, 0] = np.sqrt(3) * r[2, 0] * r[2, 1]
    D[4, 1] = r[0, 0] * r[2, 1] + r[0, 1] * r[2, 0]
    D[4, 2] = r[1, 0] * r[2, 1] + r[1, 1] * r[2, 0]
    D[4, 3] = r[0, 0] * r[0, 1] - r[1, 0] * r[1, 1]
    D[4, 4] = r[0, 0] * r[1, 1] + r[0, 1] * r[1, 0]

    return D


def rotate_d_overlap(S_local: dict, R: np.ndarray) -> np.ndarray:
    """Rotate d-orbital overlap from local to molecular frame.

    Takes local-frame sigma/pi/delta overlaps and produces
    the full 5×5 d-d overlap block in molecular frame.

    Args:
        S_local: dict with 'S_dd_sigma', 'S_dd_pi', 'S_dd_delta'
        R: (3, 3) rotation matrix

    Returns:
        S_dd: (5, 5) d-d overlap in molecular frame
    """
    D = wigner_d_matrix(R)

    # Local frame diagonal: [sigma, pi, pi, delta, delta]
    # In Wigner convention: dz²=sigma, dxz/dyz=pi, dx²-y²/dxy=delta
    S_diag = np.array([
        S_local['S_dd_sigma'],
        S_local['S_dd_pi'],
        S_local['S_dd_pi'],
        S_local['S_dd_delta'],
        S_local['S_dd_delta'],
    ])

    # S_mol = D · diag(S_local) · D^T
    S_dd = D @ np.diag(S_diag) @ D.T
    return S_dd


def rotate_ds_overlap(S_ds_sigma: float, R: np.ndarray) -> np.ndarray:
    """Rotate d-s overlap from local to molecular frame.

    Returns (5,) vector: overlap of each d-orbital with s.
    Only dz² (sigma) has nonzero overlap with s in local frame.
    """
    D = wigner_d_matrix(R)
    # In local frame: only dz² (index 0) overlaps with s
    # d_mol = D @ [S_ds, 0, 0, 0, 0]
    return D[:, 0] * S_ds_sigma


def rotate_dp_overlap(S_dp_sigma: float, S_dp_pi: float, R: np.ndarray) -> np.ndarray:
    """Rotate d-p overlap from local to molecular frame.

    Returns (5, 3) matrix: overlap of each d-orbital with each p-orbital.
    In local frame: dσ-pσ (sigma), dπ-pπ (pi).
    """
    D = wigner_d_matrix(R)
    r0 = R[0]  # p-orbital sigma direction

    # Local frame d-p overlaps: [dz²-pσ, dxz-pπ_x, dyz-pπ_y, 0, 0]
    # Rotate with Wigner D for d-orbitals and R for p-orbitals
    S_dp = np.zeros((5, 3))

    # dσ-pσ contribution
    for d_mol in range(5):
        for p_mol in range(3):
            # sigma: D[d,0] * r0[p] * S_dp_sigma
            S_dp[d_mol, p_mol] += D[d_mol, 0] * r0[p_mol] * S_dp_sigma
            # pi: D[d,1]*R[1,p] + D[d,2]*R[2,p] times S_dp_pi
            S_dp[d_mol, p_mol] += (D[d_mol, 1] * R[1, p_mol]
                                    + D[d_mol, 2] * R[2, p_mol]) * S_dp_pi

    return S_dp
