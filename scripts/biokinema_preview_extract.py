#!/usr/bin/env python3
"""Convert a BioKinema coordinate bundle into a Mol* multi-model mmCIF."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError as error:  # pragma: no cover - exercised in environments without numpy
    raise SystemExit("numpy is required to read BioKinema .npy coordinate arrays") from error


ATOM_SITE_LOOP_PREFIX = "_atom_site."
COORDINATE_COLUMNS = {
    "_atom_site.Cartn_x": 0,
    "_atom_site.Cartn_y": 1,
    "_atom_site.Cartn_z": 2,
}


def find_single(path: Path, pattern: str) -> Path:
    matches = sorted(path.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching {pattern} under {path}")
    if len(matches) > 1:
        names = ", ".join(str(match) for match in matches[:4])
        raise ValueError(f"Expected one file matching {pattern}, found {len(matches)}: {names}")
    return matches[0]


def find_template_cif(bundle: Path, template: Path | None) -> Path:
    if template is not None:
        return template
    prediction_dirs = sorted(path for path in bundle.glob("*/predictions") if path.is_dir())
    for predictions in prediction_dirs:
        candidates = sorted(predictions.glob("*.cif"))
        if candidates:
            return candidates[0]
    candidates = sorted(bundle.glob("**/predictions/*.cif"))
    if candidates:
        return candidates[0]
    return find_single(bundle, "*.cif")


def find_coordinates(bundle: Path, coordinates: Path | None) -> Path:
    if coordinates is not None:
        return coordinates
    return find_single(bundle, "**/*_pred_coordinates.npy")


def read_coordinates(path: Path) -> np.ndarray:
    coordinates = np.load(path)
    if coordinates.ndim == 4 and coordinates.shape[1] == 1:
        coordinates = coordinates[:, 0, :, :]
    if coordinates.ndim != 3 or coordinates.shape[2] != 3:
        raise ValueError(f"Unsupported pred_coordinates shape: {coordinates.shape}")
    return coordinates.astype(float, copy=False)


def is_atom_site_loop(columns: list[str]) -> bool:
    return bool(columns) and all(column.startswith(ATOM_SITE_LOOP_PREFIX) for column in columns)


def parse_atom_site_template(path: Path) -> tuple[list[str], list[str], list[list[str]]]:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue
        loop_start = index
        index += 1
        columns: list[str] = []
        while index < len(lines) and lines[index].strip().startswith("_"):
            columns.append(lines[index].strip())
            index += 1
        if not is_atom_site_loop(columns):
            continue
        rows: list[list[str]] = []
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped:
                index += 1
                continue
            if stripped == "#" or stripped == "loop_" or stripped.startswith("_") or stripped.startswith("data_"):
                break
            values = stripped.split()
            if len(values) != len(columns):
                raise ValueError(f"Unsupported atom_site row in {path}: {stripped}")
            rows.append(values)
            index += 1
        if not rows:
            raise ValueError(f"{path} has an atom_site loop without atom rows")
        return lines[:loop_start], columns, rows
    raise ValueError(f"{path} does not contain an atom_site loop")


def require_column(columns: list[str], column: str) -> int:
    try:
        return columns.index(column)
    except ValueError as error:
        raise ValueError(f"Template CIF is missing {column}") from error


def frame_indices(frame_count: int, frame_limit: int | None) -> list[int]:
    if frame_count <= 0:
        return []
    if frame_limit is None or frame_count <= frame_limit:
        return list(range(frame_count))
    if frame_limit <= 1:
        return [0]
    return sorted(
        set(round(index * (frame_count - 1) / (frame_limit - 1)) for index in range(frame_limit))
    )


def convert(
    bundle: Path,
    output: Path,
    template: Path | None = None,
    coordinates_path: Path | None = None,
    frame_limit: int | None = None,
) -> int:
    template_path = find_template_cif(bundle, template)
    coordinate_path = find_coordinates(bundle, coordinates_path)
    coordinates = read_coordinates(coordinate_path)
    prefix, columns, template_rows = parse_atom_site_template(template_path)
    if coordinates.shape[1] != len(template_rows):
        raise ValueError(
            f"Atom count mismatch: template has {len(template_rows)} atoms, "
            f"coordinates have {coordinates.shape[1]}"
        )

    coordinate_column_indices = {
        axis: require_column(columns, column)
        for column, axis in COORDINATE_COLUMNS.items()
    }
    model_column = require_column(columns, "_atom_site.pdbx_PDB_model_num")
    id_column = columns.index("_atom_site.id") if "_atom_site.id" in columns else None
    selected_frames = frame_indices(coordinates.shape[0], frame_limit)

    with output.open("w", encoding="ascii") as handle:
        for line in prefix:
            handle.write(line)
            handle.write("\n")
        handle.write("loop_\n")
        for column in columns:
            handle.write(column)
            handle.write("\n")
        for output_model, frame_index in enumerate(selected_frames, start=1):
            frame = coordinates[frame_index]
            for atom_index, template_row in enumerate(template_rows, start=1):
                row = list(template_row)
                xyz = frame[atom_index - 1]
                for axis, column_index in coordinate_column_indices.items():
                    row[column_index] = f"{xyz[axis]:.3f}"
                row[model_column] = str(output_model)
                if id_column is not None:
                    row[id_column] = str((output_model - 1) * len(template_rows) + atom_index)
                handle.write(" ".join(row))
                handle.write("\n")
        handle.write("#\n")
    return len(selected_frames)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path, help="BioKinema run directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--template", type=Path)
    parser.add_argument("--coordinates", type=Path)
    parser.add_argument("--frames", type=int)
    args = parser.parse_args(argv)
    frames = convert(args.bundle, args.output, args.template, args.coordinates, args.frames)
    print(f"frames={frames}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
