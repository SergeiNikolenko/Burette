# Stage 3 and 10 evidence: optimization, constraints and automation

Started on `parity/optimization-automation` at `a5f7303cd` and verified
again on the integration branch. Numeric expectations come from Python RDKit,
RDKit's UFF fixture or the analytic lattice result. The live browser evidence
below records the observed UI output separately.

## References and fixtures

| File | Provenance |
| --- | --- |
| `tests/fixtures/optimization/generate-rdkit-optimization-reference.py` | Generator. `uv run --with rdkit==2026.9.1 python tests/fixtures/optimization/generate-rdkit-optimization-reference.py`. |
| `tests/fixtures/optimization/rdkit-optimization-reference.json` | RDKit 2026.09.1 output: analytic gradients at the fixed inputs of `tests/fixtures/forcefield/rdkit-reference.json`, unconstrained MMFF94/MMFF94s/UFF minima (`forceTol 1e-9`), the constrained ethanol minimum, conformer minima of butane and pentane, and stereo SMILES of four flat inputs. The script checks that RDKit's constraint terms sum to Burette's restraint formula after every minimization. |
| `compute/rdkit-conformer/fixtures/uff-rdkit-2025.03.4.json` | Existing RDKit 2025.03.4 UFF energies and gradients (water case). |
| `tests/fixtures/automation/ethanol.sdf`, `acetonitrile.sdf`, `n-methylacetamide.sdf` | The CCO, CC#N and CC(=O)NC molfiles of `tests/fixtures/forcefield/rdkit-reference.json`; ethanol has one `ID` data item. |
| `tests/fixtures/automation/ethanol-ensemble.sdf` | Record 1 = the ethanol input; record 2 = the same graph at RDKit's MMFF94 minimum coordinates. |
| `tests/fixtures/automation/butan-2-ol-2d.mol` | RDKit 2D depiction of `CC[C@@H](C)O` (heavy atoms only, z = 0). |
| `tests/fixtures/automation/water-trajectory.xyz` | Frame 0 = RDKit UFF water reference coordinates; frame 1 = frame 0 rotated 90° about z and translated (4, −3, 2) Å; frame 2 = frame 0 translated (1.5, 0, −0.5) Å. |
| `tests/fixtures/automation/simple-cubic.xyz` | One Cu atom in a 3 Å cubic cell (extended XYZ `Lattice`). Analytic g(r): first shell of 6 at 3 Å. |

## Python cancellation delivery ordering (2026-11-03)

The integration JavaScript sweep passed the logical XYZ topology checks after
the explicit-preview timer fix, then exposed a timing assumption in
`test-workbench-python-client.test.tsx`. The 1,000-step FIRE optimization of
N-methylacetamide completed in 371 ms before Python's separate cancellation CLI
process delivered its request. Returning the completed job was valid, but did
not exercise cancellation of a pending job.

The cancellation test now uses the existing `builtPropertiesWorkers` fixture
to hold delivery of the real browser-target chemistry worker's optimization
result. Python cancellation must terminate that worker and return a cancelled
job without summary or artifacts. Releasing any delayed result must preserve
that terminal state through MCP operation replay and subsequent Python status.
The complete `vp run test:workbench-python-client` passed all three tests and
83 assertions. This is Python/CLI/HTTP/host-hook/worker/MCP integration evidence
under happy-dom. Live browser cancellation remains a separate acceptance item.
The subsequent `vp run test:agent` completed successfully with all 24 tasks
executed without cache hits, including the three Python tests and 83 assertions.
The full JavaScript sweep still needs a successful terminal run.

## Requirements

### Stage 3

| Requirement | Status | Evidence |
| --- | --- | --- |
| MMFF94/MMFF94s/UFF with BFGS, L-BFGS, FIRE, ABC-FIRE and hybrid | Done | Every Cartesian method uses the selected field and records steps. BFGS matches the independent RDKit minima across all three fields. The suite checks additional methods against the same references and verifies the stop reason for runs that exhaust their iteration budget. |
| Frozen atoms; distance/angle/torsion constraints; residual reporting | Done | Frozen atoms are removed from the variables, so they stay exact. Other constraints are harmonic 10⁴·Δ² restraints. Constrained ethanol matches RDKit's constrained minimum, and a stationarity check starts from RDKit's coordinates. Residuals carry kind, atoms, target, value, signed error and unit in every result; `converged` requires every residual within 0.01 Å / 1°. Geometry lists each residual (`test-geometry-optimization-result`); agents read `constraintResiduals` (`test:workbench-automation-jobs`). |
| Z-matrix shared-variable optimization | Done | All five methods use central differences over the independent variables. Water with shared R/A reaches the RDKit MMFF94 minimum with each method. Invariant tests cover shared values, frozen rows, periodic torsions and central derivatives. |
| Conformer search | Done | `searchConformers` relaxes every sample to a converged minimum and drops permutation-equivalent duplicates by sorted heavy-atom distances. Butane and pentane minima match RDKit. UI: Properties → Conformers → Search opens an energy-ordered SDF (`test-workbench-prepare-conformers-ui`). Agent: `conformers` job. |
| Accepted / failed / cancelled / stale outcomes | Done | UI: a result publishes one draft edit only when the source is unchanged; cancel terminates the worker (`test-workbench-zmatrix-optimize`, `test-workbench-prepare-conformers-ui`). Agent: replay, `OPERATION_ID_CONFLICT`, stale binding, `STALE_RESULT`, `allowStale`, cancel and source close (`test:workbench-automation-jobs`, `test:workbench-python-client`). |
| One undoable revision plus an inspectable step trajectory | Done | Edit, Properties and Geometry publish one Undo step. All methods keep every accepted step; Open steps opens them as XYZ with per-step energies for Plots. Agents get a `trajectory` artifact (`Step i Energy=E kcal/mol`), which the test parses back. |
| Automatic 3D preparation for flat input, exposed to the user | Done | `prepare3d` adds hydrogens after the source atoms, embeds, checks the stereo identity (up to 8 seeds) and relaxes. Properties → 3D coordinates → Generate and Edit → More actions → Generate 3D coordinates each publish one undoable edit; RDKit reads the stereocentre back (`test-workbench-prepare-conformers-ui`). Agent: `prepare_3d`. |
| Enforced limits | Done | Analytic Cartesian optimization supports 256 atoms. Central differences and coupled Z-matrix optimization are capped at 64 atoms. Invalid constraints are refused before queueing. MMFF jobs that require central differences above the cap fail in the worker with the limit in the error. |
| Known gaps: MMFF94 boron, sodium, allenes | Documented | OpenChemLib MMFF has no boron or covalent Na types and refuses them with its own error; nothing else is substituted. Allene energies match RDKit. OCL MMFF returns NaN only at exactly collinear double-precision geometries: the generic refusal stays (`test-mmff-collinear`), and the minimizer rejects non-finite trial points instead of propagating them. |

