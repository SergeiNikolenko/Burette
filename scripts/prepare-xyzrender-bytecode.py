#!/usr/bin/env python3
"""Precompile the staged renderer's startup imports before signing the app."""
import json
from pathlib import Path
import py_compile
import sys


def compile_imported_modules(resources, modules):
    resources = resources.resolve()
    roots = [resources / name for name in ("xyzrender-runtime", "xyzrender-python")]
    sources = {
        Path(module.__file__).resolve()
        for module in modules
        if str(getattr(module, "__file__", "")).endswith(".py")
    }
    sources = sorted(path for path in sources if path.is_file()
                     and any(path.is_relative_to(root) for root in roots))
    if not 0 < len(sources) < 3000:
        raise ValueError(f"Unexpected renderer startup module count: {len(sources)}")
    outputs = [py_compile.compile(
        str(path), dfile="burette-runtime/" + str(path.relative_to(resources)),
        doraise=True, invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
    ) for path in sources]
    return {"modules": len(outputs), "bytes": sum(Path(path).stat().st_size for path in outputs)}


def main():
    resources = Path(sys.argv[1]).resolve()
    if not Path(sys.executable).resolve().is_relative_to(resources / "xyzrender-python"):
        raise ValueError("Run with the staged app's bundled Python interpreter")
    sites = list((resources / "xyzrender-runtime/lib").glob("python*/site-packages"))
    if len(sites) != 1:
        raise ValueError("Expected one staged renderer site-packages directory")
    sys.path.insert(0, str(sites[0]))
    from xyzrender import load, render
    from rdkit.Chem import rdDistGeom, rdForceFieldHelpers  # noqa: F401

    # Exercise the public renderer entry point, including its lazy imports. Only
    # imported modules are cached, not the entire scientific distribution.
    render(load("C", smiles=True), config="default")
    print(json.dumps(compile_imported_modules(resources, tuple(sys.modules.values()))))


if __name__ == "__main__":
    main()
