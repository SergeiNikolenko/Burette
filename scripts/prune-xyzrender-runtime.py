#!/usr/bin/env python3
"""Prune a staged runtime using installed dependency metadata; never a source env."""
import argparse
from importlib.metadata import distributions
from pathlib import Path
import os
import shutil

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def prune(runtime, python_root):
    sites = list((runtime / "lib").glob("python*/site-packages"))
    if len(sites) != 1:
        raise ValueError("Expected exactly one staged xyzrender site-packages directory")
    site = sites[0].resolve()
    installed = {canonicalize_name(d.metadata["Name"]): d for d in distributions(path=[str(site)])}
    pending = [Requirement("xyzrender"), Requirement("rdkit")]
    # Keep optional file-format support already installed by the packager.
    for raw in installed["xyzrender"].requires or []:
        req = Requirement(raw)
        if req.marker and req.marker.evaluate({"extra": "all"}) and canonicalize_name(req.name) in installed:
            pending.append(req)
    kept, visited = set(), set()
    while pending:
        req = pending.pop()
        name = canonicalize_name(req.name)
        key = (name, tuple(sorted(req.extras)))
        if key in visited:
            continue
        visited.add(key)
        if name not in installed:
            raise ValueError(f"Missing required runtime distribution: {name}")
        dist = installed[name]
        if req.specifier and not req.specifier.contains(dist.version, prereleases=True):
            raise ValueError(f"Runtime version mismatch: {req}, installed {dist.version}")
        kept.add(name)
        for raw in dist.requires or []:
            child = Requirement(raw)
            # xyzrender's CLI does not use its declared notebook kernel.
            if name == "xyzrender" and canonicalize_name(child.name) == "ipykernel":
                continue
            if not child.marker or any(child.marker.evaluate({"extra": extra}) for extra in ("", *req.extras)):
                pending.append(child)

    if "datamol" in kept:
        raise ValueError("Datamol is still required by the selected runtime dependency graph")

    def files(dist):
        if dist.files is None:
            raise ValueError(f"Cannot prune distribution without RECORD: {dist.metadata['Name']}")
        result = set()
        for entry in dist.files:
            path = Path(os.path.abspath(dist.locate_file(entry)))
            # RECORD also lists entrypoints outside site-packages. Those are
            # removed separately; never follow paths outside this staged tree.
            if path.resolve().is_relative_to(site):
                result.add(path)
        return result

    protected = set().union(*(files(installed[name]) for name in kept))
    removed = sorted(set(installed) - kept)
    # Resolve and validate every RECORD before any mutation.
    obsolete = set().union(*(files(installed[name]) for name in removed)) - protected
    for path in obsolete:
        if path.is_file() or path.is_symlink():
            path.unlink()
    # Keep package resources and test/data directories: some are used at runtime.
    # Only cache files and the interpreter's own development tools are removed.
    for root in (runtime, python_root):
        for cache in root.rglob("__pycache__"):
            if cache.is_dir() and not cache.is_symlink():
                shutil.rmtree(cache)
        for pattern in ("*.pyc", "*.pyo"):
            for path in root.rglob(pattern):
                path.unlink()
    for path in sorted(site.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
            path.rmdir()
    # Both uv standalone Python and framework Python layouts are supported.
    for stdlib in python_root.glob("**/lib/python*"):
        if not stdlib.is_dir() or stdlib.is_symlink():
            continue
        for name in ("test", "idlelib", "ensurepip"):
            shutil.rmtree(stdlib / name, ignore_errors=True)
        # The bundled interpreter is immutable at runtime. Keep import support,
        # but omit its package installer and metadata.
        bundled_site = stdlib / "site-packages"
        shutil.rmtree(bundled_site / "pip", ignore_errors=True)
        for metadata in bundled_site.glob("pip-*.dist-info"):
            shutil.rmtree(metadata, ignore_errors=True)

    # Keep RDKit Contrib: it includes descriptor models, not only examples.
    print("Pruned runtime distributions: " + ", ".join(removed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime", type=Path)
    parser.add_argument("python_root", type=Path)
    args = parser.parse_args()
    prune(args.runtime, args.python_root)
