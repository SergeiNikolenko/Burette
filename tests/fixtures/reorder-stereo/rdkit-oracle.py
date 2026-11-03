"""Independent RDKit check of reordered, saved and reopened copies (see oracle-cases.ts).

Every reordered copy must be the same molecule as its RDKit fixture under the
reported atom map: elements, charges, bonds, coordinates, CIP labels of centres
and double bonds, and the canonical isomeric SMILES.
"""
import json
import pathlib
import sys

from rdkit import Chem
from rdkit.Chem import rdCIPLabeler

HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1])


def read(path):
    molecule = Chem.MolFromMolFile(str(path), removeHs=False)
    assert molecule is not None, f"RDKit cannot read {path}"
    rdCIPLabeler.AssignCIPLabels(molecule)
    return molecule


def cip(item):
    return item.GetProp("_CIPCode") if item.HasProp("_CIPCode") else ""


def bonds(molecule, mapping):
    return {(min(mapping[b.GetBeginAtomIdx()], mapping[b.GetEndAtomIdx()]), max(mapping[b.GetBeginAtomIdx()], mapping[b.GetEndAtomIdx()]), str(b.GetBondType())) for b in molecule.GetBonds()}


failures, parities = 0, 0
for case in json.loads((OUT / "manifest.json").read_text()):
    try:
        original, copy = read(HERE / case["fixture"]), read(OUT / case["output"])
        mapping = case["map"]
        assert case["reopenedIsSame"], "the reopened copy differs from the reordered structure"
        assert copy.GetNumAtoms() == original.GetNumAtoms() and sorted(mapping) == list(range(original.GetNumAtoms())), "atom map is not a permutation"
        identity = list(range(original.GetNumAtoms()))
        for i, source in enumerate(mapping):
            a, b = copy.GetAtomWithIdx(i), original.GetAtomWithIdx(source)
            assert (a.GetSymbol(), a.GetFormalCharge(), a.GetIsotope()) == (b.GetSymbol(), b.GetFormalCharge(), b.GetIsotope()), f"atom {i} differs"
            assert cip(a) == cip(b), f"atom {i} CIP {cip(a)!r} != {cip(b)!r}"
            p, q = copy.GetConformer().GetAtomPosition(i), original.GetConformer().GetAtomPosition(source)
            assert max(abs(p.x - q.x), abs(p.y - q.y), abs(p.z - q.z)) < 1e-4, f"atom {i} moved"
        assert bonds(copy, mapping) == bonds(original, identity), "bonds differ"
        for bond in original.GetBonds():
            if bond.GetBondType() == Chem.BondType.DOUBLE:
                inverse = {source: i for i, source in enumerate(mapping)}
                other = copy.GetBondBetweenAtoms(inverse[bond.GetBeginAtomIdx()], inverse[bond.GetEndAtomIdx()])
                assert cip(other) == cip(bond), f"double bond CIP {cip(other)!r} != {cip(bond)!r}"
        assert Chem.MolToSmiles(copy) == Chem.MolToSmiles(original), "canonical isomeric SMILES differ"
        # The written MDL atom parities (CFG=1/2) must describe the same centres as the coordinates.
        parity = Chem.Mol(copy)
        Chem.AssignAtomChiralTagsFromMolParity(parity, True)
        Chem.AssignStereochemistry(parity, cleanIt=True, force=True)
        rdCIPLabeler.AssignCIPLabels(parity)
        for atom in copy.GetAtoms():
            if atom.HasProp("molParity") and atom.GetIntProp("molParity") in (1, 2):
                assert cip(parity.GetAtomWithIdx(atom.GetIdx())) == cip(atom), f"atom {atom.GetIdx()} parity disagrees with its coordinates"
                parities += 1
        print(f"ok   {case['output']}: {copy.GetNumAtoms()} atoms, CIP {sorted({cip(a) for a in copy.GetAtoms()} - {''})}, {Chem.MolToSmiles(copy)}")
    except AssertionError as error:
        failures += 1
        print(f"FAIL {case['output']}: {error}")
print(f"Checked {parities} written atom parities")
sys.exit(1 if failures else 0)
