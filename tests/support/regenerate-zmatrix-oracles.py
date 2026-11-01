"""Regenerate the independent Z-matrix oracles and cross-check the coordinate CLI.

Inputs are RDKit ETKDG/MMFF conformers. Open Babel (an external GPL tool, never
bundled) writes its own Gaussian and MOPAC internal coordinates for each input;
those files are the committed oracle that `tests/test-zmatrix-reference.test.ts`
reads through the real CLI. RDKit identifies stereocentres and their CIP labels.

With `--check`, the script also runs Burette's CLI and reports how independent
tools read its output: RDKit measures every emitted bond/angle/dihedral on the
input conformer, Open Babel rebuilds Cartesian atoms from the emitted Z-matrix,
and RDKit re-perceives CIP and E/Z labels from every reconstruction.

    uv run --with rdkit python tests/support/regenerate-zmatrix-oracles.py [--check]

Requires `obabel` (Open Babel 3.x) on PATH and Node for `--check`.
"""
import argparse
import itertools
import math
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem, rdMolTransforms
from rdkit.Geometry import Point3D

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/zmatrix-reference"
CLI = ROOT / "scripts/burette-agent.mjs"
CASES = {
    "bromochlorofluoromethane": "F[C@H](Cl)Br",
    "l-alanine": "C[C@H](N)C(=O)O",
    "cyclohexane": "C1CCCCC1",
    "water-dimer": "O.O",
    "e-2-butene": "C/C=C/C",
    "dichloroallene": "ClC=C=CCl",
    "acetylene": "C#C",
    "acetonitrile": "N#CC",
    "s-1-phenylethanol": "C[C@H](O)c1ccccc1",
    # Exactly collinear leading atoms: Burette must insert a dummy reference.
    "acetonitrile-linear": ("N#CC", [(0, 0, -1.157), (0, 0, 0), (0, 0, 1.458), (1.027, 0, 1.821),
                                     (-0.5135, 0.889408, 1.821), (-0.5135, -0.889408, 1.821)]),
}
# A symbolic definition with a dummy reference, shared and signed uses and an unused variable.
SYMBOLIC = "C\nX 1 DX\nH 1 R 2 A\nF 1 +R 2 A 3 -P\nCl 1 R 2 A 3 P\n\nDX=1\nR=1.09\nA=109.5\nP=120\nUNUSED=-17.125\n"


def conformer(case):
    smiles, positions = case if isinstance(case, tuple) else (case, None)
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = 20261101
    if AllChem.EmbedMolecule(mol, params) != 0:
        raise RuntimeError(f"embedding failed for {smiles}")
    AllChem.MMFFOptimizeMolecule(mol, maxIters=2000)
    conf = mol.GetConformer()
    # ETKDG may overlay disconnected fragments; place each later fragment 3 Å
    # further along x after a quarter turn so the system has distinct atoms.
    for k, fragment in enumerate(Chem.GetMolFrags(mol)[1:], start=1):
        for i in fragment:
            p = conf.GetAtomPosition(i)
            conf.SetAtomPosition(i, Point3D(p.x + 3.0 * k, -p.z, p.y))
    for i, p in enumerate(positions or []):
        conf.SetAtomPosition(i, Point3D(*p))
    return mol


def xyz_text(mol, title):
    conf = mol.GetConformer()
    rows = [f"{atom.GetSymbol()} {conf.GetAtomPosition(i).x!r} {conf.GetAtomPosition(i).y!r} {conf.GetAtomPosition(i).z!r}"
            for i, atom in enumerate(mol.GetAtoms())]
    return f"{mol.GetNumAtoms()}\n{title}\n" + "\n".join(rows) + "\n"


def obabel(args, stdin=None):
    return subprocess.run(["obabel", *args], input=stdin, capture_output=True, text=True, check=True).stdout


def gaussian_body(text):
    """Rows and variables after Open Babel's charge/multiplicity line."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.split() == ["0", "1"]) + 1
    body = []
    for line in lines[start:]:
        if not line.strip() and any(row.startswith("Variables:") for row in body):
            break
        body.append(line)
    return "\n".join(body).strip() + "\n"


def mopac_body(text):
    """MOPAC internal rows `El r f a f d f na nb nc` in Burette's `El na r nb a nc d` order."""
    rows = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 10 or not fields[0].isalpha():
            continue
        refs = [int(value) for value in fields[7:10]]
        values = [fields[1], fields[3], fields[5]]
        pairs = [f"{ref} {value}" for ref, value in zip(refs, values) if ref > 0]
        rows.append(" ".join([fields[0], *pairs]))
    return "\n".join(rows) + "\n"


