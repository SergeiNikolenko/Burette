"""Ligand interaction diagram engine.

Run by Burette with a JSON request on stdin (see main at the end): a local
structure file -> chemistry (CCD bond orders, pH 7 charges) -> interaction perception
-> MOE-style layout (3D-matched ligand depiction, residue placement by energy
minimisation) -> InteractionDrawer scene JSON plus overlay data (proximity
contour, solvent exposure, chain links) and 3D references for Mol*.
"""
from __future__ import annotations

import json
import math
import re
import sys
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import gemmi
import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, rdDepictor
from scipy.optimize import minimize

RDLogger.DisableLog("rdApp.*")

# Chemical Component Dictionary entries give the ligand's bond orders; the host
# names the directory they are kept in, and a missing one is downloaded once.
CCD_DIR: Path | None = None
CCD_ENTRY_LIMIT = 4 * 1024 * 1024
UNIT = 10.0  # scene units per Angstrom of 2D depiction (RDKit bond 1.5 A -> 15 units)

WATER = {"HOH", "WAT", "DOD", "H2O"}
METALS = {"ZN", "MG", "CA", "MN", "FE", "FE2", "CO", "NI", "CU", "CU1", "NA", "K", "CD", "HG", "SR", "BA", "LI"}
IGNORED_HET = {"SO4", "PO4", "GOL", "EDO", "PEG", "ACT", "DMS", "CL", "BR", "IOD", "FMT", "MPD", "BME", "TRS", "EPE", "MES", "NO3", "ACY", "PG4", "1PE", "P6G"}
AMINO = {"ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL", "MSE", "SEC"}
HYDROPHOBIC_RES = {"ALA", "VAL", "LEU", "ILE", "MET", "PHE", "TRP", "PRO", "CYS", "MSE", "GLY"}
BASIC_RES = {"LYS", "ARG", "HIS"}
ACIDIC_RES = {"ASP", "GLU"}
BACKBONE = {"N", "CA", "C", "O", "OXT"}

# Layout rules, set per style by the "pipeline" block of styles/<id>.json. partners: how residues with
# specific contacts are drawn ("sidechain" draws side-chain partners as chemistry and backbone-only
# partners as discs); context: which other pocket residues are shown (MOE distance tiers, every residue
# within 4 A as in Schrodinger, only those in hydrophobic contact as in LigPlot, or none); hydrophobic: "spline" draws hydrophobic-only residues as
# PoseView arcs along the ligand. orientation: the ligand's long axis runs across a wide canvas
# ("landscape") or down a tall one ("portrait"), so the drawing fills a narrow side panel too.
RULE_VALUES = {"partners": {"disc", "fragment", "sidechain"}, "context": {"moe", "cutoff", "hydrophobic", "none"},
               "waters": {True, False}, "hydrophobic": {"spline", "none"},
               "orientation": {"landscape", "portrait"}}
DEFAULT_RULES = {"partners": "disc", "context": "moe", "waters": True, "hydrophobic": "none",
                 "orientation": "landscape"}
VDW = {"C": 1.7, "N": 1.55, "O": 1.52, "S": 1.8, "P": 1.8, "F": 1.47, "CL": 1.75, "BR": 1.85, "I": 1.98, "SE": 1.9, "B": 1.92}
METAL_RADIUS = 1.4

PROTEIN_DONORS = {
    ("*", "N"), ("ARG", "NE"), ("ARG", "NH1"), ("ARG", "NH2"), ("ASN", "ND2"), ("GLN", "NE2"),
    ("HIS", "ND1"), ("HIS", "NE2"), ("LYS", "NZ"), ("SER", "OG"), ("THR", "OG1"), ("TYR", "OH"),
    ("TRP", "NE1"), ("CYS", "SG"),
}
PROTEIN_ACCEPTORS = {
    ("*", "O"), ("*", "OXT"), ("ASN", "OD1"), ("ASP", "OD1"), ("ASP", "OD2"), ("GLN", "OE1"),
    ("GLU", "OE1"), ("GLU", "OE2"), ("HIS", "ND1"), ("HIS", "NE2"), ("SER", "OG"), ("THR", "OG1"),
    ("TYR", "OH"), ("MET", "SD"), ("CYS", "SG"),
}
PROTEIN_CHARGE = {
    ("ASP", "OD1"): -0.5, ("ASP", "OD2"): -0.5, ("GLU", "OE1"): -0.5, ("GLU", "OE2"): -0.5,
    ("LYS", "NZ"): 1.0, ("ARG", "NE"): 1 / 3, ("ARG", "NH1"): 1 / 3, ("ARG", "NH2"): 1 / 3,
}
AROMATIC_RINGS = {
    "PHE": [["CG", "CD1", "CD2", "CE1", "CE2", "CZ"]],
    "TYR": [["CG", "CD1", "CD2", "CE1", "CE2", "CZ"]],
    "HIS": [["CG", "ND1", "CD2", "CE1", "NE2"]],
    "TRP": [["CD2", "CE2", "CE3", "CZ2", "CZ3", "CH2"], ["CG", "CD1", "NE1", "CE2", "CD2"]],
}
CATION_CENTERS = {"LYS": ["NZ"], "ARG": ["CZ"]}
THREE_TO_TITLE = lambda name: name[:1] + name[1:].lower()  # noqa: E731


# ---------------------------------------------------------------- input

def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=20) as response:
            body = response.read(CCD_ENTRY_LIMIT + 1)
        if len(body) > CCD_ENTRY_LIMIT:
            raise ValueError("chemical component entry is too large")
        # concurrent requests fetch the same entry; readers never see half a file
        partial = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        partial.write_bytes(body)
        partial.replace(path)
    return path


@dataclass
class CcdComponent:
    atoms: dict  # atom name -> (element, charge, aromatic)
    bonds: list  # (name1, name2, order, aromatic)


_ccd_cache: dict[str, CcdComponent] = {}


def ccd(code: str) -> CcdComponent:
    if code in _ccd_cache:
        return _ccd_cache[code]
    if CCD_DIR is None or not re.fullmatch(r"[A-Za-z0-9]{1,5}", code):
        raise ValueError(f"no chemical component entry for {code}")
    path = fetch(f"https://files.rcsb.org/ligands/download/{code}.cif", CCD_DIR / f"{code.upper()}.cif")
    block = gemmi.cif.read(str(path)).sole_block()
    atoms = {}
    table = block.find("_chem_comp_atom.", ["atom_id", "type_symbol", "charge", "pdbx_aromatic_flag"])
    for row in table:
        charge = row[2]
        atoms[gemmi.cif.as_string(row[0])] = (row[1].upper(), int(charge) if charge not in ("?", ".") else 0, row[3] == "Y")
    bonds = []
    table = block.find("_chem_comp_bond.", ["atom_id_1", "atom_id_2", "value_order", "pdbx_aromatic_flag"])
    for row in table:
        bonds.append((gemmi.cif.as_string(row[0]), gemmi.cif.as_string(row[1]), row[2].upper(), row[3] == "Y"))
    _ccd_cache[code] = CcdComponent(atoms, bonds)
    return _ccd_cache[code]


@dataclass
class Atom:
    serial: int
    name: str
    element: str
    pos: np.ndarray
    chain: str
    resname: str
    resnum: int
    icode: str
    kind: str  # protein | water | metal | ligand | het

    @property
    def residue_key(self):
        return (self.chain, self.resnum, self.icode, self.resname)


def read_atoms(path: Path) -> list[Atom]:
    st = gemmi.read_structure(str(path))
    st.setup_entities()
    st.remove_alternative_conformations()
    model = st[0]
    atoms = []
    for chain in model:
        for res in chain:
            name = res.name
            if name in WATER:
                kind = "water"
            elif name in METALS:
                kind = "metal"
            elif name in AMINO and res.het_flag != "H" or name in AMINO:
                kind = "protein"
            else:
                kind = "het"
            for atom in res:
                if atom.element.name in ("H", "D"):
                    continue
                atoms.append(Atom(serial=atom.serial, name=atom.name, element=atom.element.name.upper(),
                                  pos=np.array(atom.pos.tolist()), chain=chain.name, resname=name,
                                  resnum=res.seqid.num, icode=res.seqid.icode.strip(), kind=kind))
    return atoms


def list_ligands(path: Path) -> list[dict]:
    residues = {}
    for atom in read_atoms(path):
        if atom.kind == "het" and atom.resname not in IGNORED_HET:
            residues.setdefault(atom.residue_key, 0)
            residues[atom.residue_key] += 1
    out = [{"id": f"{k[3]}_{k[0]}_{k[1]}", "name": k[3], "chain": k[0], "number": k[1], "atoms": n}
           for k, n in residues.items() if n >= 5]
    return sorted(out, key=lambda item: -item["atoms"])


# ---------------------------------------------------------------- chemistry

def build_mol(atoms: list[Atom], resname: str) -> Chem.Mol:
    """Heavy-atom molecule with CCD bond orders and pH 7 charges; conformer from the structure."""
    comp = ccd(resname)
    rw = Chem.RWMol()
    index = {}
    for atom in atoms:
        element, charge, aromatic = comp.atoms.get(atom.name, (atom.element, 0, False))
        a = Chem.Atom(element.capitalize() if len(element) > 1 else element)
        a.SetFormalCharge(charge)
        a.SetProp("name", atom.name)
        a.SetIntProp("serial", atom.serial)
        index[atom.name] = rw.AddAtom(a)
    orders = {"SING": Chem.BondType.SINGLE, "DOUB": Chem.BondType.DOUBLE, "TRIP": Chem.BondType.TRIPLE, "AROM": Chem.BondType.AROMATIC}
    for n1, n2, order, _aromatic in comp.bonds:
        if n1 in index and n2 in index:
            rw.AddBond(index[n1], index[n2], orders.get(order, Chem.BondType.SINGLE))
    conf = Chem.Conformer(rw.GetNumAtoms())
    for atom in atoms:
        conf.SetAtomPosition(index[atom.name], atom.pos.tolist())
    rw.AddConformer(conf, assignId=True)
    mol = rw.GetMol()
    mol.UpdatePropertyCache(strict=False)
    Chem.SanitizeMol(mol, catchErrors=True)
    return protonate(mol)


def protonate(mol: Chem.Mol) -> Chem.Mol:
    """Simple pH 7 states: acids lose a proton, aliphatic amines and amidines gain one."""
    rw = Chem.RWMol(mol)
    acids = [Chem.MolFromSmarts(s) for s in ("[OX2H1:1][PX4]", "[OX2H1:1][CX3]=[OX1]", "[OX2H1:1][SX4](=O)=O", "[OX2H1:1][SX3]=O")]
    seen = set()
    for pattern in acids:
        for match in rw.GetSubstructMatches(pattern):
            idx = match[0]
            if idx in seen:
                continue
            seen.add(idx)
            atom = rw.GetAtomWithIdx(idx)
            atom.SetFormalCharge(-1)
            atom.SetNumExplicitHs(0)
            atom.SetNoImplicit(True)
    amine = Chem.MolFromSmarts("[NX3;!$(N-[!#6]);!$(N-[#6]=[!#6]);!$(N-a);!$(N-C=[#6,#7,#8,#16])]")
    amidine = Chem.MolFromSmarts("[NX3;H2]-[CX3;!$(C-[#7;!H2])]=[NX2;H1;!R]")
    # A charge lowers the basicity of every amine within three bonds (the second nitrogen of a piperazine
    # stays neutral at pH 7), and a benzylic or allylic carbon lowers it too, so the most basic one wins.
    def withdrawn(atom):
        return sum(any(x.GetIsAromatic() or x.GetHybridization() != Chem.HybridizationType.SP3 or x.GetSymbol() != "C"
                       for x in n.GetNeighbors() if x.GetIdx() != atom.GetIdx()) for n in atom.GetNeighbors())
    amines = sorted((m[0] for m in rw.GetSubstructMatches(amine)), key=lambda i: (withdrawn(rw.GetAtomWithIdx(i)), i))
    distance = Chem.GetDistanceMatrix(rw)
    charged = [a.GetIdx() for a in rw.GetAtoms() if a.GetFormalCharge() > 0]
    for idx in amines:
        atom = rw.GetAtomWithIdx(idx)
        if atom.GetFormalCharge() == 0 and all(distance[idx][j] > 3 for j in charged):
            atom.SetFormalCharge(1)
            charged.append(idx)
    for match in rw.GetSubstructMatches(amidine):
        atom = rw.GetAtomWithIdx(match[2])
        atom.SetFormalCharge(1)
    mol = rw.GetMol()
    mol.UpdatePropertyCache(strict=False)
    Chem.SanitizeMol(mol, catchErrors=True)
    return mol


def ligand_roles(mol: Chem.Mol) -> tuple[set, set]:
    donors, acceptors = set(), set()
    for atom in mol.GetAtoms():
        symbol, charge, hs = atom.GetSymbol(), atom.GetFormalCharge(), atom.GetTotalNumHs()
        if symbol in ("N", "O") and hs > 0:
            donors.add(atom.GetIdx())
        if symbol == "O" and charge <= 0:
            acceptors.add(atom.GetIdx())
        if symbol == "N" and charge <= 0 and hs == 0:
            if atom.GetIsAromatic() and atom.GetDegree() == 2:
                acceptors.add(atom.GetIdx())
            elif not atom.GetIsAromatic() and atom.GetDegree() <= 3 and not any(n.GetIsAromatic() for n in atom.GetNeighbors()):
                amide = any(b.GetBondType() == Chem.BondType.DOUBLE for n in atom.GetNeighbors() for b in n.GetBonds() if b.GetOtherAtom(n).GetSymbol() in "OS")
                if not amide:
                    acceptors.add(atom.GetIdx())
        if symbol == "N" and atom.GetHybridization() == Chem.HybridizationType.SP and hs == 0:
            acceptors.add(atom.GetIdx())
        if symbol == "F":
            acceptors.add(atom.GetIdx())
    return donors, acceptors


def is_polar_carbon(atom: Chem.Atom) -> bool:
    return any(n.GetSymbol() in ("N", "O") for n in atom.GetNeighbors())


def protein_role(resname, name, table):
    return ("*", name) in table and not (name == "N" and resname == "PRO") or (resname, name) in table


def ring_geometry(points: np.ndarray):
    center = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - center)
    return center, vt[2] / np.linalg.norm(vt[2])


