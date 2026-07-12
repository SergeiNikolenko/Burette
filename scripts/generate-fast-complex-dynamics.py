#!/usr/bin/env python3
"""Generate a compact elastic-network trajectory from a protein complex PDB."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import eigsh


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", type=int, default=80)
    parser.add_argument("--amplitude", type=float, default=1.2)
    return parser.parse_args()


def atom_records(path: Path):
    records = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith(("ATOM  ", "HETATM")) and len(line) >= 54:
            records.append({
                "line": line,
                "name": line[12:16].strip(),
                "residue": (line[21:22], line[22:26], line[26:27]),
                "protein": line.startswith("ATOM  "),
                "coord": np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])]),
            })
    if not records:
        raise ValueError(f"No PDB atoms found in {path}")
    return records


def elastic_modes(nodes: np.ndarray, cutoff: float = 13.0, mode_count: int = 3):
    rows, columns, values = [], [], []
    size = len(nodes) * 3
    for left in range(len(nodes)):
        delta = nodes[left + 1:] - nodes[left]
        distances = np.linalg.norm(delta, axis=1)
        for offset in np.flatnonzero((distances > 1e-6) & (distances <= cutoff)):
            right = left + 1 + int(offset)
            direction = delta[offset] / distances[offset]
            block = -np.outer(direction, direction)
            for a in range(3):
                for b in range(3):
                    value = float(block[a, b])
                    rows.extend((left * 3 + a, right * 3 + a, left * 3 + a, right * 3 + a))
                    columns.extend((right * 3 + b, left * 3 + b, left * 3 + b, right * 3 + b))
                    values.extend((value, value, -value, -value))
    hessian = coo_matrix((values, (rows, columns)), shape=(size, size)).tocsr()
    eigenvalues, eigenvectors = eigsh(hessian, k=min(size - 2, mode_count + 8), sigma=1e-6, which="LM")
    order = np.argsort(eigenvalues)
    usable = [index for index in order if eigenvalues[index] > 1e-5][:mode_count]
    if len(usable) < mode_count:
        raise ValueError("The elastic network did not yield enough non-rigid modes.")
    return eigenvectors[:, usable].reshape(len(nodes), 3, mode_count)


def formatted_atom(line: str, coord: np.ndarray):
    return f"{line[:30]}{coord[0]:8.3f}{coord[1]:8.3f}{coord[2]:8.3f}{line[54:]}"


def main():
    args = parse_args()
    records = atom_records(args.input)
    ca_records = [record for record in records if record["protein"] and record["name"] == "CA"]
    if len(ca_records) < 10:
        raise ValueError("At least ten protein C-alpha atoms are required.")
    nodes = np.asarray([record["coord"] for record in ca_records])
    modes = elastic_modes(nodes)
    residue_to_node = {record["residue"]: index for index, record in enumerate(ca_records)}
    atom_nodes = []
    for record in records:
        node = residue_to_node.get(record["residue"])
        if node is None:
            node = int(np.argmin(np.sum((nodes - record["coord"]) ** 2, axis=1)))
        atom_nodes.append(node)
    atom_nodes = np.asarray(atom_nodes)
    phases = np.array([0.0, 1.7, 3.1])
    weights = np.array([1.0, 0.62, 0.38])
    raw = np.einsum("ncm,m->nc", modes, weights)
    scale = args.amplitude / max(1e-9, np.sqrt(np.mean(np.sum(raw * raw, axis=1))))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for frame in range(max(2, args.frames)):
            angle = 2 * np.pi * frame / max(2, args.frames)
            coefficients = weights * np.sin(angle + phases)
            node_displacements = np.einsum("ncm,m->nc", modes, coefficients) * scale
            handle.write(f"MODEL     {frame + 1:4d}\n")
            for record, node in zip(records, atom_nodes):
                handle.write(formatted_atom(record["line"], record["coord"] + node_displacements[node]) + "\n")
            handle.write("ENDMDL\n")
        handle.write("END\n")
    print(f"Wrote {args.frames} frames with {len(records)} atoms to {args.output}")


if __name__ == "__main__":
    main()
