#!/usr/bin/env python3
"""Extract a bounded Mol* PDB preview from a Desmond CMS trajectory pair."""

from __future__ import annotations

import argparse
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


def candidate_bases(stem: str) -> list[str]:
    bases = [stem]
    if stem.endswith("-out"):
        bases.append(stem[:-4])
    if stem.endswith("_out"):
        bases.append(stem[:-4])
    return list(dict.fromkeys(base for base in bases if base))


def source_files_root(path: Path) -> tuple[Path, list[str]] | None:
    parts = list(path.parts)
    if "source_files" not in parts:
        return None
    index = parts.index("source_files")
    return Path(*parts[: index + 1]), parts[index + 1 :]


def casebook_trj_candidates(cms_path: Path, base: str) -> list[Path]:
    resolved = source_files_root(cms_path)
    if not resolved:
        return []
    root, rest = resolved
    if not rest or not rest[0].startswith("mnt__"):
        return []
    mapped = rest[0].split("__")
    return [root.joinpath(*mapped, *rest[1:-1], f"{base}_trj")]


def casebook_cms_candidates(trj_dir: Path, base: str) -> list[Path]:
    resolved = source_files_root(trj_dir)
    if not resolved:
        return []
    root, rest = resolved
    if len(rest) < 5 or rest[:3] != ["mnt", "ligandpro", "crim3s"]:
        return []
    mapped_dir = root / "__".join(rest[:4])
    return [mapped_dir / f"{base}-out.cms", mapped_dir / f"{base}.cms"]


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
        candidates = [cms_path.with_name(f"{base}_trj"), *casebook_trj_candidates(cms_path, base)]
        for candidate in candidates:
            if candidate.is_dir():
                return candidate
    raise FileNotFoundError(f"No Desmond trajectory directory found for {cms_path}")


def find_cms_for_trj(trj_dir: Path) -> Path:
    base = trj_dir.name.removesuffix("_trj")
    candidates = [
        trj_dir.with_name(f"{base}-out.cms"),
        trj_dir.with_name(f"{base}.cms"),
        *casebook_cms_candidates(trj_dir, base),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"No paired CMS file found for {trj_dir}")


def resolve_inputs(input_path: Path) -> tuple[Path, Path]:
    if input_path.name == "clickme.dtr" or input_path.suffix.lower() == ".dtr":
        trj_dir = input_path.parent
        return find_cms_for_trj(trj_dir), trj_dir
    return input_path, find_trj_for_cms(input_path)


def frame_indices(frame_count: int, limit: int) -> list[int]:
    if frame_count <= 0:
        return []
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


def selected_atom_indices(structure, atom_limit: int) -> list[int]:
    atoms = list(structure.atom)
    selected: list[int] = []
    selected_set: set[int] = set()

    def append_indices(indices: list[int]) -> bool:
        for index in indices:
            if index in selected_set:
                continue
            if len(selected) >= atom_limit:
                return True
            selected.append(index)
            selected_set.add(index)
        return len(selected) >= atom_limit

    backbone = [
        atom.index
        for atom in atoms
        if residue_name(atom) in STANDARD_RESIDUES
        and atom_pdb_name(atom) in BACKBONE_NAMES
        and not is_hydrogen(atom)
    ]
    if append_indices(backbone):
        return selected

    ligand_or_ion_heavy = [
        atom.index
        for atom in atoms
        if residue_name(atom) not in STANDARD_RESIDUES
        and residue_name(atom) not in WATER_RESIDUES
        and residue_name(atom) not in LIPID_RESIDUES
        and not is_hydrogen(atom)
    ]
    if append_indices(ligand_or_ion_heavy):
        return selected

    lipid_heavy = [
        atom.index
        for atom in atoms
        if residue_name(atom) in LIPID_RESIDUES
        and not is_hydrogen(atom)
    ]
    if append_indices(lipid_heavy):
        return selected

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
    for water in waters_by_residue.values():
        if append_indices(water):
            break
    if selected:
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


def write_pdb_frame(output, structure, selected_indices: list[int], frame_index: int, frame_count: int) -> None:
    atoms_by_index = {atom.index: atom for atom in structure.atom}
    selected = [atoms_by_index[index] for index in selected_indices if index in atoms_by_index]
    output.write(f"MODEL     {frame_index + 1:4d}\n")
    output.write(f"REMARK   Desmond preview frame {frame_index + 1} / {frame_count}\n")
    for serial, atom in enumerate(selected, start=1):
        output.write(pdb_atom_line(serial, atom))
    output.write("ENDMDL\n")


def extract(input_path: Path, frame_limit: int, atom_limit: int, output_path: Path | None) -> None:
    cms_path, trj_dir = resolve_inputs(input_path)
    _, cms_model = topo.read_cms(str(cms_path))
    trajectory = traj.read_traj(str(trj_dir))
    indices = frame_indices(len(trajectory), frame_limit)
    if not indices:
        raise RuntimeError(f"No frames found in {trj_dir}")

    first_structure = topo.update_ct(cms_model.fsys_ct, cms_model, trajectory[indices[0]]).copy()
    selected_indices = selected_atom_indices(first_structure, atom_limit)
    if not selected_indices:
        raise RuntimeError(f"No atoms selected from {cms_path}")

    output = output_path.open("w", encoding="utf-8") if output_path else sys.stdout
    try:
        for index in indices:
            structure = topo.update_ct(cms_model.fsys_ct, cms_model, trajectory[index]).copy()
            write_pdb_frame(output, structure, selected_indices, index, len(trajectory))
    finally:
        if output_path:
            output.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Desmond .cms file or clickme.dtr pointer")
    parser.add_argument("--output", help="Output multi-frame XYZ path")
    parser.add_argument("--frames", type=int, default=60)
    parser.add_argument("--atoms", type=int, default=3000)
    args = parser.parse_args()

    frame_limit = max(1, min(args.frames, 300))
    atom_limit = max(1, min(args.atoms, 10000))
    extract(Path(args.input).resolve(), frame_limit, atom_limit, Path(args.output).resolve() if args.output else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