def angle_deg(a, b, c):
    v1, v2 = a - b, c - b
    cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


# ---------------------------------------------------------------- SASA

def sphere_points(n=96):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], axis=1)


SPHERE = sphere_points(120)


def sasa(coords: np.ndarray, radii: np.ndarray, which: np.ndarray, probe=1.4) -> np.ndarray:
    """Shrake-Rupley SASA for atoms `which` against all atoms in `coords`."""
    out = np.zeros(len(which))
    expanded = radii + probe
    for k, i in enumerate(which):
        points = coords[i] + SPHERE * expanded[i]
        near = np.where(np.linalg.norm(coords - coords[i], axis=1) < expanded[i] + expanded.max())[0]
        near = near[near != i]
        if len(near):
            d = np.linalg.norm(points[:, None, :] - coords[near][None, :, :], axis=2)
            free = ~(d < expanded[near][None, :]).any(axis=1)
        else:
            free = np.ones(len(points), bool)
        out[k] = 4 * math.pi * expanded[i] ** 2 * free.mean()
    return out


def radius_of(element: str) -> float:
    return VDW.get(element, METAL_RADIUS if element in METALS else 1.8)


# ---------------------------------------------------------------- perception

@dataclass
class Contact:
    kind: str  # hbond | ionic | metal | pi | cationPi | halogen | water
    ligand_atoms: list
    partner: tuple  # residue key
    partner_atoms: list  # Atom objects
    distance: float
    direction: str = ""  # ligand->partner | partner->ligand | both
    backbone: bool = False
    extra: dict = field(default_factory=dict)


def perceive(atoms: list[Atom], ligand_key: tuple):
    lig_atoms = [a for a in atoms if a.residue_key == ligand_key]
    if not lig_atoms:
        raise ValueError("ligand not found")
    mol = build_mol(lig_atoms, ligand_key[3])
    serial_to_idx = {a.GetIntProp("serial"): a.GetIdx() for a in mol.GetAtoms()}
    lig_pos = np.array([lig_atoms[[x.serial for x in lig_atoms].index(a.GetIntProp("serial"))].pos for a in mol.GetAtoms()])
    donors, acceptors = ligand_roles(mol)

    others = [a for a in atoms if a.residue_key != ligand_key]
    other_pos = np.array([a.pos for a in others])
    center = lig_pos.mean(axis=0)
    near_mask = np.linalg.norm(other_pos - center, axis=1) < np.linalg.norm(lig_pos - center, axis=1).max() + 9
    pocket = [a for a, m in zip(others, near_mask) if m]
    pocket_pos = np.array([a.pos for a in pocket])
    by_residue: dict[tuple, list[Atom]] = {}
    for a in pocket:
        by_residue.setdefault(a.residue_key, []).append(a)

    def protein_neighbors(atom: Atom):
        return [b for b in by_residue[atom.residue_key] if b is not atom and np.linalg.norm(b.pos - atom.pos) < 1.9]

    contacts: list[Contact] = []
    dmat = np.linalg.norm(lig_pos[:, None, :] - pocket_pos[None, :, :], axis=2)
    # metal coordination shells: receptor atoms bound to each pocket metal
    shell, metal_pos = {}, {}
    for m in (a for a in pocket if a.kind == "metal"):
        metal_pos[m.serial] = m.pos
        shell[m.serial] = [b for b in pocket if b.kind == "protein" and b.element in ("N", "O", "S") and np.linalg.norm(b.pos - m.pos) <= 2.8]
    coordinated = {b.serial: m for m, bs in shell.items() for b in bs}

    # hydrogen bonds and salt bridges with protein / ligand-water
    for i in range(len(lig_pos)):
        latom = mol.GetAtomWithIdx(i)
        lnbrs = [lig_pos[n.GetIdx()] for n in latom.GetNeighbors()]
        for j in np.where(dmat[i] < 5.0)[0]:
            p = pocket[j]
            d = dmat[i, j]
            if p.kind == "metal":
                if latom.GetSymbol() in ("N", "O", "S") and d <= 2.8:
                    contacts.append(Contact("metal", [i], p.residue_key, [p], d,
                                            extra={"bridges": [(b.residue_key, b.name, float(np.linalg.norm(b.pos - p.pos))) for b in shell[p.serial]]}))
                continue
            if p.kind == "water":
                continue
            p_donor = p.kind == "protein" and protein_role(p.resname, p.name, PROTEIN_DONORS)
            p_acceptor = p.kind == "protein" and protein_role(p.resname, p.name, PROTEIN_ACCEPTORS)
            l_donor, l_acceptor = i in donors, i in acceptors
            pairs = []
            if l_donor and p_acceptor:
                pairs.append("ligand->partner")
            if l_acceptor and p_donor:
                pairs.append("partner->ligand")
            # two ligands of the same metal sit close together without an H-bond between them
            if p.serial in coordinated and np.linalg.norm(lig_pos[i] - metal_pos[coordinated[p.serial]]) <= 2.8:
                pairs = []
            if pairs and d <= 3.5:
                pnbrs = [b.pos for b in protein_neighbors(p)]
                ok_l = all(angle_deg(n, lig_pos[i], p.pos) >= 80 for n in lnbrs)
                ok_p = all(angle_deg(n, p.pos, lig_pos[i]) >= 80 for n in pnbrs)
                if ok_l and ok_p:
                    direction = "both" if len(pairs) == 2 else pairs[0]
                    contacts.append(Contact("hbond", [i], p.residue_key, [p], d, direction, p.name in BACKBONE))
            lq = latom.GetFormalCharge()
            pq = PROTEIN_CHARGE.get((p.resname, p.name), 0)
            if lq * pq < 0 and d <= 5.0:
                contacts.append(Contact("ionic", [i], p.residue_key, [p], d))
            if latom.GetSymbol() in ("CL", "Cl", "Br", "I") and p_acceptor and d <= 4.0:
                cx = [lig_pos[n.GetIdx()] for n in latom.GetNeighbors()]
                if cx and angle_deg(cx[0], lig_pos[i], p.pos) >= 140:
                    contacts.append(Contact("halogen", [i], p.residue_key, [p], d))

    # merge: ionic wins over hbond for the same residue + ligand atom; keep one record per pair
    merged: dict[tuple, Contact] = {}
    rank = {"metal": 0, "ionic": 1, "hbond": 2, "halogen": 3}
    for c in contacts:
        key = (c.ligand_atoms[0], c.partner, c.partner_atoms[0].name if c.kind != "ionic" else "group")
        if c.kind == "ionic":
            key = (c.ligand_atoms[0], c.partner, "group")
        prev = merged.get(key)
        if prev is None or (rank[c.kind], c.distance) < (rank[prev.kind], prev.distance):
            merged[key] = c
    contacts = list(merged.values())
    # donor saturation: a donor makes at most as many H-bonds as it has hydrogens
    capacity = {}
    for i in donors:
        capacity[("L", i)] = mol.GetAtomWithIdx(i).GetTotalNumHs()
    kept = []
    for c in sorted([c for c in contacts if c.kind == "hbond"], key=lambda c: c.distance):
        p = c.partner_atoms[0]
        if c.direction == "ligand->partner":
            donor = ("L", c.ligand_atoms[0])
        elif c.direction == "partner->ligand":
            donor = ("P", p.serial)
            capacity.setdefault(donor, 2 if (p.resname, p.name) in {("ARG", "NH1"), ("ARG", "NH2"), ("ASN", "ND2"), ("GLN", "NE2")} else 3 if (p.resname, p.name) == ("LYS", "NZ") else 1)
        else:
            kept.append(c)
            continue
        if capacity.get(donor, 1) > 0:
            capacity[donor] = capacity.get(donor, 1) - 1
            kept.append(c)
    contacts = [c for c in contacts if c.kind != "hbond"] + kept
    ionic_pairs = {(c.ligand_atoms[0], c.partner) for c in contacts if c.kind == "ionic"}
    contacts = [c for c in contacts if not (c.kind == "hbond" and (c.ligand_atoms[0], c.partner) in ionic_pairs)]

    # water bridges (water anchored to ligand and receptor, as in MOE)
    polar_lig = donors | acceptors
    for res_key, ratoms in by_residue.items():
        if ratoms[0].kind != "water":
            continue
        w = ratoms[0]
        lig_hits = [i for i in polar_lig if np.linalg.norm(lig_pos[i] - w.pos) <= 3.3]
        prot_hits = [b for b in pocket if b.kind == "protein" and b.element in ("N", "O") and np.linalg.norm(b.pos - w.pos) <= 3.3
                     and (protein_role(b.resname, b.name, PROTEIN_DONORS) or protein_role(b.resname, b.name, PROTEIN_ACCEPTORS))]
        if lig_hits and prot_hits:
            best = min(lig_hits, key=lambda i: np.linalg.norm(lig_pos[i] - w.pos))
            contacts.append(Contact("water", [best], res_key, [w], float(np.linalg.norm(lig_pos[best] - w.pos)),
                                    extra={"bridges": [(b.residue_key, b.name, float(np.linalg.norm(b.pos - w.pos))) for b in prot_hits]}))

    # pi interactions
    ri = mol.GetRingInfo()
    lig_rings = [list(r) for r in ri.AtomRings() if all(mol.GetAtomWithIdx(k).GetIsAromatic() for k in r)]
    lig_ring_geo = [ring_geometry(lig_pos[r]) for r in lig_rings]
    for res_key, ratoms in by_residue.items():
        names = {a.name: a for a in ratoms}
        for ring_names in AROMATIC_RINGS.get(res_key[3], []):
            if not all(n in names for n in ring_names):
                continue
            pts = np.array([names[n].pos for n in ring_names])
            pc, pn = ring_geometry(pts)
            for k, (lc, ln) in enumerate(lig_ring_geo):
                d = float(np.linalg.norm(lc - pc))
                if d > 5.5:
                    continue
                tilt = math.degrees(math.acos(min(1.0, abs(float(np.dot(ln, pn))))))
                offset = min(np.linalg.norm((pc - lc) - np.dot(pc - lc, ln) * ln), np.linalg.norm((lc - pc) - np.dot(lc - pc, pn) * pn))
                if (tilt < 30 and offset < 2.0) or (tilt > 60 and offset < 2.0):
                    contacts.append(Contact("pi", lig_rings[k], res_key, [names[n] for n in ring_names], d, extra={"ring": k, "pring": ring_names}))
        for cname in CATION_CENTERS.get(res_key[3], []):
            if cname not in names:
                continue
            cp = names[cname].pos
            for k, (lc, ln) in enumerate(lig_ring_geo):
                d = float(np.linalg.norm(cp - lc))
                offset = np.linalg.norm((cp - lc) - np.dot(cp - lc, ln) * ln)
                if d <= 6.0 and offset < 2.0:
                    contacts.append(Contact("cationPi", lig_rings[k], res_key, [names[cname]], d, extra={"ring": k}))
    cations = [a.GetIdx() for a in mol.GetAtoms() if a.GetFormalCharge() > 0]
    for res_key, ratoms in by_residue.items():
        names = {a.name: a for a in ratoms}
        for ring_names in AROMATIC_RINGS.get(res_key[3], []):
            if not all(n in names for n in ring_names):
                continue
            pc, pn = ring_geometry(np.array([names[n].pos for n in ring_names]))
            for i in cations:
                d = float(np.linalg.norm(lig_pos[i] - pc))
                offset = np.linalg.norm((lig_pos[i] - pc) - np.dot(lig_pos[i] - pc, pn) * pn)
                if d <= 6.0 and offset < 2.0:
                    contacts.append(Contact("cationPi", [i], res_key, [names[n] for n in ring_names], d, extra={"pring": ring_names}))

    # hydrophobic contacts per residue
    hydrophobic = {}
    hydrophobic_atoms: dict[tuple, set[int]] = {}
    for i in range(len(lig_pos)):
        latom = mol.GetAtomWithIdx(i)
        if latom.GetSymbol() not in ("C", "Cl", "Br", "I", "S") or (latom.GetSymbol() == "C" and is_polar_carbon(latom)):
            continue
        for j in np.where(dmat[i] < 4.0)[0]:
            p = pocket[j]
            if p.kind != "protein" or p.resname not in HYDROPHOBIC_RES | {"TYR", "THR", "LYS"} or p.name in BACKBONE:
                continue
            if p.element not in ("C", "S"):
                continue
            hydrophobic_atoms.setdefault(p.residue_key, set()).add(i)
            prev = hydrophobic.get(p.residue_key)
            if prev is None or dmat[i, j] < prev[1]:
                hydrophobic[p.residue_key] = (i, float(dmat[i, j]), p)

    strong = {c.partner for c in contacts}

    # second-tier residues, MOE rule: 1 atom within 4.5 A, 2 within 4.6 ... 10 within 5.4
    context = set()
    for res_key, ratoms in by_residue.items():
        if res_key in strong or ratoms[0].kind not in ("protein", "metal", "het"):
            continue
        dists = sorted(float(np.min(np.linalg.norm(lig_pos - a.pos, axis=1))) for a in ratoms)
        if any(len([d for d in dists if d <= 4.5 + 0.1 * k]) >= k + 1 for k in range(10)):
            context.add(res_key)
    for key in hydrophobic:
        context.add(key)
    context -= strong

    # solvent exposure: ligand atom SASA in complex, receptor residue SASA loss
    env = [a for a in pocket if a.kind != "water"]
    env_pos = np.array([a.pos for a in env])
    lig_r = np.array([radius_of(a.GetSymbol().upper()) for a in mol.GetAtoms()])
    env_r = np.array([radius_of(a.element) for a in env])
    all_pos = np.vstack([lig_pos, env_pos])
    all_r = np.concatenate([lig_r, env_r])
    lig_sasa = sasa(all_pos, all_r, np.arange(len(lig_pos)))
    lig_free = sasa(lig_pos, lig_r, np.arange(len(lig_pos)))
    residue_loss = {}
    shell = [k for k, a in enumerate(env) if np.min(np.linalg.norm(lig_pos - a.pos, axis=1)) < 6.0]
    if shell:
        idx_env = np.array(shell) + len(lig_pos)
        with_lig = sasa(all_pos, all_r, idx_env)
        without = sasa(env_pos, env_r, np.array(shell))
        for k, a_idx in enumerate(shell):
            key = env[a_idx].residue_key
            residue_loss[key] = residue_loss.get(key, 0.0) + max(0.0, without[k] - with_lig[k])

    # MOE proximity: cannonball along substitution vectors
    proximity, exposed = cannonballs(mol, lig_pos, lig_r, env_pos, env_r)
    # nearest receptor or water N/O for each ligand atom, so weak polar partners beyond the H-bond cutoff count
    polar_env = np.array([a.pos for a in pocket if a.kind in ("protein", "water") and a.element in ("N", "O")]).reshape(-1, 3)
    polar_gap = np.linalg.norm(lig_pos[:, None, :] - polar_env[None, :, :], axis=2).min(axis=1) if len(polar_env) else np.full(len(lig_pos), np.inf)

    return {
        "mol": mol, "lig_pos": lig_pos, "contacts": contacts, "hydrophobic": hydrophobic, "hydrophobic_atoms": hydrophobic_atoms, "context": context,
        "by_residue": by_residue, "lig_sasa": lig_sasa, "lig_free": lig_free, "residue_loss": residue_loss,
        "proximity": proximity, "exposed": exposed, "serial_to_idx": serial_to_idx, "polar_gap": polar_gap,
    }


