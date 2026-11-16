"""Writes the independent references of tests/test-nucleic-acid-builder.test.ts.

Run on a host with network access, from an empty directory, with Open-Source PyMOL
3.1 (pymol-open-source-whl 3.1.0.4), gemmi, numpy, MDAnalysis and RDKit installed in
one Python 3.12 environment:
  <python> references.py <output-directory>

Outputs, all small and committed next to this script:
- <id>-core.pdb: heavy-atom ATOM records of crystal duplexes (see README.md), altloc A,
  with the chain id repeated as the segment id so MDAnalysis can address strands.
- fnab-<form>.pdb: Open-Source PyMOL `fnab` builds, heavy atoms, atom names mapped to
  the wwPDB CCD (O1P/O2P -> OP1/OP2, C5M -> C7) and strand B numbered 1..n 5' to 3'.
- reference-geometry.json: per structure, MDAnalysis nuclinfo backbone torsions
  alpha..zeta and chi and the Altona-Sundaralingam pseudorotation phase per nucleotide,
  Watson-Crick donor-acceptor distances per base pair, and helical screw parameters per
  repeat: rotation and rise of the least-squares superposition of the sugar rings of one
  repeat onto the next (mononucleotides for A/B, dinucleotides for Z; sugar rings keep
  the comparison independent of base identity and of the Z-I/Z-II phosphate switch).
- rdkit-references.json: RDKit Chem.MolFromSequence molecules (flavors 2/3 RNA and 6/7
  DNA, 5'-OH or 5'-phosphate, 3'-OH) with every P-OH ionised, as Hill formula, net
  charge, atom count with hydrogens and canonical isomeric SMILES.
"""
import json
import os
import sys
import urllib.request

import gemmi
import MDAnalysis as mda
import numpy as np
from MDAnalysis.analysis import nuclinfo
from pymol import cmd
from rdkit import Chem, rdBase
from rdkit.Chem.rdMolDescriptors import CalcMolFormula

OUT = sys.argv[1]
CORES = {
    # id: (chain A first..last, chain B first..last); B pairs A antiparallel.
    "1BNA": (("A", 4, 9), ("B", 16, 21)),   # B-DNA, CGCGAATTCGCG, 1.9 A: central GAATTC
    "1RNA": (("A", 5, 10), ("B", 19, 24)),  # A-RNA, UUAUAUAUAUAUAA, 2.25 A: central AUAUAU
    "1DCG": (("A", 2, 5), ("B", 8, 11)),    # Z-DNA, CGCGCG, 1.0 A: central GCGC
    "2F8W": (("A", 2, 5), ("B", 8, 11)),    # Z-DNA, CACGTG, 1.2 A: central ACGT
}
FNAB = {"b-dna": ("DNA", "B", True), "a-dna": ("DNA", "A", True), "a-rna": ("RNA", "A", False)}
FNAB_SEQUENCE = "GATTACAGC"
RENAME = {"O1P": "OP1", "O2P": "OP2", "C5M": "C7"}
PAIRS = {  # Watson-Crick donor-acceptor pairs, purine atom first
    ("A", "T"): [("N6", "O4"), ("N1", "N3")], ("A", "U"): [("N6", "O4"), ("N1", "N3")],
    ("G", "C"): [("O6", "N4"), ("N1", "N3"), ("N2", "O2")],
}
SUGAR = ["C1'", "C2'", "C3'", "C4'", "O4'"]


def pdb_line(serial, name, resn, chain, resi, xyz, element):
    label = f" {name:<3}" if len(name) < 4 else name
    return f"ATOM  {serial:5d} {label} {resn:>3} {chain}{resi:4d}    {xyz[0]:8.3f}{xyz[1]:8.3f}{xyz[2]:8.3f}  1.00  0.00      {chain:<4}{element:>2}"


