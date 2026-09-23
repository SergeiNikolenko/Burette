import json
import sys
import traceback


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def import_engine():
    try:
        import rdkit
        from rdkit import Chem, RDLogger
        from rdkit.Chem import rdRGroupDecomposition

        RDLogger.DisableLog("rdApp.*")
        return {
            "ok": True,
            "Chem": Chem,
            "rgd": rdRGroupDecomposition,
            "rdkit_version": getattr(rdkit, "__version__", None),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def molecule_from_row(Chem, row):
    molblock = row.get("molblock") or ""
    if molblock.strip():
        molecule = Chem.MolFromMolBlock(molblock, sanitize=True, removeHs=True)
        if molecule is not None:
            return molecule
    smiles = (row.get("smiles") or "").strip()
    if smiles:
        return Chem.MolFromSmiles(smiles)
    return None


def core_from_text(Chem, text):
    text = (text or "").strip()
    if not text:
        return None
    core = Chem.MolFromSmarts(text)
    if core is not None and core.GetNumAtoms():
        return core
    return Chem.MolFromSmiles(text)


def fold_constants(Chem, assignments):
    labels = [label for label in assignments[0] if label != "Core"]
    constants = [label for label in labels
                 if len({row.get(label, "") for row in assignments}) == 1]
    for row in assignments:
        if constants:
            # RDKit's row overload handles duplicated bridge fragments and
            # broken cycles; concatenating SMILES can duplicate attachment atoms.
            core = Chem.molzip({label: Chem.MolFromSmiles(row[label])
                                for label in ["Core", *constants] if row.get(label)})
            Chem.SanitizeMol(core)
            row["Core"] = Chem.MolToSmiles(Chem.RemoveHs(core))
        for label in constants:
            row.pop(label, None)
    return constants


def decompose(payload, engine):
    from rdkit.Chem.Scaffolds import MurckoScaffold
    Chem, rgd = engine["Chem"], engine["rgd"]
    text = (payload.get("core") or "").strip()
    custom = core_from_text(Chem, text) if text else None
    if text and (custom is None or not custom.GetNumAtoms()):
        raise ValueError("The core could not be read as SMILES or SMARTS")
    groups, excluded, components = {}, [], {}
    for row in payload.get("rows") or []:
        mol = molecule_from_row(Chem, row)
        if mol is None:
            excluded.append({"rowId": row["rowId"], "status": "Invalid structure"})
            continue
        fragments = sorted(Chem.GetMolFrags(mol, asMols=True),
                           key=lambda m: (-m.GetNumHeavyAtoms(), Chem.MolToSmiles(m)))
        mol = fragments[0]
        if len(fragments) > 1:
            components[row["rowId"]] = ".".join(Chem.MolToSmiles(m) for m in fragments[1:])
        if custom is not None:
            key = text
        else:
            scaffold = MurckoScaffold.GetScaffoldForMol(mol)
            Chem.RemoveStereochemistry(scaffold)
            if not scaffold.GetNumAtoms():
                excluded.append({"rowId": row["rowId"], "status": "No ring scaffold"})
                continue
            key = Chem.MolToSmiles(scaffold)
        groups.setdefault(key, []).append((row["rowId"], mol))
    rows, series, rlabels = [], [], set()
    for number, (key, members) in enumerate(sorted(groups.items(), key=lambda g: (-len(g[1]), g[0])), 1):
        core = custom if custom is not None else Chem.MolFromSmiles(key)
        parameters = rgd.RGroupDecompositionParameters()
        parameters.removeAllHydrogenRGroups = True
        parameters.onlyMatchAtRGroups = False
        parameters.allowMultipleRGroupsOnUnlabelled = True
        parameters.timeout = 30
        decomposition = rgd.RGroupDecomposition(core, parameters)
        matched = []
        # Canonical order avoids changing symmetry choices when the table is reordered.
        for row_id, molecule in sorted(members, key=lambda m: (Chem.MolToSmiles(m[1]), m[0])):
            if decomposition.Add(molecule) < 0:
                excluded.append({"rowId": row_id, "status": "Core not found"})
            else:
                matched.append(row_id)
        if not matched:
            continue
        if not decomposition.Process():
            raise ValueError("R-group alignment could not be completed. Try a more specific core.")
        assignments = decomposition.GetRGroupsAsRows(asSmiles=True)
        if len(assignments) != len(matched):
            raise ValueError("R-group alignment returned an incomplete result")
        constants = fold_constants(Chem, assignments) if payload.get("foldConstants", True) else []
        labels = sorted({label for row in assignments for label in row if label != "Core"}, key=lambda label: int(label[1:]))
        rlabels.update(labels)
        series_id = f"S{number}"
        for row_id, assignment in zip(matched, assignments):
            values = {**assignment, "Series": series_id, "Status": "Matched"}
            if row_id in components:
                values["Components"] = components[row_id]
            rows.append({"rowId": row_id, "values": values})
        series.append({"id": series_id, "core": assignments[0]["Core"], "query": key,
                       "matchedRows": len(matched), "labels": labels, "constantPositions": len(constants),
                       "coreVariantCount": len({row["Core"] for row in assignments})})
    labels = ["Series", "Status", "Core"] + sorted(rlabels, key=lambda label: int(label[1:]))
    if components:
        labels.append("Components")
    if len(labels) > 64:
        raise ValueError("More than 61 R positions. Choose a more specific core.")
    emit({"ok": True, "rdkitVersion": engine["rdkit_version"], "labels": labels,
          "rows": rows, "series": series, "excludedRows": excluded,
          "unmatchedRows": sum(row["status"] == "Core not found" for row in excluded),
          "unparsedRows": sum(row["status"] == "Invalid structure" for row in excluded),
          "noScaffoldRows": sum(row["status"] == "No ring scaffold" for row in excluded)})


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    engine = import_engine()
    if payload.get("mode") == "status":
        if engine["ok"]:
            emit({"ok": True, "rdkitVersion": engine["rdkit_version"]})
        else:
            emit({"ok": False, "error": engine["error"]})
        return
    if not engine["ok"]:
        emit({"ok": False, "error": engine["error"]})
        return
    decompose(payload, engine)


try:
    main()
except Exception as exc:
    emit({"ok": False, "error": str(exc), "traceback": traceback.format_exc(limit=8)})
