"""Regenerate the independent protonation and hydrogen references.

uv run --no-project --with openbabel-wheel==3.1.1.23 --with dimorphite_dl==2.1.0 \
  --with rdkit==2026.9.1 python tests/fixtures/protonation/generate.py

Writes protonation-references.json and hydrogen-references.json next to this file.
Open Babel and Dimorphite-DL are only run here; none of their code or data is
bundled with Burette.
"""
import importlib.metadata as metadata
import json
from pathlib import Path

from dimorphite_dl import protonate_smiles
from openbabel import openbabel as ob
from rdkit import Chem, rdBase
from rdkit.Chem import rdMolDescriptors

HERE = Path(__file__).parent
PH = [2.0, 7.4, 12.0]

PANEL = {
    "glycine": "NCC(=O)O",
    "L-alanine": "C[C@H](N)C(=O)O",
    "L-lysine": "NCCCC[C@H](N)C(=O)O",
    "L-arginine": "NC(=N)NCCC[C@H](N)C(=O)O",
    "L-histidine": "N[C@@H](Cc1c[nH]cn1)C(=O)O",
    "L-aspartic acid": "N[C@@H](CC(=O)O)C(=O)O",
    "L-cysteine": "N[C@@H](CS)C(=O)O",
    "L-tyrosine": "N[C@@H](Cc1ccc(O)cc1)C(=O)O",
    "acetic acid": "CC(=O)O",
    "acetate": "CC(=O)[O-]",
    "benzoic acid": "OC(=O)c1ccccc1",
    "ibuprofen": "CC(C)Cc1ccc(cc1)C(C)C(=O)O",
    "lidocaine": "CCN(CC)CC(=O)Nc1c(C)cccc1C",
    "histamine": "NCCc1c[nH]cn1",
    "metformin": "CN(C)C(=N)N=C(N)N",
    "ciprofloxacin": "OC(=O)C1=CN(C2CC2)c2cc(N3CCNCC3)c(F)cc2C1=O",
    "methylamine": "CN",
    "dimethylamine": "CNC",
    "trimethylamine": "CN(C)C",
    "morpholine": "C1COCCN1",
    "piperazine": "C1CNCCN1",
    "diphenhydramine": "CN(C)CCOC(c1ccccc1)c1ccccc1",
    "aniline": "Nc1ccccc1",
    "pyridine": "c1ccncc1",
    "imidazole": "c1c[nH]cn1",
    "phenol": "Oc1ccccc1",
    "paracetamol": "CC(=O)Nc1ccc(O)cc1",
    "ethanethiol": "CCS",
    "thiophenol": "Sc1ccccc1",
    "phosphoric acid": "OP(=O)(O)O",
    "methyl phosphate": "COP(=O)(O)O",
    "dimethyl phosphate": "COP(=O)(O)OC",
    "methylphosphonic acid": "CP(=O)(O)O",
    "dimethylphosphinic acid": "CP(C)(=O)O",
    "methanesulfonic acid": "CS(=O)(=O)O",
    "taurine": "NCCS(=O)(=O)O",
    "5-methyltetrazole": "Cc1nn[nH]n1",
    "acetamidine": "CC(=N)N",
    "guanidine": "NC(=N)N",
    "tetramethylammonium": "C[N+](C)(C)C",
    "betaine": "C[N+](C)(C)CC(=O)[O-]",
    "acetamide": "CC(N)=O",
    "nitrobenzene": "[O-][N+](=O)c1ccccc1",
    "sulfanilamide": "Nc1ccc(cc1)S(N)(=O)=O",
}

# Hydrogen expansion panel: neutral, charged, isotopic, stereo and aromatic cases.
HYDROGEN_PANEL = {
    "ethanol": "CCO",
    "(R)-butan-2-ol": "C[C@@H](O)CC",
    "(E)-but-2-ene": "C/C=C/C",
    "benzene": "c1ccccc1",
    "pyrrole": "c1cc[nH]c1",
    "acetonitrile": "CC#N",
    "propyne": "CC#C",
    "formaldehyde": "C=O",
    "methylammonium": "C[NH3+]",
    "acetate": "CC(=O)[O-]",
    "imidazolium": "c1c[nH+]c[nH]1",
    "13C-methanol": "[13CH3]O",
    "trimethylphosphate": "COP(=O)(OC)OC",
    "dimethyl sulfoxide": "CS(C)=O",
    "L-proline": "OC(=O)[C@@H]1CCCN1",
    "caffeine": "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
    "cyclohexanone": "O=C1CCCCC1",
    "cyclopropane": "C1CC1",
    "cyclobutane": "C1CCC1",
    "oxirane": "C1CO1",
}


