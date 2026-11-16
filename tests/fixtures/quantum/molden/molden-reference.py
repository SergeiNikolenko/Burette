"""Independent orbital values for ORCA Molden files.

PySCF (Apache-2.0) rebuilds each [GTO] section, maps Molden's pure order (m = 0, +1, -1, ...) to
its own, and checks the [MO] coefficients for orthonormality in its AO overlap. ORCA's orca_2mkl
writes the coefficient of each unnormalized primitive, and the m = ±3 (f, g) and ±4 (g) real
harmonics with the opposite sign: only with both undone are the orbitals orthonormal
(`orthonormalityError`; `uncorrectedError` reads the file as the Molden format describes it).
Usage (PySCF 2.14):

    python molden-reference.py orca-*.molden.input > molden-reference.json
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from pyscf import gto

ANGSTROM_PER_BOHR = 0.529177210903


def read(path):
    sections, current = {}, None
    for line in path.read_text().replace("\r", "").split("\n"):
        text = line.strip()
        if text.startswith("["):
            current = text[1:text.index("]")].lower()
            sections[current] = []
        elif current and text:
            sections[current].append(text)
    atoms = [(row.split()[0], tuple(float(v) for v in row.split()[3:6])) for row in sections["atoms"]]
    shells, atom, rows, i = [], -1, sections["gto"], 0
    while i < len(rows):
        parts = rows[i].split()
        if parts[0].isdigit():
            atom, i = int(parts[0]) - 1, i + 1
            continue
        l, count = "spdfg".index(parts[0].lower()), int(parts[1])
        shells.append((atom, l, [tuple(float(v) for v in rows[i + 1 + k].split()) for k in range(count)]))
        i += count + 1
    size = sum(1 if l == 0 else 3 if l == 1 else 2 * l + 1 for _, l, _ in shells)
    orbitals, current = [], None
    for row in sections["mo"]:
        if "=" in row:
            key, value = (part.strip() for part in row.split("=", 1))
            if key.lower() == "sym":
                current = {"c": np.zeros(size)}
                orbitals.append(current)
            current[key.lower()] = value
        else:
            index, value = row.split()
            current["c"][int(index) - 1] = float(value)
    return atoms, shells, orbitals


def primitive_norm(exponent, l):
    return (2 * exponent / math.pi) ** 0.75 * math.sqrt((4 * exponent) ** l / math.prod(range(2 * l - 1, 0, -2)))


def molden_m(l, k):
    return 0 if k == 0 else (k + 1) // 2 * (1 if k % 2 else -1)


def reference(path, correct):
    atoms, shells, orbitals = read(path)
    basis = {f"{element}{k + 1}": [] for k, (element, _) in enumerate(atoms)}
    for atom, l, primitives in shells:
        basis[f"{atoms[atom][0]}{atom + 1}"].append([l] + [[a, c / primitive_norm(a, l) if correct else c] for a, c in primitives])
    mol = gto.M(atom=[(f"{element}{k + 1}", xyz) for k, (element, xyz) in enumerate(atoms)], basis=basis, unit="Bohr", verbose=0, spin=None)
    loc, used, order, sign = mol.ao_loc_nr(), set(), [], []
    for atom, l, primitives in shells:
        shell = next(b for b in range(mol.nbas) if b not in used and mol.bas_atom(b) == atom and mol.bas_angular(b) == l
                     and np.allclose(mol.bas_exp(b), [a for a, _ in primitives]))
        used.add(shell)
        for k in range(1 if l == 0 else 3 if l == 1 else 2 * l + 1):
            m = molden_m(l, k)
            order.append(loc[shell] + (k if l < 2 else l + m))
            sign.append(-1 if correct and (l, abs(m)) in {(3, 3), (4, 3), (4, 4)} else 1)
    coefficients = np.zeros((len(orbitals), mol.nao))
    for j, orbital in enumerate(orbitals):
        coefficients[j, order] = orbital["c"] * np.array(sign)
    overlap = coefficients @ mol.intor("int1e_ovlp_sph") @ coefficients.T
    return mol, coefficients, orbitals, float(np.abs(overlap - np.eye(len(overlap))).max())


def main(path):
    mol, coefficients, orbitals, error = reference(path, True)
    geometry = mol.atom_coords() * ANGSTROM_PER_BOHR
    points = np.vstack([geometry[:2] + 0.37, np.random.default_rng(20261102).uniform(geometry.min(0) - 1, geometry.max(0) + 1, (8, 3))])
    values = mol.eval_gto("GTOval_sph", points / ANGSTROM_PER_BOHR) @ coefficients.T
    occupied = [j for j, orbital in enumerate(orbitals) if float(orbital["occup"]) > 0]
    picks = sorted({0, occupied[-1], min(occupied[-1] + 1, len(orbitals) - 1), len(orbitals) - 1})
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "orthonormalityError": error, "uncorrectedError": reference(path, False)[3],
            "pointsAngstrom": points.tolist(), "orbitals": {str(j): values[:, j].tolist() for j in picks}}


if __name__ == "__main__":
    print(json.dumps({Path(name).name: main(Path(name)) for name in sys.argv[1:]}, indent=1, sort_keys=True))