### Stage 10

| Requirement | Status | Evidence |
| --- | --- | --- |
| Optimization and remaining job types on the typed bounded CLI/MCP surface | Done | New kinds: `optimize`, `prepare_3d`, `conformers` and `frame_energy_forces`. Ported from the WIP snapshot into the registry: `metadata_edit` and `pair_distribution`. Existing kinds kept: `properties`, `energy`, `energy_forces` and `orbital_cube`. New `atoms` paging operation. All share observe/submit/status/jobs/cancel/export, response and artifact bounds, and malformed, replayed, stale and cancelled handling. Tests: `test:workbench-automation-jobs`, `test:energy-agent`/`test:orbital-agent` (the compiled CLI test now lists 10 kinds) and `test:workbench-python-client` (CLI and stdio MCP). |
| Conformer and frame energy/force batching | Done | `frame_energy_forces` pages XYZ frames and SDF records: at most 64 frames and 2048 atom-frames per job, with `nextOffset`. Every SDF record is checked against record 1's elements, bonds and graph. Energies and forces match RDKit for ensembles and are rotation-covariant for frames. `extxyz` reopens with the same values. |
| Python/Jupyter client on the same protocol | Done | `plugins/burette-agent/python/burette_workbench.py` (standard library only) provides `Workbench.run`, the `iter_atoms`/`iter_orbitals` pagers, `iter_frame_energy_forces` with a pinned revision and replay-safe operation ids, and `WorkbenchError` codes. It is shipped in the npm package (`python/` is in `files`). An end-to-end test runs `python3` against the packaged CLI, the HTTP server, the production host hook and the MCP tool. |
| Compute-free widget contract kept separate | Done | No widget, hosted plugin or `mcp/lib` bundle changed. Workbench jobs exist only in `browser-agent-shell` sessions; tokenized previews still answer `SURFACE_UNSUPPORTED`. |
| Extension points for other stages | Done | See below and [Adding a typed job kind](../agent-platform.md#adding-a-typed-job-kind). |

## Extension points for other stage agents

1. **Contract.** Add one entry to `JOB_DEFINITIONS` in
   `scripts/workbench-agent-contract.mjs`. `describe` is what `capabilities`
   advertises; `params(value)` rejects unknown fields and resolves defaults.
   Add the type to `WorkbenchJobParams` in `workbench-agent-contract.d.mts`. Copy
   the contract to `plugins/burette-agent/scripts/` (`test-packaged-plugin-mirror`
   checks it).
2. **Runner.** Add one `AgentJobRunner` to `AGENT_JOBS` in
   `apps/desktop/src/lib/workbench/agent-jobs.ts`; the mapped type turns a
   missing kind into a compile error. A runner has three parts:
   - `unavailable(snapshot)`, shown by `observe`;
   - optional `paramsUnavailable(snapshot, params)`, which refuses before queueing;
   - `run(snapshot, params, { signal, timeoutMs, stem, artifact })`, which returns a bounded summary and artifacts.

   The `Snapshot` holds the exact text, extension, parsed graph, scientific
   document, source atoms with cell, and the SDF record count.
3. **Shared helpers.** `sdfRecords(text)` (`agent-source.ts`) and
   `conformerSdfRecord` (`formats.ts`), plus the `record-forces`, `frame-forces`
   and `prepare-3d` compute-worker actions.
4. **`point_group`** is now registered in `scripts/workbench-agent-contract.mjs`
   and `agent-jobs.ts`, backed by `agent-crystal-jobs.ts`. The earlier missing-engine
   note described the original stage branch, not the integrated runtime. Registration
   alone does not establish operation-specific live acceptance.

## Edits to shared or central files

- `scripts/workbench-agent-contract.mjs` / `.d.mts`, and its plugin copy:
  limits, the `atoms` operation and `JOB_DEFINITIONS`.
- `apps/desktop/src/lib/workbench/agent-controller.ts`: dispatches through the
  registry; `observe` reports `structure` and `frames`; adds `atoms` paging. The
  orbital runner moved to `agent-orbital-job.ts`.
- `apps/desktop/src/lib/workbench/agent-source.ts`: the snapshot gains `text`,
  `extension`, `source` and `sdfRecords`.
- `apps/desktop/src/lib/molecular-workbench/chemistry.ts`, `optimization.ts`,
  `minimizer.ts`, `energy-forces.ts`, `compute-client.ts`, `compute-worker.ts`.
- `apps/desktop/src/lib/workbench/use-graph-draft.ts`: the `optimize` operation
  now requires `method` and `forceField`; adds `prepare-3d`.
- UI: `optimize-button.tsx`, `geometry-panel.tsx`, `zmatrix-panel.tsx`,
  `structure-edit-panel.tsx`, `properties-dialog.tsx`, `geometry.css` and
  `workbench-layout.css`.
- `package.json`: new `test:*` scripts appended at the end of `test:ui` and
  `test:agent`. `plugins/burette-agent/package.json` ships `python/`.
- Docs: `docs/agent-platform.md`, `docs/graph-editing-and-properties.md`,
  `scripts/README.md`, and the plugin skill `external-agent-contract`.

`App.tsx`, `viewer.js`, `viewer-shell.js`, `vite.config.ts`, the Mol* adapters,
`browser-shell-dist` and `docs/avogadro-parity-checklist.md` are unchanged.

## Focused validation run

`bun run typecheck` and `bun run check:js` passed, as did:

- `test:optimization-reference`, `test:minimizer-core` and `test:workbench-automation-jobs`;
- `test:workbench-python-client` and `test:workbench-prepare-conformers-ui`;
- `test:energy-agent`, `test:orbital-agent`, `test:properties-agent` and `test:agent-graph-source`;
- `test:structure-edit-controls` and `test:properties-consumer`;
- `test-optimize-button`, `test-geometry-optimization-result`, `test-graph-draft-adapter`
  and `test-workbench-zmatrix-optimize`;
- `test-zmatrix-coupled-*`, `test-mmff-collinear` and `test-burette-agent-plugin`;
- `test-packaged-plugin-mirror`.

## Browser acceptance recorded on 2026-11-03

- Fixture: `tests/fixtures/automation/ethanol.sdf`, fresh `vite-dev` shell in the
  Codex in-app browser. Right dock → Info → Calculate properties → UFF → BFGS →
  Optimize published a single draft edit. The Edit receipt showed
  42.44 → 1.07 kcal/mol, 60 steps, Converged.
- Open steps opened `ethanol-optimization.xyz` in a separate workspace tab with
  61 frames. Back on the SDF, Undo restored C1 from (−0.327, 2.800, −1.706) to
  (−0.317, 2.796, −1.713) Å at display precision. Redo restored the optimized
  coordinates.
- The 11 RDKit reference tests cover energies, gradients, minima, constraints,
  conformers and shared Z-matrix variables. Reversing the N-methylacetamide atom
  order preserves analytic MMFF94, MMFF94s and UFF gradients in displayed order
  (component error below 2e-4 kcal/mol/Å, energy error below 1e-4 kcal/mol).
  The Python client exercised a completed UFF/BFGS job with an analytic gradient
  and step sampling.

## Remaining gaps

- **Convergence.** FIRE and ABC-FIRE can exhaust the iteration budget on some
  fixtures. The result reports `stopReason: "iterations"` and `converged: false`.
- **Conformer method.** Conformers come from OpenChemLib torsion sampling.
  Avogadro's Open Babel systematic, weighted and genetic search modes are not
  ported, because Open Babel is GPL. Count and seed are exposed.
- **`point_group`** belongs to stage 8 (see above).
- **Pending acceptance:** the remaining live browser scenarios below, the rebuilt
  packaged plugin and the native app.

## Acceptance scripts (live browser shell, packaged plugin)

Setup, once per run: `bun run build:agent-shell` (its output is not committed).
Each scenario starts a fresh session:

```bash
OPEN=$(node scripts/burette-agent.mjs open --mode browser-agent-shell "$PWD/<fixture>")
SESSION=$(jq -r .result.sessionDir <<<"$OPEN")   # open jq -r .result.url in the Codex in-app Browser
wb() { node scripts/burette-agent.mjs workbench --session-dir "$SESSION" "$@"; }
REV=$(wb '{"operation":"observe"}' | jq -r .result.sourceRevision)
```

For the packaged plugin, run the same commands with
`plugins/burette-agent/scripts/burette-agent.mjs` in place of
`scripts/burette-agent.mjs`; the Python client resolves that copy by default.

### A. Constrained optimization with steps (`ethanol.sdf`)

1. Submit:
   ```bash
   wb "{\"operation\":\"submit\",\"operationId\":\"opt-1\",\"expectedSourceRevision\":\"$REV\",\"job\":{\"kind\":\"optimize\",\"params\":{\"forceField\":\"UFF\",\"constraints\":[{\"kind\":\"freeze\",\"atoms\":[0]},{\"kind\":\"distance\",\"atoms\":[1,2],\"target\":1.5}]}}}"
   ```
   Then poll `{"operation":"status","operationId":"opt-1"}` until it is terminal.

   Expect `succeeded` with:
   - `method: "lbfgs"`, `gradient: "analytic"`, `frameSampling: "steps"`;
   - `converged: true`, `frozenAtoms: [0]`;
   - one residual with |error| < 0.01 Å.
2. Export:
   ```bash
   wb '{"operation":"export","jobId":"<id>","artifact":"trajectory"}' --output /tmp/a-steps.xyz
   ```
   Do the same for `structure` (to `/tmp/a.sdf`).

   Expect:
   - `/tmp/a.sdf` has the source bonds and atom 0 at its exact input coordinates;
   - frame 0 of `/tmp/a-steps.xyz` has `Energy=` equal to `initialEnergy`, and the last frame has `energy`.
3. Reopen both files with `open --mode browser-agent-shell`.
   - `observe.frames.count` on the trajectory equals `frameCount`.
   - Plots charts one energy per step.
4. Replay and malformed requests:
   - Resubmitting step 1 unchanged returns `deduplicated: true` with the same job.
   - The same `operationId` with `"method":"fire"` returns `OPERATION_ID_CONFLICT`.
   - `"method":"steepest"`, `"maxIterations":1001` and a 2-atom angle each return `INVALID_ARGS`, and `actions.json` stays the same length.
5. Stale result: edit the document in the shell (any coordinate), then:
   - `status` reports `stale`;
   - `export` returns `STALE_RESULT`;
   - `export` with `"allowStale":true` writes the old file.

   Submitting with the old `$REV` returns `REVISION_CONFLICT`.
6. Cancel and close:
   - Submit `{"method":"fire","maxIterations":1000}` on `n-methylacetamide.sdf` and cancel it immediately: expect `cancelled`, `summary: null` and no artifacts.
   - Close the tab while the next job runs: `source_closed`.

### B. Refusals before queueing (`acetonitrile.sdf`)

Each of these returns `JOB_UNAVAILABLE` with the stated reason, and `jobs.total`
stays at 0:

- `optimize` with an `angle` over [0,1,2] (linear angle);
- a `dihedral` over [3,0,1,2] (collinear);
- `freeze` of atom 6.

### C. Generate 3D in the UI (`butan-2-ol-2d.mol`)

1. Open the file in the shell and choose Properties → 3D coordinates → Generate.
   Expect:
   - the Edit tab opens with "MMFF94, BFGS … kcal/mol · Converged" with Open steps;
   - the draft has 15 atoms;
   - RDKit reads `CC[C@@H](C)O` from the saved file.
2. Undo restores the 2D text byte for byte. Edit → More actions → Generate 3D
   coordinates gives the same result.
3. Agent equivalent: `prepare_3d` with `{"seed":2}` on the same file. Expect
   `preparation: {addedHydrogens: 10, seed: 2, attempts: 1}`. Running
   `prepare_3d` on `ethanol.sdf` reports
   `observe.jobs.prepare_3d.available: false`.
4. Check both themes, keyboard-only use (Tab to the Generate button, Enter) and
   a 320 px dock: the Generate and Search rows stay readable without clipping.

### D. Optimizer menu (any SDF; `n-methylacetamide.sdf` for steps)

1. In Edit, open the Optimize menu.
   - Select UFF: L-BFGS is checked by default. BFGS remains available for an explicit choice.
   - In Geometry, freeze an atom: BFGS is disabled with "cannot hold frozen atoms".
   - Lock the linear angle on acetonitrile: Optimize is disabled with the linear-angle reason.
2. Run FIRE: the result line shows the method and step count, and Open steps
   opens an XYZ trajectory that Plots charts. The Geometry residual list shows
   each constraint with its signed deviation; a failing deviation is red only on
   that value.
3. Screen reader check: the menu trigger announces "Optimization method:
   L-BFGS, UFF".

### E. Conformers (`ethanol.sdf`; `n-methylacetamide.sdf` to cancel)

1. Properties → Conformers: entering 40 clamps to 32. Search opens
   `<name>-conformers.sdf`, ordered by `MMFF94 energy (kcal/mol)` with relative
   energies; the source stays unchanged.
2. Cancel during the search on N-methylacetamide: nothing opens.
3. Agent equivalent: `conformers` `{"count":16,"seed":4}`.
   - `energies` is sorted ascending.
   - Each exported record reopens with the source SMILES.

### F. Frame batches (`water-trajectory.xyz`, `ethanol-ensemble.sdf`)

1. Run the Python client with batches of 2:
   ```bash
   PYTHONPATH=plugins/burette-agent/python python3 -c "from burette_workbench import Workbench; import json,sys; wb=Workbench(sys.argv[1]); print(json.dumps([f['energy'] for f in wb.iter_frame_energy_forces('UFF', batch_size=2, operation_prefix='w')]))" "$SESSION"
   ```
   Expect three energies equal to 5.6964874763 kcal/mol (within 10⁻⁶). Rerun:
   `jobs.total` is unchanged (replay).
2. Ensemble, MMFF94: energies are 37.9166 and −1.5171 kcal/mol (RDKit). Export
   `extxyz` and reopen it: per-atom forces are shown, and `Energy` matches.
3. A mixed SDF (ethanol + acetonitrile records) fails with "SDF record 2 has a
   different graph". `{"offset":2}` on the two-record ensemble returns
   `JOB_UNAVAILABLE`.
4. Edit the source between batches: the loop raises `REVISION_CONFLICT`.

### G. MCP

Through `burette.control_viewer` with `{"type":"workbench", …}`, repeat steps A1,
A4 and F3. The responses must match the CLI responses, and `structuredContent`
must never contain inline artifact content.
## Packaged CLI coordinate jobs

A packaged browser shell loaded a single 15-atom butanol SDF. The packaged CLI
observed the editable revision, submitted `measurement_set` and `coordinate_align`
against that revision, then polled each through success and exported the
`structure` artifacts. The final observation still reported the input revision.
Both exports reopened in the same shell through the ordinary file picker and
each displayed a 3D view.

| Job | Request (zero-based source rows) | Independent check | Export SHA-256 |
| --- | --- | --- | --- |
| `measurement_set` | Angle [3, 1, 0], move last fragment, 112° | RDKit 2026.09.1 measured 112.0000000023°. Maximum coordinate component difference from `SetAngleDeg` was 4.74 × 10⁻¹¹ Å. | `e69387bf505a6ff46b011563b6faeb7673a22dd64cbb8e3064422f798580a9a5` |
| `coordinate_align` | Atom 1 at the origin, atom 3 on +z | Maximum coordinate component difference from SciPy `Rotation.align_vectors` was 4.83 × 10⁻¹¹ Å. | `8f99d46ddba1254ce513531aa59a1e4762da92c90f032794c26c5701c7c7d587` |

Both copies retained the isomeric SMILES and the source's `SOURCE_NOTE` data item.
The focused automation suite also exercised a MOL V2000 input, a MOL V3000
input, rejection before queueing, cancellation, a changed source revision and
a closed document. The broader live Jupyter batch workflow matrix remains open.

### Packaged browser coordinate jobs through stdio MCP

On 2026-11-03, source `4eb88252d` and the prebuilt browser shell from
`ed47115e4` executed both jobs through the plugin's actual stdio server and
`burette.control_viewer`. The active document was the picker-reopened nine-atom
ethanol export from the hydrogen scenario, with source SHA-256
`10704ce84c25b7772331e46a2c881da4da47f822e3e6b14cc174bc04d071080f`.

- `measurement_set` changed distance [0, 1] to 1.7 Å, moving rows [0, 3, 4, 5].
  RDKit measured the exported distance within 1.91 × 10⁻¹¹ Å of the request.
  The other five rows retained their exact source coordinates. Export SHA-256
  was `d598fb43b460f3b3f18df5cf42617dc3e22c2bec97bd4da551b24bfefd8c04d8`.
- `coordinate_align` placed atom 1 at the origin and atom 2 on +z. An independent
  SciPy axis-angle rotation matched every exported coordinate component within
  4.86 × 10⁻¹¹ Å. Export SHA-256 was
  `edcb200a644999677c322c7567060ab609953f06e5a22e89f10826ca3e31216f`.
- Both jobs succeeded, exact request replay retained the job ID, and a changed
  parameter with the same operation ID returned `OPERATION_ID_CONFLICT`.
  Final observation retained the source revision and text hash. MCP exports
  returned artifact paths and hashes without inline molecular content.
- RDKit parsed both artifacts as nine atoms and eight bonds, retaining isomeric
  SMILES, `SOURCE_NOTE` and `BURETTE_METADATA_V1_extra`. Both exact MCP artifacts
  subsequently reopened through New tab → Open file in the same packaged
  browser. Each displayed a 3D view and Info reported nine atoms, eight bonds,
  and both user property names, with the reserved identity field hidden.
  Closing the original source tab changed both jobs from `succeeded/current` to
  `source_closed/source_closed`, removed their artifacts, and refused export
  with `SOURCE_CLOSED` for both default and `allowStale: true` requests.
  Live MCP cancellation remains untested.

### Coordinate artifacts after editing their open source

The same packaged stdio MCP and prebuilt browser were tested against a
picker-reopened edited gzip SDF on 2026-11-03. Its decompressed text SHA-256 was
`d6dac03af4e57ee6d74c098460ccf75663bcdf19ec1628a8926acf91e89af472`.
Both distance [0, 1] = 1.7 Å and origin 1 / axis atom 2 on +z completed and
exported successfully. Edit → More actions → Remove hydrogens then changed
the still-open source from nine atoms/eight bonds to three atoms/two bonds.
Observation retained the document ID and reported a new source revision.

For both jobs, actual MCP status returned `stale/stale`, default export returned
`STALE_RESULT`, and `allowStale: true` exported the original artifact with its
original source revision. Byte comparison against the exports saved before
the edit matched exactly. The distance SHA-256 was
`9b16a8ed821f9888538ba065a8dd6b861c85a3c4db4898b7ae21b1b57e788035`
and the alignment SHA-256 was
`6044616be00274774bbcafe442b041b6912175e26831d14110a73121c9eca55b`.
The first repeated export correctly refused the occupied default output path
with `OUTPUT_EXISTS`; moving the verified test exports aside allowed the
retained-artifact comparison without overwriting them.

### Coordinate notebook against the live packaged browser

An executed two-cell notebook used an actual Python ipykernel through nbclient
and the plugin Python client against the same open prebuilt browser shell.
Its source was the picker-reopened distance MCP artifact above (SHA-256
`d598fb43b460f3b3f18df5cf42617dc3e22c2bec97bd4da551b24bfefd8c04d8`).
It paged all nine atoms, ran distance [0, 1] = 1.6 Å and origin 1 / axis atom 2
on +z, replayed each operation ID, and exported both SDF artifacts. RDKit
confirmed nine atoms/eight bonds, the requested distance within 10⁻⁸ Å,
an exact zero origin, and axis x/y within 10⁻⁸ Å with positive z. Artifact
hashes matched the exported bytes; the source revision stayed unchanged.

The first execution exposed a Python transport error: inherited `NO_COLOR`
and `FORCE_COLOR` caused Node to prefix stderr with a warning, masking
`REVISION_CONFLICT` as `CLI_FAILED`. The client now reads the final CLI JSON
envelope after startup diagnostics. The existing Python integration suite
reproduced two failures with both flags before the fix and passed all three
tests (80 assertions) afterward. Re-executing the notebook also passed its
stale-revision refusal. Repeated exports use fresh output paths to preserve
the CLI's no-overwrite contract.

This verifies kernel execution and live browser transport for these two jobs.
Notebook frontend interaction, the remaining job/batch matrix and native
application acceptance remain open.

## Live Python peptide build and picker reopen (2026-11-04)

Source `7675d88a9`, browser-agent-shell **vite-dev**, IAB, dark 1280 × 720.
The shipped standard-library Python client invoked the packaged CLI against a real
open browser host; no controller fixture or fake viewer handled these requests.
After opening `topology-real-browser-water.molx`, Python ran:

```python
wb = Workbench(session_dir)
job = wb.build("peptide", {"sequence": "AGS"}, operation_id="live-python-ags-20261104")
wb.export(job.job_id, "structure", output=output_path)
```

The source-independent job succeeded with 31 atoms and three residues. The resulting
[exact CIF](python-ags-live.cif) was opened through New tab → Open file, using the
ordinary browser file chooser. The rendered molecule and sequence panel showed
chain A with A–G–S. Screenshot: `/tmp/burette-python-ags-reopened.png`.

An independent Python standard-library parse of the exported atom rows counted
C8H15N3O5: alanine + glycine + serine minus two waters. Both inter-residue C–N
coordinate distances were 1.329 Å. These are formula/connectivity sanity checks,
not an independent stereochemical or optimized-energy assessment. The retained
[oracle](python-ags-live.json) includes the file hash, both distances and:

- Repeating identical build parameters and operation ID returned the same job ID.
- Reusing that ID with sequence AG returned `OPERATION_ID_CONFLICT`.
- Exporting to the occupied path returned `OUTPUT_EXISTS`, leaving bytes unchanged.

This supplies live Python build/export/reopen evidence for the peptide operation.
It does not close 10.01 or 10.03: Jupyter execution of this peptide workflow, the
remaining operation-specific Python/batch matrix, light/compact/keyboard acceptance, and packaged prebuilt
runtime acceptance remain open. This run did not exercise peptide cancellation,
stale bound-input handling, optimization, or widget compute behavior.

## Typed spectra automation (2026-11-04)

Parent `08e9731a6` lacked a typed counterpart to the six additional spectra in the
interactive panel. The `spectrum` job now shares `computeScientificSpectrum` with
the panel, exposes explicit file/frame/companion selection and produces original
source JSON/CSV, full numeric display CSV and display-settings JSON. It uses the
existing immutable scientific snapshot, job/cancellation owner and artifact bounds.
Python's `JobKind`, introspection and the packaged CLI contract include the job.
No compute widget capabilities were added. IR/Raman and mode exports remain open.

Focused agent tests: all six full display grids agree with the pinned independent
C++ golden values (relative tolerance 2e-6); raw source JSON is retained exactly.
Contract tests reject missing kinds/elements/frames, unsupported fields and invalid
basic numeric parameters. Frame/companion availability never falls back to another
source. Real workers reject pre-cancelled jobs; a real controller parses CJSON,
replays one job ID and refuses stale export. 9 tests / 799 assertions passed.
The existing spectrum-worker suite passed 9 tests / 45 assertions, including signed
ranges and NMR atom identities. Compiled CLI/MCP compatibility passed 7 / 990.

Live IAB **vite-dev**, dark 1280 × 720: normal CJSON open materialized
`spectra-native-nmr.mol` with retained science. The shipped Python client ran
`wb.run("spectrum", {"kind": "nmr", "atomicNumber": 6})` against this actual host
and exported all four artifacts. The job succeeded with 20000 grid points and one
carbon source row. Spectra → C showed C1 = 8.35600 ppm and reference 192.038 ppm,
matching the source and settings artifacts; `/tmp/burette-spectrum-live.png`.
Independent standard-library Python read the exported CSV and checked every point
against the double-precision peak-height Gaussian, absolute error <0.001. Expected
peak 183.682 ppm, nearest exported peak 183.67999267578125 ppm (0.01 ppm grid).
The compact retained [oracle](spectrum-live-oracle.json) records those values.
Full local request/artifact paths: `/tmp/burette-spectrum-live.json`.

This does not establish the full operation matrix: live execution of the other
five spectra, actual running cancellation, frame/companion publication, Jupyter,
light/compact/keyboard acceptance and prebuilt/native runtime scenarios remain open.

The exported `nmr-display.csv` also reopened through New tab → Open file in the
same browser. The table reported **20,000 rows / 3 columns**, with headers
`position_ppm`, `smoothed`, `stick`; `/tmp/burette-spectrum-csv-reopened.png`.
Typecheck and the completed browser-shell build passed; plugin verification is
recorded separately from this vite-dev run.

The plugin check passed after the completed build, and the packaged contract
matched the root contract byte-for-byte. Logs: `/tmp/burette-spectrum-{tests-final,worker,cli,types-final,build,plugin}.log`.


## Live Python ORCA optical frame spectra (2026-11-04)

At `f6aefb6e983538435fbc2ee332e60fbda4658adb`, a fresh IAB **vite-dev** host
opened `tests/fixtures/quantum/spectra-orca-camphor.out` normally, producing the
27-atom XYZ view and retained frame science. This fixture retains unchanged
geometry and electric-dipole absorption/CD tables from the pinned upstream ORCA
output (see its optical reference document); it is not a newly executed ORCA job.

The shipped Python client successfully executed both `electronic` and `ecd` via
`wb.run("spectrum", {"kind": kind, "source": "frame", "frameIndex": 0,
"axisStart": 9, "axisEnd": 3})` and exported all four artifacts for each.
Defaults also succeeded (400 points, 5 to 1 eV), but that interval includes only
the first of these 15 transitions. The explicit 9 to 3 eV interval (600 points)
was used for the signed-signal acceptance check. File source, absent frame 1 and
absent companion frame 0 each returned `JOB_UNAVAILABLE`, without fallback.

Independent standard-library Python split the original ORCA table lines, compared
all exported raw numeric columns and transition IDs exactly, then summed the
peak-height Gaussian in double precision from the original energies/strengths
at every exported grid position, with FWHM 0.1 eV. Maximum absolute errors:
8.178e-8 (absorption) and 2.740e-5 (ECD). ECD grid extrema were -12.829895 and
+8.380362, retaining both signs. Raw ECD units remain `1e40*cgs`; position units
remain the producer's eV. No wavenumber conversion was needed for this fixture.
The [compact oracle](optical-frame-live-oracle.json) retains artifact hashes,
parameters, row counts, refusal results and numerical errors.

In the dark 1280 × 720 UI, Compute → Show spectra → Circular dichroism showed
the same transition IDs, signed values and units. Double-click numeric entry
and Enter set the axes to 9 and 3 eV. Export → Source CSV downloaded
`spectra-orca-camphor-frame-1-ecd.csv`; its 1224 bytes matched the Python raw CSV
exactly. Screenshot: `/tmp/burette-optical-ecd.png`. The exported grid itself was
checked numerically, not reopened in the table viewer during this run.
Local full job/artifact locator: `/tmp/burette-optical-live.json` (the wide-axis
artifacts are alongside the default exports in that session directory).

This adds live frame publication for two optical kinds to the preceding live
file-scoped NMR evidence. It does not establish multi-frame selection, MCD
companion publication, VCD/MCD/DOS live jobs, running cancellation, Jupyter,
light/compact/full-keyboard acceptance, or prebuilt/native behavior. All stage
statuses remain partial. No production implementation changed in this evidence pass.


## Typed IR and Raman automation (2026-11-04)

Added `vibrational_spectrum` through the shared CLI/MCP contract, job owner and
Python JobKind. File/final-geometry or explicit frame modes feed a cancellable
worker using the existing Vibrations formula; source CSV/JSON, full display CSV
and settings are bounded artifacts. Missing intensities/activities refuse the job.
No Hessian-derived intensities, mode displacements or companion inference is added.

Five focused tests / 28 assertions cover contract rejection, real FCHK IR and
Raman grids against independent double-precision Gaussians, widened axes, absent
versus zero activity, pre-abort, controller replay and stale export. Live IAB
**vite-dev**, dark 1280 × 720, opened the real `gaussian16-water-raman.fchk` fixture.
Shipped Python ran both frame-0 jobs to `succeeded` and exported all four artifacts.
An independent Python parser read the FCHK Vib-E2 blocks and confirmed exact raw
frequencies, IR intensities and Raman activities. All 4100 IR and 4500 Raman points
were checked against double-precision Gaussians (max absolute errors 0.000377 and
0.000507). See [numeric oracle](vibrational-agent-live-oracle.json).

Compute → Show vibrations displayed the same three modes (2169.9, 4141.3,
4392.4 cm^-1) and automatic IR axis 4500 to 400. The unchanged exported Raman
CSV bytes, given a `.csv` extension, reopened via New tab → Open file and reported
4500 rows / 3 columns. Screenshots: `/tmp/burette-vibration-ir.png` and
`/tmp/burette-vibration-reopened.png`. Typecheck, build:agent-shell and packaged
plugin checks passed. This live run is vite-dev, not the rebuilt prebuilt shell.

Running cancellation, multi-frame selection, Jupyter, both-theme/compact/keyboard
matrix and prebuilt/native runtime remain open. The source-only operation does
not close Hessian or displaced-geometry automation. All stage statuses stay partial.

Compiled CLI/MCP compatibility passed 7 tests / 990 assertions, including the
expanded capability list; this does not claim IR/Raman execution over MCP. The
packaged/root contracts matched byte-for-byte. Logs: `/tmp/burette-vibration-*.log`.


## Preserve original vibrational source names (2026-11-04)

The new vibrational job initially used the materialized document title, so an
imported FCHK was incorrectly named `.xyz` in source CSV/JSON and settings.
The source owner now captures the registered original name with the scientific
payload before asynchronous work, and includes that name in the opaque source
revision. Parsed sources without an attached original retain their document title.
The job exports the captured name rather than looking up mutable import state.
A subsequent name replacement changes the revision; an older snapshot keeps its
original provenance. No original file bytes are cloned for this metadata field.

A regression test failed before the fix (`converted.xyz` instead of
`original-water.fchk`) and passed afterward. Seven tests / 34 assertions now also
cover zero-width and over-limit grids and Float32 intensity overflow: each rejects
before any artifact callback. This is numerical failure coverage, not running
cancellation evidence. Logs: `/tmp/burette-vibration-name-{before,tests}.log`.

Fresh live IAB **vite-dev** imported `gaussian16-water-raman.fchk`; Python frame-0
Raman succeeded and all three provenance-bearing exports named that original FCHK.
A separate file/final-geometry job's source CSV matched the UI's Export → Spectrum
as CSV byte-for-byte (972 bytes). Frame and file provenance remain distinct.
[Compact live evidence](vibrational-source-name-live.json). Screenshot:
`/tmp/burette-vibration-name-ui.png`. Typecheck, rebuilt shell and plugin validation
passed; the live session checks source vite-dev, not prebuilt/native runtime.

Compiled CLI/MCP compatibility also passed 7 tests / 990 assertions after the
source-revision change (`/tmp/burette-vibration-name-cli.log`).

### Constrained optimization in the Edit panel, step limit, progress and steps for every result (2026-11-06)

The Edit panel of an SDF/MOL structure optimized without constraints or a step
limit, the running status of every panel said only "Optimizing", and the
Z-matrix result dropped its method, step count and steps. The minimizer core
already held constraints and recorded every step; this change carries them to
the user:

- **Edit panel:** **Freeze** keeps the selected atoms in place; **Hold
  distance/angle/dihedral** restrains two, three or four selected atoms to a
  target that starts at the measured value and can be typed
  (`structure-edit/constraint-editor.tsx`). The `optimize` graph operation carries
  `constraints` and `maxIterations` to the chemistry worker, and its outcome keeps
  the residuals, listed under the result line as in Geometry. Constraints follow
  their atoms through edits (by `sourceAtomIndices`) and optimizations; Undo, Redo
  and renumbering operations start without them, as the selection does.
  Constraints undefined on the current geometry disable Optimize with the reason.
- **Every panel:** the Optimize menu has a step limit of 100, 250, 500 or 1000
  (remembered like the method and force field). The worker posts `{ iteration,
  energy }` at most every 100 ms before its answer (`runWorkerTask` `onProgress`),
  and the running status shows "Step N, E kcal/mol". The Z-matrix result line now
  names the method and step count and offers **Open steps**; Geometry, Edit and
  Z-matrix share one Open steps button and one residual list.
- `docs/graph-editing-and-properties.md` no longer claims that BFGS is
  unconstrained-only or that BFGS has no steps; every method holds constraints and
  records steps (`test-optimize-button`, `test-optimization-reference`).

Checks on Gauss: `bun run typecheck`, `test:structure-edit-controls` (new graph
draft test: two holds, residuals, frozen atom exact, Undo, worker progress and a
5-step limit; new menu test: step limit chosen, remembered, passed),
`test:geometry-ui`, `test:minimizer-core`, `test:optimization-reference`,
`test:zmatrix-draft`, `test:zmatrix-controls`, `test:zmatrix-coupled-core`,
`test:physics-worker-core`, `test:properties-consumer`,
`test:workbench-prepare-conformers-ui` and `test:mol-graph-identities` pass.
`test:structure-edit-panel` (3 of 13: element field and metadata edits) and one
`test:workbench-automation-jobs` contract test (the job-kind list lacks `spectrum`
and `vibrational_spectrum`) fail identically on the unchanged commit `a84a4b375`.

Browser scenario on Gauss, agent shell rebuilt from this checkout, RDKit-embedded
1-butanol SDF with hydrogens (15 atoms): open Edit from the command palette, pick
C1 and C2 in the atom table → **Freeze**, pick C3 and O5 → **Hold distance** →
type the target 2.645 Å (measured 2.395) → choose UFF, L-BFGS and 1000 steps →
Optimize (status "Step 1, 23.20 kcal/mol") → result "UFF, L-BFGS 4.37 → 11.27
kcal/mol, 94 steps, Converged" with the residual row → **Open steps** opens
`butanol-optimization.xyz` with 95 frames → back on the structure, **Undo**.
Light 1400x900 and dark 900x800 screenshots were inspected.

[Independent RDKit oracle](constrained-optimization-oracle.json), 18/18 checks:
both frozen atoms keep exact coordinates; C3–O5 reaches 2.6416 Å (−0.003 Å, the
displayed residual); the start and final energies equal RDKit UFF of the source
and of the displayed result within 0.01 kcal/mol; an RDKit UFF minimization with
the same fixed points and a 2·10⁴ kcal/(mol·Å²) distance constraint reaches the
same physical energy (gap 0.0000 kcal/mol) and geometry (RMSD 3·10⁻⁵ Å); Undo
restores the source geometry. Page and console errors equal those of the shell
built before this change.

Still open: keyboard-only and screen-reader passes of the constraint controls,
constraints surviving Undo/Redo, angle and dihedral holds in the browser (covered
by `test-optimization-reference`), MOL files, and native/Quick Look surfaces.

### Automatic energy model, Lennard-Jones and Avogadro's chunked optimizer state (2026-11-06)

Optimization offered three hard-coded fields and fell back to nothing for
elements MMFF94 cannot type, and the minimizer kept its FIRE and quasi-Newton
state only inside one call. Following Avogadro (avogadrolibs
`cb0e94852889da9f7288bd1e58241e69990935a7`):

- **Minimizer:** `createMinimizer(...).run(count)` keeps FIRE velocity and time
  step, the L-BFGS pairs or BFGS inverse, the stall counters and the energy
  window between calls, as `OptimizerState` does in `calc/energyoptimizer.cpp`; a
  run cut into chunks of 1–7 steps takes exactly the steps of one run. Three
  successive quasi-Newton steps that move no coordinate by 1e-10 Å or lower the
  energy by less than 1e-14 of its magnitude restart once from steepest descent
  and then stop as `stalled` (also after a failed line search with history).
  An optional energy tolerance ends a run when the mean change over at least ten
  steps falls below it (`qtplugins/forcefield/energywindow.h`).
- **Energy models:** `energy-models.ts` lists MMFF94, MMFF94s, UFF and
  Lennard-Jones with their elements and whether they type the bond graph.
  Lennard-Jones is `calc/lennardjones.cpp` (every pair, ε = 100 kJ/mol, minimum
  at the summed Alvarez radii from `core/elementdata.h`, r clamped at 0.1 Å) in
  kcal/mol with its analytic gradient, and it relaxes XYZ input without bond
  orders. **Automatic** (the new default) resolves on the parsed structure:
  MMFF94, then UFF, for a complete graph whose elements they cover, and
  Lennard-Jones only for a structure without bonds, since it would push bonded
  atoms apart. Models lacking an element are disabled in the menu with the
  element named. Avogadro also recommends LJ for bonded molecules no other model
  accepts; this is the deliberate difference.

Checks on Gauss: `bun run typecheck`, `test:minimizer-core` (chunk equivalence
for all five methods, noise-floor stall at E ≈ 10⁶, energy window),
`test:workbench-physics` (new `test-energy-models`: Ar₃ pair minima, gradient
against central differences with a Pt–Cl–H set, Automatic on SMILES and XYZ
input), `test:optimization-reference` (21 RDKit references unchanged),
`test:structure-edit-controls`, `test:geometry-ui`,
`test:geometry-source-lifecycle`, `test:zmatrix-controls`,
`test:zmatrix-coupled-core`, `test:zmatrix-draft`, `test:physics-worker-core`,
`test:properties-consumer`, `test:properties-info`, `test:properties-agent`,
`test:workbench-prepare-conformers-ui`. `test:structure-edit-panel` keeps the
same three failures as before this change (element field and metadata).

Browser scenario on Gauss with the rebuilt agent shell: a tetramethyltin SDF in
Edit shows Automatic checked and MMFF94/MMFF94s disabled with "has no
parameters for Sn", and Optimize reports "UFF, L-BFGS 1.54 → −2.14 kcal/mol,
170 steps, Converged". A four-atom Ar XYZ in Geometry runs Lennard-Jones:
"−118.49 → −143.40 kcal/mol, 12 steps, Converged", every distance 3.6600 Å,
every angle 60.00° and the dihedral −70.53°, a regular tetrahedron at −6ε. Page
and console errors equal the earlier baseline.

Still open: RDKit UFF refuses metals in bonding its typer does not recognize
(tetrahedral Pt), where Avogadro's own UFF typer succeeds; the agent job
contract still accepts only MMFF94, MMFF94s and UFF (Stage 3D).

### External energy models: xTB and Avogadro energy plugins (2026-11-06)

Avogadro optimizes with energy models in other processes (`calc/` energy
plugins and `qtplugins/forcefield/scriptenergy.cpp`, avogadrolibs
`cb0e94852889da9f7288bd1e58241e69990935a7`); Burette's optimizer only knew the
worker's force fields.

- **Minimizer:** `minimizerSteps` is the one stepping core, a generator that
  yields trial points; `createMinimizer` drives it synchronously and
  `createAsyncMinimizer` awaits each evaluation, so both take identical steps.
  `cartesianProblem(molecule, constraints)` (`initial`, `movable`, `frozen`,
  `restraints`, `unpack`, `objective`, `physicalEnergy`) is shared by
  `optimizeCartesian` and `optimizeCartesianAsync`, which accept the same
  `gradientTolerance` and `energyTolerance` and report `atoms` with each step.
- **Native sessions:** `energy_models_list`, `energy_model_open`,
  `energy_model_evaluate` and `energy_model_close` (permissions in
  `permissions/burette.toml`). xTB runs `xtb input.xyz --gfn 2|1 / --gfnff --grad
  --chrg --uhf` per evaluation in a private 0700 folder and reads
  `input.engrad` (CODATA 2018 hartree and bohr). Plugins keep one process per
  run over text-v1 or binary-v1; see
  [Energy models](../avogadro-extensions.md#energy-models) for the protocol and
  bounds. Sessions belong to the opening window and close with it or the app.
- **UI:** `optimizeWithEnergyModel` routes built-in models to the worker and
  external ones to a session; `energyWithModel` does the same for Calculate
  Energy; `useEnergyModelOptions` lists both kinds in the Optimize menu and the
  Configure dialog with each model's reason. Auto Optimize refuses external
  models ("Auto Optimize runs MMFF94, MMFF94s, UFF or Lennard-Jones; …") and
  coupled Z-matrix optimization hides them.
- **Agent jobs:** `energy`, `energy_forces`, `frame_energy_forces` and `optimize`
  accept `LJ`, which runs without a bond graph.
- **Found on the way:** avogadro-xtb-energy reads its start line with Python's
  text-mode `sys.stdin.readline()`, which reads ahead and swallows a binary
  frame already in the pipe; the process then waits forever. Avogadro escapes it
  only because evaluation starts long after set-up. Burette holds the first
  request until a probe of the stdin pipe shows the line was read. The same
  package's binary gradients are bohr² too small (see the extensions doc).

Checks (Rust on this Mac, `nice -n 10 cargo test -j 2`, in
`apps/desktop/src-tauri`): `cargo test --lib energy_models -- --include-ignored`
with `BURETTE_AVOGADRO_XTB_ENERGY` set: 11 passed, including the fixture
package `tests/fixtures/avogadro/energy-plugin` over both protocols (persistent
process, kcal conversion, error frame keeps the session, exit reports stderr,
window ownership), real xtb 6.7.1 GFN2 water (−5.070370761845 Eh, dE/dz(O)
0.002940222116 Eh/bohr) and the real avogadro-xtb-energy GFN2/GFN-FF over
binary-v1; `cargo test --lib avogadro_plugins` 11 passed; `cargo clippy --lib
--tests` without warnings; `cargo fmt --check`. On Gauss after rebasing onto
`parity/integration-main`: `bun run typecheck`, `test:minimizer-core` (14),
`test:workbench-physics` (17 + 5 external-model tests: listing, an optimization
over one session with a frozen atom, radical refusal, Cancel closing the
session, Calculate Energy and the saved external choice, start-line formats),
`test:optimization-reference` (21), `test:structure-edit-controls`,
`test:properties-consumer`, `test:energy-agent` (Ar₂ LJ energy, forces and
optimization at −100/4.184 kcal/mol), `test-geometry-auto-optimize`,
`test-workbench-zmatrix-optimize`, `test:geometry-ui`,
`tests/test-tauri-structure.mjs`, `tests/test-packaged-plugin-mirror.mjs`.

Still open: external models in agent jobs; models without gradients; unit
cells and `pdb` input; coupled Z-matrix optimization with external models; the
packaged desktop acceptance (Optimize and Cancel with GFN2-xTB and a set-up
avogadro-xtb-energy in the app).

### External models: agent jobs, no gradients, unit cells, Z-matrix (2026-11-06)

- **No gradients:** Avogadro's `EnergyCalculator::gradient` falls back to
  `finiteGradient` (central, 2.2e-6). Burette differences with 1e-4 Å, since
  text-v1 energies carry few digits, skips frozen atoms and caps the run at 64
  atoms. A binary-v1 model with `support.batch` (`FLAG_BATCH_MODE` 0x0002, a
  `uint32` count then the coordinate sets) answers the point and its 6N shifts
  in one `energy_model_evaluate_batch` request; others take them one by one.
- **Unit cells:** `ScriptEnergy::setMolecule` refuses a cell unless the model
  declares `support.unit-cell`; Burette does the same and sends the cell as
  CJSON `unitCell` or an XYZ `Lattice`, refusing other input formats. Avogadro's
  LJ and UFF wrap nonbonded pairs with `UnitCell::minimumImage`; Burette's
  Lennard-Jones does, while MMFF94 and UFF (RDKit, without periodic terms)
  refuse a cell, and Automatic picks Lennard-Jones only for unbonded atoms.
- **Coupled Z-matrix:** Avogadro has no coupled Z-matrix optimization. External
  models run it with one evaluation per point: the Cartesian gradient times the
  differenced Jacobian of the placed atoms (`optimizeZmatrixAsync`, gradient
  `chain-rule`), where the worker path needs 2n + 1 energies.
- **Agent jobs:** `energy`, `energy_forces`, `frame_energy_forces` and
  `optimize` accept `xtb:gfn2|gfn1|gfnff` and `avogadro:<package>/<id>`, one
  session per job or frame page. Workbench reads and jobs now also run in
  `desktop-app` sessions, the only runtime that lists external models.

Checks: `cargo test --lib energy_models` on this Mac (11 passed, 1 ignored,
including the fixture batch model). On Gauss: `bun run typecheck`;
`test:workbench-physics` (27, with `test-periodic-energy`);
`test:external-energy-models` (7); `test:energy-agent` (19, with a
differenced batch model in a desktop session); `test:zmatrix-coupled-core`
(39, with `test-zmatrix-chain-rule`); `test:geometry-ui` (58);
`test:properties-agent`; `test:workbench-automation-jobs` (28);
`test:crystal-agent`; `tests/test-burette-agent-cli.mjs`;
`tests/test-tauri-structure.mjs`; `tests/test-ui-shell-contract.mjs`;
`tests/test-packaged-plugin-mirror.mjs`; `tests/test-burette-agent-plugin.mjs`.

Still open: `pdb` input, and the packaged desktop acceptance with real xTB and
Avogadro packages, including an agent job in a desktop session.