def write_pdb(path, residues):
    """residues: [(chain, resi, resn, [(name, element, xyz)])]"""
    lines, serial = [], 0
    for chain, resi, resn, atoms in residues:
        for name, element, xyz in atoms:
            serial += 1
            lines.append(pdb_line(serial, name, resn, chain, resi, xyz, element))
    open(path, "w").write("\n".join(lines + ["END", ""]))


def crystal_cores():
    for pdb_id, ranges in CORES.items():
        path = os.path.join(OUT, f"{pdb_id}.cif")
        if not os.path.exists(path):
            urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id}.cif", path)
        st = gemmi.read_structure(path)
        st.remove_alternative_conformations()
        st.remove_hydrogens()
        residues = []
        for chain_id, first, last in ranges:
            for res in st[0][chain_id]:
                if first <= res.seqid.num <= last:
                    residues.append((chain_id, res.seqid.num, res.name, [(a.name, a.element.name, a.pos.tolist()) for a in res]))
        write_pdb(os.path.join(OUT, f"{pdb_id.lower()}-core.pdb"), residues)
        os.remove(path)


def fnab_builds():
    for key, (mode, form, double) in FNAB.items():
        cmd.delete("all")
        cmd.fnab(FNAB_SEQUENCE.replace("T", "U") if mode == "RNA" else FNAB_SEQUENCE, name="built", mode=mode, form=form, dbl_helix=int(double))
        model = cmd.get_model("built and not hydro")
        by_residue = {}
        for atom in model.atom:
            by_residue.setdefault((atom.chain, int(atom.resi), atom.resn), []).append((RENAME.get(atom.name, atom.name), atom.symbol, atom.coord))
        # PyMOL numbers the partner strand -n..-1 from its 3' end; renumber it 1..n from 5'.
        ordered = sorted(by_residue.items(), key=lambda item: (item[0][0], item[0][1]))
        residues = [(chain, resi if chain == "A" else resi + len(FNAB_SEQUENCE) + 1, resn, atoms) for (chain, resi, resn), atoms in ordered]
        write_pdb(os.path.join(OUT, f"fnab-{key}.pdb"), residues)


def kabsch(p, q):
    pc, qc = p.mean(0), q.mean(0)
    u, _, vt = np.linalg.svd((p - pc).T @ (q - qc))
    r = vt.T @ np.diag([1, 1, np.sign(np.linalg.det(vt.T @ u.T))]) @ u.T
    return r, qc - pc @ r.T


def screw(p, q):
    """Twist (degrees, negative = left-handed) and rise (A) of the superposition p -> q."""
    r, t = kabsch(p, q)
    angle = np.degrees(np.arccos(np.clip((np.trace(r) - 1) / 2, -1, 1)))
    axis = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    shift = t @ (axis / np.linalg.norm(axis))
    return float(np.sign(shift) * angle), float(abs(shift))


