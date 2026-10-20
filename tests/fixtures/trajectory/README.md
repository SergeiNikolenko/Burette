# Compressed XTC reference

`compressed.xtc` is one 224-byte frame independently written and read back with
MDAnalysis 2.10.0 (`XTCWriter`, precision=3). It contains 48 atoms, forcing the
compressed XDR coordinate path rather than XTC's <=9-atom raw float path.

Source coordinates in Angstrom, for zero-based atom index `i`:
`[i * 0.03125, -i * 0.0625, (i % 7) * 0.125]`.
Time is 2.75 ps. Cell lengths are `[31, 37, 43]` Angstrom and angles are
`[70, 75, 80]` degrees. XTC quantizes to 0.01 Angstrom; the test compares every
atom with 0.0051 Angstrom tolerance and checks units, time and triclinic cell.

Reproduce from the repository root without changing dependency manifests:

```sh
uv run --isolated --python 3.12 --with MDAnalysis python - <<'PY'
import MDAnalysis as mda
import numpy as np
u = mda.Universe.empty(48, trajectory=True)
u.dimensions = [31, 37, 43, 70, 75, 80]
u.atoms.positions = np.array([
    [i * .03125, -i * .0625, (i % 7) * .125] for i in range(48)
], dtype=np.float32)
u.trajectory.ts.time = 2.75
with mda.coordinates.XTC.XTCWriter(
    'tests/fixtures/trajectory/compressed.xtc', n_atoms=48, precision=3
) as writer:
    writer.write(u.atoms)
PY
```