def substitution_vectors(mol, pos, i):
    atom = mol.GetAtomWithIdx(i)
    nbrs = [pos[n.GetIdx()] - pos[i] for n in atom.GetNeighbors()]
    nbrs = [v / np.linalg.norm(v) for v in nbrs]
    hyb = atom.GetHybridization()
    sp3 = hyb in (Chem.HybridizationType.SP3, Chem.HybridizationType.SP3D, Chem.HybridizationType.SP3D2)
    sp = hyb == Chem.HybridizationType.SP
    valence = 4 if sp3 else 3 if not sp else 2
    free = valence - len(nbrs)
    if free <= 0:
        return []
    if len(nbrs) == 0:
        return list(SPHERE[::6])
    if len(nbrs) == 1:  # terminal: umbrella sampling around the bond axis
        axis = -nbrs[0]
        if sp:
            return [axis]
        half = math.radians(180 - 109.5 if sp3 else 180 - 120)
        ortho = np.cross(axis, [1, 0, 0] if abs(axis[0]) < 0.9 else [0, 1, 0])
        ortho /= np.linalg.norm(ortho)
        other = np.cross(axis, ortho)
        return [math.cos(half) * axis + math.sin(half) * (math.cos(t) * ortho + math.sin(t) * other)
                for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    s = -sum(nbrs)
    norm = np.linalg.norm(s)
    if len(nbrs) == 2 and sp3:  # two tetrahedral positions
        bis = s / (norm + 1e-9)
        perp = np.cross(nbrs[0], nbrs[1])
        perp /= np.linalg.norm(perp) + 1e-9
        a = math.radians(54.75)
        return [math.cos(a) * bis + math.sin(a) * perp, math.cos(a) * bis - math.sin(a) * perp]
    if norm < 1e-3:
        perp = np.cross(nbrs[0], nbrs[1])
        return [perp / np.linalg.norm(perp)]
    return [s / norm]


def cannonballs(mol, lig_pos, lig_r, env_pos, env_r):
    """MOE proximity: distance a vdW-sized ball travels along each substitution vector (0..2 A)."""
    proximity = np.zeros(len(lig_pos))
    exposed = np.zeros(len(lig_pos), bool)
    all_pos = np.vstack([lig_pos, env_pos])
    all_r = np.concatenate([lig_r, env_r])
    steps = np.linspace(0, 8.0, 81)
    for i in range(len(lig_pos)):
        vectors = substitution_vectors(mol, lig_pos, i)
        if not vectors:
            continue
        bonded = {n.GetIdx() for n in mol.GetAtomWithIdx(i).GetNeighbors()} | {i}
        mask = np.array([k not in bonded for k in range(len(all_pos))])
        others, others_r = all_pos[mask], all_r[mask]
        extents, infinite = [], 0
        for v in vectors:
            start = lig_pos[i] + v * 1.5
            hit = None
            for t in steps:
                c = start + v * t
                if (np.linalg.norm(others - c, axis=1) < others_r + lig_r[i] * 0.85).any():
                    hit = t
                    break
            if hit is None:
                infinite += 1
                extents.append(2.0)
            else:
                extents.append(min(2.0, hit))
        proximity[i] = float(np.mean(extents))
        exposed[i] = infinite > len(vectors) / 2
    return proximity, exposed


# ---------------------------------------------------------------- 2D layout

def depict_ligand(mol: Chem.Mol, lig_pos: np.ndarray, partners=(), portrait=False):
    """2D coordinates that follow the 3D pose, oriented like the 3D pocket view.

    `partners` holds (ligand atom index, 3D partner point, partner key) for the drawn contacts.
    The long axis of the pose runs along x; `portrait` turns it to run down the page."""
    flat = Chem.Mol(mol)
    rdDepictor.SetPreferCoordGen(True)
    ref = Chem.Mol(mol)
    rdDepictor.Compute2DCoords(flat)
    xy = flat.GetConformer().GetPositions()[:, :2].copy()
    center3 = lig_pos.mean(axis=0)
    _, _, vt = np.linalg.svd(lig_pos - center3)
    proj = (lig_pos - center3) @ vt[:2].T
    xy = fold_to_pose(mol, xy, proj, [(i, (np.asarray(q) - center3) @ vt[:2].T, key) for i, q, key in partners])
    best = None
    for mirror in (1, -1):
        a = xy.copy()
        a[:, 1] *= mirror
        a -= a.mean(axis=0)
        h = a.T @ proj
        u, _, w = np.linalg.svd(h)
        r = u @ w
        if np.linalg.det(r) < 0:
            u[:, -1] *= -1
            r = u @ w
        err = np.linalg.norm(a @ r - proj)
        if best is None or err < best[0]:
            best = (err, a @ r, mirror)
    xy2 = best[1] * (UNIT)
    if portrait:
        xy2 = xy2 @ np.array([[0.0, -1.0], [1.0, 0.0]])  # (x, y) -> (y, -x): the left end goes to the top
    # projection basis to map any 3D point into the same 2D frame (least squares affine fit)
    design = np.hstack([lig_pos - center3, np.ones((len(lig_pos), 1))])
    affine, *_ = np.linalg.lstsq(design, xy2, rcond=None)
    return flat, xy2, affine, center3


POSE_SLACK = 1.7  # how much further from the pose a depiction may go to avoid a contact conflict


def fold_to_pose(mol: Chem.Mol, xy: np.ndarray, proj: np.ndarray, rays=()) -> np.ndarray:
    """Fold the canonical depiction toward the pocket pose, as Maestro LID does.

    Two moves keep bond lengths and ring shapes exact, so the drawing stays a clean depiction:
    an acyclic single bond between two non-terminal atoms mirrors one side across the bond line,
    and a branch atom trades the slot of a terminal neighbour with an acyclic branch (P(=O)(O-)
    can turn both oxygens toward the arginine that binds them). The pose comes first: among the
    layouts within POSE_SLACK of the closest fit to the 3D projection, the one with the fewest
    contact conflicts wins, then the closer fit. Conflicts are counted on a sketch of the final
    diagram: every partner sits where its 3D position projects, pushed out just past the ligand
    atoms in that direction, and all its contacts run straight to that one spot. A line crossing
    a bond or another line is a conflict. One spot per residue matters: Arg47 binding both
    phosphates of NAD closes a loop around O2A, which no single-line test can see.
    Layouts with non-bonded atoms closer than 0.8 bond are rejected. Wedges are recomputed from
    3D on the final coordinates; bonds next to a stereo double bond stay fixed, since moving them
    would flip E/Z.

    `rays` holds (ligand atom index, partner point in the projection frame, partner key).
    """
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in mol.GetBonds()]
    length = np.mean([np.linalg.norm(xy[a] - xy[b]) for a, b in bonds] or [1.0])
    scale = length / max(np.mean([np.linalg.norm(proj[a] - proj[b]) for a, b in bonds] or [1.0]), 1e-6)
    centre = proj.mean(axis=0)
    target = (proj - centre) * scale
    ray_atoms = np.array([a for a, *_ in rays], int)
    keys = sorted({key for *_, key in rays}, key=str)
    ray_partner = np.array([keys.index(key) for *_, key in rays], int)
    partner_at = np.array([np.mean([(q - centre) * scale for _, q, key in rays if key == k], axis=0) for k in keys]).reshape(-1, 2)
    ray_bonds = np.array([[i not in bond for bond in bonds] for i in ray_atoms], bool).reshape(len(ray_atoms), len(bonds))
    bond_a, bond_b = np.array([a for a, _ in bonds], int), np.array([b for _, b in bonds], int)
    far_i, far_j = np.nonzero(np.triu(Chem.GetDistanceMatrix(mol) >= 3))

    def stereo_double(atom):
        return any(b.GetBondType() == Chem.BondType.DOUBLE and not b.IsInRing()
                   and min(b.GetBeginAtom().GetDegree(), b.GetEndAtom().GetDegree()) >= 2 for b in atom.GetBonds())

    def side_of(a, c):
        cut = Chem.RWMol(mol)
        cut.RemoveBond(a, c)
        return np.array(next(f for f in Chem.GetMolFrags(cut) if c in f))

    hinges, swaps = [], []
    contacted = {a for a, *_ in rays}  # only a terminal atom that binds something is worth turning
    for bond in mol.GetBonds():
        a, c = bond.GetBeginAtom(), bond.GetEndAtom()
        if (bond.GetBondType() == Chem.BondType.SINGLE and not bond.IsInRing() and min(a.GetDegree(), c.GetDegree()) >= 2
                and not stereo_double(a) and not stereo_double(c)):
            hinges.append((a.GetIdx(), c.GetIdx(), side_of(a.GetIdx(), c.GetIdx())))
    for atom in mol.GetAtoms():
        if atom.GetDegree() < 3 or stereo_double(atom):
            continue
        c = atom.GetIdx()
        free = [b.GetOtherAtomIdx(c) for b in atom.GetBonds() if not b.IsInRing()]
        for n1 in free:
            for n2 in free:
                if n1 in contacted and mol.GetAtomWithIdx(n1).GetDegree() == 1 and mol.GetAtomWithIdx(n2).GetDegree() > 1:
                    swaps.append((c, n1, n2, side_of(c, n2)))

    def flip(out, move):
        p, q, side = move
        d = (out[q] - out[p]) / np.linalg.norm(out[q] - out[p])
        v = out[side] - out[p]
        out = out.copy()
        out[side] = out[p] + 2 * np.outer(v @ d, d) - v
        return out

    def swap(out, move):
        c, n1, n2, side = move
        u, v = out[n1] - out[c], out[n2] - out[c]
        t = math.atan2(u[1], u[0]) - math.atan2(v[1], v[0])
        rot = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
        out = out.copy()
        out[n1] = out[c] + v * np.linalg.norm(u) / max(np.linalg.norm(v), 1e-9)
        out[side] = (out[side] - out[c]) @ rot.T + out[c]
        return out

    def score(points):
        """(distance to the projection, contact conflicts)"""
        gap = points[far_i] - points[far_j]
        if len(gap) and np.min(np.einsum("ij,ij->i", gap, gap)) < (0.8 * length) ** 2:
            return np.inf, np.inf
        a = points - points.mean(axis=0)
        u, _, w = np.linalg.svd(a.T @ target)  # best rotation or reflection onto the projection
        aligned = a @ (u @ w)
        fit, total = np.linalg.norm(aligned - target), 0
        if len(ray_atoms):
            reach = np.linalg.norm(partner_at, axis=1)
            unit = partner_at / (reach[:, None] + 1e-9)
            along = aligned @ unit.T  # (atoms, partners)
            beside = np.sqrt(np.maximum(np.sum(aligned ** 2, axis=1)[:, None] - along ** 2, 0)) < 1.5 * length
            edge = np.max(np.where(beside, along, -np.inf), axis=0)
            spots = unit * np.maximum(reach, edge + 1.5 * length)[:, None]
            starts, ends = aligned[ray_atoms], spots[ray_partner]
            total += int(np.sum(proper_crossings(starts, ends, aligned[bond_a], aligned[bond_b]) & ray_bonds))
            total += int(np.sum(proper_crossings(starts, ends, starts, ends))) // 2
        return fit, total

    def every_fold(start):
        # a flip is its own inverse and toggles one hinge whatever the others do, so a Gray code
        # walks all 2^n combinations with one flip per step
        out = start
        yield out
        for step in range(1, 1 << len(hinges)):
            out = flip(out, hinges[(step & -step).bit_length() - 1])
            yield out

    # a swap turns half the ligand, which usually only fits after other hinges flip too,
    # so every single swap gets its own full enumeration of the hinge flips
    starts = [xy] + [swap(xy, m) for m in swaps]
    found = {}  # conflicts -> (fit, points): the closest fit for every conflict count

    def keep(points):
        fit, conflicts = score(points)
        if np.isfinite(fit) and (conflicts not in found or fit < found[conflicts][0]):
            found[conflicts] = (fit, points)

    keep(xy)
    if len(hinges) <= 12 and len(starts) << len(hinges) <= 40000:
        for start in starts:
            for out in every_fold(start):
                keep(out)
    moves = [(flip, m) for m in hinges] + [(swap, m) for m in swaps]
    for _ in range(30):  # polish every kept layout, also for ligands with too many hinges to enumerate
        before = {c: v[0] for c, v in found.items()}
        for _, current in list(found.values()):
            for apply, move in moves:
                keep(apply(current, move))
        if {c: v[0] for c, v in found.items()} == before:
            break
    if not found:
        return xy
    limit = min(v[0] for v in found.values()) * POSE_SLACK
    return found[min(c for c, (fit, _) in found.items() if fit <= limit)][1]


def to2d(affine, center3, points):
    points = np.atleast_2d(points)
    return np.hstack([points - center3, np.ones((len(points), 1))]) @ affine


@dataclass
class Glyph:
    key: tuple
    kind: str  # fragment | disc | water | metal
    contacts: list
    radius: float
    target_dir: np.ndarray
    desired: list  # (ligand atom index, desired distance from that atom to the glyph centre)
    strong: bool
    offset: float = 0.0  # centre -> contact atom distance for fragments
    fragment: tuple | None = None  # (mol, centred xy, atom names, contact atom index)
    pos: np.ndarray | None = None
    placed: np.ndarray | None = None  # drawn fragment atoms after refinement
    label_pos: np.ndarray | None = None

    @property
    def anchors(self):
        return [a for a, _ in self.desired]