def geometry(path, repeat):
    u = mda.Universe(path)
    strands = {}
    for res in u.residues:
        strands.setdefault(res.segid, []).append(res)
    result = {"nucleotides": [], "pairs": [], "steps": []}
    for seg, residues in strands.items():
        for res in residues:
            i = int(res.resid)
            entry = {"chain": seg, "resid": i, "resname": res.resname.strip()}
            for name, fn in [("alpha", nuclinfo.tors_alpha), ("beta", nuclinfo.tors_beta), ("gamma", nuclinfo.tors_gamma), ("delta", nuclinfo.tors_delta),
                             ("epsilon", nuclinfo.tors_eps), ("zeta", nuclinfo.tors_zeta), ("chi", nuclinfo.tors_chi)]:
                try:
                    value = float(fn(u, seg, i))
                    entry[name] = round(value - 360 if value > 180 else value, 2)
                except Exception:
                    pass
            entry["phase"] = round(float(nuclinfo.phase_as(u, seg, i)), 2)
            result["nucleotides"].append(entry)
        # Repeats along the strand: consecutive units of `repeat` nucleotides.
        units = [residues[k:k + repeat] for k in range(0, len(residues) - repeat + 1, repeat)]
        def coords(unit):
            return np.array([res.atoms.select_atoms(f"name {name}").positions[0] for res in unit for name in SUGAR])
        for first, second in zip(units, units[1:]):
            twist, rise = screw(coords(first), coords(second))
            result["steps"].append({"chain": seg, "from": int(first[0].resid), "to": int(second[0].resid), "twist": round(twist, 2), "rise": round(rise, 3)})
    if len(strands) == 2:
        (seg_a, a), (seg_b, b) = strands.items()
        for res_a, res_b in zip(a, reversed(b)):
            codes = (res_a.resname.strip()[-1], res_b.resname.strip()[-1])
            purine, pyrimidine, key = (res_a, res_b, codes) if codes in PAIRS else (res_b, res_a, codes[::-1])
            distances = {f"{x}-{y}": round(float(np.linalg.norm(purine.atoms.select_atoms(f"name {x}").positions[0] - pyrimidine.atoms.select_atoms(f"name {y}").positions[0])), 3) for x, y in PAIRS[key]}
            c1 = round(float(np.linalg.norm(res_a.atoms.select_atoms("name C1'").positions[0] - res_b.atoms.select_atoms("name C1'").positions[0])), 3)
            result["pairs"].append({"a": int(res_a.resid), "b": int(res_b.resid), "pair": "".join(key), "hbonds": distances, "c1c1": c1})
    return result


def rdkit_references():
    cases = []
    for mode, flavors, sequence in (("DNA", (6, 7), "GATTACA"), ("DNA", (6, 7), "CACGTG"), ("RNA", (2, 3), "GAUUACA")):
        partner = sequence[::-1].translate(str.maketrans("ACGTU", "TGCAA" if mode == "DNA" else "UGCAA"))
        for flavor, five_prime in zip(flavors, ("hydroxyl", "phosphate")):
            for strands in ("single", "double"):
                mol = Chem.MolFromSequence(sequence, flavor=flavor)
                if strands == "double":
                    mol = Chem.CombineMols(mol, Chem.MolFromSequence(partner, flavor=flavor))
                ionised = Chem.RWMol(mol)
                for atom in ionised.GetAtoms():
                    if atom.GetSymbol() == "O" and atom.GetTotalNumHs() == 1 and any(n.GetSymbol() == "P" for n in atom.GetNeighbors()):
                        atom.SetFormalCharge(-1)
                        atom.SetNumExplicitHs(0)
                        atom.SetNoImplicit(True)
                Chem.SanitizeMol(ionised)
                with_h = Chem.AddHs(ionised)
                cases.append({"type": mode, "fivePrime": five_prime, "strands": strands, "sequence": sequence, "formula": CalcMolFormula(ionised),
                              "charge": Chem.GetFormalCharge(ionised), "atoms": with_h.GetNumAtoms(), "smiles": Chem.MolToSmiles(ionised)})
    return {"rdkit": rdBase.rdkitVersion, "cases": cases}


os.makedirs(OUT, exist_ok=True)
crystal_cores()
fnab_builds()
geometry_json = {
    "tools": {"MDAnalysis": mda.__version__, "gemmi": gemmi.__version__, "numpy": np.__version__, "pymol": cmd.get_version()[0]},
    "structures": {name: geometry(os.path.join(OUT, f"{name}.pdb"), 2 if name in ("1dcg-core", "2f8w-core") else 1)
                   for name in [f"{pdb_id.lower()}-core" for pdb_id in CORES] + [f"fnab-{key}" for key in FNAB]},
}
json.dump(geometry_json, open(os.path.join(OUT, "reference-geometry.json"), "w"), indent=1)
json.dump(rdkit_references(), open(os.path.join(OUT, "rdkit-references.json"), "w"), indent=1)