def heavy_graph(mol):
    # Symmetry of the element graph alone (no bond orders or charges): atoms of
    # one class may exchange H between tautomer/resonance drawings, e.g. the two
    # carboxylate O or the four phosphate O, so references compare per class.
    topology = Chem.RWMol()
    for atom in mol.GetAtoms():
        topology.AddAtom(Chem.Atom(atom.GetAtomicNum()))
    for bond in mol.GetBonds():
        topology.AddBond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), Chem.BondType.SINGLE)
    topology.UpdatePropertyCache(False)
    Chem.FastFindRings(topology)
    return {
        "elements": [a.GetSymbol() for a in mol.GetAtoms()],
        "bonds": sorted([sorted([b.GetBeginAtomIdx(), b.GetEndAtomIdx()]) for b in mol.GetBonds()]),
        "symmetry": list(Chem.CanonicalRankAtoms(topology, breakTies=False)),
    }


def open_babel(smiles, ph, graph):
    conv = ob.OBConversion()
    conv.SetInFormat("smi")
    mol = ob.OBMol()
    if not conv.ReadString(mol, smiles):
        raise ValueError(smiles)
    # Exactly what `obabel -p <pH>` does: add all hydrogens with the pH model.
    mol.AddHydrogens(False, True, ph)
    heavy = [a for a in ob.OBMolAtomIter(mol) if a.GetAtomicNum() != 1]
    elements = [ob.GetSymbol(a.GetAtomicNum()) for a in heavy]
    if elements != graph["elements"]:
        raise ValueError(f"Open Babel reordered {smiles}")
    hydrogens = [sum(1 for n in ob.OBAtomAtomIter(a) if n.GetAtomicNum() == 1) for a in heavy]
    charges = [a.GetFormalCharge() for a in heavy]
    return {"charge": sum(a.GetFormalCharge() for a in ob.OBMolAtomIter(mol)), "hydrogens": hydrogens, "charges": charges}


def dimorphite(smiles, ph, source):
    variants = protonate_smiles(smiles, ph_min=ph, ph_max=ph, precision=0.0, max_variants=1)
    if len(variants) != 1:
        raise ValueError(f"Dimorphite-DL returned {variants} for {smiles}")
    result = Chem.MolFromSmiles(variants[0])
    # Map by element/connectivity only; protonation changes charges and H counts.
    query = Chem.RWMol()
    for atom in source.GetAtoms():
        query.AddAtom(Chem.AtomFromSmarts(f"[#{atom.GetAtomicNum()}]"))
    for bond in source.GetBonds():
        query.AddBond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), Chem.BondType.SINGLE)
        query.ReplaceBond(query.GetNumBonds() - 1, Chem.BondFromSmarts("~"))
    match = result.GetSubstructMatch(query.GetMol())
    if len(match) != source.GetNumAtoms() or result.GetNumAtoms() != source.GetNumAtoms():
        raise ValueError(f"Could not map {variants[0]} to {smiles}")
    atoms = [result.GetAtomWithIdx(i) for i in match]
    return {
        "smiles": variants[0],
        "charge": Chem.GetFormalCharge(result),
        "hydrogens": [a.GetTotalNumHs() for a in atoms],
        "charges": [a.GetFormalCharge() for a in atoms],
    }


def protonation_references():
    molecules = []
    for name, smiles in PANEL.items():
        source = Chem.MolFromSmiles(smiles)
        graph = heavy_graph(source)
        molecules.append({
            "name": name, "smiles": smiles, **graph,
            "references": {
                str(ph): {"openbabel": open_babel(smiles, ph, graph), "dimorphite": dimorphite(smiles, ph, source)}
                for ph in PH
            },
        })
    return molecules


def hydrogen_references():
    molecules = []
    for name, smiles in HYDROGEN_PANEL.items():
        source = Chem.MolFromSmiles(smiles)
        expanded = Chem.AddHs(source)
        removed = Chem.RemoveHs(expanded)
        molecules.append({
            "name": name, "smiles": smiles, **heavy_graph(source),
            "hydrogens": [a.GetTotalNumHs() for a in source.GetAtoms()],
            "charge": Chem.GetFormalCharge(source),
            "formula": rdMolDescriptors.CalcMolFormula(expanded),
            "atomsWithHydrogens": expanded.GetNumAtoms(),
            "atomsAfterRemoveHs": removed.GetNumAtoms(),
        })
    return molecules


tools = {
    "openbabel": metadata.version("openbabel-wheel"),
    "dimorphite_dl": metadata.version("dimorphite_dl"),
    "rdkit": rdBase.rdkitVersion,
}
def write(name, head, molecules):
    # One molecule per line keeps review diffs local.
    rows = ",\n  ".join(json.dumps(m, separators=(",", ":")) for m in molecules)
    (HERE / name).write_text(json.dumps(head)[:-1] + f', "molecules": [\n  {rows}\n]}}\n')


write("protonation-references.json", {"tools": tools, "pH": PH}, protonation_references())
write("hydrogen-references.json", {"tools": {"rdkit": tools["rdkit"]}}, hydrogen_references())
