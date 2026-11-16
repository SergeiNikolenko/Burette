"""Independent RDKit references for browser geometry optimization.

Run: uv run --with rdkit==2026.9.1 python tests/fixtures/optimization/generate-rdkit-optimization-reference.py

Inputs are the fixed-coordinate MOL blocks of ../forcefield/rdkit-reference.json.
For each record and model the output holds the analytic gradient at the input
coordinates and fully converged minima: unconstrained, and with the same
objective the browser optimizer uses (frozen atoms excluded from the variables,
harmonic restraints 1e4*(d - d0)^2 kcal/mol with d in angstrom or radians).
RDKit distance contributions are k/2*(d - d0)^2 (k = 2e4); angle and torsion
contributions are k*(d - d0)^2 in degrees (k = 1e4*(pi/180)^2). The script checks
the summed contributions against the browser formula after every minimization.
"""
import json
import math
from pathlib import Path

import rdkit
from rdkit import Chem
from rdkit.Chem import rdForceFieldHelpers as H
from rdkit.Chem import rdMolTransforms as T
from rdkit.ForceField import rdForceField  # noqa: F401  (registers constraint methods)

HERE = Path(__file__).resolve().parent
SOURCE = json.loads((HERE.parent / "forcefield" / "rdkit-reference.json").read_text())
PENALTY = 10000.0
DEGREE_K = PENALTY * (math.pi / 180) ** 2


def field(mol, model):
    if model == "UFF":
        return H.UFFGetMoleculeForceField(mol, ignoreInterfragInteractions=False)
    props = H.MMFFGetMoleculeProperties(mol, mmffVariant=model)
    return H.MMFFGetMoleculeForceField(mol, props, ignoreInterfragInteractions=False)


def minimize(ff):
    ff.Initialize()
    for _ in range(200):
        if ff.Minimize(maxIts=100000, forceTol=1e-9, energyTol=1e-14) == 0:
            break
    else:
        raise RuntimeError("RDKit minimization did not converge")


def add_restraints(ff, model, mol, restraints):
    add = {
        "distance": (ff.UFFAddDistanceConstraint if model == "UFF" else ff.MMFFAddDistanceConstraint, 2 * PENALTY),
        "angle": (ff.UFFAddAngleConstraint if model == "UFF" else ff.MMFFAddAngleConstraint, DEGREE_K),
        "dihedral": (ff.UFFAddTorsionConstraint if model == "UFF" else ff.MMFFAddTorsionConstraint, DEGREE_K),
    }
    for item in restraints:
        if item["kind"] == "freeze":
            ff.AddFixedPoint(item["atoms"][0])
            continue
        method, k = add[item["kind"]]
        method(*item["atoms"], False, item["target"], item["target"], k)


def measure(conf, kind, atoms):
    if kind == "distance":
        return T.GetBondLength(conf, *atoms)
    if kind == "angle":
        return T.GetAngleDeg(conf, *atoms)
    return T.GetDihedralDeg(conf, *atoms)


def residual(conf, item):
    delta = measure(conf, item["kind"], item["atoms"]) - item["target"]
    return (delta + 540) % 360 - 180 if item["kind"] == "dihedral" else delta


def penalty(conf, restraints):
    total = 0.0
    for item in restraints:
        if item["kind"] == "freeze":
            continue
        delta = residual(conf, item)
        scale = 1 if item["kind"] == "distance" else math.pi / 180
        total += PENALTY * (delta * scale) ** 2
    return total


def run(molfile, model, restraints):
    mol = Chem.MolFromMolBlock(molfile, removeHs=False)
    ff = field(mol, model)
    if restraints:
        add_restraints(ff, model, mol, restraints)
    minimize(ff)
    conf = mol.GetConformer()
    for i, x in enumerate(ff.Positions()[::3]):
        pos = ff.Positions()
        conf.SetAtomPosition(i, (pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]))
    physical = field(mol, model).CalcEnergy()
    objective = ff.CalcEnergy()
    expected = physical + penalty(conf, restraints)
    if abs(objective - expected) > 1e-6 * max(1, abs(objective)):
        raise RuntimeError(f"Constraint formula mismatch: {objective} vs {expected}")
    original = Chem.MolFromMolBlock(molfile, removeHs=False).GetConformer()
    for item in restraints:
        if item["kind"] == "freeze":
            a = item["atoms"][0]
            if (conf.GetAtomPosition(a) - original.GetAtomPosition(a)).Length() > 1e-12:
                raise RuntimeError("Fixed point moved")
    return {
        "energy": physical,
        "objective": objective,
        "residuals": [residual(conf, r) for r in restraints if r["kind"] != "freeze"],
        "coordinates": [[round(v, 10) for v in conf.GetAtomPosition(i)] for i in range(mol.GetNumAtoms())],
    }


