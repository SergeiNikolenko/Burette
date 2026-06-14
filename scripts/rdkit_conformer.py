import io
import json
import math
import sys

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem
except Exception as exc:
    sys.stderr.write("RDKit Python is not available: " + str(exc))
    sys.exit(2)

text = sys.stdin.read()
try:
    payload = json.loads(text)
except Exception as exc:
    sys.stderr.write("Invalid conformer generation request: " + str(exc))
    sys.exit(3)

text = str(payload.get("text") or "")
engine = str(payload.get("engine") or "datamol").strip().lower()
mode = str(payload.get("mode") or "single").strip().lower()
extension = str(payload.get("extension") or "").strip().lower().lstrip(".")
source3d = payload.get("source3d")
if not text.strip():
    sys.stderr.write("Structure text is empty.")
    sys.exit(3)
if engine not in ("datamol", "rdkit"):
    sys.stderr.write("3D conformer generation supports Datamol and RDKit engines.")
    sys.exit(3)
if mode not in ("single", "ensemble"):
    mode = "single"

if "$RXN" in text:
    sys.stderr.write("3D conformer generation supports single small molecules, not reactions.")
    sys.exit(3)

DEFAULT_ENSEMBLE_CANDIDATE_COUNT = 128
DEFAULT_ENSEMBLE_RMSD_CUTOFF = 0.75


def bounded_int_setting(name, default, minimum, maximum):
    try:
        value = int(payload.get(name, default))
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def bounded_float_setting(name, default, minimum, maximum):
    try:
        value = float(payload.get(name, default))
    except Exception:
        value = default
    if not math.isfinite(value):
        value = default
    return max(minimum, min(maximum, value))


ENSEMBLE_CANDIDATE_COUNT = bounded_int_setting("candidateCount", DEFAULT_ENSEMBLE_CANDIDATE_COUNT, 1, 512)
ENSEMBLE_RMSD_CUTOFF = bounded_float_setting("rmsdCutoff", DEFAULT_ENSEMBLE_RMSD_CUTOFF, 0.0, 5.0)


def parse_molecule(value, label):
    mol = None
    if extension in ("smi", "smiles"):
        smiles = value.strip().splitlines()[0].split()[0] if value.strip() else ""
        mol = Chem.MolFromSmiles(smiles, sanitize=True)
    elif "$$$$" in value:
        supplier = Chem.ForwardSDMolSupplier(io.BytesIO(value.encode("utf-8")), sanitize=True, removeHs=False)
        for item in supplier:
            if item is not None:
                mol = item
                break
    else:
        mol = Chem.MolFromMolBlock(value, sanitize=True, removeHs=False)
    if mol is None:
        sys.stderr.write("RDKit could not parse " + label + ".")
        sys.exit(3)
    return mol


mol = parse_molecule(text, "the structure")


def source_core_with_conformer(source):
    if not isinstance(source, dict):
        return None
    source_text = str(source.get("text") or "")
    if not source_text.strip() or "$RXN" in source_text:
        return None
    core = parse_molecule(source_text, "the source 3D structure")
    if core.GetNumConformers() == 0:
        return None
    conf = core.GetConformer()
    if hasattr(conf, "Is3D") and not conf.Is3D():
        return None
    return Chem.RemoveHs(core, sanitize=False)


atom_count = mol.GetNumAtoms()
if atom_count == 0:
    sys.stderr.write("Structure has no atoms.")
    sys.exit(3)
if atom_count > 256:
    sys.stderr.write("3D conformer generation supports up to 256 atoms.")
    sys.exit(3)

core = source_core_with_conformer(source3d)
core_match = ()
if core is not None:
    if core.GetNumAtoms() == 0:
        core = None
    else:
        core_match = mol.GetSubstructMatch(core)
        if len(core_match) != core.GetNumAtoms():
            sys.stderr.write("Cannot preserve the original 3D pose because the original core no longer matches the current Ketcher sketch.")
            sys.exit(4)

def conformer_plane_thickness(value, conf_id):
    conf = value.GetConformer(conf_id)
    points = []
    for atom_idx in range(value.GetNumAtoms()):
        if value.GetAtomWithIdx(atom_idx).GetAtomicNum() == 1:
            continue
        position = conf.GetAtomPosition(atom_idx)
        points.append((position.x, position.y, position.z))
    if not points:
        return 0.0
    try:
        import numpy as np
        array = np.array(points, dtype=float)
        array = array - array.mean(axis=0)
        covariance = array.T @ array / max(1, len(points))
        eigenvalues, eigenvectors = np.linalg.eigh(covariance)
        normal = eigenvectors[:, int(np.argmin(eigenvalues))]
        distances = array @ normal
        return float(distances.max() - distances.min())
    except Exception:
        ranges = []
        for axis in range(3):
            values = [point[axis] for point in points]
            ranges.append(max(values) - min(values))
        return min(ranges)