def cross2(u, v):
    return u[..., 0] * v[..., 1] - u[..., 1] * v[..., 0]


def segment_distance(points, a, b):
    """Distance from each of `points` (N,2) to segments a->b (M,2) -> (M,N)."""
    ab = b - a
    t = np.clip(np.einsum("mnk,mk->mn", points[None, :, :] - a[:, None, :], ab) / (np.sum(ab * ab, axis=1)[:, None] + 1e-9), 0, 1)
    proj = a[:, None, :] + t[..., None] * ab[:, None, :]
    return np.linalg.norm(points[None, :, :] - proj, axis=2)


def crossings(lig_xy, bonds, anchor, ends):
    """Number of ligand bonds crossed by segments anchor->end for each end (K,2)."""
    a = lig_xy[anchor]
    count = np.zeros(len(ends))
    for b1, b2 in bonds:
        if anchor in (b1, b2):
            continue
        p1, p2 = lig_xy[b1], lig_xy[b2]
        d1 = cross2(p2 - p1, a - p1)
        d2 = cross2(p2 - p1, ends - p1)
        d3 = cross2(ends - a, p1 - a)
        d4 = cross2(ends - a, p2 - a)
        count += ((d1 * d2) < 0) & ((d3 * d4) < 0)
    return count


def relu(x):
    return np.maximum(x, 0.0)


class Layout:
    """MOE-style residue placement: greedy initial guess, then joint energy minimisation."""

    def __init__(self, glyphs, lig_xy, bonds, ring_centers, chain_pairs, obstacles=()):
        self.glyphs = glyphs
        self.obstacles = np.array(obstacles, float).reshape(-1, 2)  # fixed drawn points (hydrophobic arcs and their labels)
        self.lig = lig_xy
        self.bonds = bonds
        self.fixed = np.vstack([lig_xy] + ([np.array(ring_centers)] if ring_centers else []))
        index = {g.key: k for k, g in enumerate(glyphs)}
        self.links = np.array([(index[a], index[b]) for a, b in chain_pairs if a in index and b in index], int).reshape(-1, 2)
        self.radius = np.array([g.radius for g in glyphs])
        self.offset = np.array([g.offset if g.kind == "fragment" else g.radius for g in glyphs])
        self.targets = np.array([g.target_dir for g in glyphs])
        self.anchor_center = np.array([lig_xy[g.anchors].mean(axis=0) for g in glyphs])
        self.strong = np.array([g.strong for g in glyphs])
        rows = [(k, a, d) for k, g in enumerate(glyphs) for a, d in g.desired]
        self.d_glyph = np.array([r[0] for r in rows], int)
        self.d_atom = np.array([r[1] for r in rows], int)
        self.d_value = np.array([r[2] for r in rows], float)
        self.d_weight = np.where(self.strong[self.d_glyph], 1.0, 0.25)
        # interaction lines: one per (glyph, anchor atom) pair, used for crossing/overlap terms
        self.l_glyph, self.l_atom = self.d_glyph, self.d_atom
        neighbors = {i: {i} for i in range(len(lig_xy))}
        for b1, b2 in bonds:
            neighbors[b1].add(b2)
            neighbors[b2].add(b1)
        self.line_atom_mask = np.ones((len(self.l_glyph), len(lig_xy)), bool)
        for m, a in enumerate(self.l_atom):
            for n in neighbors[a]:
                self.line_atom_mask[m, n] = False

    def contact_points(self, P, idx=None):
        idx = np.arange(len(P)) if idx is None else idx
        u = self.anchor_center[idx] - P
        u /= np.linalg.norm(u, axis=1, keepdims=True) + 1e-9
        return P + u * self.offset[idx, None]

    def energy(self, x, base, active, present, tethers):
        P = base.copy()
        P[active] = x.reshape(-1, 2)
        pres = np.zeros(len(P), bool)
        pres[present] = True
        e = 0.0
        rows = pres[self.d_glyph]
        d = np.linalg.norm(P[self.d_glyph[rows]] - self.lig[self.d_atom[rows]], axis=1)
        e += np.sum(self.d_weight[rows] * (d - self.d_value[rows]) ** 2)
        loose = pres & ~self.strong
        e += 0.03 * np.sum((P[loose] - tethers[loose]) ** 2)
        Pp, Rp = P[pres], self.radius[pres]
        direction = Pp - self.anchor_center[pres]
        direction /= np.linalg.norm(direction, axis=1, keepdims=True) + 1e-9
        e += np.sum(np.where(self.strong[pres], 45.0, 35.0) * (1 - np.sum(direction * self.targets[pres], axis=1)))
        dl = np.linalg.norm(Pp[:, None, :] - self.fixed[None, :, :], axis=2)
        e += 80 * np.sum(relu(Rp[:, None] + 12 - dl) ** 2)
        dp = np.linalg.norm(Pp[:, None, :] - Pp[None, :, :], axis=2) + np.eye(len(Pp)) * 1e6
        e += 30 * np.sum(relu(Rp[:, None] + Rp[None, :] + 6 - dp) ** 2)
        if len(self.links):
            ok = pres[self.links[:, 0]] & pres[self.links[:, 1]]
            links = self.links[ok]
            dc = np.linalg.norm(P[links[:, 0]] - P[links[:, 1]], axis=1)
            limit = self.radius[links[:, 0]] + self.radius[links[:, 1]] + 22
            e += 2.0 * np.sum(relu(dc - limit))
        lines = pres[self.l_glyph]
        if lines.any():
            lg = self.l_glyph[lines]
            starts = self.lig[self.l_atom[lines]]
            ends = self.contact_points(P)[lg]
            dg = segment_distance(Pp, starts, ends)
            own = lg[:, None] == np.where(pres)[0][None, :]
            e += 60 * np.sum(np.where(own, 0, relu(Rp[None, :] + 4 - dg) ** 2))
            da = segment_distance(self.lig, starts, ends)
            e += 8 * np.sum(np.where(self.line_atom_mask[lines], relu(7 - da) ** 2, 0))
        return e

    def place_initial(self):
        P = np.zeros((len(self.glyphs), 2))
        placed = np.zeros(len(self.glyphs), bool)
        order = sorted(range(len(self.glyphs)), key=lambda k: (not self.strong[k], -len(self.glyphs[k].desired), -len(self.glyphs[k].contacts)))
        angles = np.radians(np.arange(0, 360, 6))
        units = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        for k in order:
            g = self.glyphs[k]
            base = float(np.mean([dv for _, dv in g.desired]))
            radii = base + np.array([-6, 0, 8, 18, 32, 50])
            cand = (self.anchor_center[k][None, None, :] + radii[:, None, None] * units[None, :, :]).reshape(-1, 2)
            score = np.zeros(len(cand))
            for a, dv in g.desired:
                w = 1.0 if g.strong else 0.25
                score += w * (np.linalg.norm(cand - self.lig[a], axis=1) - dv) ** 2
            direction = cand - self.anchor_center[k]
            direction /= np.linalg.norm(direction, axis=1, keepdims=True) + 1e-9
            score += (60.0 if g.strong else 40.0) * (1 - direction @ self.targets[k])
            dl = np.linalg.norm(cand[:, None, :] - self.fixed[None, :, :], axis=2)
            score += 80 * np.sum(relu(g.radius + 12 - dl) ** 2, axis=1)
            u = self.anchor_center[k] - cand
            u /= np.linalg.norm(u, axis=1, keepdims=True) + 1e-9
            contact = cand + u * self.offset[k]
            for a in g.anchors:
                score += 2500 * crossings(self.lig, self.bonds, a, contact)
            if placed.any():
                others = np.where(placed)[0]
                dp = np.linalg.norm(cand[:, None, :] - P[others][None, :, :], axis=2)
                score += 30 * np.sum(relu(g.radius + self.radius[others][None, :] + 6 - dp) ** 2, axis=1)
                # new lines through placed glyphs, placed lines through the candidate
                for a in g.anchors:
                    dg = segment_distance(P[others], np.repeat(self.lig[a][None, :], len(cand), axis=0), contact)
                    score += 400 * np.sum(dg < self.radius[others][None, :] + 2, axis=1)
                mask = np.isin(self.l_glyph, others)
                if mask.any():
                    starts = self.lig[self.l_atom[mask]]
                    ends = self.contact_points(P[self.l_glyph[mask]], self.l_glyph[mask])
                    dc = segment_distance(cand, starts, ends)
                    score += 400 * np.sum(dc < g.radius + 2, axis=0)
                for a_idx, b_idx in self.links:
                    other = b_idx if a_idx == k else a_idx if b_idx == k else None
                    if other is not None and placed[other]:
                        score += 2.0 * relu(np.linalg.norm(cand - P[other], axis=1) - (g.radius + self.radius[other] + 22))
            P[k] = cand[int(np.argmin(score))]
            placed[k] = True
        return P

    def run(self):
        P = self.place_initial()
        everyone = np.arange(len(P))
        result = minimize(self.energy, P.ravel(), args=(P, everyone, everyone, P.copy()),
                          method="L-BFGS-B", options={"maxiter": 250})
        P = result.x.reshape(-1, 2)
        for g, p in zip(self.glyphs, P):
            g.pos = p
        Refiner(self).run()
        return self.glyphs


def pairwise(a, b):
    """Euclidean distances (K,2) x (N,2) -> (K,N) without the (K,N,2) temporary."""
    sq = np.sum(a * a, axis=1)[:, None] + np.sum(b * b, axis=1)[None, :] - 2 * a @ b.T
    return np.sqrt(np.maximum(sq, 0.0))


def proper_crossings(a1, a2, b1, b2):
    """Proper intersections of segments a (C,2) with segments b (L,2) -> (C,L) bool."""
    ra, rb = (a2 - a1)[:, None, :], (b2 - b1)[None, :, :]
    d1 = cross2(rb, a1[:, None, :] - b1[None, :, :])
    d2 = cross2(rb, a2[:, None, :] - b1[None, :, :])
    d3 = cross2(ra, b1[None, :, :] - a1[:, None, :])
    d4 = cross2(ra, b2[None, :, :] - a1[:, None, :])
    return (d1 * d2 < -1e-6) & (d3 * d4 < -1e-6)


def paired_crossings(a1, a2, b1, b2):
    """Row-by-row proper intersections of segments a (C,2) and b (C,2) -> (C,) bool."""
    ra, rb = a2 - a1, b2 - b1
    d1, d2 = cross2(rb, a1 - b1), cross2(rb, a2 - b1)
    d3, d4 = cross2(ra, b1 - a1), cross2(ra, b2 - a1)
    return (d1 * d2 < -1e-6) & (d3 * d4 < -1e-6)


