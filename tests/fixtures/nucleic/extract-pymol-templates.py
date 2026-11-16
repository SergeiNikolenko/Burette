"""Regenerates the heavy-atom tables in
apps/desktop/src/lib/molecular-workbench/nucleic-templates.ts from Open-Source PyMOL.

Source: the `fnab` fragments shipped with Open-Source PyMOL 3.1.0
(pymol/pymol_path/data/chempy/fragments/{atp,ctp,gtp,ttp}{A,B}.pkl and utpA.pkl),
which PyMOL credits to the 3DNA fiber models (Lu & Olson, NAR 32, W667, 2004).
Run with PyMOL's interpreter:  <pymol-prefix>/bin/python extract-pymol-templates.py

Only renames are applied: O1P/O2P -> OP1/OP2 and C5M -> C7 (wwPDB CCD names).
The backbone is identical in every base's fragment of a form, so it is written once;
uridine (A form only) is the thymine ring without C7, and its O2' is the only atom
taken from utpA.pkl, whose backbone matches atpA.pkl to 0.0015 A.
"""
import os
import pickle

import pymol

FRAGMENTS = next(p for p in (os.path.join(os.path.dirname(pymol.__file__), *x, "data", "chempy", "fragments") for x in (("pymol_path",), ())) if os.path.isdir(p))
BACKBONE = ["P", "OP1", "OP2", "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "C1'"]
BASES = {
    "A": ["N9", "C8", "N7", "C5", "C6", "N6", "N1", "C2", "N3", "C4"],
    "C": ["N1", "C2", "O2", "N3", "C4", "N4", "C5", "C6"],
    "G": ["N9", "C8", "N7", "C5", "C6", "O6", "N1", "C2", "N2", "N3", "C4"],
    "T": ["N1", "C2", "O2", "N3", "C4", "O4", "C5", "C7", "C6"],
}
RENAME = {"O1P": "OP1", "O2P": "OP2", "C5M": "C7"}


def load(name):
    with open(os.path.join(FRAGMENTS, f"{name}.pkl"), "rb") as handle:
        model = pickle.load(handle)
    return {RENAME.get(atom.name, atom.name): atom.coord for atom in model.atom}


def row(name, coord):
    return f'["{name}", {", ".join(format(round(value, 3), "g") for value in coord)}]'


for form in "BA":
    fragments = {base: load(f"{base.lower()}tp{form}") for base in BASES}
    print(f"// {form} form")
    print("backbone:", "[" + ", ".join(row(name, fragments["A"][name]) for name in BACKBONE) + "],")
    if form == "A":
        print("o2:", row("O2'", load("utpA")["O2'"]) + ",")
    for base, names in BASES.items():
        print(f"{base}:", "[" + ", ".join(row(name, fragments[base][name]) for name in names) + "],")