def stereo_labels(mol, positions):
    copy = Chem.Mol(mol)
    conf = copy.GetConformer()
    for i, (x, y, z) in enumerate(positions):
        conf.SetAtomPosition(i, Point3D(x, y, z))
    Chem.AssignStereochemistryFrom3D(copy)
    centres = {atom.GetIdx(): atom.GetProp("_CIPCode") for atom in copy.GetAtoms() if atom.HasProp("_CIPCode")}
    bonds = {bond.GetIdx(): str(bond.GetStereo()) for bond in copy.GetBonds() if bond.GetStereo() != Chem.BondStereo.STEREONONE}
    return {"centres": centres, "bonds": bonds}


def oracle(mol):
    """Stereocentres with their ordered neighbours and E/Z bonds with their reference atoms."""
    labels = stereo_labels(mol, [tuple(p) for p in mol.GetConformer().GetPositions()])
    centres = [{"atom": idx, "neighbors": [n.GetIdx() for n in mol.GetAtomWithIdx(idx).GetNeighbors()], "cip": cip}
               for idx, cip in labels["centres"].items()]
    bonds = []
    for bond in mol.GetBonds():
        if bond.GetStereo() == Chem.BondStereo.STEREONONE:
            continue
        a, b = bond.GetBeginAtom(), bond.GetEndAtom()
        ends = [next(n.GetIdx() for n in atom.GetNeighbors() if n.GetIdx() != other.GetIdx() and n.GetAtomicNum() > 1)
                for atom, other in ((a, b), (b, a))]
        torsion = rdMolTransforms.GetDihedralDeg(mol.GetConformer(), ends[0], a.GetIdx(), b.GetIdx(), ends[1])
        bonds.append({"atoms": [ends[0], a.GetIdx(), b.GetIdx(), ends[1]], "label": str(bond.GetStereo()), "trans": abs(torsion) > 90})
    return {"centres": centres, "doubleBonds": bonds}


def regenerate():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, case in CASES.items():
        mol = conformer(case)
        smiles = case[0] if isinstance(case, tuple) else case
        xyz = xyz_text(mol, f"{name} {'explicit coordinates' if isinstance(case, tuple) else 'RDKit ETKDGv3 MMFF94'}")
        (FIXTURES / f"{name}.xyz").write_text(xyz)
        (FIXTURES / f"{name}.openbabel.gzmat.zmat").write_text(gaussian_body(obabel(["-ixyz", "-ogzmat"], xyz)))
        (FIXTURES / f"{name}.openbabel.mopin.zmat").write_text(mopac_body(obabel(["-ixyz", "-omopin"], xyz)))
        manifest[name] = {"smiles": smiles, **oracle(mol)}
    version = obabel(["-V"]).strip()
    (FIXTURES / "oracle.json").write_text(json.dumps({"openBabel": version, "rdkit": Chem.rdBase.rdkitVersion, "cases": manifest}, indent=1) + "\n")


def read_xyz(text):
    lines = text.splitlines()
    count = int(lines[0])
    return [(line.split()[0], tuple(float(v) for v in line.split()[1:4])) for line in lines[2:2 + count]]


def convert(source, fmt, directory):
    """Runs the CLI subprocess and returns the written file."""
    output = Path(directory) / f"out-{len(list(Path(directory).iterdir()))}.{fmt}"
    subprocess.run(["node", str(CLI), "convert", "--file", str(source), "--format", fmt, "--output", str(output)],
                   capture_output=True, text=True, check=True)
    return output


def max_distance_error(a, b):
    return max((abs(dist(a[i], a[j]) - dist(b[i], b[j])) for i, j in itertools.combinations(range(len(a)), 2)), default=0.0)


def sin_deg(angle):
    return math.sin(math.radians(angle))


def dist(p, q):
    return sum((x - y) ** 2 for x, y in zip(p, q)) ** 0.5


def burette_rows(zmat):
    rows = []
    for line in zmat.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split()
        rows.append((fields[0], [int(v) - 1 for v in fields[1::2]], [float(v) for v in fields[2::2]]))
    return rows