class Refiner:
    """Coordinate descent on the geometry that is actually drawn.

    The smooth layout energy treats every residue as a disc. Fragments are drawn as
    chemistry, so interaction lines end at specific atoms and long side chains reach
    far from the centre. This pass moves, rotates and mirrors one glyph at a time and
    scores real line lengths, line crossings and overlaps with the drawn atoms.
    """

    ATOM_CLEARANCE = 6.0
    # Crossings outrank every soft preference (line length, direction, distance to the pocket), so the
    # layout trades any amount of neatness for one crossing less. 200 left five crossings on NAD in 1HTB.
    LINE_CROSS = 2000  # one interaction line crossing another
    BOND_CROSS = 3000  # an interaction line crossing a ligand bond
    THROUGH = 1500  # an interaction line running through a residue it does not belong to

    def __init__(self, layout: Layout):
        self.L = layout
        self.glyphs = layout.glyphs
        self.lig = layout.lig
        self.bond_a = np.array([layout.lig[a] for a, _ in layout.bonds])
        self.bond_b = np.array([layout.lig[b] for _, b in layout.bonds])
        self.pose = [(1, 0.0)] * len(self.glyphs)
        self.body = [None] * len(self.glyphs)
        self.clear = []
        for k, g in enumerate(self.glyphs):
            n = len(g.fragment[1]) if g.kind == "fragment" else 1
            self.clear.append(np.full(n, self.ATOM_CLEARANCE if g.kind == "fragment" else g.radius))
            self.body[k] = self.shapes(k, g.pos[None, :], [(1, 0.0)])[0][0]
        index = {g.key: k for k, g in enumerate(self.glyphs)}
        self.lines = []  # (fixed ligand xy | None, ligand atoms near the start, glyph a, atom a, glyph b, atom b)
        for k, g in enumerate(self.glyphs):
            names = g.fragment[2] if g.kind == "fragment" else []
            for c in g.contacts:
                if c.kind == "hydrophobic":
                    continue
                # the scene draws atom-pair contacts from their first ligand atom and ring contacts from the ring centre
                ring = c.kind in ("pi", "cationPi") and len(c.ligand_atoms) > 1
                near = set(c.ligand_atoms) if ring else {c.ligand_atoms[0]}
                start = self.lig[sorted(near)].mean(axis=0)
                atom = names.index(c.partner_atoms[0].name) if c.partner_atoms and c.partner_atoms[0].name in names else 0
                self.lines.append((start, near, -1, -1, k, atom))
                for key, pname, _ in c.extra.get("bridges", []) if g.kind in ("water", "metal") else []:
                    h = index.get(key)
                    if h is None:
                        continue
                    target = self.glyphs[h]
                    if target.kind == "fragment":
                        target_names = target.fragment[2]
                        if pname not in target_names:
                            continue
                        endpoint = target_names.index(pname)
                    else:
                        endpoint = 0  # a schematic residue disc
                    self.lines.append((None, set(), k, 0, h, endpoint))
        self.bond_excluded = []
        for start, near, *_ in self.lines:
            self.bond_excluded.append(np.array([a in near or b in near for a, b in layout.bonds], bool))

    def shapes(self, k, centers, poses):
        """Drawn atoms for glyph k at each centre and (mirror, rotation) pose -> (C,M,2), pose list."""
        g = self.glyphs[k]
        if g.kind != "fragment":
            return centers[:, None, :], [(1, 0.0)] * len(centers)
        _, xy, _, contact = g.fragment
        out, used = [], []
        u = self.L.anchor_center[k][None, :] - centers
        base = np.arctan2(u[:, 1], u[:, 0])
        for mirror, extra in poses:
            q = xy * np.array([1, mirror])
            v = q[contact]
            theta = base - (math.atan2(v[1], v[0]) if np.linalg.norm(v) > 1e-6 else 0.0) + extra
            c, s = np.cos(theta), np.sin(theta)
            rot = np.stack([np.stack([c, -s], -1), np.stack([s, c], -1)], -2)  # (C,2,2)
            out.append(np.einsum("cij,mj->cmi", rot, q) + centers[:, None, :])
            used += [(mirror, extra)] * len(centers)
        return np.concatenate(out), used

    def endpoint(self, g, atom):
        return self.body[g][atom]

    def score(self, k, centers, bodies):
        g = self.glyphs[k]
        C = len(centers)
        s = np.zeros(C)
        flat = bodies.reshape(-1, 2)
        M = bodies.shape[1]
        clear_k = self.clear[k]
        # drawn atoms against the ligand and the other glyphs
        d = pairwise(flat, self.lig).reshape(C, M, -1)
        gap = 10 if g.kind == "fragment" else 16  # discs keep about a bond length off the ligand atoms
        s += 40 * np.sum(relu(clear_k[None, :, None] + gap - d) ** 2, axis=(1, 2))
        if len(self.L.obstacles):
            d = pairwise(flat, self.L.obstacles).reshape(C, M, -1)
            s += 40 * np.sum(relu(clear_k[None, :, None] + 9 - d) ** 2, axis=(1, 2))
        others = [h for h in range(len(self.glyphs)) if h != k and self.active[h]]
        if others:  # a ligand with a single partner has nothing else to avoid
            O = np.concatenate([self.body[h] for h in others])
            Oc = np.concatenate([self.clear[h] for h in others])
            Og = np.concatenate([np.full(len(self.body[h]), h) for h in others])
            d = pairwise(flat, O).reshape(C, M, -1)
            s += 40 * np.sum(relu(clear_k[None, :, None] + Oc[None, None, :] + 3 - d) ** 2, axis=(1, 2))
            onehot = (Og[:, None] == np.arange(len(self.glyphs))[None, :]).astype(float)
        own = []
        # lines that move with this glyph
        for li, (start, near, ga, ia, gb, ib) in enumerate(self.lines):
            if k not in (ga, gb):
                continue
            mine = bodies[:, ia if ga == k else ib, :]
            other = start if ga == -1 else self.endpoint(gb if ga == k else ga, ib if ga == k else ia)
            a = np.broadcast_to(other, mine.shape)
            own.append((a, mine))
            length = np.linalg.norm(mine - a, axis=1)
            s += length + 0.03 * relu(length - 35) ** 2
            keep = ~self.bond_excluded[li]
            if keep.any():  # water and metal relays to the protein must not cut through the ligand either
                s += self.BOND_CROSS * np.sum(proper_crossings(a, mine, self.bond_a[keep], self.bond_b[keep]), axis=1)
            if ga == -1:
                ld = segment_distance(self.lig, a, mine)  # (C, A)
                nearby = np.array([i in near for i in range(len(self.lig))])
                s += 60 * np.sum((ld < 7) & ~nearby[None, :], axis=1)
            if len(self.L.obstacles):  # interaction lines must not run through hydrophobic arcs or their labels
                s += 120 * np.sum(segment_distance(self.L.obstacles, a, mine) < 6, axis=1)
            if others:
                partner = gb if ga == k else ga
                hits = (segment_distance(O, a, mine) < Oc[None, :] + 2) & (Og[None, :] != partner)
                s += self.THROUGH * np.sum(hits.astype(float) @ onehot > 0, axis=1)
            rest = [m for m in self.lines if k not in (m[2], m[4])]
            if rest:
                rs = np.array([m[0] if m[2] == -1 else self.endpoint(m[2], m[3]) for m in rest])
                re = np.array([self.endpoint(m[4], m[5]) for m in rest])
                s += self.LINE_CROSS * np.sum(proper_crossings(a, mine, rs, re), axis=1)
        # two lines of one residue (Arg NE and NH2 to two phosphate oxygens) must not cross each other either
        for i in range(len(own)):
            for j in range(i + 1, len(own)):
                s += self.LINE_CROSS * paired_crossings(own[i][0], own[i][1], own[j][0], own[j][1])
        # lines of other glyphs passing through this glyph
        rest = [m for m in self.lines if k not in (m[2], m[4])]
        if rest:
            rs = np.array([m[0] if m[2] == -1 else self.endpoint(m[2], m[3]) for m in rest])
            re = np.array([self.endpoint(m[4], m[5]) for m in rest])
            d = segment_distance(flat, rs, re).reshape(len(rest), C, M)
            s += self.THROUGH * np.sum(np.any(d < clear_k[None, None, :] + 2, axis=2), axis=0)
        # MOE-style preferences
        direction = centers - self.L.anchor_center[k]
        direction /= np.linalg.norm(direction, axis=1, keepdims=True) + 1e-9
        s += (25.0 if g.strong else 35.0) * (1 - direction @ g.target_dir)
        if not g.strong:
            for a, dv in g.desired:
                s += 0.08 * (np.linalg.norm(centers - self.lig[a], axis=1) - dv) ** 2
            s += 15 * np.sum(np.exp(-pairwise(centers, self.lig) ** 2 / (2 * 20.0 ** 2)), axis=1)
        for a_idx, b_idx in self.L.links:
            other = b_idx if a_idx == k else a_idx if b_idx == k else None
            if other is not None and self.active[other]:
                limit = g.radius + self.glyphs[other].radius + 22
                s += 1.5 * relu(np.linalg.norm(centers - self.glyphs[other].pos, axis=1) - limit)
        return s

    def candidates(self, k):
        g = self.glyphs[k]
        angles = np.radians(np.arange(0, 360, 22.5))
        units = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        local = g.pos[None, :] + (np.array([5, 10, 18, 28])[:, None, None] * units[None]).reshape(-1, 2)
        ring_angles = np.radians(np.arange(0, 360, 15))
        ring_units = np.stack([np.cos(ring_angles), np.sin(ring_angles)], axis=1)
        reach = (g.offset if g.kind == "fragment" else g.radius) + np.array([22, 34, 48, 66, 90, 120])
        ring = self.L.anchor_center[k][None, :] + (reach[:, None, None] * ring_units[None]).reshape(-1, 2)
        return np.vstack([g.pos[None, :], local, ring])

    def run(self, sweeps=4):
        strong = [k for k in sorted(range(len(self.glyphs)), key=lambda k: -len(self.glyphs[k].contacts)) if self.glyphs[k].strong]
        context = [k for k in range(len(self.glyphs)) if not self.glyphs[k].strong]
        # MOE order: settle the interacting residues alone, then fit the pocket context around them
        self.active = np.array([g.strong for g in self.glyphs])
        self.sweep(strong, sweeps)
        self.active[:] = True
        self.sweep(context, sweeps)
        if self.swap():
            self.sweep(strong + context, 2)
        self.untangle()
        for g, body in zip(self.glyphs, self.body):
            if g.kind == "fragment":
                g.placed = body
        self.place_labels()

    def place_labels(self):
        """Put each fragment's residue label next to its own atoms, clear of everything else."""
        bond_mid = [self.lig[[a for a, _ in self.L.bonds]] * 0.5 + self.lig[[b for _, b in self.L.bonds]] * 0.5]
        mid_owner = [np.full(len(self.L.bonds), -1)]
        for k, g in enumerate(self.glyphs):
            if g.kind == "fragment":
                pairs = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in g.fragment[0].GetBonds()]
                if pairs:
                    bond_mid.append(np.array([(self.body[k][i] + self.body[k][j]) / 2 for i, j in pairs]))
                    mid_owner.append(np.full(len(pairs), k))
        points = np.vstack([self.lig] + self.body + bond_mid + [self.L.obstacles])
        clear = np.concatenate([np.full(len(self.lig), 5.0)] + self.clear + [np.full(len(m), 2.0) for m in mid_owner] + [np.full(len(self.L.obstacles), 6.0)])
        owner = np.concatenate([np.full(len(self.lig), -1)] + [np.full(len(b), k) for k, b in enumerate(self.body)] + mid_owner + [np.full(len(self.L.obstacles), -1)])
        starts = np.array([m[0] if m[2] == -1 else self.endpoint(m[2], m[3]) for m in self.lines]).reshape(-1, 2)
        ends = np.array([self.endpoint(m[4], m[5]) for m in self.lines]).reshape(-1, 2)
        boxes = []
        angles = np.radians(np.arange(0, 360, 30))
        units = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        for k in sorted(range(len(self.glyphs)), key=lambda k: -len(self.glyphs[k].contacts)):
            g = self.glyphs[k]
            if g.kind != "fragment":
                continue
            hw, hh = (5.0 * len(residue_label(g.key)) + 4) / 2, 4.5
            body = self.body[k]
            reach = np.abs(units[:, 0]) * hw + np.abs(units[:, 1]) * hh
            cand = np.concatenate([body[:, None, :] + units[None] * (reach[None, :, None] + d) for d in (5, 10, 18)], axis=1).reshape(-1, 2)
            dx = relu(np.abs(points[None, :, 0] - cand[:, None, 0]) - hw)
            dy = relu(np.abs(points[None, :, 1] - cand[:, None, 1]) - hh)
            gap = np.hypot(dx, dy)
            need = np.where(owner[None, :] == k, 2.0, clear[None, :] + 2)
            score = 50 * np.sum(relu(need - gap) ** 2, axis=1)
            if len(starts):
                for fx in (-0.9, -0.45, 0.0, 0.45, 0.9):
                    probe = cand + np.array([fx * hw, 0.0])
                    score += 150 * np.sum(segment_distance(probe, starts, ends) < hh + 1, axis=0)
            for cx, cy, bw, bh in boxes:
                ox = relu(np.minimum(cand[:, 0] + hw, cx + bw) - np.maximum(cand[:, 0] - hw, cx - bw) + 3)
                oy = relu(np.minimum(cand[:, 1] + hh, cy + bh) - np.maximum(cand[:, 1] - hh, cy - bh) + 3)
                score += 20 * ox * oy
            score += 2 * np.min(np.linalg.norm(cand[:, None, :] - body[None, :, :], axis=2), axis=1)
            best = cand[int(np.argmin(score))]
            g.label_pos = best
            boxes.append((best[0], best[1], hw, hh))

    def settle_at(self, k, center, poses):
        """Put glyph k at `center` in its best pose."""
        g = self.glyphs[k]
        bodies, used = self.shapes(k, center[None, :], poses if g.kind == "fragment" else [(1, 0.0)])
        scores = self.score(k, np.repeat(center[None, :], len(bodies), axis=0), bodies)
        best = int(np.argmin(scores))
        g.pos, self.body[k], self.pose[k] = center.copy(), bodies[best], used[best]

    def swap(self, rounds=3):
        """Exchange two glyphs whose lines cross.

        Moving one glyph at a time cannot untangle two residues that sit on each other's side of the
        ligand: every single step makes the pair overlap before it gets better. The score of the two
        glyphs holds every term their positions change, so comparing it before and after is enough.
        """
        poses = [(m, r) for m in (1, -1) for r in (0.0, -0.45, 0.45)]
        swapped = False
        for _ in range(rounds):
            if not self.lines:
                break
            starts = np.array([m[0] if m[2] == -1 else self.endpoint(m[2], m[3]) for m in self.lines]).reshape(-1, 2)
            ends = np.array([self.endpoint(m[4], m[5]) for m in self.lines]).reshape(-1, 2)
            crossed = proper_crossings(starts, ends, starts, ends)
            pairs = set()
            for i, j in zip(*np.nonzero(crossed)):
                for a in {self.lines[i][2], self.lines[i][4]} - {-1}:
                    for b in {self.lines[j][2], self.lines[j][4]} - {-1}:
                        if a != b:
                            pairs.add((min(a, b), max(a, b)))
            improved = False
            for a, b in sorted(pairs):
                pair_score = lambda: sum(self.score(k, self.glyphs[k].pos[None, :], self.body[k][None])[0] for k in (a, b))
                saved = [(self.glyphs[k].pos.copy(), self.body[k], self.pose[k]) for k in (a, b)]
                before = pair_score()
                pa, pb = saved[0][0], saved[1][0]
                self.settle_at(a, pb, poses)
                self.settle_at(b, pa, poses)
                self.settle_at(a, pb, poses)  # a's pose was chosen while b still sat on its new spot
                if pair_score() < before - 1e-3:
                    improved = swapped = True
                    continue
                for k, (pos, body, pose) in zip((a, b), saved):
                    self.glyphs[k].pos, self.body[k], self.pose[k] = pos, body, pose
            if not improved:
                break
        return swapped

    def tangles(self, k, centers, bodies):
        """Crossings and overlaps that involve glyph k, for each candidate (C,).

        Only these change when k moves, so a lower count is a lower count for the whole diagram.
        """
        C, M = bodies.shape[:2]
        flat = bodies.reshape(-1, 2)
        clear_k = self.clear[k]
        n = np.zeros(C)
        others = [h for h in range(len(self.glyphs)) if h != k]
        if others:
            O = np.concatenate([self.body[h] for h in others])
            Oc = np.concatenate([self.clear[h] for h in others])
            Og = np.concatenate([np.full(len(self.body[h]), h) for h in others])
            onehot = (Og[:, None] == np.array(others)[None, :]).astype(float)
            close = pairwise(flat, O).reshape(C, M, -1) < clear_k[None, :, None] + Oc[None, None, :]
            n += np.sum(np.any(close, axis=1).astype(float) @ onehot > 0, axis=1)
        n += np.any(pairwise(flat, self.lig).reshape(C, M, -1) < clear_k[None, :, None] + 3, axis=(1, 2))
        rest = [m for m in self.lines if k not in (m[2], m[4])]
        if rest:
            rs = np.array([m[0] if m[2] == -1 else self.endpoint(m[2], m[3]) for m in rest])
            re = np.array([self.endpoint(m[4], m[5]) for m in rest])
            through = segment_distance(flat, rs, re).reshape(len(rest), C, M) < clear_k[None, None, :] + 2
            through &= np.array([k != m[2] and k != m[4] for m in rest])[:, None, None]
            n += np.sum(np.any(through, axis=2), axis=0)
        own = []
        for li, (start, near, ga, ia, gb, ib) in enumerate(self.lines):
            if k not in (ga, gb):
                continue
            mine = bodies[:, ia if ga == k else ib, :]
            a = np.broadcast_to(start if ga == -1 else self.endpoint(gb if ga == k else ga, ib if ga == k else ia), mine.shape)
            own.append((a, mine))
            keep = ~self.bond_excluded[li]
            if keep.any():
                n += np.sum(proper_crossings(a, mine, self.bond_a[keep], self.bond_b[keep]), axis=1)
            if rest:
                n += np.sum(proper_crossings(a, mine, rs, re), axis=1)
            if others:
                hits = (segment_distance(O, a, mine) < Oc[None, :] + 2) & ~np.isin(Og, [ga, gb])[None, :]
                n += np.sum(hits.astype(float) @ onehot > 0, axis=1)
        for i in range(len(own)):
            for j in range(i + 1, len(own)):
                n += paired_crossings(own[i][0], own[i][1], own[j][0], own[j][1])
        return n

    def untangle(self, rounds=2):
        """Last resort for what the weighted score left: move a tangled glyph anywhere around the
        ligand, in any pose, if that lowers the number of crossings and overlaps it takes part in.
        The count decides; the ordinary score only breaks ties."""
        poses = [(m, r) for m in (1, -1) for r in (0.0, -0.45, 0.45)]
        angles = np.radians(np.arange(0, 360, 15))
        units = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        for _ in range(rounds):
            improved = False
            for k, g in enumerate(self.glyphs):
                now = self.tangles(k, g.pos[None, :], self.body[k][None])[0]
                if now == 0:
                    continue
                reach = (g.offset if g.kind == "fragment" else g.radius) + np.array([18, 30, 46, 66, 90, 120])
                centers = np.vstack([self.candidates(k), self.L.anchor_center[k][None, :] + (reach[:, None, None] * units[None]).reshape(-1, 2),
                                     self.lig.mean(axis=0)[None, :] + ((np.ptp(self.lig, axis=0).max() / 2 + reach)[:, None, None] * units[None]).reshape(-1, 2)])
                bodies, used = self.shapes(k, centers, poses if g.kind == "fragment" else [(1, 0.0)])
                all_centers = np.tile(centers, (len(bodies) // len(centers), 1))
                count = self.tangles(k, all_centers, bodies)
                if count.min() >= now:
                    continue
                pick = np.flatnonzero(count == count.min())
                best = pick[int(np.argmin(self.score(k, all_centers[pick], bodies[pick])))]
                g.pos, self.body[k], self.pose[k] = all_centers[best].copy(), bodies[best], used[best]
                improved = True
            if not improved:
                break

    def sweep(self, order, sweeps):
        poses = [(m, r) for m in (1, -1) for r in (0.0, -0.45, 0.45)]
        for _ in range(sweeps):
            moved = 0
            for k in order:
                g = self.glyphs[k]
                centers = self.candidates(k)
                bodies, used = self.shapes(k, centers, poses if g.kind == "fragment" else [(1, 0.0)])
                all_centers = np.tile(centers, (len(bodies) // len(centers), 1))
                current = self.score(k, g.pos[None, :], self.body[k][None])[0]
                scores = self.score(k, all_centers, bodies)
                best = int(np.argmin(scores))
                if scores[best] < current - 1e-3:
                    g.pos = all_centers[best].copy()
                    self.body[k] = bodies[best]
                    self.pose[k] = used[best]
                    moved += 1
            if not moved:
                break


def orient_fragment(g, lig_xy, anchor_center):
    """Rotate/mirror the residue fragment so its contact atom faces the ligand."""
    mol, xy, order, k = g.fragment
    u = anchor_center - g.pos
    u /= np.linalg.norm(u) + 1e-9
    best = None
    for mirror in (1, -1):
        q = xy.copy()
        q[:, 1] *= mirror
        v = q[k]
        theta = math.atan2(u[1], u[0]) - math.atan2(v[1], v[0]) if np.linalg.norm(v) > 1e-6 else 0.0
        rot = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
        placed = q @ rot.T + g.pos
        clearance = np.min(np.linalg.norm(placed[:, None, :] - lig_xy[None, :, :], axis=2))
        if best is None or clearance > best[0]:
            best = (clearance, placed)
    return best[1]


# ---------------------------------------------------------------- scene

def residue_label(key):
    chain, num, icode, name = key
    if name in WATER:
        return "H₂O"
    if name in METALS:
        return name.capitalize()
    return f"{THREE_TO_TITLE(name)}{num}{icode}{chain}"


def residue_class(name):
    if name in WATER:
        return "water"
    if name in METALS:
        return "metal"
    if name in ACIDIC_RES:
        return "res_acidic"
    if name in BASIC_RES:
        return "res_basic"
    if name in HYDROPHOBIC_RES:
        return "res_hydrophobic"
    if name in AMINO:
        return "res_polar"
    return "res_other"


def fragment_atoms(key, contact_atoms, by_residue, atoms_all):
    """Residue atoms to draw as chemistry: backbone and/or side chain around the contact atoms."""
    ratoms = {a.name: a for a in by_residue[key]}
    names = {a.name for a in contact_atoms}
    want = set(names)
    if names & BACKBONE:
        want |= {"N", "CA", "C", "O"}
    side = names - BACKBONE
    if side:
        want |= set(ratoms) - BACKBONE | {"CA"}
    return [ratoms[n] for n in ratoms if n in want]


def build_fragment(key, frag_atoms, atoms_all):
    comp = ccd(key[3])
    names = [a.name for a in frag_atoms]
    rw = Chem.RWMol()
    index = {}
    for a in frag_atoms:
        element = comp.atoms.get(a.name, (a.element, 0, False))[0]
        atom = Chem.Atom(element.capitalize() if len(element) > 1 else element)
        index[a.name] = rw.AddAtom(atom)
    for n1, n2, order, _ in comp.bonds:
        if n1 in index and n2 in index:
            rw.AddBond(index[n1], index[n2], {"DOUB": Chem.BondType.DOUBLE, "AROM": Chem.BondType.AROMATIC}.get(order, Chem.BondType.SINGLE))
    positions = {a.name: a.pos for a in frag_atoms}
    dummies = []
    ca = positions.get("CA")
    if "N" in index:
        prev = [b for b in atoms_all if b.chain == key[0] and b.resnum == key[1] - 1 and b.name == "C"]
        d = rw.AddAtom(Chem.Atom(0))
        rw.AddBond(index["N"], d, Chem.BondType.SINGLE)
        positions[f"R{d}"] = prev[0].pos if prev else positions["N"] + (positions["N"] - ca) if ca is not None else positions["N"]
        dummies.append((d, f"R{d}"))
    if "C" in index:
        nxt = [b for b in atoms_all if b.chain == key[0] and b.resnum == key[1] + 1 and b.name == "N"]
        d = rw.AddAtom(Chem.Atom(0))
        rw.AddBond(index["C"], d, Chem.BondType.SINGLE)
        positions[f"R{d}"] = nxt[0].pos if nxt else positions["C"] + (positions["C"] - ca)
        dummies.append((d, f"R{d}"))
    if "CA" in index and "N" not in index and "C" not in index:
        pass
    mol = rw.GetMol()
    mol.UpdatePropertyCache(strict=False)
    Chem.SanitizeMol(mol, catchErrors=True)
    conf = Chem.Conformer(mol.GetNumAtoms())
    order = names + [name for _, name in dummies]
    for k, name in enumerate(order):
        conf.SetAtomPosition(k, positions[name].tolist())
    mol.AddConformer(conf, assignId=True)
    flat = Chem.Mol(mol)
    try:
        rdDepictor.GenerateDepictionMatching3DStructure(flat, mol)
    except Exception:
        rdDepictor.Compute2DCoords(flat)
    xy = flat.GetConformer().GetPositions()[:, :2] * UNIT
    return mol, xy, order


def build(path: Path, ligand_id: str, rules: dict = DEFAULT_RULES) -> dict:
    atoms = read_atoms(path)
    name, chain, number = ligand_id.split("_")
    matches = [a for a in atoms if a.resname == name and a.chain == chain and a.resnum == int(number)]
    if not matches:
        raise ValueError(f"ligand {ligand_id} not found")
    ligand_key = matches[0].residue_key
    data = perceive(atoms, ligand_key)
    mol, lig_pos = data["mol"], data["lig_pos"]
    partners = [(c.ligand_atoms[0], c.partner_atoms[0].pos, c.partner) for c in data["contacts"]
                if c.partner_atoms and not (c.kind in ("pi", "cationPi") and len(c.ligand_atoms) > 1)]
    flat, lig_xy, affine, center3 = depict_ligand(mol, lig_pos, partners, rules.get("orientation") == "portrait")
    by_residue = data["by_residue"]

    # glyphs: one per partner residue / water / metal
    glyph_contacts: dict[tuple, list[Contact]] = {}
    for c in data["contacts"]:
        if c.partner[3] in WATER and not rules["waters"]:
            continue
        glyph_contacts.setdefault(c.partner, []).append(c)
    # Fragment layouts with explicit waters need atom-resolved relay targets,
    # including receptor residues that do not contact the ligand directly.
    relay_targets: dict[tuple, dict[str, tuple[int, float]]] = {}
    if rules["partners"] == "fragment" and rules["waters"]:
        for contacts in glyph_contacts.values():
            for c in contacts:
                for key, pname, distance in c.extra.get("bridges", []):
                    relay_targets.setdefault(key, {}).setdefault(pname, (c.ligand_atoms[0], c.distance + distance))

    glyphs = []
    for key in dict.fromkeys([*glyph_contacts, *relay_targets]):
        cs = glyph_contacts.get(key, [])
        relay = relay_targets.get(key, {})
        anchors = sorted({a for c in cs for a in c.ligand_atoms} or {a for a, _ in relay.values()})
        res_center = np.mean([a.pos for a in by_residue[key]], axis=0)
        ref3 = lig_pos[anchors].mean(axis=0)
        target = to2d(affine, center3, res_center)[0] - to2d(affine, center3, ref3)[0]
        target /= np.linalg.norm(target) + 1e-9
        drawn = rules["partners"]
        if drawn == "sidechain":
            drawn = "fragment" if any(pa.name not in BACKBONE for c in cs for pa in c.partner_atoms) else "disc"
        kind = "water" if key[3] in WATER else "metal" if key[3] in METALS else drawn
        if kind == "fragment":
            contact_atoms = [pa for c in cs for pa in c.partner_atoms]
            relay_atoms = [a for a in by_residue[key] if a.name in relay]
            fmol, fxy, order = build_fragment(key, fragment_atoms(key, contact_atoms + relay_atoms, by_residue, atoms), atoms)
            names = {a.name for a in contact_atoms or relay_atoms}
            k = next(i for i, n in enumerate(order) if n in names)
            centred = fxy - fxy.mean(axis=0)
            radius = float(np.max(np.linalg.norm(centred, axis=1))) + 4
            offset = float(np.linalg.norm(centred[k]))
            desired = [(c.ligand_atoms[0] if len(c.ligand_atoms) == 1 else int(c.ligand_atoms[0]), offset + float(np.clip(10 * c.distance, 24, 42))) for c in cs]
            if not desired:
                desired = [(a, offset + UNIT * distance) for a, distance in relay.values()]
            glyphs.append(Glyph(key, kind, cs, radius, target, desired, True, offset, (fmol, centred, order, k)))
        else:
            radius = 11.0 if kind == "disc" else 9.0
            desired = [(c.ligand_atoms[0], radius + float(np.clip(10 * c.distance, 24, 34))) for c in cs]
            glyphs.append(Glyph(key, kind, cs, radius, target, desired, True))
    if rules["context"] == "moe":
        context = set(data["context"])
    elif rules["context"] == "cutoff":  # Schrodinger: every residue with a heavy atom within 4 A
        context = {key for key, ratoms in by_residue.items() if ratoms[0].kind in ("protein", "metal", "het")
                   and min(float(np.min(np.linalg.norm(lig_pos - a.pos, axis=1))) for a in ratoms) <= 4.0}
    elif rules["context"] == "hydrophobic":
        context = set(data["hydrophobic"])
    else:
        context = set()
    context -= glyph_contacts.keys() | relay_targets.keys()
    # hydrophobic-only residues become arcs; the context then shows only the rest of the pocket
    splines = {key: atoms_ for key, atoms_ in data["hydrophobic_atoms"].items() if key not in glyph_contacts} \
        if rules["hydrophobic"] == "spline" else {}
    context -= set(splines)
    for key in sorted(context):
        res_center = np.mean([a.pos for a in by_residue[key]], axis=0)
        nearest = np.argsort(np.linalg.norm(lig_pos[:, None, :] - np.array([a.pos for a in by_residue[key]])[None, :, :], axis=2).min(axis=1))[:2]
        target = to2d(affine, center3, res_center)[0] - to2d(affine, center3, lig_pos[nearest].mean(axis=0))[0]
        target /= np.linalg.norm(target) + 1e-9
        radius = 11.0
        desired = [(int(a), radius + 42.0) for a in nearest]
        glyphs.append(Glyph(key, "metal" if key[3] in METALS else "disc", [], radius, target, desired, False))

    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in mol.GetBonds()]
    rings = [list(r) for r in mol.GetRingInfo().AtomRings()]
    ring_centers = [lig_xy[r].mean(axis=0) for r in rings]
    amino_keys = sorted([g.key for g in glyphs if g.key[3] in AMINO], key=lambda k: (k[0], k[1]))
    chain_pairs = [(a, b) for a, b in zip(amino_keys, amino_keys[1:]) if a[0] == b[0] and 0 < b[1] - a[1] <= 4]
    # PoseView: hydrophobic-only residues as arcs along the ligand atoms they touch. An arc follows one
    # contiguous run of atoms, so it never jumps across the drawing; each residue keeps its largest run, and
    # residues whose runs share atoms share one arc and stack their labels. Built before the layout so
    # residues avoid them.
    bond = float(np.median([np.linalg.norm(lig_xy[a] - lig_xy[b]) for a, b in
                            ((x.GetBeginAtomIdx(), x.GetEndAtomIdx()) for x in mol.GetBonds())])) if mol.GetNumBonds() else 15.0

    def largest_run(atoms_: set) -> set:
        left, best = set(atoms_), set()
        while left:
            run, todo = set(), [left.pop()]
            while todo:
                a = todo.pop()
                run.add(a)
                near_ = {b for b in left if np.linalg.norm(lig_xy[a] - lig_xy[b]) < 1.6 * bond}
                left -= near_
                todo.extend(near_)
            best = max(best, run, key=len)
        return best

    patches: list[dict] = []
    for key, touched in sorted(splines.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        run = largest_run(set(touched))
        joined = [p for p in patches if p["atoms"] & run]
        patch = {"atoms": run.union(*(p["atoms"] for p in joined)), "keys": [k for p in joined for k in p["keys"]] + [key]}
        patches = [p for p in patches if p not in joined] + [patch]
    for patch in patches:
        idx = sorted(patch["atoms"])
        pts = lig_xy[idx]
        # each control point leaves its atom away from that atom's own neighbourhood, so the arc wraps
        # around rings and chains instead of cutting through them
        normals = []
        for p in pts:
            v = p - lig_xy[np.linalg.norm(lig_xy - p, axis=1) < 2.2 * bond].mean(axis=0)
            normals.append(v)
        outward = np.mean(normals, axis=0)
        if np.linalg.norm(outward) < 0.1 * bond:
            outward = np.mean([to2d(affine, center3, np.mean([a.pos for a in by_residue[key]], axis=0))[0] for key in patch["keys"]], axis=0) - pts.mean(axis=0)
        outward /= np.linalg.norm(outward) + 1e-9
        normals = [n / np.linalg.norm(n) if np.linalg.norm(n) > 0.1 * bond else outward for n in normals]
        normals = [n if n @ outward > -0.2 else outward for n in normals]
        across = np.array([-outward[1], outward[0]])
        order = np.argsort(pts @ across)
        ctrl = []
        for k in order:
            q = pts[k] + normals[k] * 0.55 * bond
            for _ in range(6):  # keep clear of every other ligand atom
                if np.min(np.linalg.norm(lig_xy - q, axis=1)) >= 0.45 * bond:
                    break
                q = q + normals[k] * 0.15 * bond
            ctrl.append((q, idx[k]))
        # bend both ends back toward the ligand so every arc reads as a bracket around the atoms it touches
        (first, i0), (last, i1) = ctrl[0], ctrl[-1]
        ctrl = [(first - across * 0.5 * bond - outward * 0.25 * bond, i0)] + ctrl + \
            [(last + across * 0.5 * bond - outward * 0.25 * bond, i1)]
        patch["ctrl"] = ctrl
        patch["mid"], patch["outward"] = np.mean([p for p, _ in ctrl], axis=0), outward
    arcs = np.array([p for patch in patches for p, _ in patch["ctrl"]]) if patches else np.zeros((0, 2))

    def box_gap(points, centre, half):
        d = np.maximum(np.abs(points - centre) - half, 0)
        return float(np.min(np.hypot(d[:, 0], d[:, 1]))) if len(points) else np.inf

    def place_spline_labels(drawn):
        """Stack each patch's labels as one block of text lines at the nearest free spot in a fan around the
        arc's outward direction, clear of the ligand, the arcs, earlier blocks and the other drawn points.
        Boxes are sized for text up to 8 px."""
        placed: list[tuple[np.ndarray, np.ndarray]] = []  # (centre, half-size) of every label line
        for patch in patches:
            lines = [(key, np.array([2.4 * len(residue_label(key)) + 2, 5.0])) for key in patch["keys"]]
            rows = len(lines)
            out = patch["outward"]
            fan = [np.array([np.cos(t) * out[0] - np.sin(t) * out[1], np.sin(t) * out[0] + np.cos(t) * out[1]])
                   for t in np.radians([0, 25, -25, 50, -50, 75, -75])]
            found = False
            for step in np.arange(10.0, 160.0, 3.0):
                for direction in fan:
                    base = patch["mid"] + direction * step
                    boxes = [(base + np.array([0.0, (j - (rows - 1) / 2) * 10.0]), half) for j, (_, half) in enumerate(lines)]
                    if all(box_gap(lig_xy, c, h) >= 7 and box_gap(arcs, c, h) >= 3 and box_gap(drawn, c, h) >= 4 and
                           not any(np.all(np.abs(c - pc) < h + ph + 1) for pc, ph in placed)
                           for c, h in boxes):
                        found = True
                        break
                if found:
                    break
            placed.extend(boxes)
            patch["labels"] = [(key, c) for (key, _), (c, _) in zip(lines, boxes)]
        return placed

    # first pass reserves room so residues avoid the arcs and their labels
    placed = place_spline_labels(np.zeros((0, 2)))
    obstacles = [p for patch in patches for p, _ in patch["ctrl"]] + \
        [c + np.array([dx * h[0], 0.0]) for c, h in placed for dx in (-1, 0, 1)]
    Layout(glyphs, lig_xy, bonds, ring_centers, chain_pairs, obstacles).run()
    if patches:
        # second pass sees the placed residues, their labels and every interaction line
        drawn = []
        for g in glyphs:
            body = g.placed if g.kind == "fragment" and getattr(g, "placed", None) is not None else g.pos[None, :]
            drawn.append(body)
            if g.kind != "fragment":
                drawn.append(g.pos + g.radius * np.stack([np.cos(np.arange(0, 6.3, 0.5)), np.sin(np.arange(0, 6.3, 0.5))], axis=1))
            if g.kind == "fragment" and g.label_pos is not None:
                hw = 2.4 * len(residue_label(g.key)) + 2
                drawn.append(g.label_pos + np.array([[dx, dy] for dx in np.linspace(-hw, hw, 5) for dy in (-4.5, 0, 4.5)]))
            names = g.fragment[2] if g.kind == "fragment" else []
            for c in g.contacts:
                if c.kind == "hydrophobic":
                    continue
                a = lig_xy[list(c.ligand_atoms)].mean(axis=0)
                pname = c.partner_atoms[0].name if c.partner_atoms else None
                b = body[names.index(pname)] if pname in names else g.pos
                n = max(2, int(np.linalg.norm(b - a) / 3))
                drawn.append(a + (b - a) * np.linspace(0, 1, n)[:, None])
        place_spline_labels(np.vstack(drawn))

    # ---- scene structures
    flip = np.array([1, -1])  # SVG y grows downwards
    structures, annotations, pair_ints, pi_ints, cation_ints = [], [], [], [], []
    next_atom_id = [1]

    def new_atom_id():
        next_atom_id[0] += 1
        return next_atom_id[0]

    lig_atom_ids = {}
    lig_atoms_json = []
    for atom in mol.GetAtoms():
        i = atom.GetIdx()
        aid = new_atom_id()
        lig_atom_ids[i] = aid
        symbol = atom.GetSymbol()
        lig_atoms_json.append({
            "id": aid, "element": symbol, "label": "" if symbol == "C" else symbol,
            "coordinates": {"x": float(lig_xy[i][0]), "y": float(-lig_xy[i][1])},
            "charge": atom.GetFormalCharge(), "hydrogenCount": atom.GetTotalNumHs(),
            "aromatic": False, "additionalInformation": {"atomName": atom.GetProp("name"), "serial": atom.GetIntProp("serial")},
        })
    kek = Chem.Mol(mol)
    try:
        Chem.Kekulize(kek, clearAromaticFlags=True)
    except Exception:
        pass
    bond_json = []
    for b in kek.GetBonds():
        t = {Chem.BondType.DOUBLE: "double", Chem.BondType.TRIPLE: "triple"}.get(b.GetBondType(), "single")
        bond_json.append({"id": b.GetIdx() + 1, "from": lig_atom_ids[b.GetBeginAtomIdx()], "to": lig_atom_ids[b.GetEndAtomIdx()], "type": t, "aromatic": False})
    add_wedges(mol, flat, lig_xy, bond_json, lig_atom_ids)
    ring_json = []
    ring_id = 1
    lig_ring_ids = {}
    for k, r in enumerate(rings):
        ring_json.append({"id": ring_id, "atoms": [lig_atom_ids[i] for i in r]})
        lig_ring_ids[tuple(sorted(r))] = ring_id
        ring_id += 1
    structures.append({"id": 0, "structureName": ligand_id, "structureType": "ligand", "structureLabel": name,
                       "representation": 1, "atoms": lig_atoms_json, "bonds": bond_json, "rings": ring_json})

    sid = 0
    contact_out = []
    glyph_struct = {}
    atom_refs = {}  # scene atom id -> 3D reference
    for g in glyphs:
        sid += 1
        glyph_struct[g.key] = sid
        label = residue_label(g.key)
        info = {"chain": g.key[0], "number": g.key[1], "name": g.key[3], "class": residue_class(g.key[3]),
                "sasaLoss": round(data["residue_loss"].get(g.key, 0.0), 1), "tier": "strong" if g.strong else "context"}
        if g.kind == "fragment":
            fmol, _, order, _ = g.fragment
            anchor = lig_xy[g.anchors].mean(axis=0)
            placed = g.placed if g.placed is not None else orient_fragment(g, lig_xy, anchor)
            atom_json, name_to_id = [], {}
            for k, a in enumerate(fmol.GetAtoms()):
                aid = new_atom_id()
                nm = order[k]
                name_to_id[nm] = aid
                symbol = "R" if a.GetAtomicNum() == 0 else a.GetSymbol()
                charge = 0
                if (g.key[3], nm) in PROTEIN_CHARGE:
                    q = PROTEIN_CHARGE[(g.key[3], nm)]
                    charge = -1 if q < 0 and nm in ("OD2", "OE2") else (1 if g.key[3] == "LYS" or (g.key[3] == "ARG" and nm == "NH2") else 0)
                hs = 0
                if symbol in ("N", "O", "S"):
                    if protein_role(g.key[3], nm, PROTEIN_DONORS) and not (nm == "N" and g.key[3] == "PRO"):
                        hs = 2 if (g.key[3], nm) in {("ARG", "NH1"), ("ARG", "NH2"), ("ASN", "ND2"), ("GLN", "NE2")} else 3 if (g.key[3], nm) == ("LYS", "NZ") else 1
                        if (g.key[3], nm) in {("HIS", "ND1")}:
                            hs = 0
                atom_json.append({"id": aid, "element": "C" if symbol == "R" else symbol, "label": "R" if symbol == "R" else ("" if symbol == "C" else symbol),
                                  "coordinates": {"x": float(placed[k][0]), "y": float(-placed[k][1])}, "charge": charge, "hydrogenCount": hs,
                                  "aromatic": False, "additionalInformation": {"atomName": nm}})
                atom_refs[aid] = {"chain": g.key[0], "number": g.key[1], "atom": nm}
            fk = Chem.Mol(fmol)
            try:
                Chem.Kekulize(fk, clearAromaticFlags=True)
            except Exception:
                pass
            bjson = [{"id": b.GetIdx() + 1, "from": name_to_id[order[b.GetBeginAtomIdx()]], "to": name_to_id[order[b.GetEndAtomIdx()]],
                      "type": {Chem.BondType.DOUBLE: "double"}.get(b.GetBondType(), "single"), "aromatic": False} for b in fk.GetBonds()]
            rjson = []
            for r in fmol.GetRingInfo().AtomRings():
                rjson.append({"id": ring_id, "atoms": [name_to_id[order[i]] for i in r]})
                ring_id += 1
            structures.append({"id": sid, "structureName": label, "structureType": info["class"], "structureLabel": label,
                               "representation": 1, "atoms": atom_json, "bonds": bjson, "rings": rjson, "additionalInformation": info})
            if g.label_pos is not None:
                lab = g.label_pos
            else:
                out = g.pos - anchor
                lab = g.pos + out / (np.linalg.norm(out) + 1e-9) * (g.radius + 5)
            annotations.append({"id": len(annotations), "label": label, "coordinates": {"x": float(lab[0]), "y": float(-lab[1])},
                                "isStructureLabel": True, "belongsTo": {"type": "structure", "id": sid}})
            g_atoms = name_to_id
        else:
            aid = new_atom_id()
            element = g.key[3].capitalize() if g.key[3] in METALS else "O" if g.key[3] in WATER else "C"
            atom_json = [{"id": aid, "element": element, "label": "", "coordinates": {"x": float(g.pos[0]), "y": float(-g.pos[1])},
                          "charge": 0, "hydrogenCount": 0, "aromatic": False, "additionalInformation": {}}]
            first = by_residue[g.key][0]
            atom_refs[aid] = {"chain": g.key[0], "number": g.key[1], "atom": first.name}
            structures.append({"id": sid, "structureName": label, "structureType": info["class"],
                               "structureLabel": label if g.key[3] in WATER or g.key[3] in METALS else f"{THREE_TO_TITLE(g.key[3])} {g.key[1]}",
                               "representation": 2, "atoms": atom_json, "bonds": [], "additionalInformation": info})
            g_atoms = {"*": aid}

        for c in g.contacts:
            entry = {"kind": c.kind, "residue": label, "residueKey": [g.key[0], g.key[1], g.key[3]], "distance": round(c.distance, 2),
                     "ligandAtom": "/".join(mol.GetAtomWithIdx(i).GetProp("name") for i in c.ligand_atoms[:1]) if c.kind not in ("pi",) else "ring",
                     "residueAtom": c.partner_atoms[0].name if c.kind != "pi" else "ring", "direction": c.direction, "backbone": c.backbone,
                     "structure": sid}
            if c.kind in ("hbond", "ionic", "metal", "halogen", "water"):
                to = g_atoms.get(c.partner_atoms[0].name, g_atoms.get("*")) if g.kind == "fragment" else g_atoms["*"]
                if to is None:
                    continue
                iid = len(pair_ints)
                pair_ints.append({"id": iid, "fromStructure": 0, "toStructure": sid, "from": lig_atom_ids[c.ligand_atoms[0]], "to": to,
                                  "additionalInformation": {"kind": c.kind, "direction": c.direction, "backbone": c.backbone}})
                entry.update({"type": "atomPairInteractions", "id": iid})
            elif c.kind in ("pi", "cationPi") and g.kind != "fragment":
                # a disc has no ring: draw ligand ring -> disc, or ligand cation -> disc
                lr = lig_ring_ids.get(tuple(sorted(c.ligand_atoms))) if len(c.ligand_atoms) > 1 else None
                if lr is not None:
                    iid = len(cation_ints)
                    cation_ints.append({"id": iid, "fromStructure": 0, "toStructure": sid, "from": lr, "to": g_atoms["*"]})
                    entry.update({"type": "cationPiStackings", "id": iid})
                else:
                    iid = len(pair_ints)
                    pair_ints.append({"id": iid, "fromStructure": 0, "toStructure": sid, "from": lig_atom_ids[c.ligand_atoms[0]], "to": g_atoms["*"],
                                      "additionalInformation": {"kind": c.kind}})
                    entry.update({"type": "atomPairInteractions", "id": iid})
            elif c.kind == "pi":
                lr = lig_ring_ids.get(tuple(sorted(c.ligand_atoms)))
                pr = None
                for r in structures[-1].get("rings", []):
                    names_in = {k for k, v in g_atoms.items() if v in r["atoms"]}
                    if set(c.extra.get("pring", [])) == names_in:
                        pr = r["id"]
                if lr is None or pr is None:
                    continue
                iid = len(pi_ints)
                pi_ints.append({"id": iid, "fromStructure": 0, "toStructure": sid, "from": lr, "to": pr})
                entry.update({"type": "piStackings", "id": iid})
            elif c.kind == "cationPi":
                if len(c.ligand_atoms) > 1:
                    lr = lig_ring_ids.get(tuple(sorted(c.ligand_atoms)))
                    to = g_atoms.get(c.partner_atoms[0].name, g_atoms.get("*"))
                    if lr is None or to is None:
                        continue
                    iid = len(cation_ints)
                    cation_ints.append({"id": iid, "fromStructure": 0, "toStructure": sid, "from": lr, "to": to})
                else:
                    pr = None
                    for r in structures[-1].get("rings", []):
                        names_in = {k for k, v in g_atoms.items() if v in r["atoms"]}
                        if set(c.extra.get("pring", [])) == names_in:
                            pr = r["id"]
                    if pr is None:
                        continue
                    iid = len(cation_ints)
                    cation_ints.append({"id": iid, "fromStructure": sid, "toStructure": 0, "from": pr, "to": lig_atom_ids[c.ligand_atoms[0]]})
                entry.update({"type": "cationPiStackings", "id": iid})
            contact_out.append(entry)
        if g.key in data["hydrophobic"] and not g.contacts and g.key not in splines:
            i, d, p = data["hydrophobic"][g.key]
            contact_out.append({"kind": "hydrophobic", "residue": label, "residueKey": [g.key[0], g.key[1], g.key[3]], "distance": round(d, 2),
                                "ligandAtom": mol.GetAtomWithIdx(i).GetProp("name"), "residueAtom": p.name, "structure": sid})

    # water bridges and metal coordination: lines to receptor residues that are in the scene
    for g in glyphs:
        if g.kind not in ("water", "metal"):
            continue
        drawn = set()
        for c in g.contacts:
            for key, pname, dist in c.extra.get("bridges", []):
                target = glyph_struct.get(key)
                if target is None or (key, pname) in drawn:
                    continue
                st = structures[target]
                if st["representation"] == 2:
                    to = st["atoms"][0]["id"]  # a schematic residue disc
                else:
                    to = next((a["id"] for a in st["atoms"] if a["additionalInformation"].get("atomName") == pname), None)
                    if to is None:
                        continue
                drawn.add((key, pname))
                iid = len(pair_ints)
                pair_ints.append({"id": iid, "fromStructure": glyph_struct[g.key], "toStructure": target, "from": structures[glyph_struct[g.key]]["atoms"][0]["id"], "to": to,
                                  "additionalInformation": {"kind": g.kind}})
                contact_out.append({"kind": g.kind, "residue": f"{residue_label(g.key)} {g.key[1]} → {residue_label(key)}" if g.kind == "water" else f"{residue_label(g.key)} → {residue_label(key)}",
                                    "residueKey": [key[0], key[1], key[3]],
                                    "distance": round(dist, 2), "ligandAtom": "", "residueAtom": pname, "type": "atomPairInteractions", "id": iid, "structure": target})

    hydrophobic_json = []
    for gid, patch in enumerate(patches):
        hydrophobic_json.append({"id": gid, "belongsTo": 0, "controlPoints": [
            {"x": float(p[0]), "y": float(-p[1]), "atomLinks": [lig_atom_ids[i]]} for p, i in patch["ctrl"]]})
        for key, lab in patch["labels"]:
            annotations.append({"id": len(annotations), "label": residue_label(key), "coordinates": {"x": float(lab[0]), "y": float(-lab[1])},
                                # the drawer reads belongsTo.id as the structure owning the spline (the ligand), not the spline id
                                "isStructureLabel": False, "belongsTo": {"type": "structureSpline", "id": 0},
                                "additionalInformation": {"kind": "hydrophobic", "chain": key[0], "number": key[1], "name": key[3]}})
            i, d, p = data["hydrophobic"][key]
            contact_out.append({"kind": "hydrophobic", "residue": residue_label(key), "residueKey": [key[0], key[1], key[3]], "distance": round(d, 2),
                                "ligandAtom": mol.GetAtomWithIdx(i).GetProp("name"), "residueAtom": p.name, "structure": 0,
                                "type": "hydrophobicContacts", "id": gid})

    # chain links between scene residues (Schrodinger-style backbone trace)
    chain_links = []
    residues_in_scene = sorted([g.key for g in glyphs if g.key[3] in AMINO], key=lambda k: (k[0], k[1]))
    for a, b in zip(residues_in_scene, residues_in_scene[1:]):
        if a[0] == b[0] and 0 < b[1] - a[1] <= 4:
            chain_links.append({"from": glyph_struct[a], "to": glyph_struct[b], "gap": b[1] - a[1] - 1,
                                "fromAtom": next((x["id"] for x in structures[glyph_struct[a]]["atoms"] if x["additionalInformation"].get("atomName") == "CA"), None),
                                "toAtom": next((x["id"] for x in structures[glyph_struct[b]]["atoms"] if x["additionalInformation"].get("atomName") == "CA"), None)})

    contour = proximity_contour(lig_xy, data["proximity"], data["exposed"], bonds)

    ligand_overlay = []
    for i in range(len(lig_xy)):
        ligand_overlay.append({"atom": lig_atom_ids[i], "sasa": round(float(data["lig_sasa"][i]), 1),
                               "free": round(float(data["lig_free"][i]), 1), "proximity": round(float(data["proximity"][i]), 2),
                               "exposed": bool(data["exposed"][i]), "polarGap": round(float(min(data["polar_gap"][i], 99.0)), 2)})
    for k, a in enumerate(mol.GetAtoms()):
        atom_refs[lig_atom_ids[k]] = {"chain": chain, "number": int(number), "atom": a.GetProp("name")}

    return {
        "scene": {"scene": {"structures": structures, "atomPairInteractions": pair_ints, "piStackings": pi_ints,
                            "cationPiStackings": cation_ints, "hydrophobicContacts": hydrophobic_json, "annotations": annotations}},
        "contacts": contact_out,
        "overlay": {"contour": contour, "ligandAtoms": ligand_overlay, "chainLinks": chain_links,
                    "ligandAtomIds": [lig_atom_ids[i] for i in range(len(lig_xy))]},
        "atomRefs": atom_refs,
        # the molblock keeps the 3D pose with the dictionary's bond orders and charges; the ligand card draws the molecule from it
        "ligand": {"id": ligand_id, "name": name, "chain": chain, "number": int(number), "smiles": Chem.MolToSmiles(mol),
                   "molblock": ligand_molblock(mol, ligand_id)},
        "pdb": path.stem,
    }


def ligand_molblock(mol, title):
    try:
        m = Chem.Mol(mol)
        m.SetProp("_Name", title)
        return Chem.MolToMolBlock(m)
    except Exception:  # a ligand RDKit cannot kekulize keeps the drawing the viewer infers
        return ""


def add_wedges(mol, flat, lig_xy, bond_json, lig_atom_ids):
    """Stereo wedges from the 3D structure, drawn on the 2D depiction."""
    m = Chem.Mol(mol)
    Chem.AssignStereochemistryFrom3D(m)
    conf = Chem.Conformer(m.GetNumAtoms())
    for i in range(m.GetNumAtoms()):
        conf.SetAtomPosition(i, [float(lig_xy[i][0]), float(lig_xy[i][1]), 0.0])
    m2 = Chem.Mol(m)
    m2.RemoveAllConformers()
    m2.AddConformer(conf, assignId=True)
    Chem.WedgeMolBonds(m2, m2.GetConformer())
    by_pair = {(b["from"], b["to"]): b for b in bond_json}
    for b in m2.GetBonds():
        d = b.GetBondDir()
        if d not in (Chem.BondDir.BEGINWEDGE, Chem.BondDir.BEGINDASH):
            continue
        a1, a2 = lig_atom_ids[b.GetBeginAtomIdx()], lig_atom_ids[b.GetEndAtomIdx()]
        wedge = "stereoFront" if d == Chem.BondDir.BEGINWEDGE else "stereoBack"
        if (a1, a2) in by_pair:
            by_pair[(a1, a2)]["type"] = wedge + "Reverse"
        elif (a2, a1) in by_pair:
            by_pair[(a2, a1)]["type"] = wedge


def proximity_contour(lig_xy, proximity, exposed, bonds, step=2.0):
    """MOE proximity contour: Gaussian blobs sized by substitution room, broken at exposed atoms."""
    radii = 9.0 + proximity * 11.0  # 0 A of room hugs the atom, 2 A leaves about a bond length
    pad = radii.max() + 20
    xs = np.arange(lig_xy[:, 0].min() - pad, lig_xy[:, 0].max() + pad, step)
    ys = np.arange(lig_xy[:, 1].min() - pad, lig_xy[:, 1].max() + pad, step)
    gx, gy = np.meshgrid(xs, ys)
    pts = np.stack([gx.ravel(), gy.ravel()], axis=1)
    field_values = np.zeros(len(pts))
    for i, p in enumerate(lig_xy):
        field_values += np.exp(-np.sum((pts - p) ** 2, axis=1) / (radii[i] ** 2))
    # bonds keep the envelope continuous along the skeleton
    for a, b in bonds:
        mid = (lig_xy[a] + lig_xy[b]) / 2
        r = (radii[a] + radii[b]) / 2
        field_values += 0.6 * np.exp(-np.sum((pts - mid) ** 2, axis=1) / (r ** 2))
    f = field_values.reshape(gx.shape)
    level = math.exp(-1.0)
    segments = marching_squares(f, xs, ys, level)
    paths = join_segments(segments)
    out = []
    for path in paths:
        pts2 = np.array(path)
        nearest = np.argmin(np.linalg.norm(pts2[:, None, :] - lig_xy[None, :, :], axis=2), axis=1)
        visible = ~exposed[nearest]
        current = []
        for p, v in zip(pts2, visible):
            if v:
                current.append([round(float(p[0]), 2), round(float(-p[1]), 2)])
            elif len(current) > 2:
                out.append(current)
                current = []
            else:
                current = []
        if len(current) > 2:
            out.append(current)
    # also report nearest atoms so the overlay can follow ligand moves
    return out


def marching_squares(f, xs, ys, level):
    segs = []
    ny, nx = f.shape

    def interp(p1, p2, v1, v2):
        t = (level - v1) / (v2 - v1 + 1e-12)
        return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))

    for j in range(ny - 1):
        for i in range(nx - 1):
            v = [f[j, i], f[j, i + 1], f[j + 1, i + 1], f[j + 1, i]]
            p = [(xs[i], ys[j]), (xs[i + 1], ys[j]), (xs[i + 1], ys[j + 1]), (xs[i], ys[j + 1])]
            idx = sum(1 << k for k in range(4) if v[k] > level)
            if idx in (0, 15):
                continue
            edges = []
            for k in range(4):
                a, b = k, (k + 1) % 4
                if (v[a] > level) != (v[b] > level):
                    edges.append(interp(p[a], p[b], v[a], v[b]))
            if len(edges) == 2:
                segs.append((edges[0], edges[1]))
            elif len(edges) == 4:
                segs.append((edges[0], edges[1]))
                segs.append((edges[2], edges[3]))
    return segs


def join_segments(segs):
    def key(p):
        return (round(p[0], 3), round(p[1], 3))

    adjacency = {}
    for k, (a, b) in enumerate(segs):
        adjacency.setdefault(key(a), []).append((k, b))
        adjacency.setdefault(key(b), []).append((k, a))
    used = set()
    paths = []
    for k, (a, b) in enumerate(segs):
        if k in used:
            continue
        used.add(k)
        path = [a, b]
        while True:
            nxt = [(s, q) for s, q in adjacency.get(key(path[-1]), []) if s not in used]
            if not nxt:
                break
            s, q = nxt[0]
            used.add(s)
            path.append(q)
        paths.append(path)
    return paths


LIGAND_ID = re.compile(r"[A-Za-z0-9]{1,5}_[A-Za-z0-9]{1,4}_-?[0-9]{1,6}")


def diagram_rules(requested) -> dict:
    """A style's rules over the defaults; the request comes from the page, so each value is checked."""
    rules = {**DEFAULT_RULES, **(requested if isinstance(requested, dict) else {})}
    for key, value in rules.items():
        if key not in RULE_VALUES or not isinstance(value, (str, bool)) or value not in RULE_VALUES[key]:
            raise ValueError(f"Invalid diagram rule {key}={value!r}")
    return rules


def emit(payload) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def main() -> None:
    """{"path", "ccdCache", "ligand"?, "rules"?} on stdin; one JSON line out with the structure's
    ligands and the diagram of the one asked for, or of the largest."""
    global CCD_DIR
    try:
        request = json.loads(sys.stdin.read())
        CCD_DIR = Path(request["ccdCache"])
        path = Path(request["path"])
        ligands = list_ligands(path)
        ligand = request.get("ligand") or (ligands[0]["id"] if ligands else None)
        if not ligand:
            raise ValueError("This structure has no ligand to map")
        if not isinstance(ligand, str) or not LIGAND_ID.fullmatch(ligand):
            raise ValueError("Invalid ligand")
        emit({"ok": True, "ligands": ligands, "diagram": build(path, ligand, diagram_rules(request.get("rules")))})
    except Exception as error:  # the host shows one message, not a traceback
        emit({"ok": False, "error": str(error) or type(error).__name__})


if __name__ == "__main__":
    main()
