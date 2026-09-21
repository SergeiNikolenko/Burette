#!/usr/bin/env python3
"""Extract a bounded multi-model PDB preview from an Amber NetCDF trajectory."""

from __future__ import annotations

import argparse
import math
import struct
import sys
from pathlib import Path


NC_DIMENSION = 10
NC_VARIABLE = 11
NC_ATTRIBUTE = 12
NC_BYTE = 1
NC_CHAR = 2
NC_SHORT = 3
NC_INT = 4
NC_FLOAT = 5
NC_DOUBLE = 6

TYPE_INFO = {
    NC_BYTE: (1, ">b"),
    NC_CHAR: (1, "c"),
    NC_SHORT: (2, ">h"),
    NC_INT: (4, ">i"),
    NC_FLOAT: (4, ">f"),
    NC_DOUBLE: (8, ">d"),
}
HEADER_READ_LIMIT = 16 * 1024 * 1024


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def read(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise ValueError("Unexpected end of NetCDF header")
        value = self.data[self.offset:end]
        self.offset = end
        return value

    def u32(self) -> int:
        return struct.unpack(">I", self.read(4))[0]

    def i64(self) -> int:
        return struct.unpack(">q", self.read(8))[0]

    def name(self) -> str:
        size = self.u32()
        raw = self.read(size)
        self.align4(size)
        return raw.decode("utf-8", "replace")

    def align4(self, size: int) -> None:
        padding = (-size) % 4
        if padding:
            self.read(padding)


def read_attrs(reader: Reader) -> None:
    tag = reader.u32()
    if tag == 0:
        reader.u32()
        return
    if tag != NC_ATTRIBUTE:
        raise ValueError(f"Unexpected NetCDF attribute tag: {tag}")
    count = reader.u32()
    for _ in range(count):
        reader.name()
        type_id = reader.u32()
        nelems = reader.u32()
        size, _ = TYPE_INFO[type_id]
        byte_count = size * nelems
        reader.read(byte_count)
        reader.align4(byte_count)


def parse_header(data: bytes) -> tuple[dict[str, int | None], list[dict[str, object]], int]:
    reader = Reader(data)
    magic = reader.read(4)
    if magic not in (b"CDF\x01", b"CDF\x02"):
        raise ValueError("Only classic NetCDF/CDF-2 Amber trajectories are supported")
    is_cdf2 = magic == b"CDF\x02"
    record_count = reader.u32()

    dim_tag = reader.u32()
    dimensions: dict[str, int | None] = {}
    dim_names: list[str] = []
    if dim_tag == NC_DIMENSION:
        dim_count = reader.u32()
        for _ in range(dim_count):
            name = reader.name()
            length = reader.u32()
            dimensions[name] = None if length == 0 else length
            dim_names.append(name)
    elif dim_tag != 0:
        raise ValueError(f"Unexpected NetCDF dimension tag: {dim_tag}")
    else:
        reader.u32()

    read_attrs(reader)

    variables: list[dict[str, object]] = []
    var_tag = reader.u32()
    if var_tag == NC_VARIABLE:
        var_count = reader.u32()
        for _ in range(var_count):
            name = reader.name()
            dim_ids = [reader.u32() for _ in range(reader.u32())]
            read_attrs(reader)
            type_id = reader.u32()
            size = reader.u32()
            begin = reader.i64() if is_cdf2 else reader.u32()
            variables.append(
                {
                    "name": name,
                    "dim_names": [dim_names[index] for index in dim_ids],
                    "type_id": type_id,
                    "size": size,
                    "begin": begin,
                }
            )
    elif var_tag != 0:
        raise ValueError(f"Unexpected NetCDF variable tag: {var_tag}")

    return dimensions, variables, record_count


def read_header(path: Path) -> tuple[dict[str, int | None], list[dict[str, object]], int]:
    file_size = path.stat().st_size
    read_size = min(64 * 1024, file_size)
    while read_size <= min(file_size, HEADER_READ_LIMIT):
        with path.open("rb") as handle:
            data = handle.read(read_size)
        try:
            return parse_header(data)
        except ValueError as error:
            if "Unexpected end of NetCDF header" not in str(error) or read_size == file_size:
                raise
        read_size = min(read_size * 2, file_size)
    raise ValueError(f"NetCDF header exceeds {HEADER_READ_LIMIT} bytes")


def record_size(variables: list[dict[str, object]], dimensions: dict[str, int | None]) -> int:
    size = 0
    for variable in variables:
        dim_names = list(variable["dim_names"])
        if dim_names and dimensions[dim_names[0]] is None:
            item_size, _ = TYPE_INFO[int(variable["type_id"])]
            values = math.prod(int(dimensions[name]) for name in dim_names[1:])
            byte_count = item_size * values
            size += byte_count + (-byte_count) % 4
    return size


def coordinate_frame(
    path: Path,
    variable: dict[str, object],
    dimensions: dict[str, int | None],
    variables: list[dict[str, object]],
    frame_index: int,
) -> list[tuple[float, float, float]]:
    type_id = int(variable["type_id"])
    item_size, fmt = TYPE_INFO[type_id]
    dim_names = list(variable["dim_names"])
    if not dim_names or dimensions[dim_names[0]] is not None:
        raise ValueError("coordinates must be a NetCDF record variable")
    tail_shape = [int(dimensions[name]) for name in dim_names[1:]]
    if len(tail_shape) != 2 or tail_shape[1] != 3:
        raise ValueError(f"Unsupported coordinates shape: record,{','.join(map(str, tail_shape))}")
    atom_count = tail_shape[0]
    values_per_record = atom_count * 3
    byte_count = values_per_record * item_size
    stride = record_size(variables, dimensions)
    if stride <= 0:
        raise ValueError("NetCDF record size is zero")
    with path.open("rb") as handle:
        handle.seek(int(variable["begin"]) + frame_index * stride)
        raw = handle.read(byte_count)
    if len(raw) != byte_count:
        raise ValueError(f"Could not read coordinates for frame {frame_index}")
    values = [item[0] for item in struct.iter_unpack(fmt, raw)]
    return [
        (values[index], values[index + 1], values[index + 2])
        for index in range(0, len(values), 3)
    ]


def pdb_atom_lines(path: Path) -> list[str]:
    lines = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith(("ATOM  ", "HETATM")):
            lines.append(line)
    if not lines:
        raise ValueError(f"{path} does not contain ATOM/HETATM records")
    return lines


def replace_coords(line: str, xyz: tuple[float, float, float]) -> str:
    padded = line.ljust(80)
    return f"{padded[:30]}{xyz[0]:8.3f}{xyz[1]:8.3f}{xyz[2]:8.3f}{padded[54:]}"


def frame_indices(frame_count: int, frame_limit: int) -> list[int]:
    if frame_count <= frame_limit:
        return list(range(frame_count))
    if frame_limit <= 1:
        return [0]
    return sorted(
        set(round(index * (frame_count - 1) / (frame_limit - 1)) for index in range(frame_limit))
    )


def convert(topology: Path, trajectory: Path, output: Path, frame_limit: int) -> int:
    dimensions, variables, record_count = read_header(trajectory)
    coord_var = next((var for var in variables if var["name"] == "coordinates"), None)
    if coord_var is None:
        raise ValueError("NetCDF trajectory does not contain a coordinates variable")
    atoms = pdb_atom_lines(topology)
    atom_dim = int(dimensions[list(coord_var["dim_names"])[1]])
    if atom_dim != len(atoms):
        raise ValueError(f"Atom count mismatch: topology has {len(atoms)} atoms, trajectory has {atom_dim}")
    indices = frame_indices(record_count, frame_limit)
    with output.open("w", encoding="ascii") as handle:
        for model_index, frame_index in enumerate(indices, start=1):
            handle.write(f"MODEL{model_index:9d}\n")
            frame = coordinate_frame(trajectory, coord_var, dimensions, variables, frame_index)
            for atom_line, xyz in zip(atoms, frame, strict=True):
                handle.write(replace_coords(atom_line, xyz))
                handle.write("\n")
            handle.write("ENDMDL\n")
        handle.write("END\n")
    return len(indices)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("topology", type=Path)
    parser.add_argument("trajectory", type=Path)
    parser.add_argument("--frames", type=int, default=100)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    frame_count = convert(args.topology, args.trajectory, args.output, max(1, args.frames))
    print(f"frames={frame_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
