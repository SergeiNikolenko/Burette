# Reference numbers for tests/test-collection-chart.test.ts, from NumPy and matplotlib.
# Usage:
#   uv run --no-project --with numpy==2.3.4 --with matplotlib==3.10.7 python -I \
#     tests/fixtures/collection-chart/reference.py tests/fixtures/collection-chart/moses-properties.sdf \
#     > tests/fixtures/collection-chart/reference.json
import json, re, sys
import numpy as np
from matplotlib.cbook import boxplot_stats

records = [dict(re.findall(r"> <([^>]+)>\n([^\n]*)", block)) for block in open(sys.argv[1]).read().split("$$$$\n") if block.strip()]
column = lambda name: np.array([float(record[name]) for record in records])
out = {"records": len(records), "histogram": {}, "box": {}}
# Bin edges are the ones Burette picks (start + step * i); NumPy only counts.
for name, start, step, bins in [("MolWt", 240, 20, 6), ("SLogP", -1, 1, 6), ("TPSA", 0, 20, 5), ("Rings", 0.5, 1, 4)]:
    edges = start + step * np.arange(bins + 1)
    out["histogram"][name] = np.histogram(column(name), bins=edges)[0].tolist()
for value, group in [("SLogP", "Halogen"), ("MolWt", "Rings")]:
    out["box"][f"{value} by {group}"] = {}
    for label in sorted({record[group] for record in records}):
        values = np.array([float(record[value]) for record in records if record[group] == label])
        stats = boxplot_stats(values)[0]
        out["box"][f"{value} by {group}"][label] = {
            "count": len(values), "q1": stats["q1"], "median": stats["med"], "q3": stats["q3"],
            "whiskerLow": stats["whislo"], "whiskerHigh": stats["whishi"], "outliers": sorted(stats["fliers"].tolist()),
        }
out["mean MolWt by Halogen"] = {label: float(np.mean([float(r["MolWt"]) for r in records if r["Halogen"] == label])) for label in sorted({r["Halogen"] for r in records})}
print(json.dumps(out, indent=1))
