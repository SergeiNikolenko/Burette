#!/usr/bin/env python3
"""Freeze UFF energy/analytic-gradient references using pinned Python RDKit."""
import json
from pathlib import Path
from rdkit import Chem, rdBase
from rdkit.Chem import AllChem

CASES = [
    ("water", "O", True),
    ("ethanol", "CCO", True),
    ("benzene", "c1ccccc1", True),
    ("acetamide", "CC(=O)N", True),
    ("dimethyl-sulfoxide", "CS(=O)C", True),
    ("cyclohexane", "C1CCCCC1", True),
    ("methyl-phosphate", "COP(=O)(O)O", True),
    ("tetrafluorosilane", "F[Si](F)(F)F", True),
    ("separate-waters", "O.O", True),
    ("ethanol-implicit-hydrogens", "CCO", False),
]


def main():
    if rdBase.rdkitVersion != "2025.03.4":
        raise RuntimeError("Reference fixtures require RDKit 2025.03.4")
    cases = []
    for ordinal, (name, smiles, explicit_hydrogens) in enumerate(CASES):
        molecule = Chem.MolFromSmiles(smiles)
        if explicit_hydrogens:
            molecule = Chem.AddHs(molecule)
        if AllChem.EmbedMolecule(molecule, randomSeed=0xB017 + ordinal) != 0:
            raise RuntimeError(f"Embedding failed for {name}")
        molblock = Chem.MolToMolBlock(molecule)
        # Reparse the exact delivered input; no oracle-only H or coordinate path.
        molecule = Chem.MolFromMolBlock(molblock, removeHs=False)
        coordinates = [float(x) for point in molecule.GetConformer().GetPositions() for x in point]
        coordinates = [value + ((i % 7) - 3) * 0.013 for i, value in enumerate(coordinates)]
        field = AllChem.UFFGetMoleculeForceField(
            molecule, vdwThresh=100.0, ignoreInterfragInteractions=True
        )
        field.Initialize()
        cases.append({
            "name": name, "smiles": smiles, "molblock": molblock,
            "atomCount": molecule.GetNumAtoms(), "coordinates": coordinates,
            "expectedEnergyKcalMol": field.CalcEnergy(coordinates),
            "expectedGradientKcalMolAngstrom": list(field.CalcGrad(coordinates)),
        })
    output = Path(__file__).with_name("fixtures") / "uff-rdkit-2025.03.4.json"
    charge_cases = []
    for name, smiles in [("ethanol", "CCO"), ("acetate", "CC(=O)[O-]"),
                         ("guanidinium", "NC(N)=[NH2+]"), ("ammonium", "[NH4+]"),
                         ("nitromethane", "C[N+](=O)[O-]"), ("pyridinium", "c1cc[nH+]cc1")]:
        molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
        molblock = Chem.MolToMolBlock(molecule)
        molecule = Chem.MolFromMolBlock(molblock, removeHs=False)
        AllChem.ComputeGasteigerCharges(molecule, nIter=12, throwOnParamFailure=True)
        charge_cases.append({"name": name, "molblock": molblock,
                             "charges": [atom.GetDoubleProp("_GasteigerCharge") for atom in molecule.GetAtoms()]})
    output.write_text(json.dumps({
        "schemaVersion": 1, "rdkitVersion": rdBase.rdkitVersion,
        "rdkitCommit": "276b5a662302c6a548ac4f1363c066f3258e3a20",
        "vdwThreshold": 100.0, "ignoreInterfragmentInteractions": True,
        "cases": cases, "gasteigerCases": charge_cases,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
