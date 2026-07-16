# Native RDKit conformer extractor

This directory owns the small native chemistry boundary that converts one
sanitized RDKit molecule into molecule-local arrays for
`conformer.engine-pack.v1`. It is built as a dedicated WebAssembly module; it
is not a Python dependency and it does not replace the smaller RDKit MinimalLib
used by the renderer and fingerprint worker.

The adapter is pinned to official RDKit tag `Release_2025_03_4`, commit
`276b5a662302c6a548ac4f1363c066f3258e3a20`. It calls RDKit's exact variant
presets, CrystalFF torsion extraction, bounds construction, triangle-smoothing
fallback, and internal embedding chirality helpers. Use with another RDKit
revision is unsupported and the build must fail closed on a source mismatch.

The module accepts one canonical sanitized V2000 or V3000 MOL block and keeps
explicit hydrogens. Format detection and record splitting stay outside this
chemistry boundary, so the extractor does not carry the renderer's full
MinimalLib surface.

The adapter is Burrete-owned code. `mlxmolkit/dg_extract.py` and
`mlxmolkit/etk_extract.py` at commit
`9e7337f6f93c40a39ad0187991151944a4f1e274` are parity references only; no
source text from those files is present here. The pinned RDKit source is
BSD-3-Clause and its notice must ship with every extractor artifact.

`conformer_extractor.cpp` intentionally forward-declares three functions from
the pinned `Embedder.cpp` because RDKit does not publish them in `Embedder.h`.
This is a narrow version-locked boundary, not a claim of compatibility with
arbitrary RDKit releases.
