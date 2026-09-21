#!/usr/bin/env python3
"""Compile the pinned mlxmolkit D3 NPZ tables into a native little-endian blob."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import struct
from pathlib import Path

import numpy as np

C6_SHA256 = "4cf0968d78ed05c68adbd5ae6166a2d983d6c7180f61633c0fd3120e504bd746"
R0_SHA256 = "ead44d7cd5bf4a179aa2a6dd2f1e4f495160b066156a76e25cbef1026e7d3cd9"
MAGIC = b"BD3V1\0\0\0"
ELEMENTS = 94
RCOV = [
    0.32, 0.46, 1.20, 0.94, 0.77, 0.75, 0.71, 0.63, 0.64, 0.67,
    1.40, 1.25, 1.13, 1.04, 1.10, 1.02, 0.99, 0.96, 1.76, 1.54,
    1.33, 1.22, 1.21, 1.10, 1.07, 1.04, 1.00, 0.99, 1.01, 1.09,
    1.12, 1.09, 1.15, 1.10, 1.14, 1.17, 1.89, 1.67, 1.47, 1.39,
    1.32, 1.24, 1.15, 1.13, 1.13, 1.08, 1.15, 1.23, 1.28, 1.26,
    1.26, 1.23, 1.32, 1.31, 2.09, 1.76, 1.62, 1.47, 1.58, 1.57,
    1.56, 1.55, 1.51, 1.52, 1.51, 1.50, 1.49, 1.49, 1.48, 1.53,
    1.46, 1.37, 1.31, 1.23, 1.18, 1.16, 1.11, 1.12, 1.13, 1.32,
    1.30, 1.30, 1.36, 1.31, 1.38, 1.42, 2.01, 1.81, 1.67, 1.58,
    1.52, 1.53, 1.54, 1.55,
]


def checked(path: Path, expected: str) -> None:
    observed = hashlib.sha256(path.read_bytes()).hexdigest()
    if observed != expected:
        raise SystemExit(f"{path}: SHA-256 {observed} != pinned {expected}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("c6_npz", type=Path)
    parser.add_argument("r0_npz", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--archive-dir", type=Path)
    args = parser.parse_args()
    checked(args.c6_npz, C6_SHA256)
    checked(args.r0_npz, R0_SHA256)
    c6_data = np.load(args.c6_npz)
    c6 = c6_data["c6ab"].astype("<f8", copy=False)
    mxc = c6_data["mxc"].astype(np.int64, copy=False)
    r0 = np.load(args.r0_npz)["r0ab"].astype("<f8", copy=False)
    if c6.shape != (ELEMENTS, ELEMENTS, 5, 5, 3) or mxc.shape != (ELEMENTS,):
        raise SystemExit("unexpected c6ab/mxc shape")
    if r0.shape != (ELEMENTS, ELEMENTS) or len(RCOV) != ELEMENTS:
        raise SystemExit("unexpected r0ab/RCOV shape")

    offsets = [0]
    references: list[tuple[float, float, float]] = []
    for left in range(ELEMENTS):
        for right in range(ELEMENTS):
            for i in range(int(mxc[left])):
                for j in range(int(mxc[right])):
                    value = c6[left, right, i, j]
                    if value[0] > 0.0:
                        references.append((float(value[0]), float(value[1]), float(value[2])))
            offsets.append(len(references))

    payload = bytearray(MAGIC)
    payload.extend(struct.pack("<IIII", ELEMENTS, ELEMENTS * ELEMENTS, len(references), len(offsets)))
    payload.extend(struct.pack(f"<{ELEMENTS}d", *RCOV))
    payload.extend(r0.tobytes(order="C"))
    payload.extend(struct.pack(f"<{len(offsets)}I", *offsets))
    for reference in references:
        payload.extend(struct.pack("<ddd", *reference))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)

    if args.archive_dir is not None:
        args.archive_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.c6_npz, args.archive_dir / "c6ab_d3.npz")
        shutil.copyfile(args.r0_npz, args.archive_dir / "r0ab_d3.npz")
    print(f"wrote {len(payload)} bytes with {len(references)} references")


if __name__ == "__main__":
    main()
