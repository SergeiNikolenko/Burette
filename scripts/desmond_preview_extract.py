#!/usr/bin/env python3
"""Extract a bounded Mol* PDB preview from a Desmond CMS trajectory pair."""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

from schrodinger.application.desmond.packages import topo, traj

BACKBONE_NAMES = {"N", "CA", "C", "O", "P"}
STANDARD_RESIDUES = {
    "ALA",
    "ARG",
    "ASN",
    "ASP",
    "CYS",
    "GLN",
    "GLU",
    "GLY",
    "HID",
    "HIE",
    "HIP",
    "HIS",
    "ILE",
    "LEU",
    "LYS",
    "MET",
    "PHE",
    "PRO",
    "SER",
    "THR",
    "TRP",
    "TYR",
    "VAL",
}
WATER_RESIDUES = {"HOH", "H2O", "SOL", "TIP", "T3P", "T4P", "WAT"}
LIPID_RESIDUES = {"POPC", "POPE", "POPG", "POPS", "DPPC", "DOPC", "CHL", "CHOL"}
ESTIMATED_PDB_ATOM_BYTES = 96
BoxVectors = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


def candidate_bases(stem: str) -> list[str]:
    bases = [stem]
    for suffix in ("-out", "_out", "-in", "_in"):
        if stem.endswith(suffix):
            bases.append(stem[: -len(suffix)])
    for base in list(bases):
        bases.append(re.sub(r"_replica_(\d+)$", r"_replica\1", base))
        bases.append(re.sub(r"replica_(\d+)$", r"replica\1", base))
    return list(dict.fromkeys(base for base in bases if base))


def find_trj_for_cms(cms_path: Path) -> Path:
    try:
        native = topo.find_traj_path_from_cms_path(str(cms_path))
    except Exception:
        native = None
    if native:
        native_path = Path(native)
        if native_path.is_dir():
            return native_path

    for base in candidate_bases(cms_path.stem):
        candidates = [cms_path.with_name(f"{base}_trj")]
        for candidate in candidates:
            if candidate.is_dir():
                return candidate
    raise FileNotFoundError(f"No Desmond trajectory directory found for {cms_path}")


def find_cms_for_trj(trj_dir: Path) -> Path:
    base = trj_dir.name.removesuffix("_trj")
    candidates = []
    for candidate_base in candidate_bases(base):
        candidates.extend(
            [
                trj_dir.with_name(f"{candidate_base}-out.cms"),
                trj_dir.with_name(f"{candidate_base}.cms"),
            ]
        )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"No paired CMS file found for {trj_dir}")


def resolve_inputs(input_path: Path) -> tuple[Path, Path]:
    if input_path.name == "clickme.dtr" or input_path.suffix.lower() == ".dtr":
        trj_dir = input_path.parent
        return find_cms_for_trj(trj_dir), trj_dir
    return input_path, find_trj_for_cms(input_path)


def candidate_cfg_paths(cms_path: Path) -> list[Path]:
    candidates: list[Path] = []
    for base in candidate_bases(cms_path.stem):
        candidates.extend(
            [
                cms_path.with_name(f"{base}-out.cfg"),
                cms_path.with_name(f"{base}.cfg"),
                cms_path.with_name(f"{base}.cpt.cfg"),
            ]
        )
    return list(dict.fromkeys(candidates))


