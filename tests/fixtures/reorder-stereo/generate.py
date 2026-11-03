"""Writes the reorder/property-table fixtures with RDKit (run: uv run --with rdkit==2026.09.1 python generate.py).

Each molecule is embedded with a fixed seed, MMFF-relaxed and written as a MOL
V2000 block whose wedges RDKit derives from the 3D coordinates.
"""
import pathlib

from rdkit import Chem
from rdkit.Chem import AllChem

MOLECULES = {
    "lactic-acid-r": "C[C@@H](O)C(=O)O",
    "crotonic-acid-e": "C/C=C/C(=O)O",
    "dimethylcyclohexane-trans": "C[C@@H]1CCCC[C@H]1C",
    "sodium-alaninate-s": "[Na+].C[C@H](N)C(=O)[O-]",
    "chlorofluoro-pentene-z": "C/C=C\\[C@@H](Cl)F",
    "but-2-yne-linear": "CC#CC",
}

for name, smiles in MOLECULES.items():
    molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
    assert AllChem.EmbedMolecule(molecule, randomSeed=7) == 0, name
    AllChem.MMFFOptimizeMolecule(molecule, maxIters=2000)
    Chem.AssignStereochemistryFrom3D(molecule)
    molecule.SetProp("_Name", name)
    pathlib.Path(__file__).with_name(f"{name}.mol").write_text(Chem.MolToMolBlock(molecule))
