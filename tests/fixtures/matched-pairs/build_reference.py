"""Builds the matched-pair fixtures for tests/test-matched-pairs.test.ts.

Two steps per series, both documented in README.md next to this file:

  series NAME ACTIVITY_JSON   ChEMBL activity JSON -> NAME.sdf
  reference NAME              NAME.sdf -> mmpdb fragment/index -> NAME.mmpdb.json

The reference step reads the molecules back from the SDF, so mmpdb and the app
see the same structures and the same values.
"""
import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem

HERE = Path(__file__).resolve().parent
RGROUP_RUNNER = HERE.parents[2] / "apps/desktop/src-tauri/src/commands/rgroup_runner.py"
PROPERTY = "pKi"


def build_series(name, chembl_json):
    # A molecule measured twice keeps its first reported value.
    activities = {}
    for activity in sorted(json.loads(Path(chembl_json).read_text())["activities"], key=lambda a: a["activity_id"]):
        activities.setdefault(activity["molecule_chembl_id"], activity)
    activities = sorted(activities.values(), key=lambda a: int(a["molecule_chembl_id"].removeprefix("CHEMBL")))
    mols = [Chem.MolFromSmiles(activity["canonical_smiles"]) for activity in activities]

    # The R-group columns are the ones Analyze > Decompose R-Groups stores: the
    # same runner, all scaffolds, written under the same column names.
    payload = {"core": "", "rows": [{"rowId": i, "smiles": Chem.MolToSmiles(mol), "molblock": ""} for i, mol in enumerate(mols)]}
    decomposition = json.loads(subprocess.run(
        [sys.executable, str(RGROUP_RUNNER)], input=json.dumps(payload), capture_output=True, text=True, check=True).stdout)
    if not decomposition.get("ok"):
        raise SystemExit(decomposition.get("error"))
    rgroups = {row["rowId"]: row["values"] for row in decomposition["rows"]}

    writer = Chem.SDWriter(str(HERE / f"{name}.sdf"))
    for index, (activity, mol) in enumerate(zip(activities, mols)):
        AllChem.Compute2DCoords(mol)
        mol.SetProp("_Name", activity["molecule_chembl_id"])
        mol.SetProp(PROPERTY, activity["pchembl_value"])
        for label in decomposition["labels"]:
            value = rgroups.get(index, {}).get(label)
            if value:
                mol.SetProp(f"RGroup_{label}", value)
        writer.write(mol)
    writer.close()
    print(f"wrote {name}.sdf: {len(mols)} molecules, {len(decomposition['series'])} R-group series")


def build_reference(name):
    import mmpdblib

    records = [(mol.GetProp("_Name"), Chem.MolToSmiles(mol), mol.GetProp(PROPERTY))
               for mol in Chem.SDMolSupplier(str(HERE / f"{name}.sdf"))]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "series.smi").write_text("".join(f"{smiles} {title}\n" for title, smiles, _ in records))
        (tmp / "props.tsv").write_text(f"ID\t{PROPERTY}\n" + "".join(f"{title}\t{value}\n" for title, _, value in records))
        mmpdb = [sys.executable, "-m", "mmpdblib"]
        subprocess.run([*mmpdb, "fragment", "series.smi", "--num-cuts", "1", "--salt-remover", "<none>",
                        "--num-jobs", "1", "-o", "series.fragdb"], cwd=tmp, check=True, capture_output=True)
        subprocess.run([*mmpdb, "index", "series.fragdb", "--properties", "props.tsv", "-o", "series.mmpdb"],
                       cwd=tmp, check=True, capture_output=True)
        fragdb = sqlite3.connect(tmp / "series.fragdb")
        fragmentations = fragdb.execute(
            "SELECT record.title, enumeration_label, variable_smiles, constant_smiles, variable_num_heavies"
            " FROM fragmentation JOIN record ON record.id = fragmentation.record_id").fetchall()
        db = sqlite3.connect(tmp / "series.mmpdb")
        # Radius 0 is the bare attachment point, so there is one rule environment
        # per rule and its statistics are those of the transformation as a whole.
        rule = (" JOIN rule_environment e ON e.id = {}.rule_environment_id AND e.radius = 0"
                " JOIN rule ON rule.id = e.rule_id"
                " JOIN rule_smiles f ON f.id = rule.from_smiles_id"
                " JOIN rule_smiles t ON t.id = rule.to_smiles_id")
        transformations = db.execute(
            "SELECT f.smiles, t.smiles, s.count, s.avg, s.std, s.min, s.max"
            " FROM rule_environment_statistics s" + rule.format("s")).fetchall()
        pairs = db.execute(
            "SELECT f.smiles, t.smiles, c1.public_id, c2.public_id, k.smiles FROM pair" + rule.format("pair")
            + " JOIN compound c1 ON c1.id = pair.compound1_id"
            " JOIN compound c2 ON c2.id = pair.compound2_id"
            " JOIN constant_smiles k ON k.id = pair.constant_id").fetchall()

    def rows(values):
        return "[\n" + ",\n".join(json.dumps(list(value)) for value in sorted(values, key=json.dumps)) + "\n]"

    (HERE / f"{name}.mmpdb.json").write_text(
        "{\n"
        f'"tool": {json.dumps(f"mmpdb {mmpdblib.__version__}, RDKit {rdBase.rdkitVersion}")},\n'
        f'"property": {json.dumps(PROPERTY)},\n'
        f'"fragmentationColumns": ["id", "label", "variable", "constant", "variableHeavies"],\n'
        f'"fragmentations": {rows(fragmentations)},\n'
        f'"transformationColumns": ["from", "to", "count", "avg", "std", "min", "max"],\n'
        f'"transformations": {rows(transformations)},\n'
        f'"pairColumns": ["from", "to", "fromId", "toId", "constant"],\n'
        f'"pairs": {rows(pairs)}\n'
        "}\n")
    print(f"wrote {name}.mmpdb.json: {len(fragmentations)} fragmentations, "
          f"{len(transformations)} transformations, {len(pairs)} pairs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    series = commands.add_parser("series")
    series.add_argument("name")
    series.add_argument("chembl_json")
    commands.add_parser("reference").add_argument("name")
    args = parser.parse_args()
    if args.command == "series":
        build_series(args.name, args.chembl_json)
    else:
        build_reference(args.name)
