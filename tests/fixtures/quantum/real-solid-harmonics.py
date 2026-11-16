"""Independent values of normalized real solid-harmonic Gaussians, d through i.

Each function is N_l r^l exp(-a r^2) S_lm(theta, phi): N_l normalizes the radial factor,
S_lm is the real spherical harmonic built from SciPy's complex harmonic (BSD-3-Clause) with the
Condon-Shortley phase removed, so the cos(m phi) and sin(m phi) components are positive for
x, y > 0 near the xy plane. Components run m = 0, +1, -1, +2, -2, ... (Gaussian's pure order).
Usage (SciPy >= 1.15):

    python real-solid-harmonics.py > real-solid-harmonics.json
"""
import json
import math

import numpy as np
import scipy
from scipy.special import sph_harm_y

EXPONENT = 0.7
POINTS_BOHR = [[0.31, -0.47, 0.83], [-0.72, 0.28, -0.41], [0.0, 0.0, 1.2], [1.1, 0.0, 0.0], [0.5, 0.9, -0.2]]


def value(l, m, point):
    x, y, z = point
    r = math.sqrt(x * x + y * y + z * z)
    theta, phi = math.acos(z / r), math.atan2(y, x)
    radial = math.sqrt(2 * (2 * EXPONENT) ** (l + 1.5) / math.gamma(l + 1.5)) * r ** l * math.exp(-EXPONENT * r * r)
    complex_value = sph_harm_y(l, abs(m), theta, phi) * (-1) ** abs(m)  # removes the Condon-Shortley phase
    angular = complex_value.real if m == 0 else math.sqrt(2) * (complex_value.real if m > 0 else complex_value.imag)
    return radial * float(np.real(angular))


def order(l):
    return [0] + [sign * k for k in range(1, l + 1) for sign in (1, -1)]


print(json.dumps({
    "source": f"SciPy {scipy.__version__} sph_harm_y; see real-solid-harmonics.py",
    "exponent": EXPONENT,
    "pointsBohr": POINTS_BOHR,
    "shells": [{"l": l, "m": order(l), "values": [[value(l, m, p) for m in order(l)] for p in POINTS_BOHR]} for l in range(2, 7)],
}, indent=1))
