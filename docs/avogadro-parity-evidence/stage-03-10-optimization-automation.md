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
4. **`point_group`** is not registered: its engine (`point-group.ts`, libmsym)
   is not on this branch. The crystals stage registers it through the two steps
   above. `UNSUPPORTED_WORKBENCH_JOB` is pinned for it in
   `test-orbital-cli-compiled` and must change together with that registration.

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