def check():
    data = json.loads((FIXTURES / "oracle.json").read_text())
    report = {}
    with tempfile.TemporaryDirectory() as directory:
        for name, case in data["cases"].items():
            source = FIXTURES / f"{name}.xyz"
            original = read_xyz(source.read_text())
            positions = [p for _, p in original]
            mol = conformer(case["smiles"])
            conf = mol.GetConformer()
            for i, p in enumerate(positions):
                conf.SetAtomPosition(i, Point3D(*p))
            expected = stereo_labels(mol, positions)
            zmat_path = convert(source, "zmat", directory)
            zmat = zmat_path.read_text()
            rows = burette_rows(zmat)
            # Physical index of each definition row (dummy references have none).
            physical, measured_error, skipped, ill = [], 0.0, 0, 0
            for element, refs, values in rows:
                physical.append(None if element == "X" else sum(1 for p in physical if p is not None))
                ids = [physical[-1], *(physical[ref] for ref in refs)]
                if None in ids:
                    skipped += 1
                    continue
                measures = [rdMolTransforms.GetBondLength(conf, ids[0], ids[1]) if len(refs) > 0 else None,
                            rdMolTransforms.GetAngleDeg(conf, ids[0], ids[1], ids[2]) if len(refs) > 1 else None,
                            rdMolTransforms.GetDihedralDeg(conf, ids[0], ids[1], ids[2], ids[3]) if len(refs) > 2 else None]
                # A dihedral is undefined when either of its angles is (nearly) linear;
                # there its value moves the atom by at most r·sin(angle)·Δφ.
                if len(refs) > 2 and min(abs(sin_deg(rdMolTransforms.GetAngleDeg(conf, ids[0], ids[1], ids[2]))),
                                         abs(sin_deg(rdMolTransforms.GetAngleDeg(conf, ids[1], ids[2], ids[3])))) < 1e-3:
                    ill += 1
                    measures[2] = values[2]
                for value, reference in zip(values, measures):
                    measured_error = max(measured_error, abs(value - reference))
            body = "\n".join(line for line in zmat.splitlines() if not line.lstrip().startswith("#"))
            gaussian = "#\n\nreference\n\n0 1\n" + body.replace(" +", " ") + "\n\n"
            rebuilt = [p for element, p in read_xyz(obabel(["-igzmat", "-oxyz"], gaussian))]
            ours = [p for _, p in read_xyz(convert(zmat_path, "xyz", directory).read_text())]
            from_openbabel = {}
            for kind in ("gzmat", "mopin"):
                try:
                    rebuilt_ours = [p for _, p in read_xyz(convert(FIXTURES / f"{name}.openbabel.{kind}.zmat", "xyz", directory).read_text())]
                except subprocess.CalledProcessError as error:
                    from_openbabel[kind] = {"refused": json.loads(error.stderr)["error"]["message"]}
                    continue
                from_openbabel[kind] = {"maxDistanceError": max_distance_error(positions, rebuilt_ours),
                                        "stereoMatches": stereo_labels(mol, rebuilt_ours) == expected}
            report[name] = {
                "rows": len(rows), "dummyRows": sum(1 for row in rows if row[0] == "X"), "rowsReferencingDummies": skipped,
                "illConditionedDihedrals": ill,
                "rdkitMaxValueError": measured_error,
                "openBabelRebuildMaxDistanceError": max_distance_error(positions, rebuilt),
                "openBabelRebuildStereoMatches": stereo_labels(mol, rebuilt) == expected,
                "buretteRoundTripExact": ours == positions,
                "openBabelInternalCoordinatesReadByBurette": from_openbabel,
                "stereo": expected,
            }
        symbolic = Path(directory) / "symbolic.zmat"
        symbolic.write_text(SYMBOLIC)
        ours = [p for _, p in read_xyz(convert(symbolic, "xyz", directory).read_text())]
        gaussian = "#\n\nreference\n\n0 1\n" + SYMBOLIC.replace(" +", " ") + "\n"
        rebuilt = [p for _, p in read_xyz(obabel(["-igzmat", "-oxyz"], gaussian))]
        report["symbolic-dummy"] = {"openBabelRebuildMaxDistanceError": max_distance_error(ours, rebuilt), "atoms": len(ours)}
    print(json.dumps({"openBabel": data["openBabel"], "rdkit": data["rdkit"], "cases": report}, indent=1))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="cross-check the CLI against the committed oracle")
    args = parser.parse_args()
    if not shutil.which("obabel"):
        raise SystemExit("obabel (Open Babel 3.x) must be on PATH")
    if args.check:
        check()
    else:
        regenerate()