records = []
for record in SOURCE["records"]:
    mol = Chem.MolFromMolBlock(record["molfile"], removeHs=False)
    item = {"smiles": record["smiles"], "atomCount": mol.GetNumAtoms(), "models": {}}
    for model in ("MMFF94", "MMFF94s", "UFF"):
        ff = field(mol, model)
        item["models"][model] = {
            "energy": ff.CalcEnergy(),
            "gradient": list(ff.CalcGrad()),
            "minimum": run(record["molfile"], model, []),
        }
    records.append(item)

# One constrained case per model on ethanol (C1 C2 O3 H4..H9).
ethanol = next(r for r in SOURCE["records"] if r["smiles"] == "CCO")
conf = Chem.MolFromMolBlock(ethanol["molfile"], removeHs=False).GetConformer()
restraints = [
    {"kind": "freeze", "atoms": [0]},
    {"kind": "distance", "atoms": [1, 2], "target": round(T.GetBondLength(conf, 1, 2) + 0.15, 6)},
    {"kind": "angle", "atoms": [0, 1, 2], "target": 115.0},
    {"kind": "dihedral", "atoms": [3, 0, 1, 2], "target": 75.0},
    # Holding the hydroxyl rotor too leaves one constrained minimum to compare.
    {"kind": "dihedral", "atoms": [0, 1, 2, 8], "target": 180.0},
]
constrained = {model: run(ethanol["molfile"], model, restraints) for model in ("MMFF94", "MMFF94s", "UFF")}

# Distinct MMFF94/UFF minima of small flexible alkanes: 300 ETKDG embeddings each,
# minimized to convergence, energies rounded to 1e-4 kcal/mol and deduplicated.
from rdkit.Chem import AllChem


def minima(smiles, model):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    ids = AllChem.EmbedMultipleConfs(mol, 300, params)
    values = set()
    for cid in ids:
        ff = (H.UFFGetMoleculeForceField(mol, confId=cid) if model == "UFF"
              else H.MMFFGetMoleculeForceField(mol, H.MMFFGetMoleculeProperties(mol, mmffVariant=model), confId=cid))
        minimize(ff)
        values.add(round(ff.CalcEnergy(), 4))
    return sorted(values)


conformer_minima = {smiles: {model: minima(smiles, model) for model in ("MMFF94", "UFF")} for smiles in ("CCCC", "CCCCC")}

# Flat inputs for automatic 3D preparation: RDKit 2D depictions with wedges and
# without hydrogens, plus the isomeric SMILES the 3D result must keep.
from rdkit.Chem import rdDepictor


def depiction(smiles):
    mol = Chem.MolFromSmiles(smiles)
    rdDepictor.Compute2DCoords(mol)
    Chem.WedgeMolBonds(mol, mol.GetConformer())
    block = Chem.MolToMolBlock(mol)
    return {"smiles": Chem.MolToSmiles(mol), "molfile": block, "heavyAtoms": mol.GetNumAtoms(),
            "hydrogens": sum(atom.GetTotalNumHs() for atom in mol.GetAtoms())}


flat_inputs = [depiction(smiles) for smiles in ("c1ccccc1", "C[C@@H](O)CC", "C/C=C\\C", "N[C@@H](C)C(=O)O")]

output = {
    "source": f"RDKit {rdkit.__version__} Python; generate-rdkit-optimization-reference.py. Input coordinates are ../forcefield/rdkit-reference.json molfiles; minima converged with forceTol 1e-9.",
    "gradientUnit": "kcal/(mol*angstrom), dE/dr in molfile atom order",
    "records": records,
    "constrained": {"smiles": "CCO", "restraints": restraints, "penalty": "1e4*(delta)^2, delta in angstrom or radians", "models": constrained},
    "conformerMinima": conformer_minima,
    "flatInputs": flat_inputs,
}
(HERE / "rdkit-optimization-reference.json").write_text(json.dumps(output, indent=1) + "\n")
print("records", len(records))
