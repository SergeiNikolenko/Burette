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
The WASM build requires Emscripten 4.0.10 and Boost 1.87.0. Set
`BURETTE_BUILD_PARALLEL` to change the default two compilation jobs on a remote
Linux build host.

The module accepts one canonical sanitized V2000/V3000 MOL block or canonical
SMILES. MOL blocks preserve their explicit-hydrogen representation; SMILES are
sanitized and expanded with explicit hydrogens before extraction. Format
detection and record splitting stay outside this chemistry boundary, so the
extractor does not carry the renderer's full MinimalLib surface. DataWarrior
IDCode remains an explicit unsupported-record outcome.

The adapter is Burette-owned code. `mlxmolkit/dg_extract.py` and
`mlxmolkit/etk_extract.py` at commit
`9e7337f6f93c40a39ad0187991151944a4f1e274` are parity references only; no
source text from those files is present here. The pinned RDKit source is
BSD-3-Clause and its notice must ship with every extractor artifact.

`conformer_extractor.cpp` intentionally forward-declares three functions from
the pinned `Embedder.cpp` because RDKit does not publish them in `Embedder.h`.
This is a narrow version-locked boundary, not a claim of compatibility with
arbitrary RDKit releases.

The same pinned module now also owns a separate `BMFX` v1 boundary for
MMFF94/MMFF94s parameter extraction. It calls RDKit's public MMFF property APIs
and emits partial charges plus seven groups of fixed 48-byte terms that map to
the native Metal ABI. Nonbonded terms cover all intrafragment graph pairs at
1-4 distance or beyond, so the immutable parameter pack does not depend on a
particular input conformer's coordinates. `BMFX` is decoded and validated by
Rust before any GPU dispatch; it is not folded into the conformer EnginePack.

`Burette_rdkit_conformer.d.ts` is the authored TypeScript contract for the
bindings in `jswrapper.cpp` and the pinned Emscripten factory. `build-wasm.sh`
copies it beside the generated JavaScript; declaration changes do not require
recompiling the unchanged JavaScript or WASM.

`generate-mmff-parity-fixtures.py` uses only pinned RDKit `2025.03.4` as a
reference-oracle dependency and freezes unoptimized coordinates plus initial
and converged MMFF94/MMFF94s energies for twelve molecules.
`attach-mmff-bmfx-fixtures.mjs`
then requires the packaged revision and BMFX v1 ABI before attaching the exact
parameter payloads. The resulting 24-case fixture is consumed by CPU and real
Metal corpus tests; neither generator nor Python is part of the application
runtime.

`generate-conformer-parity-fixtures.mjs` separately freezes BCEX v1 parameter
payloads for four chemistry and stereochemistry cases across all eight DG,
ETDG, and ETKDG variants. The real-Metal corpus test decodes and executes all
32 cases with the production retry ceiling. The hardest pinned chiral case
currently needs 23 deterministic attempts, so the desktop request uses a
bounded ceiling of 32 rather than silently stopping at the former value of 8.

`uff_evaluator.cpp` adds a separate living UFF evaluator, ABI v1. It preserves
the MOL block's atom order and hydrogen representation, requires complete RDKit
UFF atom typing, and owns the molecule together with one reusable force field.
Each evaluation accepts exactly 3N finite float64 coordinates in angstrom and
returns kcal/mol plus the analytic gradient in kcal/(mol angstrom). The frozen
construction policy uses `vdwThresh=100` and ignores interactions between
fragments; the nonbonded term list is fixed from the initial MOL conformer.
Callers must delete the context in `finally` or terminate its owning worker on
cancellation. Limits are specified in `uff-evaluator-contract.v1.json`.

The same module exposes RDKit Gasteiger charges with 12 iterations and
`throwOnParamFailure=true`, preserving explicit and implicit hydrogens and atom
order. Unsupported parameters and non-finite charges fail without substitution.
`generate-uff-parity-fixtures.py` requires Python RDKit 2025.03.4 only as an
independent oracle. `tests/test-uff-wasm.mjs` executes the shipped artifact,
checks energy/gradient and charged Gasteiger parity, finite differences, bounds,
context disposal, and the exact frozen BCEX/BMFX payloads.
