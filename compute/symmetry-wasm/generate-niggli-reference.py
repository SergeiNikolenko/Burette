"""Writes Niggli reductions from the Python spglib package as an independent
reference for the WebAssembly engine.

Run from the repository root:
  uv run --no-project --with 'spglib==2.8.0' --with numpy \
    python compute/symmetry-wasm/generate-niggli-reference.py
"""

import json
from pathlib import Path

import numpy as np
import spglib

EPS = 1e-5
OBLIQUE = [[4.0, 0.0, 0.0], [3.0, 2.0, 0.0], [1.0, 1.0, 3.0]]


def rebased(cell, transform):
    # Rows are lattice vectors, so the new basis B = A·U is Uᵀ·rows(A).
    return (np.array(transform, dtype=int).T @ np.array(cell)).tolist()


rng = np.random.default_rng(20261026)
cases = {
    "oblique": OBLIQUE,
    "left-handed": [OBLIQUE[0], OBLIQUE[2], OBLIQUE[1]],
    "rebased-det-plus": rebased(OBLIQUE, [[1, 2, 0], [0, 1, 0], [1, 1, 1]]),
    "rebased-det-minus": rebased(OBLIQUE, [[0, 1, 0], [1, 0, 3], [0, 0, 1]]),
    "cubic-reduced": [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
    "fcc-primitive-skewed": rebased([[0.0, 2.0, 2.0], [2.0, 0.0, 2.0], [2.0, 2.0, 0.0]], [[1, 0, 2], [1, 1, 0], [0, 0, 1]]),
    "hexagonal-skewed": rebased([[3.0, 0.0, 0.0], [-1.5, 2.598076211353316, 0.0], [0.0, 0.0, 5.0]], [[1, 3, 0], [0, 1, 0], [2, 0, 1]]),
    "triclinic-random": (rng.normal(size=(3, 3)) * 3 + np.diag([6.0, 7.0, 8.0])).tolist(),
}

reference = {
    "generator": "compute/symmetry-wasm/generate-niggli-reference.py",
    "spglib": spglib.__version__,
    "eps": EPS,
    "cases": [
        {"name": name, "cell": cell, "reduced": spglib.niggli_reduce(cell, eps=EPS).tolist()}
        for name, cell in cases.items()
    ],
}
output = Path("tests/fixtures/symmetry/niggli-spglib-reference.json")
output.write_text(json.dumps(reference, indent=2) + "\n")
print(f"Wrote {len(cases)} cases with spglib {spglib.__version__} to {output}")
