"""Derives the Z-DNA tables in
apps/desktop/src/lib/molecular-workbench/nucleic-templates.ts.

Source structure: PDB 4OCB, Z-DNA dodecamer d(CGCGCGCGCGCG)2 at 0.75 A (P-SAD;
Brzezinski, Brzuszkiewicz, Dauter et al., 2014). wwPDB data, CC0. One strand is in the
asymmetric unit; the duplex is biological assembly 1, whose second operator is the
crystallographic two-fold axis, i.e. the dyad of the double helix.

Method, with numpy only:
1. Alternative conformations keep altloc A; hydrogens, waters and ions are removed.
   With altloc A every GpC phosphate is in the canonical Z-I conformation (zeta of G
   and alpha of C both near -60/-150 degrees) except G6pC7, which 4OCB models only as
   Z-II (alpha of C7 +167 degrees).
2. The helix screw is one least-squares superposition (Kabsch) of the dinucleotide
   units (C, G) 2..4 onto units 3..5 of strand A together with the same units of the
   symmetry-related strand, which advance the other way, without the atoms that move
   between Z-I and Z-II (P, OP1, OP2, O5' and C5' of C; O3' of G). Its rotation and
   its translation along the axis are the twist and rise per dinucleotide.
3. The helix frame has z along that screw axis (strand A runs toward -z) and x along
   the crystallographic dyad, projected perpendicular to z, with the origin where the
   dyad meets the axis. That dyad lies between G6 and C7 (a GpC step).
4. The pyrimidine (C) and purine (G) nucleotides of the template unit are the mean of
   the Z-I units among strand A units 2..5 (residues 3..10; unit 4 is Z-II) mapped
   onto unit 3 (C5, G6) by the ideal screw. Units 1 and 6 are the duplex ends.
5. A Cartesian mean blurs the GpC linkage that crosses repeats (O3'-P 1.74 A,
   O3'-P-O5' 90 degrees). The mean is therefore regularized by restrained least squares
   (scipy) under the fixed screw: positions to the mean (sigma 0.15 A); every bond
   (0.01 A) and bond angle (1 degree) of C and G to its mean over the Z-I residues
   C3, C5, C9 and G4, G6, G10; both linkages, the GpC one through the screw, to the
   mean length and angles of the CpG links (C3pG4 ... C11pG12) and the Z-I GpC links
   (G2pC3, G4pC5, G8pC9, G10pC11); and the three Watson-Crick distances to the dyad
   partner to their mean over C3, C5, C7 and C9.
6. Base atoms are the B-form `fnab` bases of Open-Source PyMOL (the same bases as the
   A and B tables), superposed on the mean ring of the Z template: purines (A, G) on
   the guanine ring N9 C8 N7 C5 C6 N1 C2 N3 C4, pyrimidines (C, T) on the cytosine
   ring N1 C2 N3 C4 C5 C6. Backbone atoms, through C1', come from 4OCB.

Run with Open-Source PyMOL's interpreter with gemmi and numpy installed:
  <pymol-python> derive-z-template.py 4OCB.cif
Printed rows are pasted into nucleic-templates.ts; the run summary goes to stderr.
"""
import os
import pickle
import sys

import gemmi
import numpy as np
import pymol
from scipy.optimize import least_squares

