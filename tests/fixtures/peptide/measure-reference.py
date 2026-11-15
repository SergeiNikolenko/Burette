"""Independent measurements of the peptide reference cases.

usage: python measure-reference.py <cases-dir> <ccd-cache-dir> <mkdssp> > reference-results.json

Reads every <cases-dir>/*.cif with gemmi and Biopython and compares it with the
wwPDB Chemical Component Dictionary, RDKit, MDAnalysis HELANAL and DSSP. None of
these values come from Burette code.
"""
import glob, hashlib, json, math, os, re, subprocess, sys, tempfile, urllib.request
import numpy as np, gemmi, Bio, rdkit, MDAnalysis as mda
from rdkit import Chem
from rdkit.Chem import rdCIPLabeler, rdMolDescriptors, rdDetermineBonds
from Bio.PDB import MMCIFParser
from Bio.PDB.Polypeptide import Polypeptide
from MDAnalysis.analysis import helix_analysis

cases_dir, ccd_dir, mkdssp = sys.argv[1:4]
# D components mirror their L partners (identical lengths, angles, names and protonation).
MIRROR = dict(DAL="ALA", DAR="ARG", DSG="ASN", DAS="ASP", DCY="CYS", DGN="GLN", DGL="GLU", DHI="HIS", DIL="ILE", DLE="LEU",
              DLY="LYS", MED="MET", DPN="PHE", DPR="PRO", DSN="SER", DTH="THR", DTR="TRP", DTY="TYR", DVA="VAL")
COMPONENTS = ["GLY", *MIRROR.values(), *MIRROR]
os.makedirs(ccd_dir, exist_ok=True)
ccd, ccd_sha = {}, {}
for name in COMPONENTS:
    path = f"{ccd_dir}/{name}.cif"
    if not os.path.exists(path):
        urllib.request.urlretrieve(f"https://files.wwpdb.org/pub/pdb/refdata/chem_comp/{name[-1]}/{name}/{name}.cif", path)
    ccd_sha[name] = hashlib.sha256(open(path, "rb").read()).hexdigest()
    block = gemmi.cif.read(path).sole_block()
    rows = block.find("_chem_comp_atom.", ["atom_id", "pdbx_stereo_config", "pdbx_model_Cartn_x_ideal", "pdbx_model_Cartn_y_ideal", "pdbx_model_Cartn_z_ideal"])
    ccd[name] = {"atoms": [gemmi.cif.as_string(r[0]) for r in rows],
                 "stereo": {gemmi.cif.as_string(r[0]): r[1] for r in rows if r[1] in ("R", "S")},
                 "ideal": {gemmi.cif.as_string(r[0]): np.array([float(r[k]) for k in (2, 3, 4)]) for r in rows if r[2] != "?"},
                 "bonds": [(gemmi.cif.as_string(r[0]), gemmi.cif.as_string(r[1])) for r in block.find("_chem_comp_bond.", ["atom_id_1", "atom_id_2"])],
                 "formula": gemmi.cif.as_string(block.find_value("_chem_comp.formula")), "charge": int(block.find_value("_chem_comp.pdbx_formal_charge"))}
partner = lambda name: ccd[MIRROR.get(name, name)]

def angle(a, b, c):
    u, v = a - b, c - b
    return math.degrees(math.acos(np.clip(np.dot(u, v) / np.linalg.norm(u) / np.linalg.norm(v), -1, 1)))

def span(values):
    return [round(min(values), 4), round(max(values), 4)] if values else None

def read(path):
    block = gemmi.cif.read(path).sole_block()
    st = gemmi.make_structure_from_block(block)
    chain = st[0][0]
    atoms = [(res.seqid.num, res.name, a.name, a.element.name, a.charge, np.array(a.pos.tolist())) for res in chain for a in res]
    index = {(r, n): i for i, (r, _, n, *_rest) in enumerate(atoms)}
    # struct_conn lists every bond the file declares, peptide links included.
    rows = block.find("_struct_conn.", ["ptnr1_label_seq_id", "ptnr1_label_atom_id", "ptnr2_label_seq_id", "ptnr2_label_atom_id", "pdbx_value_order"])
    bonds = [(index[(int(r[0]), gemmi.cif.as_string(r[1]))], index[(int(r[2]), gemmi.cif.as_string(r[3]))], 2 if r[4].upper().startswith("DOUB") else 1) for r in rows]
    return chain, atoms, bonds

