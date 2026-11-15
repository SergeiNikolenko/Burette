# Independent coordinate-editing reference for Burette's measurement and align operations.
#
#   uv run --with rdkit==2026.09.1 --with numpy --with scipy \
#     python tests/fixtures/coordinate-editing/generate-reference.py
#
# RDKit rdMolTransforms moves the fragment on the last atom's side of the edited
# bond (SetBondLength: j side, SetAngleDeg: k side, SetDihedralDeg: the k side
# without k). Align follows Avogadro's Align tool: translate the first atom to the
# origin, then apply the minimal rotation taking the second atom onto +axis.
# Expected align coordinates come from SciPy's Rotation.align_vectors; Burette's
# implementation is never consulted.
import json
from pathlib import Path

import numpy as np
import rdkit
import scipy
from rdkit import Chem
from rdkit.Chem import AllChem, rdMolTransforms
from scipy.spatial.transform import Rotation

HERE = Path(__file__).resolve().parent


def embedded(smiles, seed):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    assert AllChem.EmbedMolecule(mol, params) == 0
    return mol


def written(mol, title):
    mol.SetProp("_Name", title)
    v2000 = Chem.MolToMolBlock(mol)
    # Every variant carries the same 4-decimal coordinates as the V2000 block.
    parsed = Chem.MolFromMolBlock(v2000, removeHs=False)
    parsed.SetProp("_Name", title)
    v3000 = Chem.MolToMolBlock(parsed, forceV3000=True)
    sdf = f"{v2000}>  <SOURCE_NOTE>\nkept verbatim\n\n$$$$\n"
    for text in (v3000, sdf):
        other = Chem.MolFromMolBlock(text.split("$$$$")[0], removeHs=False)
        assert np.array_equal(other.GetConformer().GetPositions(), parsed.GetConformer().GetPositions())
    return parsed, {"v2000": v2000, "v3000": v3000, "sdf": sdf}


def cip(mol, positions):
    copy = Chem.Mol(mol)
    conf = copy.GetConformer()
    for index, point in enumerate(positions):
        conf.SetAtomPosition(index, [float(value) for value in point])
    Chem.AssignStereochemistryFrom3D(copy)
    return {str(atom.GetIdx()): atom.GetProp("_CIPCode") for atom in copy.GetAtoms() if atom.HasProp("_CIPCode")}


def measure(conf, kind, atoms):
    if kind == "distance":
        return rdMolTransforms.GetBondLength(conf, *atoms)
    if kind == "angle":
        return rdMolTransforms.GetAngleDeg(conf, *atoms)
    return rdMolTransforms.GetDihedralDeg(conf, *atoms)


def measurement_case(name, mol, kind, atoms, value, side, rdkit_atoms=None):
    """`rdkit_atoms` is the order in which RDKit moves the same fragment Burette moves."""
    copy = Chem.Mol(mol)
    conf = copy.GetConformer()
    before = conf.GetPositions()
    order = rdkit_atoms or atoms
    case = {"molecule": name, "measurement": kind, "atoms": atoms, "value": value, "side": side}
    try:
        {"distance": rdMolTransforms.SetBondLength, "angle": rdMolTransforms.SetAngleDeg,
         "dihedral": rdMolTransforms.SetDihedralDeg}[kind](conf, *order, value)
    except (ValueError, RuntimeError) as error:
        case["refused"] = str(error).splitlines()[0][:200]
        return case
    after = conf.GetPositions()
    case.update({
        "expected": after.tolist(),
        "measured": measure(conf, kind, atoms),
        "moved": [index for index in range(len(after)) if not np.allclose(after[index], before[index], atol=0, rtol=0)],
        "cip": {"before": cip(mol, before), "after": cip(mol, after)},
    })
    return case


AXES = {"x": np.array([1.0, 0, 0]), "y": np.array([0, 1.0, 0]), "z": np.array([0, 0, 1.0])}


def signed_volumes(points, mol):
    result = {}
    for atom in mol.GetAtoms():
        neighbours = [neighbour.GetIdx() for neighbour in atom.GetNeighbors()]
        if len(neighbours) == 4:
            a, b, c, d = (points[index] for index in neighbours)
            result[str(atom.GetIdx())] = float(np.dot(b - a, np.cross(c - a, d - a)))
    return result


def align_case(name, mol, origin, target, axis):
    before = mol.GetConformer().GetPositions()
    shifted = before - before[origin]
    case = {"molecule": name, "origin": origin, "axis": axis}
    if target is None:
        expected, matrix = shifted, np.eye(3)
    else:
        case["target"] = target
        direction = shifted[target] / np.linalg.norm(shifted[target])
        if np.dot(direction, AXES[axis]) < -1 + 1e-12:
            # Antiparallel: any half turn about a perpendicular works; Burette documents the next axis.
            following = {"x": "y", "y": "z", "z": "x"}[axis]
            rotation = Rotation.from_rotvec(np.pi * AXES[following])
            case["convention"] = f"half turn about {following}"
        else:
            rotation, _ = Rotation.align_vectors([AXES[axis]], [direction])
        matrix = rotation.as_matrix()
        expected = shifted @ matrix.T
    case.update({
        "expected": expected.tolist(),
        "translation": (-before[origin]).tolist(),
        "rotation": matrix.tolist(),
        "cip": {"before": cip(mol, before), "after": cip(mol, expected)},
        "signedVolumes": {"before": signed_volumes(before, mol), "after": signed_volumes(expected, mol)},
    })
    return case