BACKBONE = ["P", "OP1", "OP2", "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "C1'"]
BASES = {
    "A": ["N9", "C8", "N7", "C5", "C6", "N6", "N1", "C2", "N3", "C4"],
    "C": ["N1", "C2", "O2", "N3", "C4", "N4", "C5", "C6"],
    "G": ["N9", "C8", "N7", "C5", "C6", "O6", "N1", "C2", "N2", "N3", "C4"],
    "T": ["N1", "C2", "O2", "N3", "C4", "O4", "C5", "C7", "C6"],
}
RING = {"purine": ["N9", "C8", "N7", "C5", "C6", "N1", "C2", "N3", "C4"], "pyrimidine": ["N1", "C2", "N3", "C4", "C5", "C6"]}
# Conda builds keep PyMOL data under pymol_path/, the pymol-open-source-whl wheels directly in the package.
FRAGMENTS = next(path for path in (os.path.join(os.path.dirname(pymol.__file__), *parts, "data", "chempy", "fragments") for parts in (("pymol_path",), ())) if os.path.isdir(path))
RENAME = {"O1P": "OP1", "O2P": "OP2", "C5M": "C7"}


def kabsch(p, q):
    """Rotation r and translation t with q ~ p @ r.T + t."""
    pc, qc = p.mean(0), q.mean(0)
    u, _, vt = np.linalg.svd((p - pc).T @ (q - qc))
    d = np.sign(np.linalg.det(vt.T @ u.T))
    r = vt.T @ np.diag([1, 1, d]) @ u.T
    return r, qc - pc @ r.T


def load():
    st = gemmi.read_structure(sys.argv[1])
    st.setup_entities()
    st.remove_alternative_conformations()
    st.remove_hydrogens()
    model = gemmi.make_assembly(st.assemblies[0], st[0], gemmi.HowToNameCopiedChain.AddNumber)
    strands = [{res.seqid.num: {atom.name: np.array(atom.pos.tolist()) for atom in res} for res in chain if res.name in ("DC", "DG")} for chain in model]
    strands = [strand for strand in strands if len(strand) == 12]
    assert len(strands) == 2, len(strands)
    op = st.assemblies[0].generators[0].operators[1].transform
    return strands, np.array(op.mat.tolist()), np.array(op.vec.tolist())


NAMES = [("C", name) for name in BACKBONE + BASES["C"]] + [("G", name) for name in BACKBONE + BASES["G"]]
# Atoms whose positions differ between the Z-I and Z-II GpC phosphate.
SWITCHING = {("C", "P"), ("C", "OP1"), ("C", "OP2"), ("C", "O5'"), ("C", "C5'"), ("G", "O3'")}
RIGID = [i for i, key in enumerate(NAMES) if key not in SWITCHING]


def unit(strand, k):
    """Coordinates of dinucleotide unit k (residues 2k-1, 2k) in NAMES order."""
    return np.array([strand[2 * k - 1 if base == "C" else 2 * k][name] for base, name in NAMES])


def dihedral(p0, p1, p2, p3):
    b0, b1, b2 = p0 - p1, (p2 - p1) / np.linalg.norm(p2 - p1), p3 - p2
    v, w = b0 - (b0 @ b1) * b1, b2 - (b2 @ b1) * b1
    return np.degrees(np.arctan2(np.cross(b1, v) @ w, v @ w))


def z_one(strand, k):
    """Alpha of the unit's cytidine, O3'(G) P O5' C5': about -150 in Z-I, +165 in Z-II."""
    c = strand[2 * k - 1]
    return dihedral(strand[2 * k - 2]["O3'"], c["P"], c["O5'"], c["C5'"]) < 0


def angle_of(a, b, c):
    u, v = a - b, c - b
    return np.degrees(np.arccos(np.clip(u @ v / np.linalg.norm(u) / np.linalg.norm(v), -1, 1)))


def regularize(strand, partner, mean, phi, tau):
    """Restrained least squares of the template under the fixed screw (step 5 of the docstring)."""
    index = {key: i for i, key in enumerate(NAMES)}
    residues = {"C": [3, 5, 9], "G": [4, 6, 10]}
    bonds = [(i, j) for i in range(len(NAMES)) for j in range(i + 1, len(NAMES)) if NAMES[i][0] == NAMES[j][0]
             and np.linalg.norm(mean[i] - mean[j]) < 1.8]
    targets = lambda base, names: np.mean([angle_of(*(strand[r][n] for n in names)) if len(names) == 3 else np.linalg.norm(strand[r][names[0]] - strand[r][names[1]]) for r in residues[base]])
    bond_targets = [targets(NAMES[i][0], (NAMES[i][1], NAMES[j][1])) for i, j in bonds]
    neighbours = {i: [j for bond in bonds for j in bond if i in bond and j != i] for i in range(len(NAMES))}
    angles = [(j, i, k) for i in neighbours for j in neighbours[i] for k in neighbours[i] if j < k]
    angle_targets = [targets(NAMES[i][0], (NAMES[j][1], NAMES[i][1], NAMES[k][1])) for j, i, k in angles]
    # Links: (5' residue numbers, 3' residue numbers) in the crystal; CpG inside a repeat, Z-I GpC across repeats.
    link_names = [("O3'", "P"), ("C3'", "O3'", "P"), ("O3'", "P", "O5'"), ("O3'", "P", "OP1"), ("O3'", "P", "OP2")]
    def link_targets(pairs):
        def measure(first, second, names):
            atoms = [strand[first][n] if n in ("C3'", "O3'") else strand[second][n] for n in names]
            return angle_of(*atoms) if len(names) == 3 else np.linalg.norm(atoms[0] - atoms[1])
        return [np.mean([measure(i, j, names) for i, j in pairs]) for names in link_names]
    cpg = link_targets([(3, 4), (5, 6), (7, 8), (9, 10), (11, 12)])
    gpc = link_targets([(2, 3), (4, 5), (8, 9), (10, 11)])
    hbonds = [(("C", "N4"), ("G", "O6")), (("C", "N3"), ("G", "N1")), (("C", "O2"), ("G", "N2"))]
    hbond_targets = [np.mean([np.linalg.norm(strand[i][x[1]] - partner[13 - i][y[1]]) for i in (3, 5, 7, 9)]) for x, y in hbonds]

    def screw_of(coords, p, t, steps=1):
        theta = np.radians(p * steps)
        rot = np.array([[np.cos(theta), -np.sin(theta), 0], [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
        return coords @ rot.T + np.array([0, 0, t * steps])

    def link_values(x, first, second, shifted):
        at = lambda base, name: (screw_of(x[index[(base, name)]], *shifted) if shifted and base == second else x[index[(base, name)]])
        values = []
        for names in link_names:
            atoms = [at(first, n) if n in ("C3'", "O3'") else at(second, n) for n in names]
            values.append(angle_of(*atoms) if len(names) == 3 else np.linalg.norm(atoms[0] - atoms[1]))
        return values

    def residuals(params):
        x, p, t = params.reshape(-1, 3), phi, tau
        out = list(((x - mean) / 0.15).ravel())
        out += [(np.linalg.norm(x[i] - x[j]) - target) / 0.01 for (i, j), target in zip(bonds, bond_targets)]
        out += [(angle_of(x[j], x[i], x[k]) - target) / 1.0 for (j, i, k), target in zip(angles, angle_targets)]
        for values, target in ((link_values(x, "C", "G", None), cpg), (link_values(x, "G", "C", (p, t)), gpc)):
            out += [(value - goal) / (0.01 if k == 0 else 1.0) for k, (value, goal) in enumerate(zip(values, target))]
        partner_g = screw_of(x, p, t) * np.array([1, -1, -1])
        out += [(np.linalg.norm(x[index[c]] - partner_g[index[g]]) - target) / 0.03 for (c, g), target in zip(hbonds, hbond_targets)]
        return np.array(out)

    fit = least_squares(residuals, mean.ravel())
    x, p, t = fit.x.reshape(-1, 3), phi, tau
    shift = np.sqrt(((x - mean) ** 2).sum(1).mean())
    print(f"regularized: RMS shift {shift:.3f} A; CpG link {np.round(link_values(x, 'C', 'G', None), 2)} vs {np.round(cpg, 2)};"
          f" GpC link {np.round(link_values(x, 'G', 'C', (p, t)), 2)} vs {np.round(gpc, 2)}", file=sys.stderr)
    print(f"  worst bond {max(abs(np.linalg.norm(x[i] - x[j]) - g) for (i, j), g in zip(bonds, bond_targets)):.3f} A,"
          f" worst angle {max(abs(angle_of(x[j], x[i], x[k]) - g) for (j, i, k), g in zip(angles, angle_targets)):.2f} deg,"
          f" hbonds {[round(float(np.linalg.norm(x[index[c]] - (screw_of(x, p, t) * np.array([1, -1, -1]))[index[g]])), 2) for c, g in hbonds]} vs {np.round(hbond_targets, 2)}", file=sys.stderr)
    return x, p, t


def fragment(base):
    with open(os.path.join(FRAGMENTS, f"{base.lower()}tpB.pkl"), "rb") as handle:
        model = pickle.load(handle)
    return {RENAME.get(atom.name, atom.name): np.array(atom.coord) for atom in model.atom}


def main():
    (a, b), dyad_r, dyad_t = load()
    # Strand A unit k -> k + 1; the partner strand advances the other way, unit k + 1 -> k.
    source = np.vstack([unit(a, k)[RIGID] for k in (2, 3, 4)] + [unit(b, k + 1)[RIGID] for k in (2, 3, 4)])
    target = np.vstack([unit(a, k + 1)[RIGID] for k in (2, 3, 4)] + [unit(b, k)[RIGID] for k in (2, 3, 4)])
    r, t = kabsch(source, target)
    screw_rmsd = np.sqrt(((source @ r.T + t - target) ** 2).sum(1).mean())
    angle = np.degrees(np.arccos((np.trace(r) - 1) / 2))
    axis = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    axis /= np.linalg.norm(axis)
    shift = t @ axis
    point = np.linalg.lstsq(np.eye(3) - r, t - shift * axis, rcond=None)[0]
    z = axis if shift < 0 else -axis
    # The dyad: the two-fold axis of the assembly operator.
    w, v = np.linalg.eig(dyad_r)
    dyad = np.real(v[:, np.argmin(abs(w - 1))])
    dyad_point = np.linalg.lstsq(np.eye(3) - dyad_r, dyad_t, rcond=None)[0]
    # Closest point of the helix axis to the dyad axis.
    n = np.cross(z, dyad)
    s = np.linalg.solve(np.array([z, -dyad, n]).T, dyad_point - point)
    origin = point + s[0] * z
    gap = abs(s[2]) * np.linalg.norm(n)
    x = dyad - (dyad @ z) * z
    x /= np.linalg.norm(x)
    frame = np.array([x, np.cross(z, x), z])
    local = lambda coords: (coords - origin) @ frame.T
    r_local = frame @ r @ frame.T
    phi = np.degrees(np.arctan2(r_local[1, 0], r_local[0, 0]))
    tau = (frame @ (r @ origin + t - origin))[2]

    def ideal(coords, steps):
        theta = np.radians(phi * steps)
        rot = np.array([[np.cos(theta), -np.sin(theta), 0], [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
        return coords @ rot.T + np.array([0, 0, tau * steps])

    # Units 2..5 mapped onto unit 3 (C5, G6), whose G6 is the 5' side of the dyad's GpC step.
    units = [k for k in (2, 3, 4, 5) if z_one(a, k)]
    mean = np.mean([ideal(local(unit(a, k)), 3 - k) for k in units], axis=0)
    spread = np.sqrt(np.mean([((ideal(local(unit(a, k)), 3 - k) - mean) ** 2).sum(1).mean() for k in units]))
    print(f"4OCB screw: {angle:.2f} deg about the axis, {shift:+.3f} A along it (fit RMSD {screw_rmsd:.3f} A)", file=sys.stderr)
    print(f"frame: twist {-phi:.2f} deg, rise {-tau:.3f} A per dinucleotide; dyad to axis {np.degrees(np.arccos(abs(dyad @ z))):.2f} deg, gap {gap:.3f} A", file=sys.stderr)
    print(f"Z-I units {units}; template spread {spread:.3f} A", file=sys.stderr)
    mean, phi, tau = regularize(a, b, mean, phi, tau)
    pyrimidine = {name: mean[i] for i, (base, name) in enumerate(NAMES) if base == "C"}
    purine = {name: mean[i] for i, (base, name) in enumerate(NAMES) if base == "G"}

    fragments = {base: fragment(base) for base in BASES}
    def placed(base):
        kind = "purine" if base in "AG" else "pyrimidine"
        reference = purine if kind == "purine" else pyrimidine
        rr, tt = kabsch(np.array([fragments[base][name] for name in RING[kind]]), np.array([reference[name] for name in RING[kind]]))
        fit = np.sqrt(((np.array([fragments[base][name] for name in RING[kind]]) @ rr.T + tt - np.array([reference[name] for name in RING[kind]])) ** 2).sum(1).mean())
        print(f"{base} ring fit RMSD {fit:.3f} A", file=sys.stderr)
        return [(name, fragments[base][name] @ rr.T + tt) for name in BASES[base]]

    row = lambda name, coord: f'["{name}", {", ".join(format(round(float(value), 3) + 0.0, "g") for value in coord)}]'
    print(f"twistDegrees: {round(-phi, 2)}, riseAngstrom: {round(-tau, 3)},")
    print("pyrimidine:", "[" + ", ".join(row(name, pyrimidine[name]) for name in BACKBONE) + "],")
    print("purine:", "[" + ", ".join(row(name, purine[name]) for name in BACKBONE) + "],")
    for base in BASES:
        print(f"{base}:", "[" + ", ".join(row(name, coord) for name, coord in placed(base)) + "],")


main()
