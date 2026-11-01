"""Independent orbital values for Burette's QCSchema wavefunction reader.

PySCF (Apache-2.0) rebuilds the basis of each QCSchema AtomicResult wavefunction written by
Psi4 1.11 through QCEngine 0.52. Shell coefficients include the primitive normalization of the
x^l component; they are divided by it and PySCF normalizes each contraction. The AO convention
of these files was established against PySCF's own SCF density for the same molecule and basis
(`densityError` below, sign- and rotation-invariant):

- spherical components run m = +l, ..., 0, ..., -l (p: x, z, y; d: x²-y², xz, z², yz, xy);
- Cartesian components are lexicographic (xx, xy, xz, yy, yz, zz) and all carry the
  normalization of the x^l component (PySCF's Cartesian AOs are rescaled accordingly);
- orbitals are stored (nbf, nmo) row-major.

The script also records orthonormality in that basis and orbital values at fixed points.
Usage (PySCF 2.14):

    python orbital-reference.py *-wavefunction.json > orbital-reference.json
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from pyscf import gto, scf

ANGSTROM_PER_BOHR = 0.529177210903


def x_power_normalization(exponent, l):
    double_factorial = math.prod(range(2 * l - 1, 0, -2)) if l else 1
    return (2 * exponent / math.pi) ** 0.75 * math.sqrt((4 * exponent) ** l / double_factorial)


def pyscf_component(l, k, cartesian):
    if cartesian or l == 0:
        return k
    m = l - k  # QCSchema: m = +l .. -l
    return {1: 0, -1: 1, 0: 2}[m] if l == 1 else l + m  # PySCF p: x, y, z; d and up: m = -l .. +l


def reference(path):
    data = json.loads(path.read_text())
    wavefunction, molecule = data["wavefunction"], data["molecule"]
    basis_set = wavefunction["basis"]
    symbols = molecule["symbols"]
    geometry = np.array(molecule["geometry"]).reshape(-1, 3)
    atoms, basis, shells, cartesian = [], {}, [], False
    for index, (symbol, xyz, key) in enumerate(zip(symbols, geometry, basis_set["atom_map"])):
        tag = f"{symbol}{index + 1}"
        atoms.append((tag, tuple(xyz)))
        basis[tag] = []
        for shell in basis_set["center_data"][key]["electron_shells"]:
            (l,) = shell["angular_momentum"]
            cartesian |= l >= 2 and shell["harmonic_type"] == "cartesian"
            exponents = [float(e) for e in shell["exponents"]]
            (coefficients,) = shell["coefficients"]
            basis[tag].append([l] + [[e, float(c) / x_power_normalization(e, l)] for e, c in zip(exponents, coefficients)])
            shells.append((index, l, exponents))
    multiplicity = int(molecule.get("molecular_multiplicity", 1))
    options = dict(unit="Bohr", cart=cartesian, verbose=0, charge=int(molecule.get("molecular_charge", 0)), spin=multiplicity - 1)
    mol = gto.M(atom=atoms, basis=basis, **options)
    # PySCF sorts an atom's shells by angular momentum: match them by atom, l and exponents.
    loc, used, order = mol.ao_loc_nr(cart=cartesian), set(), []
    for atom, l, exponents in shells:
        shell = next(b for b in range(mol.nbas) if b not in used and mol.bas_atom(b) == atom and mol.bas_angular(b) == l
                     and len(mol.bas_exp(b)) == len(exponents) and np.allclose(mol.bas_exp(b), exponents))
        used.add(shell)
        size = (l + 1) * (l + 2) // 2 if cartesian else 2 * l + 1
        order += [loc[shell] + pyscf_component(l, k, cartesian) for k in range(size)]
    kind = "cart" if cartesian else "sph"
    raw = mol.intor(f"int1e_ovlp_{kind}")
    # PySCF normalizes the radial factor; scale each shell so that its x^l component is unit-normalized.
    scale = np.ones(len(raw))
    if cartesian:
        for shell in range(mol.nbas):
            scale[loc[shell]:loc[shell + 1]] = 1 / math.sqrt(raw[loc[shell], loc[shell]])
    overlap = raw * np.outer(scale, scale)
    nbf = basis_set["nbf"]
    points = np.vstack([geometry * ANGSTROM_PER_BOHR + 0.37, np.random.default_rng(20261102).uniform(-2.5, 2.5, (10, 3))])
    raw_ao = mol.eval_gto(f"GTOval_{kind}", points / ANGSTROM_PER_BOHR)
    ao = raw_ao * scale
    # Closed shells only: an open-shell SCF may settle in another degenerate component.
    reference_density = None
    if multiplicity == 1:
        reference_density = np.einsum("pi,ij,pj->p", raw_ao, scf.RHF(mol).run(conv_tol=1e-11).make_rdm1(), raw_ao)
    result = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pointsAngstrom": points.tolist(), "spins": []}
    density = np.zeros(len(points))
    for spin in ("a", "b"):
        key = wavefunction.get(f"orbitals_{spin}") if spin == "a" or not wavefunction["restricted"] else None
        if not key:
            continue
        coefficients = np.array(wavefunction[key]).reshape(nbf, -1).T
        full = np.zeros((len(coefficients), overlap.shape[0]))
        full[:, order] = coefficients
        occupied = int(data["properties"]["calcinfo_nalpha" if spin == "a" else "calcinfo_nbeta"])
        values = ao @ full.T
        density += (1 if not wavefunction["restricted"] else 2) * (values[:, :occupied] ** 2).sum(axis=1)
        error = np.abs(full @ overlap @ full.T - np.eye(len(full))).max()
        picks = sorted({0, occupied - 1, occupied, len(full) - 1})
        result["spins"].append({"orthonormalityError": float(error), "orbitals": {str(n): values[:, n].tolist() for n in picks}})
    if reference_density is not None:
        result["densityError"] = float(np.abs(density - reference_density).max())
    return result


if __name__ == "__main__":
    print(json.dumps({Path(name).name: reference(Path(name)) for name in sys.argv[1:]}, indent=1, sort_keys=True))