def measure(path):
    chain, atoms, bonds = read(path)
    residues = list(chain)
    out = {"sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(), "chain": chain.name, "residues": [r.name for r in residues], "atoms": len(atoms), "bonds": len(bonds)}
    element = lambda e: e if len(e) == 1 else e[0] + e[1:].lower()
    mol = Chem.RWMol()
    for *_, el, charge, _ in atoms:
        atom = Chem.Atom(element(el)); atom.SetFormalCharge(charge); atom.SetNoImplicit(True); mol.AddAtom(atom)
    for a, b, order in bonds: mol.AddBond(a, b, Chem.BondType.DOUBLE if order == 2 else Chem.BondType.SINGLE)
    conf = Chem.Conformer(len(atoms))
    for i, a in enumerate(atoms): conf.SetAtomPosition(i, a[5].tolist())
    mol.AddConformer(conf, assignId=True); mol = mol.GetMol()
    Chem.SanitizeMol(mol); Chem.AssignStereochemistryFrom3D(mol); rdCIPLabeler.AssignCIPLabels(mol)
    label = lambda i: f"{atoms[i][0]}:{atoms[i][2]}"
    out["formula"] = re.sub(r"[+-]\d*$", "", rdMolDescriptors.CalcMolFormula(mol)); out["charge"] = Chem.GetFormalCharge(mol)
    out["cip"] = {label(a.GetIdx()): a.GetProp("_CIPCode") for a in mol.GetAtoms() if a.HasProp("_CIPCode")}
    out["ccd_stereo"] = {f"{r.seqid.num}:{name}": config for r in residues for name, config in ccd[r.name]["stereo"].items()}
    # Peptide formula from CCD residue formulas: n residues lose n-1 waters; NH3+ adds and CO2- removes one H.
    counts = {}
    for r in residues:
        for symbol, count in re.findall(r"([A-Z][a-z]?)(\d*)", partner(r.name)["formula"]): counts[symbol] = counts.get(symbol, 0) + int(count or 1)
    ammonium = atoms[0][4] == 1; carboxylate = any(a.name == "OXT" and a.charge == -1 for a in residues[-1])
    counts["H"] += -2 * (len(residues) - 1) + int(ammonium) - int(carboxylate); counts["O"] -= len(residues) - 1
    out["ccd_formula"] = "".join(f"{s}{counts[s] if counts[s] > 1 else ''}" for s in ["C", "H", *sorted(set(counts) - {"C", "H"})] if counts.get(s))
    out["ccd_charge"] = sum(partner(r.name)["charge"] for r in residues) + int(ammonium) - int(carboxylate)
    unknown, order, bond_dev, angle_dev = [], [], [], []
    for r in residues:
        c = partner(r.name); names = [a.name for a in r]
        extra = {"H2", "H3"} if r is residues[0] else set()
        unknown += [f"{r.seqid.num}:{x}" for x in names if x not in c["atoms"] and x not in extra]
        # Terminal H2/H3 rank directly after H, as in the CCD and in PDB entries.
        rank = [c["atoms"].index(x) if x in c["atoms"] else max(c["atoms"].index(h) for h in ("H", "H2") if h in c["atoms"]) + 0.5 for x in names]
        if rank != sorted(rank): order.append(f"{r.seqid.num}:{r.name}")
        pos = {a.name: np.array(a.pos.tolist()) for a in r}
        neighbours = {}
        for a, b in c["bonds"]:
            if a in pos and b in pos:
                bond_dev.append((abs(np.linalg.norm(pos[a] - pos[b]) - np.linalg.norm(c["ideal"][a] - c["ideal"][b])), f"{r.name}:{a}-{b}"))
            neighbours.setdefault(a, []).append(b); neighbours.setdefault(b, []).append(a)
        # Backbone N is sp2 in a peptide (sp3 at an ammonium terminus); the CCD
        # describes the free amino acid, so N-centred angles are checked separately.
        for center, ns in neighbours.items():
            if center == "N": continue
            for i in range(len(ns)):
                for j in range(i + 1, len(ns)):
                    trio = (ns[i], center, ns[j])
                    if all(t in pos for t in trio):
                        angle_dev.append((abs(angle(*[pos[t] for t in trio]) - angle(*[c["ideal"][t] for t in trio])), f"{r.name}:{'-'.join(trio)}"))
    out["names_not_in_ccd"] = unknown; out["order_differs_from_ccd"] = order
    worst = lambda values: [round(float(max(values)[0]), 5), max(values)[1]] if values else None
    out["bond_max_dev"] = worst(bond_dev); out["angle_max_dev"] = worst(angle_dev)
    at = lambda r, name: np.array(r[name][0].pos.tolist())
    link = {"C-N": [], "CA-C-N": [], "C-N-CA": [], "O-C-N": [], "N_angle_sum": []}
    out_of_plane = []
    for prev, r in zip(residues, residues[1:]):
        link["C-N"].append(float(np.linalg.norm(at(r, "N") - at(prev, "C"))))
        link["CA-C-N"].append(angle(at(prev, "CA"), at(prev, "C"), at(r, "N"))); link["C-N-CA"].append(angle(at(prev, "C"), at(r, "N"), at(r, "CA")))
        link["O-C-N"].append(angle(at(prev, "O"), at(prev, "C"), at(r, "N")))
        third = "CD" if r.find_atom("CD", "*") and r.name in ("PRO", "DPR") else "H"
        link["N_angle_sum"].append(angle(at(prev, "C"), at(r, "N"), at(r, "CA")) + angle(at(r, "CA"), at(r, "N"), at(r, third)) + angle(at(r, third), at(r, "N"), at(prev, "C")))
        if third == "H": out_of_plane.append(180 - abs(math.degrees(gemmi.calculate_dihedral(r["H"][0].pos, r["N"][0].pos, prev["C"][0].pos, prev["O"][0].pos))))
    out["peptide_link"] = {k: span(v) for k, v in link.items()}; out["amide_h_out_of_plane_max"] = round(max(out_of_plane), 4) if out_of_plane else None
    n0 = 0; around = [b if a == n0 else a for a, b, _ in bonds if n0 in (a, b)]
    out["terminal_n_angles"] = span([angle(atoms[i][5], atoms[n0][5], atoms[j][5]) for k, i in enumerate(around) for j in around[k + 1:]])
    # Connectivity perceived from coordinates alone (RDKit), against the declared bonds.
    bare = Chem.RWMol()
    for *_, el, _, _ in atoms: bare.AddAtom(Chem.Atom(element(el)))
    bare.AddConformer(Chem.Conformer(conf), assignId=True); bare = bare.GetMol(); rdDetermineBonds.DetermineConnectivity(bare, useHueckel=False)
    declared = {tuple(sorted((a, b))) for a, b, _ in bonds}; perceived = {tuple(sorted((b.GetBeginAtomIdx(), b.GetEndAtomIdx()))) for b in bare.GetBonds()}
    pair = lambda p: f"{label(p[0])}-{label(p[1])}"
    out["perceived_extra"] = [pair(p) for p in sorted(perceived - declared)]; out["perceived_missing"] = [pair(p) for p in sorted(declared - perceived)]
    # Clashes: Bondi radii, pairs more than three bonds apart, N/O donor-acceptor pairs exempt, MolProbity's 0.4 Å overlap.
    radius = {"H": 1.2, "C": 1.7, "N": 1.55, "O": 1.52, "S": 1.8}
    xyz = np.array([a[5] for a in atoms]); el = [a[3] for a in atoms]
    overlap = np.array([radius[e] for e in el])[:, None] + np.array([radius[e] for e in el])[None] - np.linalg.norm(xyz[:, None] - xyz[None], axis=-1)
    polar = np.array([e in "NO" for e in el]); polar_h = np.array([e == "H" and any(el[n.GetIdx()] in "NO" for n in mol.GetAtomWithIdx(i).GetNeighbors()) for i, e in enumerate(el)])
    heavy = np.array([e != "H" for e in el])
    mask = np.triu(np.ones_like(overlap, dtype=bool), 1) & (Chem.GetDistanceMatrix(mol) > 3) & ~((polar_h[:, None] & polar[None]) | (polar[:, None] & polar_h[None]) | (polar[:, None] & polar[None]))
    heavy_mask = mask & heavy[:, None] & heavy[None]
    out["worst_overlap"] = round(float(overlap[mask].max(initial=0)), 3); out["clash_count"] = int((mask & (overlap > 0.4)).sum())
    out["heavy_worst_overlap"] = round(float(overlap[heavy_mask].max(initial=0)), 3)
    out["heavy_clashes"] = [f"{pair((i, j))}:{overlap[i, j]:.2f}" for i, j in zip(*np.where(heavy_mask & (overlap > 0.4)))]
    # Backbone torsions with Biopython; omega with gemmi.
    model = MMCIFParser(QUIET=True).get_structure("peptide", path)[0]
    out["phi_psi"] = [[None if v is None else round(math.degrees(v), 4) for v in pair_] for pair_ in Polypeptide(list(next(model.get_chains()).get_residues())).get_phi_psi_list()]
    out["omega"] = [round(math.degrees(gemmi.calculate_omega(a, b)), 4) for a, b in zip(residues, residues[1:])]
    if len(residues) >= 9:
        u = mda.Universe.empty(len(atoms), n_residues=len(residues), atom_resindex=[a[0] - 1 for a in atoms], trajectory=True)
        u.add_TopologyAttr("name", [a[2] for a in atoms]); u.add_TopologyAttr("resid", [r.seqid.num for r in residues]); u.atoms.positions = xyz
        helanal = helix_analysis.HELANAL(u, select="name CA", ref_axis=[0, 0, 1]).run().results
        out["helanal"] = {"residues_per_turn": round(float(np.mean(helanal.local_nres_per_turn)), 4), "rise": round(float(np.mean(helanal.local_heights)), 4)}
    with tempfile.TemporaryDirectory() as tmp:
        dssp = subprocess.run([mkdssp, "--mmcif-dictionary", os.path.join(os.path.dirname(mkdssp), "../share/libcifpp/mmcif_pdbx.dic"), "--output-format", "dssp", path, f"{tmp}/out.dssp"], capture_output=True, text=True)
        out["dssp"] = "".join(l[16].replace(" ", "-") for l in open(f"{tmp}/out.dssp").read().split("  #  RESIDUE")[1].splitlines()[1:]) if dssp.returncode == 0 else f"error: {dssp.stderr.strip()[:200]}"
    return out

cases = {os.path.basename(p)[:-4]: measure(p) for p in sorted(glob.glob(f"{cases_dir}/*.cif"))}
# Mol* re-exports must reopen with the same atoms, charges, coordinates (3 decimals) and bonds.
for name in [n for n in cases if n.endswith(".molstar")]:
    (_, a, ab), (_, b, bb) = read(f"{cases_dir}/{name[:-8]}.cif"), read(f"{cases_dir}/{name}.cif")
    key = lambda atoms, bonds: sorted(tuple(sorted((atoms[x][:3], atoms[y][:3]))) + (o,) for x, y, o in bonds)
    cases[name]["reexport"] = {"atoms_equal": [x[:5] for x in a] == [y[:5] for y in b], "bonds_equal": key(a, ab) == key(b, bb),
                               "max_coordinate_delta": round(max(float(np.abs(x[5] - y[5]).max()) for x, y in zip(a, b)), 6)}
version = subprocess.run([mkdssp, "--version"], capture_output=True, text=True).stdout.split("\n")[0]
line = lambda value: json.dumps(value, separators=(",", ":"))
tools = {"python": sys.version.split()[0], "gemmi": gemmi.__version__, "biopython": Bio.__version__, "rdkit": rdkit.__version__, "MDAnalysis": mda.__version__, "numpy": np.__version__, "dssp": version}
print('{"tools":' + line(tools) + ',\n"ccd_sha256":' + line(ccd_sha) + ',\n"cases":{\n' + ",\n".join(f"{line(k)}:{line(v)}" for k, v in cases.items()) + "\n}}")
