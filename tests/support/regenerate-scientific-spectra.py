"""Regenerate all six positive-range golden grids using the pinned C++ oracle."""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("oracle", type=Path)
args = parser.parse_args()
fixture = Path(__file__).resolve().parents[1] / "fixtures/quantum/scientific-spectra-golden.json"
cases = json.loads(fixture.read_text())
for case in cases:
    data, selection, options = case["data"], case["selection"], case["options"]
    spectrum = data["spectra"][0]
    nmr = selection["kind"] == "nmr"
    if nmr:
        rows = [row for row, atom in enumerate(spectrum["atomIndices"])
                if data["atomicNumbers"][atom] == selection["atomicNumber"]]
        positions = [spectrum["valuesPpm"][row] for row in rows]
        values = [1.0] * len(rows)
    else:
        positions, values = spectrum["positions"], spectrum["values"]
        if spectrum["xUnit"] == "nm":
            positions = [1239.841984 / value for value in positions]
        elif spectrum["xUnit"] == "cm^-1" and selection["kind"] in ["electronic", "ecd"]:
            positions = [value / 8065.544 for value in positions]
    x_scale = 100 if selection["kind"] in ["nmr", "electronic", "ecd"] else 1
    fields = [int(nmr), x_scale, options["scale"], options["offset"], options["fwhm"],
              options["axisStart"], options["axisEnd"], len(positions)]
    fields.extend(value for pair in zip(positions, values) for value in pair)
    result = subprocess.run([str(args.oracle.resolve())], input=" ".join(map(str, fields)),
                            text=True, capture_output=True, check=True, timeout=10)
    case["rows"] = [[float(value) for value in line.split()] for line in result.stdout.splitlines()]
fixture.write_text(json.dumps(cases, separators=(",", ":")) + "\n")
print(json.dumps({"cases": len(cases), "points": sum(len(case["rows"]) for case in cases)}))
