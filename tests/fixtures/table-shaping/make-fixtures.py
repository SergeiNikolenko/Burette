"""Writes the Stage 26 table-shaping fixtures. Run from this directory:

    uv run --with rdkit python make-fixtures.py

Structures are 2D depictions of well-known drugs generated from SMILES; the
ChEMBL IDs are the real identifiers of those compounds. Every activity value
is made up for the tests and is not measured data.
"""
import csv

from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors

COMPOUNDS = [
    # name, ChEMBL ID, class, source, SMILES
    ("Aspirin", "CHEMBL25", "NSAID", "handbook", "CC(=O)Oc1ccccc1C(=O)O"),
    ("Ibuprofen", "CHEMBL521", "NSAID", "handbook", "CC(C)Cc1ccc(cc1)C(C)C(=O)O"),
    ("Naproxen", "CHEMBL154", "NSAID", "handbook", "COc1ccc2cc(ccc2c1)C(C)C(=O)O"),
    ("Diclofenac", "CHEMBL139", "NSAID", "handbook", "OC(=O)Cc1ccccc1Nc1c(Cl)cccc1Cl"),
    ("Paracetamol", "CHEMBL112", "Analgesic", "handbook", "CC(=O)Nc1ccc(O)cc1"),
    ("Caffeine", "CHEMBL113", "Stimulant", "handbook", "Cn1cnc2c1c(=O)n(C)c(=O)n2C"),
    ("Theophylline", "CHEMBL190", "Stimulant", "handbook", "Cn1c(=O)c2[nH]cnc2n(C)c1=O"),
    ("Nicotine", "CHEMBL3", "Stimulant", "", "CN1CCCC1c1cccnc1"),
    ("Diazepam", "CHEMBL12", "", "handbook", "CN1C(=O)CN=C(c2ccccc2)c2cc(Cl)ccc12"),
    ("Benzene", "", "Solvent", "", "c1ccccc1"),
    ("Acetylsalicylic acid", "CHEMBL25", "NSAID", "supplier", "CC(=O)Oc1ccccc1C(=O)O"),
]

# Long format: one row per compound and assay. Covers a missing combination
# (Ibuprofen has no COX-2 row), a repeated combination (Aspirin COX-1 twice),
# a row without a value (Naproxen COX-1) and a row without a key (Benzene).
ASSAYS = [
    ("Aspirin", "CHEMBL25", "COX-1", "5.8"),
    ("Aspirin", "CHEMBL25", "COX-2", "4.6"),
    ("Ibuprofen", "CHEMBL521", "COX-1", "5.3"),
    ("Naproxen", "CHEMBL154", "COX-1", ""),
    ("Naproxen", "CHEMBL154", "COX-2", "6.1"),
    ("Diclofenac", "CHEMBL139", "COX-1", "6.9"),
    ("Diclofenac", "CHEMBL139", "COX-2", "7.4"),
    ("Aspirin", "CHEMBL25", "COX-1", "6.0"),
    ("Benzene", "", "COX-1", "3.0"),
]

SMILES = {name: smiles for name, _, _, _, smiles in COMPOUNDS}


def molblock(name):
    mol = Chem.MolFromSmiles(SMILES[name])
    AllChem.Compute2DCoords(mol)
    mol.SetProp("_Name", name)
    return Chem.MolToMolBlock(mol), mol


def write_sdf(path, records):
    with open(path, "w", newline="\n") as handle:
        for name, fields in records:
            block, _ = molblock(name)
            handle.write(block)
            for key, value in fields:
                if value != "":
                    handle.write(f">  <{key}>\n{value}\n\n")
            handle.write("$$$$\n")


compound_rows = []
for name, chembl_id, klass, source, _ in COMPOUNDS:
    _, mol = molblock(name)
    compound_rows.append((name, [
        ("ChEMBL ID", chembl_id),
        ("Class", klass),
        ("MW", f"{Descriptors.MolWt(mol):.2f}"),
        ("Source", source),
    ]))
write_sdf("chembl-compounds.sdf", compound_rows)
with open("chembl-compounds.csv", "w", newline="") as handle:
    writer = csv.writer(handle, lineterminator="\n")
    writer.writerow(["ChEMBL ID", "Class", "MW", "Source"])
    for _, fields in compound_rows:
        writer.writerow([value for _, value in fields])

write_sdf("chembl-assays-long.sdf", [
    (name, [("ChEMBL ID", chembl_id), ("Assay", assay), ("pChEMBL", value)])
    for name, chembl_id, assay, value in ASSAYS
])