def desmond_box_from_cfg(cms_path: Path) -> BoxVectors | None:
    for cfg_path in candidate_cfg_paths(cms_path):
        if not cfg_path.is_file():
            continue
        text = cfg_path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"\bbox\s*=\s*\[([^\]]+)\]", text, re.DOTALL)
        if not match:
            continue
        values = [float(value) for value in re.findall(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?", match.group(1))]
        if len(values) != 9:
            continue
        return (
            (values[0], values[1], values[2]),
            (values[3], values[4], values[5]),
            (values[6], values[7], values[8]),
        )
    return None


def frame_indices(frame_count: int, limit: int | None) -> list[int]:
    if frame_count <= 0:
        return []
    if limit is None:
        return list(range(frame_count))
    if frame_count <= limit:
        return list(range(frame_count))
    step = (frame_count - 1) / max(limit - 1, 1)
    return sorted({min(frame_count - 1, int(round(index * step))) for index in range(limit)})


def residue_name(atom) -> str:
    return str(getattr(atom, "pdbres", "")).strip().upper()


def atom_pdb_name(atom) -> str:
    return str(getattr(atom, "pdbname", "")).strip()


def is_hydrogen(atom) -> bool:
    return str(getattr(atom, "element", "")).strip().upper() == "H"


def selected_atom_indices(structure, atom_limit: int | None) -> list[int]:
    atoms = list(structure.atom)
    if atom_limit is None:
        return [atom.index for atom in atoms]
    selected: list[int] = []
    selected_set: set[int] = set()

    def append_indices(indices: list[int], limit: int | None = None) -> bool:
        added = 0
        for index in indices:
            if index in selected_set:
                continue
            if limit is not None and added >= limit:
                return len(selected) >= atom_limit
            if len(selected) >= atom_limit:
                return True
            selected.append(index)
            selected_set.add(index)
            added += 1
        return len(selected) >= atom_limit

    ligand_or_ion_heavy = [
        atom.index
        for atom in atoms
        if residue_name(atom) not in STANDARD_RESIDUES
        and residue_name(atom) not in WATER_RESIDUES
        and residue_name(atom) not in LIPID_RESIDUES
        and not is_hydrogen(atom)
    ]
    backbone = [
        atom.index
        for atom in atoms
        if residue_name(atom) in STANDARD_RESIDUES
        and atom_pdb_name(atom) in BACKBONE_NAMES
        and not is_hydrogen(atom)
    ]

    lipid_heavy = [
        atom.index
        for atom in atoms
        if residue_name(atom) in LIPID_RESIDUES
        and not is_hydrogen(atom)
    ]

    waters_by_residue: dict[tuple[str, int, str], list[int]] = {}
    for atom in atoms:
        if residue_name(atom) not in WATER_RESIDUES:
            continue
        key = (
            str(getattr(atom, "chain", "") or " "),
            int(getattr(atom, "resnum", 0) or 0),
            str(getattr(atom, "inscode", "") or " "),
        )
        waters_by_residue.setdefault(key, []).append(atom.index)

    ligand_quota = max(64, atom_limit // 5)
    backbone_quota = max(128, atom_limit // 2)
    lipid_quota = max(64, atom_limit // 5)
    water_quota = max(0, atom_limit - ligand_quota - backbone_quota - lipid_quota)

    if append_indices(ligand_or_ion_heavy, ligand_quota):
        return selected
    if append_indices(backbone, backbone_quota):
        return selected
    if append_indices(lipid_heavy, lipid_quota):
        return selected
    water_indices = [index for water in waters_by_residue.values() for index in water]
    if append_indices(water_indices, water_quota):
        return selected
    if selected:
        if len(selected) < atom_limit:
            append_indices([atom.index for atom in atoms if not is_hydrogen(atom)])
        return selected

    protein_heavy = [
        atom.index
        for atom in atoms
        if residue_name(atom) in STANDARD_RESIDUES and not is_hydrogen(atom)
    ]
    if protein_heavy:
        return protein_heavy[:atom_limit]

    heavy = [atom.index for atom in atoms if not is_hydrogen(atom)]
    if heavy:
        return heavy[:atom_limit]
    return [atom.index for atom in atoms[:atom_limit]]


def adaptive_atom_limit(frame_count: int, atom_limit: int | None, target_mb: int | None) -> int | None:
    if atom_limit is not None or target_mb is None or target_mb <= 0 or frame_count <= 0:
        return atom_limit
    target_bytes = target_mb * 1024 * 1024
    per_frame = max(1, target_bytes // frame_count)
    return max(250, int(per_frame // ESTIMATED_PDB_ATOM_BYTES))


def vector_length(vector: tuple[float, float, float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def vector_angle(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    denominator = vector_length(first) * vector_length(second)
    if denominator <= 0:
        return 90.0
    cosine = sum(a * b for a, b in zip(first, second)) / denominator
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def pdb_cryst1_line(box: BoxVectors) -> str:
    a, b, c = box
    return (
        f"CRYST1{vector_length(a):9.3f}{vector_length(b):9.3f}{vector_length(c):9.3f}"
        f"{vector_angle(b, c):7.2f}{vector_angle(a, c):7.2f}{vector_angle(a, b):7.2f} P 1           1\n"
    )


def atom_symbol(atom) -> str:
    value = str(getattr(atom, "element", "")).strip()
    return value.capitalize() if value else "C"


def pdb_atom_name(atom) -> str:
    name = str(getattr(atom, "pdbname", "") or getattr(atom, "atom_name", "") or atom_symbol(atom)).strip()
    return name[:4].rjust(4) if len(name) < 4 and len(atom_symbol(atom)) == 1 else name[:4].ljust(4)


def pdb_residue_name(atom) -> str:
    if residue_name(atom) in WATER_RESIDUES:
        return "HOH"
    return (str(getattr(atom, "pdbres", "") or "UNK").strip() or "UNK")[:3].rjust(3)


def pdb_chain(atom) -> str:
    return (str(getattr(atom, "chain", "") or " ")[:1] or " ")


def pdb_residue_number(atom) -> int:
    value = int(getattr(atom, "resnum", 1) or 1)
    return max(-999, min(9999, value))


def pdb_insert_code(atom) -> str:
    return (str(getattr(atom, "inscode", "") or " ")[:1] or " ")


def pdb_record_name(atom) -> str:
    return "ATOM  " if residue_name(atom) in STANDARD_RESIDUES else "HETATM"


def pdb_atom_line(serial: int, atom) -> str:
    element = atom_symbol(atom).rjust(2)
    return (
        f"{pdb_record_name(atom)}{serial:5d} {pdb_atom_name(atom)} "
        f"{pdb_residue_name(atom)} {pdb_chain(atom)}{pdb_residue_number(atom):4d}{pdb_insert_code(atom)}   "
        f"{float(atom.x):8.3f}{float(atom.y):8.3f}{float(atom.z):8.3f}"
        f"{1.0:6.2f}{float(getattr(atom, 'temperature_factor', 0.0) or 0.0):6.2f}"
        f"          {element}  \n"
    )



def frame_time_ps(frame) -> float | None:
    try:
        time = float(getattr(frame, "time"))
    except (TypeError, ValueError):
        return None
    return time if math.isfinite(time) else None


def write_pdb_frame(
    output,
    structure,
    selected_indices: list[int],
    frame_index: int,
    frame_count: int,
    frame_time_ps: float | None,
) -> None:
    atoms_by_index = {atom.index: atom for atom in structure.atom}
    selected = [atoms_by_index[index] for index in selected_indices if index in atoms_by_index]
    output.write(f"MODEL     {frame_index + 1:4d}\n")
    time_text = f" time_ps={frame_time_ps:.6f}" if frame_time_ps is not None else ""
    output.write(f"REMARK   Desmond preview frame {frame_index + 1} / {frame_count}{time_text}\n")
    for serial, atom in enumerate(selected, start=1):
        output.write(pdb_atom_line(serial, atom))
    output.write("ENDMDL\n")


def extract(
    input_path: Path,
    frame_limit: int | None,
    atom_limit: int | None,
    target_mb: int | None,
    output_path: Path | None,
) -> None:
    cms_path, trj_dir = resolve_inputs(input_path)
    _, cms_model = topo.read_cms(str(cms_path))
    trajectory = traj.read_traj(str(trj_dir))
    indices = frame_indices(len(trajectory), frame_limit)
    if not indices:
        raise RuntimeError(f"No frames found in {trj_dir}")

    first_structure = topo.update_ct(cms_model.fsys_ct, cms_model, trajectory[indices[0]]).copy()
    selected_indices = selected_atom_indices(first_structure, adaptive_atom_limit(len(indices), atom_limit, target_mb))
    if not selected_indices:
        raise RuntimeError(f"No atoms selected from {cms_path}")

    box = desmond_box_from_cfg(cms_path)
    output = output_path.open("w", encoding="utf-8") if output_path else sys.stdout
    try:
        if box is not None:
            output.write(pdb_cryst1_line(box))
        for index in indices:
            frame = trajectory[index]
            structure = topo.update_ct(cms_model.fsys_ct, cms_model, frame).copy()
            write_pdb_frame(
                output,
                structure,
                selected_indices,
                index,
                len(trajectory),
                frame_time_ps(frame),
            )
    finally:
        if output_path:
            output.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Desmond .cms file or clickme.dtr pointer")
    parser.add_argument("--output", help="Output multi-frame XYZ path")
    parser.add_argument("--frames", type=int, default=0, help="Maximum frames to include; 0 means all frames")
    parser.add_argument("--atoms", type=int, default=0, help="Maximum atoms to include; 0 means all atoms unless --target-mb is set")
    parser.add_argument("--target-mb", type=int, default=0, help="Approximate output size target for adaptive all-frame atom selection")
    args = parser.parse_args()

    frame_limit = None if args.frames <= 0 else max(1, args.frames)
    atom_limit = None if args.atoms <= 0 else max(1, args.atoms)
    target_mb = None if args.target_mb <= 0 else max(1, args.target_mb)
    extract(Path(args.input).resolve(), frame_limit, atom_limit, target_mb, Path(args.output).resolve() if args.output else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
