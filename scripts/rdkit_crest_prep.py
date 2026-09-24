"""Prepare one molecule for the explicitly requested external CREST workflow.

The app's conformer generator uses Metal; this script only prepares CREST input.
Sanitization rejects invalid valences instead of repairing the molecular graph.
Normalization preserves protonation, formal charge, fragments and stereochemistry.
"""

import sys
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.MolStandardize import rdMolStandardize


def prepare(input_path, output_path):
    extension = Path(input_path).suffix.lower()
    if extension in {".sdf", ".sd"}:
        # Do not silently skip an invalid first record and prepare another molecule.
        supplier = Chem.SDMolSupplier(input_path, removeHs=False, sanitize=True)
        mol = supplier[0] if len(supplier) else None
    elif extension == ".mol2":
        mol = Chem.MolFromMol2File(input_path, removeHs=False, sanitize=True)
    elif extension == ".mol":
        mol = Chem.MolFromMolFile(input_path, removeHs=False, sanitize=True)
    elif extension in {".pdb", ".pdbqt", ".ent"}:
        mol = Chem.MolFromPDBFile(input_path, removeHs=False, sanitize=True)
    else:
        mol = None
    if mol is None:
        raise ValueError("RDKit could not parse input molecule")

    charge = Chem.GetFormalCharge(mol)
    # Normalize functional-group representations without reionizing or uncharging.
    mol = rdMolStandardize.Normalize(mol)
    Chem.SanitizeMol(mol)
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
    if Chem.GetFormalCharge(mol) != charge:
        raise ValueError("RDKit normalization changed the input formal charge")
    mol = Chem.AddHs(mol, addCoords=True)

    needs_embed = mol.GetNumConformers() == 0 or not mol.GetConformer().Is3D()
    if needs_embed:
        params = AllChem.ETKDGv3()
        params.randomSeed = 0xB00
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(mol, params) != 0:
            raise ValueError("RDKit ETKDG embedding failed")

    props = AllChem.MMFFGetMoleculeProperties(mol, mmffVariant="MMFF94s")
    ff = AllChem.MMFFGetMoleculeForceField(mol, props) if props else None
    if ff is None and AllChem.UFFHasAllMoleculeParams(mol):
        ff = AllChem.UFFGetMoleculeForceField(mol)
    if ff is None:
        raise ValueError("RDKit could not initialize MMFF94s or UFF")
    ff.Minimize(maxIts=1000)
    with Chem.SDWriter(output_path) as writer:
        writer.write(mol)


if __name__ == "__main__":
    prepare(sys.argv[1], sys.argv[2])
