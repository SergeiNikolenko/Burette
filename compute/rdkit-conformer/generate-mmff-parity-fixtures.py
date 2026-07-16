#!/usr/bin/env python3
"""Generate pinned RDKit MMFF94/MMFF94s energy reference coordinates."""

import json
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem


EXPECTED_RDKIT = "2025.03.4"
MOLECULES = [
    ("ethanol", "CCO"),
    ("acetamide", "CC(=O)N"),
    ("benzene", "c1ccccc1"),
    ("pyridine", "c1ccncc1"),
    ("butane", "CCCC"),
    ("ethyl-acetate", "CCOC(=O)C"),
    ("dimethyl-sulfoxide", "CS(=O)C"),
    ("triethylamine", "CCN(CC)CC"),
    ("benzoic-acid", "O=C(O)c1ccccc1"),
    ("cyclohexane", "C1CCCCC1"),
    ("tert-butanol", "CC(C)(C)O"),
    ("methyl-phosphate", "COP(=O)(O)O"),
]


def main() -> None:
    if rdBase.rdkitVersion != EXPECTED_RDKIT:
        raise RuntimeError(
            f"RDKit version drift: expected {EXPECTED_RDKIT}, got {rdBase.rdkitVersion}"
        )
    cases = []
    for molecule_index, (name, smiles) in enumerate(MOLECULES):
        molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
        status = AllChem.EmbedMolecule(
            molecule,
            randomSeed=0xB017 + molecule_index,
            useRandomCoords=True,
        )
        if status != 0:
            raise RuntimeError(f"RDKit embedding failed for {name}")
        conformer = molecule.GetConformer()
        positions = [
            [float(point.x), float(point.y), float(point.z), 0.0]
            for point in (conformer.GetAtomPosition(index) for index in range(molecule.GetNumAtoms()))
        ]
        molblock = Chem.MolToMolBlock(molecule)
        for variant in ("MMFF94", "MMFF94s"):
            properties = AllChem.MMFFGetMoleculeProperties(molecule, mmffVariant=variant)
            if properties is None:
                raise RuntimeError(f"RDKit MMFF typing failed for {name} {variant}")
            force_field = AllChem.MMFFGetMoleculeForceField(molecule, properties)
            if force_field is None:
                raise RuntimeError(f"RDKit force field failed for {name} {variant}")
            optimized = Chem.Mol(molecule)
            optimized_properties = AllChem.MMFFGetMoleculeProperties(
                optimized, mmffVariant=variant
            )
            optimized_force_field = AllChem.MMFFGetMoleculeForceField(
                optimized, optimized_properties
            )
            if optimized_force_field.Minimize(maxIts=1000) != 0:
                raise RuntimeError(f"RDKit MMFF optimization failed for {name} {variant}")
            cases.append(
                {
                    "name": name,
                    "smiles": smiles,
                    "variant": variant,
                    "molblock": molblock,
                    "positions": positions,
                    "expectedEnergyKcalMol": float(force_field.CalcEnergy()),
                    "expectedOptimizedEnergyKcalMol": float(
                        optimized_force_field.CalcEnergy()
                    ),
                }
            )
    output = Path(__file__).with_name("fixtures") / "mmff-rdkit-2025.03.4.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "rdkitVersion": rdBase.rdkitVersion,
                "rdkitCommit": "276b5a662302c6a548ac4f1363c066f3258e3a20",
                "cases": cases,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(cases)} RDKit MMFF energy cases at {output}")


if __name__ == "__main__":
    main()