def molecule_force_field(value, conf_id):
    if AllChem.MMFFHasAllMoleculeParams(value):
        props = AllChem.MMFFGetMoleculeProperties(value)
        return AllChem.MMFFGetMoleculeForceField(value, props, confId=int(conf_id)), "MMFF"
    return AllChem.UFFGetMoleculeForceField(value, confId=int(conf_id)), "UFF"


def optimize_conformer(value, conf_id, fixed_atoms=None):
    ff, family = molecule_force_field(value, conf_id)
    if fixed_atoms:
        for atom_idx in fixed_atoms:
            ff.AddFixedPoint(int(atom_idx))
    ff.Initialize()
    ff.Minimize(maxIts=500)
    try:
        energy = float(ff.CalcEnergy())
    except Exception:
        energy = math.inf
    return energy, family


def keep_only_conformer(value, conf_id):
    for conformer in list(value.GetConformers()):
        current_id = conformer.GetId()
        if current_id != conf_id:
            value.RemoveConformer(current_id)


def embed_params(random_coords=False):
    params = AllChem.ETKDGv3() if hasattr(AllChem, "ETKDGv3") else AllChem.ETKDG()
    params.randomSeed = 0xB00
    params.useRandomCoords = bool(random_coords)
    if hasattr(params, "pruneRmsThresh"):
        params.pruneRmsThresh = ENSEMBLE_RMSD_CUTOFF if mode == "ensemble" else 0.25
    return params


def datamol_module():
    try:
        import datamol as dm
        return dm
    except Exception as exc:
        sys.stderr.write("Datamol Python is not available: " + str(exc))
        sys.exit(2)


def datamol_forcefield(value):
    probe = Chem.AddHs(Chem.Mol(value))
    return "MMFF94s" if AllChem.MMFFHasAllMoleculeParams(probe) else "UFF"


def conformer_energy_property(conf, forcefield):
    for key in (
        "rdkit_" + forcefield + "_energy",
        "rdkit_MMFF94s_energy",
        "rdkit_UFF_energy",
    ):
        if conf.HasProp(key):
            try:
                return float(conf.GetProp(key))
            except Exception:
                pass
    return math.inf


def select_ensemble_conformer_ids(scored):
    return [item[2] for item in sorted(scored, key=lambda item: (item[0], item[1], item[2]))]


used_datamol = engine == "datamol" and core is None

if used_datamol:
    dm = datamol_module()
    forcefield = datamol_forcefield(mol)
    try:
        generated = dm.conformers.generate(
            mol,
            n_confs=ENSEMBLE_CANDIDATE_COUNT if mode == "ensemble" else 32,
            use_random_coords=True,
            enforce_chirality=True,
            num_threads=1,
            rms_cutoff=ENSEMBLE_RMSD_CUTOFF if mode == "ensemble" else 0.25,
            clear_existing=True,
            align_conformers=True,
            minimize_energy=True,
            sort_by_energy=True,
            method="ETKDGv3",
            forcefield=forcefield,
            energy_iterations=500,
            random_seed=0xB00,
            add_hs=True,
            ignore_failure=False,
        )
    except Exception as exc:
        sys.stderr.write("Datamol failed to generate 3D conformers: " + str(exc))
        sys.exit(4)
    if generated is None or generated.GetNumConformers() == 0:
        sys.stderr.write("Datamol did not produce conformer coordinates.")
        sys.exit(4)
    mol = generated
    scored = []
    for conformer in mol.GetConformers():
        conf_id = int(conformer.GetId())
        scored.append((
            conformer_energy_property(conformer, forcefield),
            -conformer_plane_thickness(mol, conf_id),
            conf_id,
        ))
    if not scored:
        sys.stderr.write("Datamol did not produce conformer coordinates.")
        sys.exit(4)
    if mode == "ensemble":
        selected_conf_ids = select_ensemble_conformer_ids(scored)
        method = "Datamol+ETKDGv3+" + forcefield + "+conformer-set"
    else:
        _, _, selected_conf_id = sorted(scored, key=lambda item: (item[1], item[0], item[2]))[0]
        selected_conf_ids = [selected_conf_id]
        method = "Datamol+ETKDGv3+" + forcefield
        keep_only_conformer(mol, selected_conf_id)
