"""Reference products for the library-enumeration tests.

Run from this directory:
    uv run --with rdkit python reference.py > expected.json
"""
import itertools
import json
import sys

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem

AMIDATION = "[C:1](=[O:2])[OH].[N;!$(N=*);!$(N-[!#6;!#1]);!$(N-C=[O,N,S]):3]>>[C:1](=[O:2])[N:3]"
CORE = "[*:1]c1ccc([*:2])cc1"


def read_smiles(path):
    rows = []
    with open(path) as handle:
        for line in handle:
            if line.strip():
                smiles, _, name = line.strip().partition(" ")
                rows.append((smiles, name))
    return rows


def amide_library():
    acids = read_smiles("acids.smi")
    amines = read_smiles("amines.smi")
    reaction = AllChem.ReactionFromSmarts(AMIDATION)
    products = AllChem.EnumerateLibraryFromReaction(
        reaction,
        [[Chem.MolFromSmiles(s) for s, _ in acids], [Chem.MolFromSmiles(s) for s, _ in amines]],
    )
    # EnumerateLibraryFromReaction walks the reactant lists as a Cartesian
    # product in order and yields one tuple of products per template match.
    pairs = itertools.product(range(len(acids)), range(len(amines)))
    rows = []
    for (acid, amine), product in zip(pairs, products, strict=True):
        assert len(product) == 1
        Chem.SanitizeMol(product[0])
        rows.append({
            "smiles": Chem.MolToSmiles(product[0]),
            "reactants": [acids[acid][0], amines[amine][0]],
            "rows": [acid + 1, amine + 1],
        })
    return rows


def labelled(smiles, label):
    molecule = Chem.MolFromSmiles(smiles)
    dummies = [atom for atom in molecule.GetAtoms() if atom.GetAtomicNum() == 0]
    assert len(dummies) == 1
    dummies[0].SetAtomMapNum(label)
    return molecule


def core_library():
    r1 = read_smiles("r1.smi")
    r2 = read_smiles("r2.smi")
    rows = []
    for (first, _), (second, _) in itertools.product(r1, r2):
        product = Chem.molzip(Chem.molzip(Chem.MolFromSmiles(CORE), labelled(first, 1)), labelled(second, 2))
        Chem.SanitizeMol(product)
        rows.append({"smiles": Chem.MolToSmiles(product), "groups": [first, second]})
    return rows


json.dump({
    "rdkit": rdBase.rdkitVersion,
    "amidation": AMIDATION,
    "amides": amide_library(),
    "core": CORE,
    "coreLibrary": core_library(),
}, sys.stdout, indent=2)
sys.stdout.write("\n")
