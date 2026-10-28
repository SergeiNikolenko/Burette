# Locked renderer snapshot

The runtime uses the reviewed xyzrender **0.3.9+burette.1 upstream snapshot**, commit
`828e721e40b18f1944c87f949ce224af812dc649` (2026-09-28). This is not a PyPI
release. It includes the ESP/density projection correction (#177), automatic
stereocentre hydrogen visibility (#172), and Chemical JSON input (#174).

`source.json` records the immutable source URL, SHA-256, build timestamp and
wheel SHA-256. The wheel under `vendor/` is built from that Python source with
the reviewed, hash-locked `patches/density-projection.patch` and includes the
upstream MIT license. Its 256 KB size is below
the repository's blob limit. Large upstream examples are not included.

Regenerate the wheel with the CPython 3.13.13 distribution pinned in
`bootstrap.json` and uv from the repository root:

```bash
/path/to/pinned/python3 scripts/vendor-xyzrender.py
```

The helper verifies the entire source archive before reading its members,
installs hash-locked build tools in a temporary environment, and sets
`SOURCE_DATE_EPOCH`. It checks the rebuilt wheel hash before replacing the
vendored artifact. `--archive /path/to/source.tar.gz` reuses a local copy with
the same hash verification. Ordinary application builds only install the
already reviewed wheel; they do not build Python source or fetch this archive.

The local patch applies the upstream ESP occupied-pixel normalization to the
standalone density path too. Upstream #177 fixes `esp.py`; `dens.py` still
blurred occupied voxels together with empty projection pixels. A synthetic
Gaussian with maximum density near 1 and isovalue 0.1 produced no contour. The
patch restores the density scale inside the silhouette, keeps the soft
fall-off at its rim and adds enough projection padding to close its contours.
The local version suffix identifies this extra change.

`requirements.txt` keeps the previously reviewed transitive dependency versions
and hashes, with the source snapshot wheel replacing the PyPI package. Install
from the repository root; the runtime preparation helper sets this working
directory explicitly. To resolve a later snapshot, update `source.json`, build
and review the wheel, then regenerate the dependency lock using the command in
`docs/releasing.md`. Do not describe a snapshot version as a released version.

Run scientific regressions with the prepared environment's Python:

```bash
/path/to/venv/bin/python3 tests/test-xyzrender-upstream.py
/path/to/venv/bin/python3 tests/test-xyzrender-card-pool.py --live
```

The tests check a Gaussian density's analytic ESP range and visible silhouette,
and render stereogenic and symmetric molecules to verify essential hydrogens.
