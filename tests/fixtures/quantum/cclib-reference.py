"""Independent reference values for Burette's quantum output readers.

Runs cclib (BSD-3-Clause, https://github.com/cclib/cclib) on each output file given on
the command line and writes `<directory>/cclib-reference.json`. cclib is a separate
implementation of the same program-output conventions; Burette's tests compare their own
parse of the same bytes with these values. Usage (cclib 1.8.1):

    python cclib-reference.py tests/fixtures/quantum/nwchem/*.out
"""
import hashlib
import json
import sys
from pathlib import Path

import cclib
import numpy as np
import packaging.version
from cclib.parser import psi4parser
from cclib.parser.utils import convertor

# conda-forge Psi4 1.11 prints the version "1!1.11.dev+-zzzzzzz", which cclib's version
# parser rejects before reading anything. Only the metadata version is affected.
_parse_version = psi4parser.parse_version
psi4parser.parse_version = lambda text: _parse_version(text.split("+")[0].split("!")[-1] if "+" in text else text)
assert packaging.version.parse("1.11")


def hartree(values):
    return [convertor(float(v), "eV", "hartree") for v in np.ravel(values)]


def as_list(value):
    return np.asarray(value).tolist()


def reference(path: Path):
    data = cclib.io.ccread(str(path))
    if data is None:
        return {"error": "cclib could not read this file"}
    out = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "cclib": cclib.__version__}
    attrs = data.getattributes()
    if "atomnos" in attrs:
        out["atomnos"] = as_list(data.atomnos)
    if "atomcoords" in attrs:
        out["atomcoords"] = as_list(data.atomcoords)
    for key in ("scfenergies",):
        if key in attrs:
            out[key] = hartree(data.scfenergies)
    if "mpenergies" in attrs:
        out["mpenergies"] = [hartree(row) for row in data.mpenergies]
    if "ccenergies" in attrs:
        out["ccenergies"] = hartree(data.ccenergies)
    for key in ("optdone", "optstatus", "vibfreqs", "vibirs", "vibramans", "vibdisps", "vibsyms", "homos", "mult", "charge", "nmo", "nbasis", "mosyms"):
        if key in attrs:
            value = attrs[key]
            out[key] = value if isinstance(value, (bool, int, float, str)) else as_list(value)
    if "moenergies" in attrs:
        out["moenergies"] = [hartree(row) for row in data.moenergies]
    if "atomcharges" in attrs:
        out["atomcharges"] = {k: as_list(v) for k, v in data.atomcharges.items()}
    if "moments" in attrs:
        out["dipole_debye"] = as_list(data.moments[1]) if len(data.moments) > 1 else None
    if "hessian" in attrs:
        out["hessian"] = as_list(data.hessian)
    if "metadata" in attrs:
        out["metadata"] = {k: v for k, v in data.metadata.items() if k in ("package", "package_version", "success", "methods")}
    return out


def finite(value):
    """JSON has no NaN: cclib marks unprinted values (for example orbitals outside a printed window) with NaN."""
    if isinstance(value, float) and not np.isfinite(value):
        return None
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    return value


def main(files):
    groups = {}
    for name in files:
        path = Path(name)
        try:
            groups.setdefault(path.parent, {})[path.name] = reference(path)
        except Exception as error:  # cclib does not read every program version; record why
            groups.setdefault(path.parent, {})[path.name] = {"error": f"{type(error).__name__}: {error}"}
    for directory, values in groups.items():
        target = directory / "cclib-reference.json"
        target.write_text(json.dumps(finite(values), indent=1, sort_keys=True, allow_nan=False) + "\n")
        print(target)


if __name__ == "__main__":
    main(sys.argv[1:])
