"""Regenerate the independent coordinate-block oracles.

Inputs are the reviewed RDKit conformers in `tests/fixtures/zmatrix-reference`.
Open Babel (an external GPL tool, never bundled) writes its own GAMESS,
Turbomole, MOPAC (Cartesian and internal), Gaussian, ORCA, NWChem, Molpro and
GAMESS-UK coordinate files; `tests/test-coordinate-block.test.ts` reads them with
Burette's parser. Open Babel also reads Burette's generated blocks back and
writes plain XYZ, and gemmi fractionalizes one conformer in a triclinic cell.

    uv run --with gemmi python tests/support/regenerate-coordinate-block-oracles.py

Requires `obabel` (Open Babel 3.x) and `bun` on PATH.
"""
import json
import subprocess
from pathlib import Path

import gemmi

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "tests/fixtures/zmatrix-reference"
FIXTURES = ROOT / "tests/fixtures/coordinate-block"
CASES = ["bromochlorofluoromethane", "l-alanine", "s-1-phenylethanol", "water-dimer"]
WRITERS = ["gamin", "tmol", "mopcrt", "mopin", "com", "orcainp", "nw", "mp", "gukin"]
# Burette preset -> (Open Babel reader, minimal input around the generated block).
READERS = {
    "gamess-symbols": ("gamin", lambda block: f" $CONTRL COORD=CART UNITS=ANGS $END\n\n $DATA\nburette\nC1\n{block} $END\n"),
    "turbomole": ("tmol", lambda block: f"$coord\n{block}$end\n"),
    "mopac-cartesian": ("mopcrt", lambda block: f"PUT KEYWORDS HERE\nburette\n\n{block}"),
    "mopac-zmatrix": ("mopin", lambda block: f"PUT KEYWORDS HERE\nburette\n\n{block}"),
    "gaussian-zmatrix": ("gzmat", lambda block: f"#\n\nburette\n\n0 1\n{block}\n"),
    "gamess-uk": ("gukin", lambda block: f"title\nburette\ngeometry angstrom\n{block}end\n"),
    "xyz-symbols": ("xyz", None),
}
# A triclinic cell (Å, degrees) for the fractional-coordinate oracle.
CELL = (9.1, 10.3, 11.7, 81.0, 97.0, 105.0)
EMIT = """
import { generateCoordinateBlock, COORDINATE_PRESETS } from "./apps/desktop/src/lib/molecular-workbench/coordinate-block";
const text = await Bun.stdin.text();
const atoms = text.trim().split("\\n").slice(2).map(line => { const [element, x, y, z] = line.trim().split(/\\s+/); return { element, x: Number(x), y: Number(y), z: Number(z) }; });
const out = {};
for (const id of JSON.parse(process.argv.at(-1))) {
  const preset = COORDINATE_PRESETS.find(item => item.id === id);
  out[id] = generateCoordinateBlock(atoms, { spec: preset.spec, mode: preset.mode, unit: preset.unit ?? "angstrom" });
}
console.log(JSON.stringify(out));
"""


def run(args, stdin=None):
    return subprocess.run(args, input=stdin, capture_output=True, text=True, check=True, cwd=ROOT).stdout


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name in CASES:
        xyz = (SOURCES / f"{name}.xyz").read_text()
        for writer in WRITERS:
            (FIXTURES / f"{name}.openbabel.{writer}").write_text(run(["obabel", "-ixyz", f"-o{writer}"], xyz))
        blocks = json.loads(run(["bun", "-e", EMIT, json.dumps(list(READERS))], xyz))
        for preset, (reader, wrap) in READERS.items():
            block = blocks[preset]
            text = f"{len(block.splitlines())}\nburette\n{block}" if wrap is None else wrap(block)
            (FIXTURES / f"{name}.burette.{preset}.{reader}").write_text(text)
            (FIXTURES / f"{name}.burette.{preset}.openbabel.xyz").write_text(run(["obabel", f"-i{reader}", "-oxyz"], text))
    # gemmi's orthogonalization matrix has the a, b and c vectors as its columns.
    cell = gemmi.UnitCell(*CELL)
    orth = cell.orth.mat.tolist()
    vectors = [[orth[row][column] for row in range(3)] for column in range(3)]
    rows = (SOURCES / "l-alanine.xyz").read_text().strip().splitlines()[2:]
    fractional = []
    for row in rows:
        _, x, y, z = row.split()
        f = cell.fractionalize(gemmi.Position(float(x), float(y), float(z)))
        fractional.append([f.x, f.y, f.z])
    (FIXTURES / "l-alanine.gemmi-fractional.json").write_text(json.dumps({"cell": CELL, "vectors": vectors, "fractional": fractional}, indent=1) + "\n")
    (FIXTURES / "oracle.json").write_text(json.dumps({"openBabel": run(["obabel", "-V"]).strip(), "gemmi": gemmi.__version__, "cases": CASES}, indent=1) + "\n")


if __name__ == "__main__":
    main()
