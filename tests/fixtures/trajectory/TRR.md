# TRR vector reference

`vectors.trr` (228 bytes) and `forces-only.trr` (192 bytes) were written and read
back with MDAnalysis 2.11.0's independent `libmdaxdr.TRRFile`. The low-level
writer accepts raw GROMACS units: positions/cell in nm, velocities in nm/ps,
forces in kJ/mol/nm, time in ps. `tests/test-trr-codecs.mjs` checks conversion to angstrom, angstrom/ps and
kcal/mol/angstrom, float32/64 frames, bounded indexing and rejection of malformed
blocks. An absent velocity block stays absent on the next frame.
No temperature is inferred from positions or from velocities without masses
and degrees of freedom.

Reproduce these fixtures (one frame in each file):

```sh
uv run --isolated --python 3.12 --with MDAnalysis==2.11.0 python - <<'PY'
from MDAnalysis.lib.formats.libmdaxdr import TRRFile
import numpy as np
from pathlib import Path
folder = Path('tests/fixtures/trajectory')
x = np.array([[.125, -.25, 1.5], [1, 2, 3], [-1, 0, .5]], dtype=np.float32)
v = np.array([[.01, -.02, .03], [.04, 0, -.06], [-.07, .08, .09]], dtype=np.float32)
f = np.array([[41.84, -83.68, 125.52], [0, 20.92, -20.92], [4.184, 8.368, 12.552]], dtype=np.float32)
box = np.array([[2, 0, 0], [.25, 3, 0], [-.125, .5, 4]], dtype=np.float32)
for name, velocity, force, time, step in [
    ('vectors.trr', v, f, 2.75, 125),
    ('forces-only.trr', None, f * 2, 4.25, 175),
]:
    with TRRFile(str(folder / name), 'w') as stream:
        stream.write(x, velocity, force, box, step, time, .25, 3)
    with TRRFile(str(folder / name), 'r') as stream:
        frame = stream.read()
        assert np.array_equal(frame.x, x) and np.array_equal(frame.f, force)
        if velocity is not None:
            assert np.array_equal(frame.v, velocity)
PY
```