else:
    mol = Chem.AddHs(mol)

params = embed_params(False)
coord_map = {}
conformer_ids = []
if not used_datamol:
    if core is not None:
        core_conf = core.GetConformer()
        for core_idx, mol_idx in enumerate(core_match):
            coord_map[int(mol_idx)] = core_conf.GetAtomPosition(core_idx)
        if hasattr(params, "SetCoordMap"):
            params.SetCoordMap(coord_map)
            if mode == "ensemble":
                conformer_ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=ENSEMBLE_CANDIDATE_COUNT, params=params))
                status = 0 if conformer_ids else -1
            else:
                status = AllChem.EmbedMolecule(mol, params)
                conformer_ids = [mol.GetConformer().GetId()] if status == 0 else []
        else:
            status = AllChem.EmbedMolecule(
                mol,
                coordMap=coord_map,
                randomSeed=0xB00,
                useExpTorsionAnglePrefs=True,
                useBasicKnowledge=True,
                enforceChirality=True,
            )
            conformer_ids = [mol.GetConformer().GetId()] if status == 0 else []
    else:
        mol.RemoveAllConformers()
        params = embed_params(True)
        conformer_ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=ENSEMBLE_CANDIDATE_COUNT if mode == "ensemble" else 32, params=params))
        if not conformer_ids:
            status = AllChem.EmbedMolecule(mol, params)
            conformer_ids = [mol.GetConformer().GetId()] if status == 0 else []
        else:
            status = 0
    if status != 0:
        if core is not None and not hasattr(params, "SetCoordMap"):
            status = AllChem.EmbedMolecule(
                mol,
                coordMap=coord_map,
                randomSeed=0xB00,
                useRandomCoords=True,
                useExpTorsionAnglePrefs=True,
                useBasicKnowledge=True,
                enforceChirality=True,
            )
        else:
            params.useRandomCoords = True
            if core is not None and hasattr(params, "SetCoordMap"):
                params.SetCoordMap(coord_map)
            if mode == "ensemble":
                conformer_ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=ENSEMBLE_CANDIDATE_COUNT, params=params))
                status = 0 if conformer_ids else -1
            else:
                status = AllChem.EmbedMolecule(mol, params)
                conformer_ids = [mol.GetConformer().GetId()] if status == 0 else []
    if status != 0:
        sys.stderr.write("RDKit failed to embed a 3D conformer.")
        sys.exit(4)

    method = "ETKDG"
    scored = []
    family = "MMFF" if AllChem.MMFFHasAllMoleculeParams(mol) else "UFF"
    for conf_id in conformer_ids or [mol.GetConformer().GetId()]:
        try:
            energy, family = optimize_conformer(mol, conf_id, coord_map.keys() if core is not None else None)
        except Exception:
            energy = math.inf
        scored.append((energy, -conformer_plane_thickness(mol, conf_id), int(conf_id)))
    if not scored:
        sys.stderr.write("RDKit did not produce conformer coordinates.")
        sys.exit(4)
    if mode == "ensemble":
        selected_conf_ids = select_ensemble_conformer_ids(scored)
        method = "ETKDG+" + family + "+conformer-set"
    else:
        _, _, selected_conf_id = sorted(scored, key=lambda item: (item[1], item[0], item[2]))[0]
        selected_conf_ids = [selected_conf_id]
        method = "ETKDG+" + family + ("+fixed-core" if core is not None else "+ensemble")
        keep_only_conformer(mol, selected_conf_id)

    if core is not None:
        for conf in mol.GetConformers():
            for atom_idx, position in coord_map.items():
                conf.SetAtomPosition(int(atom_idx), position)

try:
    output_mol = Chem.RemoveHs(mol, sanitize=False)
except Exception:
    output_mol = mol

if output_mol.GetNumConformers() == 0:
    sys.stderr.write("RDKit did not produce conformer coordinates.")
    sys.exit(4)

records = []
for rank, conf_id in enumerate(selected_conf_ids, start=1):
    output_mol.SetProp("_Name", "Conformer " + str(rank))
    try:
        block = Chem.MolToMolBlock(output_mol, confId=int(conf_id), kekulize=False)
    except Exception:
        block = Chem.MolToMolBlock(output_mol, kekulize=False)
    records.append(block.rstrip() + "\n$$$$\n")

sys.stdout.write(json.dumps({
    "text": "".join(records),
    "method": method,
    "conformerCount": len(records),
}))
