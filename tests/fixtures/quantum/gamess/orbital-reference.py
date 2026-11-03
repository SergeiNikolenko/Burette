"""Independent orbital values for Burette's GAMESS reader.

For each output, cclib (BSD-3-Clause) reads the basis and MO coefficients and PySCF
(Apache-2.0) builds the same Cartesian basis. GAMESS coefficients refer to Cartesian AOs that
are each normalized to unity, so PySCF's Cartesian AOs are rescaled by their own overlap
diagonal. The script records how orthonormal the coefficients are in that basis (a check of
the AO order and normalization convention, independent of Burette) and the values of a few
orbitals at fixed points. Usage (cclib 1.8.1, PySCF 2.14):

    python orbital-reference.py cclib-*.out > orbital-reference.json
"""
import hashlib
import json
import sys
from pathlib import Path

import cclib
import numpy as np
from pyscf import gto

ANGSTROM_PER_BOHR = 0.529177210903
MOMENTUM = {"S": 0, "P": 1, "D": 2, "F": 3, "G": 4, "H": 5, "I": 6}


def cartesian_order(l):
    return [(x, y, l - x - y) for x in range(l, -1, -1) for y in range(l - x, -1, -1)]


def label_powers(label):
    return (0, 0, 0) if label == "S" else tuple(label.count(axis) for axis in "XYZ")


def reference(path):
    data = cclib.io.ccread(str(path))
    coords = data.atomcoords[-1]
    atoms, basis = [], {}
    for index, (number, xyz) in enumerate(zip(data.atomnos, coords)):
        tag = f"{gto.mole._symbol(int(number))}{index + 1}"
        atoms.append((tag, tuple(xyz)))
        basis[tag] = [[MOMENTUM[kind]] + [[e, c] for e, c in primitives] for kind, primitives in data.gbasis[index]]
    mol = gto.M(atom=atoms, basis=basis, unit="Angstrom", cart=True, verbose=0,
                charge=int(data.charge), spin=int(data.mult) - 1)
    # GAMESS AO -> PySCF Cartesian AO, matching shells by atom, angular momentum and exponents.
    labels = [name.split("_", 1)[1] for name in data.aonames]
    loc = mol.ao_loc_nr(cart=True)
    used, order, k = set(), [], 0
    for atom, shells in enumerate(data.gbasis):
        for kind, primitives in shells:
            l = MOMENTUM[kind]
            exponents = np.array([e for e, _ in primitives])
            shell = next(b for b in range(mol.nbas) if b not in used and mol.bas_atom(b) == atom and mol.bas_angular(b) == l
                         and len(mol.bas_exp(b)) == len(exponents) and np.allclose(mol.bas_exp(b), exponents))
            used.add(shell)
            components = cartesian_order(l)
            for label in labels[k:k + len(components)]:
                order.append(loc[shell] + components.index(label_powers(label)))
            k += len(components)
    overlap = mol.intor("int1e_ovlp_cart")
    scale = 1 / np.sqrt(np.diag(overlap))
    unit_overlap = overlap * np.outer(scale, scale)
    rng = np.random.default_rng(20261102)
    lo, hi = coords.min(axis=0) - 1.5, coords.max(axis=0) + 1.5
    points = np.vstack([coords + 0.37, lo + (hi - lo) * rng.random((10, 3))])
    ao = mol.eval_gto("GTOval_cart", points / ANGSTROM_PER_BOHR) * scale
    result = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pointsAngstrom": points.tolist(), "spins": []}
    homos = list(np.atleast_1d(data.homos))
    for spin, coefficients in enumerate(data.mocoeffs):
        # cclib pads orbitals that were not printed (for example virtuals of a final MO print) with zeros.
        printed = int(np.flatnonzero(np.abs(coefficients).sum(axis=1)).max()) + 1
        full = np.zeros((printed, mol.nao_cart()))
        full[:, order] = coefficients[:printed]
        error = np.abs(full @ unit_overlap @ full.T - np.eye(len(full))).max()
        homo = int(homos[min(spin, len(homos) - 1)])
        picks = sorted({0, homo, min(homo + 1, len(full) - 1), len(full) - 1})
        result["spins"].append({"orthonormalityError": float(error), "orbitals": {str(n): (ao @ full[n]).tolist() for n in picks}})
    return result


if __name__ == "__main__":
    print(json.dumps({Path(name).name: reference(Path(name)) for name in sys.argv[1:]}, indent=1, sort_keys=True))