def antiparallel_halomethane():
    mol = embedded("F[C@H](Cl)Br", 11)
    conf = mol.GetConformer()
    points = conf.GetPositions()
    carbon = 1
    hydrogen = next(atom.GetIdx() for atom in mol.GetAtomWithIdx(carbon).GetNeighbors() if atom.GetSymbol() == "H")
    direction = points[hydrogen] - points[carbon]
    rotation, _ = Rotation.align_vectors([[0, 0, -1.0]], [direction / np.linalg.norm(direction)])
    # Round onto the V2000 grid with the C-H direction exactly on -z.
    moved = np.round((points - points[carbon]) @ rotation.as_matrix().T + [1.25, -0.5, 2.0], 4)
    moved[hydrogen][:2] = moved[carbon][:2]
    for index, point in enumerate(moved):
        conf.SetAtomPosition(index, point.tolist())
    return mol, carbon, hydrogen


def main():
    molecules, sources = {}, {}
    butanol, sources["butanol"] = written(embedded("C[C@@H](O)CC", 42), "(R)-butan-2-ol")
    cyclohexanol, sources["cyclohexanol"] = written(embedded("OC1CCCCC1", 7), "cyclohexanol")
    halomethane, carbon, hydrogen = antiparallel_halomethane()
    halomethane, sources["halomethane"] = written(halomethane, "bromochlorofluoromethane")
    for name, mol in (("butanol", butanol), ("cyclohexanol", cyclohexanol), ("halomethane", halomethane)):
        molecules[name] = {**sources[name], "coordinates": mol.GetConformer().GetPositions().tolist(),
                           "elements": [atom.GetSymbol() for atom in mol.GetAtoms()]}
    measurements = [
        # Butanol heavy atoms: 0 C1, 1 C2 (stereocentre), 2 O, 3 C3, 4 C4.
        measurement_case("butanol", butanol, "distance", [1, 3], 1.62, "last"),
        measurement_case("butanol", butanol, "distance", [3, 1], 1.62, "smaller", [1, 3]),
        measurement_case("butanol", butanol, "angle", [0, 1, 3], 118.0, "last"),
        measurement_case("butanol", butanol, "angle", [3, 1, 0], 104.5, "smaller"),
        measurement_case("butanol", butanol, "dihedral", [0, 1, 3, 4], 65.0, "last"),
        measurement_case("butanol", butanol, "dihedral", [4, 3, 1, 0], -150.0, "first", [0, 1, 3, 4]),
        # Cyclohexanol: 0 O, 1 C1, 2..6 ring carbons.
        measurement_case("cyclohexanol", cyclohexanol, "distance", [1, 2], 1.6, "smaller"),
        measurement_case("cyclohexanol", cyclohexanol, "distance", [0, 3], 2.5, "smaller"),
        measurement_case("cyclohexanol", cyclohexanol, "distance", [1, 0], 1.5, "smaller"),
        measurement_case("cyclohexanol", cyclohexanol, "angle", [2, 1, 0], 100.0, "smaller"),
        measurement_case("cyclohexanol", cyclohexanol, "angle", [0, 1, 2], 100.0, "last"),
    ]
    hydroxyl = next(atom.GetIdx() for atom in cyclohexanol.GetAtomWithIdx(0).GetNeighbors() if atom.GetSymbol() == "H")
    measurements.append(measurement_case("cyclohexanol", cyclohexanol, "dihedral", [2, 1, 0, hydroxyl], 180.0, "smaller"))
    # The dihedral over the ring bond 1-2 cannot move either side rigidly.
    measurements.append(measurement_case("cyclohexanol", cyclohexanol, "dihedral", [0, 1, 2, 3], 30.0, "smaller"))
    aligns = [
        align_case("butanol", butanol, 1, 3, "x"),
        align_case("butanol", butanol, 1, 3, "y"),
        align_case("butanol", butanol, 2, 4, "z"),
        align_case("butanol", butanol, 4, None, "x"),
        align_case("halomethane", halomethane, carbon, hydrogen, "z"),
    ]
    reference = {
        "generator": "tests/fixtures/coordinate-editing/generate-reference.py",
        "rdkit": rdkit.__version__, "numpy": np.__version__, "scipy": scipy.__version__,
        "molecules": molecules, "measurements": measurements, "aligns": aligns,
    }
    (HERE / "rdkit-reference.json").write_text(json.dumps(reference, indent=1) + "\n")


if __name__ == "__main__":
    main()
