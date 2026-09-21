#!/usr/bin/env python3
"""Check changed git blobs against a maximum size policy."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def read_allowlist(path: Path) -> set[str]:
    if not path.exists():
        return set()
    entries: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#"):
            entries.add(line)
    return entries


def changed_paths(base: str, head: str) -> list[str]:
    output = git_bytes(
        "diff",
        "--name-only",
        "--diff-filter=AMR",
        "-z",
        base,
        head,
    )
    return [item.decode("utf-8") for item in output.split(b"\0") if item]


def blob_size(revision: str, path: str) -> int | None:
    try:
        return int(git_text("cat-file", "-s", f"{revision}:{path}"))
    except subprocess.CalledProcessError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Base git revision.")
    parser.add_argument("--head", required=True, help="Head git revision.")
    parser.add_argument("--max-bytes", type=int, required=True)
    parser.add_argument("--allowlist", type=Path, required=True)
    args = parser.parse_args()

    allowlist = read_allowlist(args.allowlist)
    violations: list[tuple[str, int]] = []

    for path in changed_paths(args.base, args.head):
        size = blob_size(args.head, path)
        if size is None or size <= args.max_bytes or path in allowlist:
            continue
        violations.append((path, size))

    if not violations:
        print("Blob size policy passed.")
        return 0

    print(
        f"Changed blobs exceed {args.max_bytes} bytes and are not allow-listed:",
        file=sys.stderr,
    )
    for path, size in sorted(violations, key=lambda item: item[1], reverse=True):
        print(f"- {path}: {size} bytes", file=sys.stderr)
    print(
        "Move generated/build output out of git, minimize the fixture, or add an "
        "intentional exact-path entry to .github/blob-size-allowlist.txt.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
