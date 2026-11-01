"""Independent orbital values for Burette's Gaussian log reader (pop=full with gfinput).

cclib (BSD-3-Clause) reads the printed general basis and MO coefficients; PySCF (Apache-2.0)
builds the same basis with its own real solid harmonics. Gaussian prints pure components as
D 0, D+1, D-1, ... (m order 0, +1, -1, ...), which map to PySCF's m = -l..l order; p shells are
x, y, z in both. The script records the orthonormality of the coefficients in PySCF's AO overlap
(a check of order, normalization and phase convention independent of Burette) and orbital values
at fixed points. Usage (cclib 1.8.1, PySCF 2.14):

    python orbital-reference.py cclib-dvb_sp.out cclib-C_bigbasis-trimmed.out > orbital-reference.json
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import cclib
import numpy as np
from pyscf import gto

ANGSTROM_PER_BOHR = 0.529177210903
MOMENTUM = {"S": 0, "P": 1, "D": 2, "F": 3, "G": 4, "H": 5, "I": 6}


def component_index(l, label):
    if l == 0:
        return 0
    if l == 1:
        return "XYZ".index(label[-1])
    m = int(re.sub(r"^\d*[DFGHI]\s?", "", label))
    return l + m


def reference(path):
    data = cclib.io.ccread(str(path))
    coords = data.atomcoords[-1]
    atoms, basis = [], {}
    for index, (number, xyz) in enumerate(zip(data.atomnos, coords)):
        tag = f"{gto.mole._symbol(int(number))}{index + 1}"
        atoms.append((tag, tuple(xyz)))
        basis[tag] = [[MOMENTUM[kind]] + [[e, c] for e, c in primitives] for kind, primitives in data.gbasis[index]]
    mol = gto.M(atom=atoms, basis=basis, unit="Angstrom", cart=False, verbose=0,
                charge=int(data.charge), spin=int(data.mult) - 1)
    labels = [name.split("_", 1)[1] for name in data.aonames]
    loc = mol.ao_loc_nr()
    used, order, k = set(), [], 0
    for atom, shells in enumerate(data.gbasis):
        for kind, primitives in shells:
            l = MOMENTUM[kind]
            exponents = np.array([e for e, _ in primitives])
            shell = next(b for b in range(mol.nbas) if b not in used and mol.bas_atom(b) == atom and mol.bas_angular(b) == l
                         and len(mol.bas_exp(b)) == len(exponents) and np.allclose(mol.bas_exp(b), exponents))
            used.add(shell)
            for label in labels[k:k + 2 * l + 1]:
                order.append(loc[shell] + component_index(l, label))
            k += 2 * l + 1
    assert k == len(labels)
    overlap = mol.intor("int1e_ovlp_sph")
    rng = np.random.default_rng(20261102)
    lo, hi = coords.min(axis=0) - 1.5, coords.max(axis=0) + 1.5
    points = np.vstack([coords + 0.37, lo + (hi - lo) * rng.random((10, 3))])
    ao = mol.eval_gto("GTOval_sph", points / ANGSTROM_PER_BOHR)
    result = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pointsAngstrom": points.tolist(), "spins": []}
    homos = list(np.atleast_1d(data.homos))
    for spin, coefficients in enumerate(data.mocoeffs):
        full = np.zeros((coefficients.shape[0], mol.nao_nr()))
        full[:, order] = coefficients
        error = np.abs(full @ overlap @ full.T - np.eye(len(full))).max()
        homo = int(homos[min(spin, len(homos) - 1)])
        picks = sorted({0, homo, homo + 1, len(full) - 1})
        result["spins"].append({"orthonormalityError": float(error), "orbitals": {str(n): (ao @ full[n]).tolist() for n in picks}})
    return result


if __name__ == "__main__":
    print(json.dumps({Path(name).name: reference(Path(name)) for name in sys.argv[1:]}, indent=1, sort_keys=True))
