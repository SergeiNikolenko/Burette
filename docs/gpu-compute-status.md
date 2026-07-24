# Native GPU Compute Layer Implementation Status

Status: all requested workflow families are implemented in the native v20
CPU/Metal layer and exposed through Grid, 3D, table, and report result surfaces. Exact 100k
clustering, all conformer variants, MMFF94/MMFF94s optimization, mapped
alignment/scoring, and all eight semiempirical method identities have focused
CPU/reference and real-Apple-GPU evidence. Clustering, alignment/scoring, and
semiempirical SCF and the complete conformer DG/ETK/MMFF/stereo Metal pipeline
now run in the separately attested compute service rather than the UI process.
A current v20 development package is built,
hash-verified, signed ad hoc, installed, and passes real helper-process
Tanimoto, fixed-pose shape/electrostatic scoring, RM1 SCF, DG embedding, ETK
optimization, MMFF optimization, and stereo-validation dispatches on Apple M2
Pro. Its desktop
process launches from the installed bundle. Production release remains gated on
external Developer ID/notarization credentials and final UI-triggered acceptance
evidence; the current UI inspection attempt was blocked by a locked macOS
session.

Updated: 2026-07-17

Target architecture:
[Native GPU Compute Layer](superpowers/specs/2026-07-15-gpu-compute-platform-design.md)

Acceptance contract:
[GPU Compute Validation And Delivery](superpowers/specs/2026-07-15-gpu-compute-validation-and-delivery.md)

Upstream ledger:
[mlxmolkit Provenance and Adaptation Ledger](third-party/mlxmolkit-provenance.md)

## Current Outcome

Burette now has one complete source-level desktop workflow for molecular
clustering:

1. Grid freezes an immutable selected or all-record molecular snapshot.
2. A bounded package-owned Web Worker computes the pinned RDKit Morgan
   fingerprints.
3. The native coordinator validates every chunk against frozen record identity.
4. A checked memory plan selects native Metal or the deterministic Rust
   reference implementation for blockwise Tanimoto neighbor construction. In a
   packaged app, Metal graph construction runs in the attested compute service;
   the UI coordinator exchanges bounded anonymous files over `SCM_RIGHTS`, with
   per-job capability tokens and exact length/SHA-256 verification.
5. Deterministic CPU Butina assigns clusters and representatives without an
   `N x N` matrix.
6. Burette publishes immutable EnginePack and ResultPack files, commits the
   artifact manifest, and writes typed results back to Grid.
7. Grid exposes `clusterId`, `isRepresentative`, and per-record status/error
   values with analysis filtering.
8. `Export diverse` streams the frozen representative subset from the verified
   MolecularSnapshot and ResultPack into an atomic `SDF/SMI + CSV + provenance`
   bundle without routing molecular arrays through the WebView.
9. Selecting exactly one molecule enables `Find similar` against the latest
   successful clustering snapshot. The coordinator re-verifies the job,
   artifact manifest, ResultPack, EnginePack, packed fingerprints, validity
   map, and frozen record identities before scoring.
10. The exact one-query Tanimoto path runs on native Metal when available under
    the source job policy, or on the deterministic CPU reference with an
    explicit fallback reason. Ranking compares integer intersection/union
    ratios, excludes the query, and uses source record ID as its stable tie
    break.
11. The top 50 matches are written back to Grid as a derived analysis with
    query flag, rank, display similarity, intersection, and union columns.

The ordinary runtime does not require Python or MLX. No `mlxmolkit` source has
been copied into this slice: the fingerprint ABI, exact Tanimoto contract,
Metal kernels, CSR builder, and Butina policy were independently implemented.
The upstream repository remains an attributed reference and future adaptation
source subject to the provenance gate.

The next conformer stage now has stable wire identities for all eight requested
variants and an independent bounded `N x K` batch planner. Its 128-bit seed is
derived from immutable job, molecule-content, variant, conformer, and retry
identity, so changing memory pressure or batch size cannot change the random
stream assigned to a conformer. The planner accounts for the resident
EnginePack, 4D DG positions, work vectors, L-BFGS history, scalar outputs, and
headroom before admitting a batch. A strict `conformer.engine-pack.v1` ABI now
stores molecular topology and all shared DG, chiral, torsion, improper, ETK
distance, and stereo constraints once per molecule in 26 typed canonical
arrays. Manifest validation rejects missing, extra, reordered, misshaped, or
unit-incompatible arrays before execution. The native parameter-extraction
source is packaged as a dedicated, version-locked RDKit WASM adapter. It
accepts a canonical MOL block, selects the exact official preset for all eight
variants, uses RDKit bounds smoothing, CrystalFF torsion/improper data and
embedding chirality helpers, and emits a bounded little-endian binary ABI that
maps directly to the shared EnginePack arrays. It is separate from renderer
MinimalLib and has no Python runtime. The worker-only ES module and WASM pair
are now covered by the vendored asset lock, verified by the native engine
catalog, and bound to the exact RDKit source revision, BCEX ABI, and BMFX ABI.
The 32-case all-variant RDKit/Metal corpus is complete; exact coordinate-stream
identity with upstream is intentionally not an acceptance rule because Burette
replaces its schedule-dependent RNG with immutable identity-derived seeds. The
paired `conformer.result-pack.v2` ABI is defined and
strictly validates ragged coordinate offsets, Cartesian positions, molecule and
conformer identity, DG and ETK status/objective values, stereo failure flags,
embedding attempt counts, MMFF94s energies, explicit optimizer and convergence
status, and the exact 128-bit seed words used for every generated structure.

The frozen conformer corpus now contains 32 packaged-BCEX cases: ethanol,
chiral lactic acid, cyclohexane, and acetamide under all eight supported
variants. Every case decodes and completes the DG/ETK/stereo pipeline on the
v20 Metal runtime on Apple M2 Pro. The hardest chiral DG case requires 23
identity-derived retries; the desktop production request therefore admits 32
of the protocol-bounded maximum 64 attempts.

The extractor ABI now has a bounded binary Web Worker and Rust decoder. The
worker verifies the exported RDKit revision plus BCEX and BMFX versions, emits
raw BCER v2 envelopes through transferable buffers, and never serializes
chemistry arrays as JSON. The Rust path validates every header, count, alignment,
index, numeric domain, and parallel-array length before assembly. A canonical
EnginePack builder then globalizes molecule-local atom indices, preserves
invalid source records with empty offset spans, constructs all seven ragged
offset arrays, and rejects variant, frozen-record-count, `u32` index-range, and
payload-budget mismatches before publication. Chunk application is
transactional, so a rejected or retried chunk cannot duplicate earlier records.
The coordinator freezes the real Grid source, streams bounded MOL-block or
SMILES chunks, accepts raw BCER results, derives exact admission from the
assembled arrays, creates the durable conformer job, and atomically publishes
the validated EnginePack and ResultPack after CPU-reference validation.

The canonical EnginePack distance payload now also has a validated in-memory
core representation. It rejects malformed or non-monotonic offsets,
cross-molecule and non-canonical atom pairs, payload attached to invalid
records, unsupported atomic numbers, inconsistent array lengths, and non-finite
or inverted bounds before a GPU dispatch can be constructed. Valid records are
exposed as molecule-local distance constraints without changing their frozen
global atom identity.

`conformer.execution-plan.v1` fixes the durable stage sequence to scope freeze,
constraint extraction boundary, distance-geometry embedding, stereo
validation, reference validation, and atomic publication. Distance geometry
and stereo validation are both numeric stages: `gpuRequired` rejects either
CPU resolution, while `gpuPreferred` permits only an explicit, reason-bearing
reference fallback. Every stage and partition must cover the same frozen record
count and remain within the request memory limit. Artifact provenance accepts
only this exact stage order.

The first conformer Metal primitive, `burette_conformer_initialize_v1`, now
turns each immutable 128-bit conformer seed into deterministic `float4` initial
coordinates without schedule-dependent RNG state. Its independently written
Rust oracle verifies bounded and prefix-stable output. Both a test-only source
dispatch and the verified production metallib passed on the real Apple GPU with
exact CPU parity. The next Metal primitive evaluates batched normalized
upper-bound and rational lower-bound distance penalties plus analytic `float4`
gradients without atomics or a pair matrix. Its Rust oracle passes upper/lower
known answers and a central-difference gradient check, and the packaged Metal
startup KAT matches the oracle within the fixed floating tolerance. This
formula replaced an early unnormalized squared-bound penalty after parity
inspection found that it did not match the pinned mlxmolkit/nvMolKit
mathematical contract.

A deterministic bounded float32 L-BFGS CPU oracle now drives that distance
objective for one conformer. It has fixed memory history, capped directions,
bounded Armijo backtracking, explicit gradient/step convergence, and distinct
`lineSearchExhausted` and `maxIterations` outcomes. It preserves coordinates
when line search cannot accept a step and produces identical results across
repeated runs. This defines the reference behavior for the fused Metal
optimizer. Runtime v5 added that optimizer: one fixed 32-thread
threadgroup owns each conformer, reuses molecule constraints, evaluates the
objective and gradient by atom gather without atomics or a pair matrix, and
performs bounded L-BFGS plus Armijo backtracking entirely inside one Metal
dispatch. Its public result records the same four explicit convergence outcomes
as the CPU oracle. Runtime v8 additionally binds Metal stereo validation, ETK
energy and analytic-gradient evaluation, and fused ETK L-BFGS refinement. The
ETK objective contains CrystalFF Fourier torsions, improper-angle penalties,
and flat-bottom distance terms. One threadgroup owns one conformer and keeps
the iterative optimizer on the GPU. The CPU reference uses the same objective
and bounded optimizer contract. Runtime v8 binds seven sources, seven reviewed
contracts, AIR files, nine entrypoints, the compiler, linker, SDK, and final
metallib by hash. Runtime v9 adds an independently written batched seven-term
MMFF94/MMFF94s evaluator and bounded central-difference reference-gradient
entrypoint. Runtime v10 adds a fused per-conformer optimizer with
central-difference gradient evaluation, full BFGS for molecules through 32
atoms, bounded L-BFGS for larger molecules, and Armijo line search inside one
Metal dispatch. Its package binds eight sources, eight contracts, eight AIR
files, and twelve entrypoints by hash. Startup KATs compare every term and the
full gradient against the float64 CPU oracle, then require the GPU optimizer to
reduce a known MMFF bond objective before the runtime becomes available.
Runtime v20 replaces the production numerical gradient with local forward-mode
analytic differentiation for all seven terms while retaining the float64 CPU
central difference only as an independent parity oracle.
The pinned native RDKit adapter source also exposes a separate `BMFX` v1 MMFF94/
MMFF94s parameter boundary with partial charges and seven fixed-width term
groups. Its C++ serializer and strict Rust decoder are tested; rebuilding and
vendoring the augmented WASM artifact is complete. The hash-locked packaged
module was executed against `CCO` and returned both `BCEX` and `BMFX` payloads
from the pinned RDKit revision.
The frozen MMFF corpus now covers twelve chemically varied molecules under
both MMFF94 and MMFF94s (24 cases). Pinned RDKit energies, the packaged BMFX
payloads, the float64 CPU evaluator, and the v20 Metal evaluator agree within
`0.002` kcal/mol on CPU and `0.02` kcal/mol on Apple M2 Pro. All 24 Metal
optimizations converge and finish within `0.25` kcal/mol of the independently
minimized RDKit endpoint. This corpus also exposed and fixed an invalid
positivity restriction on signed RDKit out-of-plane coefficients.
A deterministic optimization oracle now selects full BFGS through 32 atoms and
bounded L-BFGS above that threshold. Both paths share Armijo line search,
gradient/step convergence, and distinct line-search/max-iteration outcomes.
The full BFGS update stores the dense inverse Hessian only inside the bounded
small-molecule branch; the large-molecule branch remains linear in atom count.
This is the CPU reference contract used to validate the fused Metal optimizer.
The runtime now composes seed-based initialization and optimization into one
verified per-molecule ensemble operation, keeping both numerical stages on
Metal while sharing constraints across all requested conformers. Its admission
counts caller inputs, Metal buffers, returned host vectors, and transient
history-buffer materialization as simultaneous Apple unified-memory residents;
the adaptive scheduler uses the same seven position-sized buffers and
three-way transient history peak.
This proves the iterative DG distance-bound optimizer, ETK refinement, stereo
evaluation primitives, deterministic stereo-aware retries, and MMFF
optimization primitives. The Grid workflow now exposes every admitted DG/ETDG/
ETKDG variant and applies the selected MMFF94 or MMFF94s profile after ETK. It
retries non-converged structures with a conservative bounded policy,
validates stereochemistry after optimization, publishes explicit unavailable
or non-converged states without false GPU claims, ranks converged structures by
the selected MMFF energy, records the exact variant in XYZ and Grid provenance,
and writes the best converged energy back to Grid.

`Optimize geometry` uses the selected V2000/V3000 coordinates directly, requires
one input geometry per molecule, and never substitutes a generated conformer.
The same bounded BMFX extraction, automatic BFGS/L-BFGS selection, retry, Metal
dispatch, CPU reference validation, ResultPack/XYZ publication, Mol* opening,
and typed Grid writeback are reused. The immutable request, XYZ header, and Grid
analysis record distinguish `inputGeometry` from `generated` execution.

The durable executor now consumes the admitted EnginePack without an `N x N`
allocation, rebuilds the exact adaptive `molecule x conformer` schedule, derives
each seed from immutable job/molecule/variant/conformer/retry identity, and
executes initialization, distance L-BFGS, and ETK L-BFGS on native Metal.
Non-converged distance or ETK results are retried up to the request limit with
a new deterministic retry seed. It records ragged offsets, refined positions,
both energies, attempt count, both statuses, final seed, and actual
command-buffer GPU time. The same executor has a deterministic CPU oracle.
Failed stereochemistry now also triggers a new identity-derived seed and the
full generation/refinement loop up to the request attempt limit. Metal stereo
validation is then repeated as a subsequent durable job stage, and its final
flags must exactly match those produced by the retry loop. Runtime v8 therefore
admits `gpuRequired` for both numeric stages. Reference validation and atomic
EnginePack/ResultPack/XYZ publication are implemented before Grid writeback and
Mol* opening.

The durable reference-validation stage recomputes every final ETK energy with
the CPU evaluator and requires it to match the recorded Metal/CPU result within
the fixed mixed tolerance. It also requires the retry-loop and final stereo
flags to be identical. A mismatch terminates the job with
`ValidationMismatch`; only validated computations advance to `Publishing`.

The durable `JobSnapshot` request is no longer cluster-only. An untagged typed
union accepts normalized `cluster.v1` and `conformer.v1` requests while keeping
the existing on-disk JSON shape unchanged. Snapshot validation dispatches to
the matching fixed execution-plan contract, and a conformer snapshot now
round-trips through JSON with its canonical request and plan hashes. The wire
protocol also has a strict `submitConformerV1` command. Desktop admission now
requires a verified chemistry preflight bound to the frozen library's ordered
molecule-identity hash, with exact record, valid-molecule, atom,
distance-constraint, EnginePack, ResultPack, and accounted numeric peak sizes.
It rejects identity/count swaps, undersized ResultPack
payloads, and any stage above `maxMemoryBytes` before queueing. Distance
geometry and stereo validation receive independent probed backend decisions,
so `gpuRequired` fails if either verified Metal capability is absent and
`gpuPreferred` persists a stage-specific CPU fallback reason. The queued
factory emits canonical request/plan hashes, a revision-one durable conformer
snapshot, and evidence-empty queued stages; the snapshot repository has the
matching capability-rooted conformer source binding. Chemistry extraction,
DG/ETK/stereo execution, reference validation, and artifact publication are
wired. Restart recovery for unpublished in-flight prepared arrays remains
fail-closed; Grid, 3D, table, and durable Markdown report presentation are
implemented.

## Product Truth By Surface

| Surface | Current truth |
| --- | --- |
| macOS desktop source build | `Cluster selected`, `Cluster filtered`, `Cluster all`, immutable `Export diverse`, and exact `Find similar` are wired end to end in Grid |
| Native CPU backend | Implemented and used as the deterministic reference/fallback backend |
| Native Metal backend | Real graph, exact query, conformer initialization, fused DG/ETK L-BFGS, stereo-aware retry, final validation, seven-term MMFF evaluation, fused automatic BFGS/L-BFGS MMFF optimization, and mapped Horn/RMSD/shape/ESP scoring on Apple M2 Pro |
| Packaged development Metal | `Burette-gpucompute9a97v27.app` is installed at `/Users/nikolenko/Applications/Burette-gpucompute9a97v27.app`; it was clean-built from commit `84c019d7`, packages the hash-bound v20 runtime and one arm64 helper under `Contents/Helpers`, and passes helper handshake, runtime/helper SHA binding, replay rejection, one-shot transport recovery, real FD-based Tanimoto, alignment/shape/electrostatic, all eight semiempirical methods, DG, ETK, MMFF, stereo, the 32-case conformer corpus, and deep/strict ad-hoc signature verification on Apple M2 Pro |
| Packaged production Metal | Pending external Developer ID signing, hardened-runtime verification, notarization, and UI-triggered installed-app acceptance evidence |
| Browser development | Compute is explicitly reported unavailable; it never claims Metal execution |
| Finder Quick Look | Read-only rendering remains unchanged; no compute commands are granted |
| iPhone source app | Rendering remains unchanged; no macOS Metal compute workflow is exposed |
| Agent/plugin surface | Durable compute contracts exist internally, but no new public agent tool is released in this slice |

The implementation machine now has Metal Toolchain 27A5209h installed for
Xcode 27 beta. Its default `xcode-select` still points to Command Line Tools, so
package builds must either select full Xcode or pass
`DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`. The package
build regenerates the reviewed runtime inside its isolated build tree and fails
closed if `metal` or `metallib` cannot execute. Runtime source compilation
remains test-only and is not accepted as production availability.

## Implemented User Scenario

Grid now provides a molecular clustering control with a Tanimoto cutoff and
scope derived from the current selection and filters:

- selected rows take precedence and produce an explicit, sorted, deduplicated
  source-index scope;
- with no selected rows, active text, column, descriptor, and analysis filters
  produce an immutable filtered scope;
- with neither a selection nor active filters, the immutable all-record scope
  is used;
- progress distinguishes fingerprinting, similarity/clustering, and
  publication;
- the active control becomes `Cancel clustering`; cancellation terminates the
  RDKit worker, closes the durable job and any running stage/attempt as
  `Cancelled`, and discards prepared in-memory compute buffers;
- completion reports `Metal GPU` only when the durable numeric stage records
  `nativeMetal`; every other completed execution reports `reference CPU`;
- a completed run refreshes Grid and exposes typed analysis values;
- individual fingerprint failures remain visible and are excluded from the
  graph rather than silently converted into valid molecules;
- `Export diverse` resolves the latest successful clustering job, asks for a
  destination folder, and publishes a unique immutable bundle containing every
  representative in `representatives.csv`, structurally serializable records in
  `representatives.sdf` and/or `representatives.smi`, and `provenance.json` with
  the source snapshot, job, artifact manifest, payload hashes, and execution
  trace. IDCode-only or whitespace-bearing SMILES records remain losslessly
  represented in the table instead of making the whole export fail.
- `Find similar` requires exactly one selected query and a successful cluster
  analysis for the current Grid. It searches that frozen clustering scope at
  the selected cutoff, returns at most 50 exact matches, excludes the query,
  reports `Metal GPU` only for a native Metal execution, and refreshes Grid with
  `isSimilarityQuery`, `similarityRank`, `similarityToQuery`,
  `tanimotoIntersection`, and `tanimotoUnion`.

The similarity operation is deliberately a derived immutable Grid analysis
over the successful `cluster.v1` EnginePack. It references that artifact as
`fingerprintSource`; it does not emit a second standalone JobSnapshot,
ResultPack, or duplicate fingerprint payload. Consequently it searches the
frozen scope of that clustering job, which may be a selected subset rather than
the entire current collection.

Every successful clustering, conformer/MMFF, alignment, and semiempirical
publication now includes a hash-verified `result/report.md` in the committed
artifact. The report records the durable job, workflow, frozen snapshot,
normalized request digest, workflow-specific counts, and actual per-stage
backend, kernel, GPU time, and host time. Desktop Grid workflows open the
report as a background text document while keeping Grid or Mol* as the active
result. A generic low-level binary-array artifact inspector remains a separate
product increment; it is no longer required to read the user-facing report.

## Owning Modules

| Responsibility | Primary source |
| --- | --- |
| Fixed request/job/artifact contracts | `crates/burette-compute-protocol/` |
| Exact fingerprint ABI, CPU Tanimoto/CSR, Butina | `crates/burette-compute-core/` |
| Metal runtime, tiling, dispatch, GPU timings | `crates/burette-compute-metal/` |
| Reviewed Metal kernels | `compute/metal/tanimoto.v2.metal`, `compute/metal/conformer-initialize.v1.metal`, `compute/metal/conformer-distance.v1.metal`, `compute/metal/conformer-optimize.v1.metal`, `compute/metal/conformer-stereo.v1.metal`, `compute/metal/conformer-etk.v1.metal`, `compute/metal/conformer-etk-optimize.v1.metal`, `compute/metal/mmff-energy.v1.metal` |
| Frozen source verification and RDKit chunk sessions | `apps/desktop/src-tauri/src/compute/fingerprint_session.rs` |
| Durable job execution and lifecycle | `apps/desktop/src-tauri/src/compute/coordinator.rs`, `job_lifecycle.rs` |
| Attested helper control/data plane and clustering/alignment/semiempirical dispatch | `apps/desktop/src-tauri/src/compute/service.rs`, `crates/burette-compute-protocol/src/control/worker.rs` |
| Conformer preflight admission and queued snapshot | `apps/desktop/src-tauri/src/compute/conformer_plan.rs`, `job_factory.rs` |
| Conformer extractor validation and canonical array assembly | `apps/desktop/src/lib/conformer-extractor.ts`, `crates/burette-compute-core/src/conformer_extract.rs`, `conformer_pack.rs` |
| Packaged conformer extraction and raw submission | `compute/rdkit-conformer/`, `apps/desktop/src/workers/conformer-extract.worker.ts`, `apps/desktop/src/lib/compute-conformer.ts`, `apps/desktop/src-tauri/src/compute/conformer_session.rs` |
| Adaptive CPU/Metal conformer distance execution | `apps/desktop/src-tauri/src/compute/conformer_executor.rs`, `coordinator.rs` |
| Artifact materialization and restart reconciliation | `apps/desktop/src-tauri/src/compute/artifact_publisher.rs` |
| Human-readable compute reports | `apps/desktop/src-tauri/src/compute/artifact_publisher.rs`, `apps/desktop/src/hooks/use-app-grid-compute-messages.ts`, `use-app-grid-conformer-messages.ts` |
| Immutable representative export and provenance | `apps/desktop/src-tauri/src/compute/representative_export.rs` |
| Verified fingerprint reuse and exact similarity ranking | `apps/desktop/src-tauri/src/compute/similarity_artifact.rs`, `similarity_search.rs` |
| Grid analysis writeback/readback | `apps/desktop/src-tauri/src/preview/grid_analysis.rs`, `grid_store.rs` |
| RDKit Web Worker and desktop workflow | `apps/desktop/src/workers/cluster-fingerprint.worker.ts`, `apps/desktop/src/lib/compute-cluster.ts` |
| Grid bridge and controls | `apps/desktop/src/hooks/use-app-grid-compute-messages.ts`, `PreviewExtension/Web/grid-viewer.js` |

## Validation Completed In This Slice

- 382 desktop library tests pass, including the real Grid-to-artifact
  workflows, durable alignment/semiempirical artifacts, helper exchange ABI,
  conformer DG/ETK/MMFF/stereo codecs, and representative export before and
  after coordinator restart. Six manual
  real-GPU tests are kept ignored by default.
- The deterministic v20 benchmark handles an exact 100,000-fingerprint query
  in 1--2 ms GPU time and constructs a 100,000-vertex sparse exact CSR in
  27.6 seconds GPU time on Apple M2 Pro without a dense matrix. Dynamic-count
  Butina over that CSR takes 66 ms after replacing the quadratic representative
  scan with a deterministic lazy priority queue. A separate 10,000-record,
  5,000-edge case exercises count plus fill in 526 ms GPU time. Exact cutoff
  boundary parity, a dense 512-record/130,816-edge fill, and rejection before
  fill under a 16 MiB unified-memory limit also pass. Full evidence and commands
  are in `docs/benchmarks/apple-m2-pro-v20.md`.
- Metal crate unit/parity tests pass, including real graph and exact query-count
  dispatches on the local 19-core Apple M2 Pro GPU reported with Metal 4
  support.
- The current `Burette-gpucompute9a97v27.app` development package was rebuilt
  from clean detached commit `84c019d7` in an isolated tree. The build boundary
  now excludes ephemeral `.codegraph` state. Deep/strict ad-hoc signature
  verification passes for the
  app, its single packaged compute helper, and nested extensions. The helper
  reports Apple M2 Pro, binds its own SHA-256 into the runtime identity, rejects
  replayed control requests, automatically relaunches once after a killed helper,
  and completes the exact known-answer Tanimoto graph,
  fixed-pose shape/electrostatic scoring, converged RM1 water SCF, MMFF94,
  two-conformer DG, ETK distance optimization, and chiral validation through
  the anonymous-FD exchange. Each operation reports real nonzero Apple GPU
  time. Direct installed-bundle smokes additionally pass all eight
  semiempirical method identities, reordered Grid alignment, adaptive conformer
  batching, and the 32-case all-variant RDKit conformer corpus. The signed
  helper SHA-256 is
  `c758554beb3e78fefe05d43d2c511ed328f69cbc3a7b3d58dcd4874e4923ee8e`. The
  isolated app is installed under `/Users/nikolenko/Applications`; visible Grid
  invocation and UI-triggered compute acceptance remain separate gates because
  the current Computer Use attempt found the macOS session locked.
- The bounded agent-browser smoke renders `samples/collections/sdf/multi.sdf`
  as two RDKit cards, selects ethanol, reports `2 molecules / 1 selected`, and
  exposes the seven-atom/two-component Inspector. This verifies the Grid
  collection surface only. The shell explicitly reports that the native app
  bundle, installer, and Quick Look registration are inactive, so this result
  is not counted as installed-app or Metal UI acceptance.
- The packaged runtime is `burette-native-metal-v20`, generation
  `generation.qxCQYr`, with `native-compute.v20.metallib` SHA-256
  `341d858756cfd33438304e0d643d4ad647081df7678f88e407cc2734e87a2c84`.
  The canonical runtime pointer, metadata digest, metallib digest, source/AIR
  manifest, and startup known-answer suite all verify before Metal is reported
  available.
- `bun run check:release` passes. The development package deliberately has an
  ad-hoc signature and no TeamIdentifier, so the release-signature gate
  correctly rejects it until a Developer ID Application identity is supplied.
  The current keychain contains two Apple Development identities and no
  Developer ID Application identity, so hardened distribution signing and
  notarization cannot be claimed from this machine.
- The pinned RDKit 2025.03.4 runtime reproduces four frozen Morgan
  known-answer vectors byte for byte, and Rust decodes the same vectors through
  the canonical EnginePack ABI.
- A SHA-pinned fixture from mlxmolkit commit
  `9e7337f6f93c40a39ad0187991151944a4f1e274` now exercises the native SCF
  evaluator against 12 PYSEQM known answers: H2, H2O, CH4, and NH3 with RM1,
  AM1, and full PM6. Electronic, nuclear, and total energies all pass the
  upstream `0.001 eV` absolute threshold without Python or MLX at test or
  production runtime.
- Desktop Rust clippy passes with warnings denied.
- The production web bundle builds with the dedicated RDKit worker and pinned
  WASM asset.
- Tauri ACL, shell bridge, generated Grid UI, JavaScript syntax, and clustering
  and similarity workflow contract checks pass.
- Focused durable workflow tests verify that clustering, conformer/MMFF, and
  semiempirical artifacts contain a `computeReport` file, that its path remains
  inside the committed artifact, and that the report contains the expected
  workflow summary. Frontend contract tests require those reports to open as
  background text documents after successful Grid operations.
- The real Grid-to-artifact coordinator test executes similarity search through
  the CPU fallback, verifies exact ranking and all five Grid columns, repeats
  after coordinator restart, preserves clustering results, and rejects a
  corrupted fingerprint payload.
- The desktop production web bundle builds with the `Find similar` bridge and
  generated Grid controls. Repository-wide TypeScript checking is currently
  blocked by pre-existing duplicate CodeMirror dependency identities in the
  text-file viewer; the errors do not involve the compute files changed here.
- All 75 protocol tests and 40 compute-core tests pass after adding the fixed
  conformer request/pack/plan contracts, validated EnginePack distance view,
  identity-derived seed, adaptive batch
  coverage, deterministic coordinate oracle, DG objective/gradient oracle,
  finite-difference gradient validation, rebatching invariance, and memory
  rejection checks. Focused protocol/core/Metal clippy also passes with warnings
  denied.
- Twenty-one focused desktop conformer tests pass, including independent GPU
  admission for both numeric stages, honest mixed-backend fallback, bounded
  preflight/result memory rejection, canonical queued snapshot construction,
  BMFX decoding, MMFF94s CPU execution and retry, ResultPack v2/Grid writeback,
  and the existing process-boundary conformer safeguards.
- The pinned RDKit extractor was rebuilt with Emscripten 4.0.10 from exact RDKit
  commit `276b5a662302c6a548ac4f1363c066f3258e3a20`. Its exported revision and
  BCEX/BMFX ABIs were executed directly from the packaged artifacts; `CCO`
  produced `BCEX` and `BMFX` payloads of 1,568 and 3,040 bytes. The packaged JS
  SHA-256 is
  `ccf362fdb1f8077d7015a4f851a3ac2cb230132ab961a2876d43152d707a4882`; the
  WASM SHA-256 is
  `8ba8ab76a9aa31c0ee02f9e50fdcd4078520b882d6a98cb254a165775348a589`.
- The raw Grid submission integration test continues through deterministic
  reference execution, covering six conformers, CPU-reference validation,
  atomic EnginePack/ResultPack publication, manifest readback, and durable job
  completion.
- The adaptive executor passed a manual real-GPU smoke on `Apple M2 Pro`
  (`registryId=0x1000003c0`, unified memory): two conformers completed through
  the verified v5 runtime with `gpuTimeMs=4` and metallib SHA-256
  `52e15c9544f0b33cbfd62379ac96d88f75983b1187cc570fd773aeff93c527aa`.
- The verified v8 runtime passed all packaged startup known-answer tests and an
  executor smoke on the same `Apple M2 Pro`. Two four-atom conformers with
  non-empty torsion, improper, and ETK distance terms completed through Metal
  initialization, DG L-BFGS, ETK L-BFGS, and stereo validation. The combined
  generation/DG/ETK/retry-validation GPU time was `8 ms`; final stereo
  validation was `1 ms`. The tested
  `native-compute.v8.metallib` SHA-256 is
  `fd9c0d16d1cf2affc6020026e8f2718dbe1b5ac5a563c2a5f9bb4f0858d5d79a`.
- The verified v9 runtime adds all seven MMFF terms and its numerical reference
  gradient to the startup CPU/Metal KAT. It loaded and dispatched on `Apple M2
  Pro` (`registryId=0x1000003c0`, unified memory); the tested
  `native-compute.v9.metallib` SHA-256 is
  `cfa70ec563965f5e98df6d178fdb7e8e3172ba4b7e59965dfc495402315d2521`.
- The verified v10 runtime adds fused MMFF optimization with automatic BFGS or
  L-BFGS selection and an energy-reduction startup KAT. It loaded and dispatched
  on `Apple M2 Pro` (`registryId=0x1000003c0`, unified memory); the tested
  `native-compute.v10.metallib` SHA-256 is
  `84d3d2cf0c31c09e87abe97d7455acd498b204b1bb27109a246be22b47c76a56`.
- The verified v20 runtime replaces the production MMFF numerical gradient with
  analytic forward-mode differentiation over local terms. The seven-term KAT
  matches the float64 CPU central-difference oracle within
  `0.005 kcal/(mol angstrom)`, and fused BFGS reaches the known bond minimum on
  `Apple M2 Pro`. The tested `native-compute.v20.metallib` SHA-256 is
  `341d858756cfd33438304e0d643d4ad647081df7678f88e407cc2734e87a2c84`.
- The verified v11 runtime adds mapped Horn/quaternion alignment, weighted RMSD,
  analytic Gaussian shape Tanimoto/Carbo, and ESP-Sim Carbo/Tanimoto scoring.
  Its startup KAT recovers a known proper transform and matches the independent
  float64 CPU oracle on `Apple M2 Pro` (`registryId=0x1000003c0`, unified
  memory). The tested `native-compute.v11.metallib` SHA-256 is
  `e38da4f671a12a0d31bf8f68b55c77716dad646ca8c987a0fc24d4b2fca09c85`.
- The desktop Grid exposes `Align & compare` for 2--256 selected 3D poses.
  The lowest selected source index is the reference. V2000 and V3000 probes are
  deterministically remapped by exact element, formal-charge, bond-order, and
  adjacency isomorphism, so identical molecules may use different atom orders;
  non-isomorphic structures are rejected. The command dispatches the bounded
  Metal batch, rejects CPU/Metal parity drift, writes RMSD, shape
  Tanimoto, optional electrostatic Carbo, and combined similarity back to the
  current Grid identity, then opens an aligned SDF ensemble in Mol*. It selects
  the highest-priority newest semiempirical charge run that covers every pose
  (`PM6_D3H4`, `PM6_D`, `PM6`, `RM1`, `PM6_SP`, `AM1*`, `PM3`, then `AM1`),
  with exact atom-count validation. If no complete run exists, it uses molfile
  formal charges; all-zero inputs report electrostatics as unavailable. A real
  Grid-to-Metal smoke on Apple M2 Pro passes with a non-identity atom order.
- The desktop Grid now also exposes a persistent method selector and native
  `energy & charges` action for RM1, full variable-basis PM6/PM6_D,
  PM6_D3H4, complete upstream-domain AM1, PM3, and PM6_SP, plus CHNO AM1*
  over 1--256 selected
  molecules with explicit coordinates.
  Each method writes to its own Grid columns so runs do not overwrite another
  method's electronic, nuclear, and total energies, SCF status/iterations, or
  JSON atomic charges. The frozen Grid lease is parsed without Python/MLX.
  Runtime v20 contracts the dominant
  two-center Coulomb/exchange Fock contribution on Metal for every SCF
  iteration and diagonalizes matrices through order 32 with a batched Metal
  Jacobi kernel. It also generates all compact H-H, heavy-H, and 22-term
  heavy-heavy local pair integrals, rotates them, and materializes
  complete repulsion/core-attraction tensors on Metal. Every GPU result is checked against the float64 CPU reference;
  trace-shift/spectral preconditioning controls float32 error, and the SCF tail
  switches adaptively to float64 polishing at the precision floor. The Grid
  reports `nativeMetalScfHybrid` only after at least one verified GPU dispatch.
  SCF orchestration and adaptive float64 polishing remain CPU. Unavailable
  Metal or all-invalid input remains `nativeCpuReference`.
- The verified v20 runtime includes `burette_rm1_pair_fock_v1`. One thread owns one
  Fock-matrix element and accumulates pair tensors in deterministic order with
  no atomics. It adds `burette_rm1_symmetric_eigen_v1`, with one threadgroup per
  admitted matrix. It adds `burette_rm1_pair_rotate_v1`, with one thread per
  H-H, heavy-H, or heavy-heavy atom pair. It also adds the batched
  `burette_pm6_h4_hh_v1` and full Z=1--94 `burette_pm6_d3_v2` correction kernels,
  with one independent molecule per GPU thread and mandatory float64 parity
  for all three output terms. Runtime v17 also adds the 45-thread-per-block
  `burette_pm6_one_center_fock_v1` kernel with mandatory full-matrix CPU
  parity. Runtime v18 adds `burette_pm6_pair_fock_v1` for exact 1/4/9-orbital
  tensor strides and full variable-basis SCF. The package binds sixteen
  sources, sixteen contracts, sixteen AIR files, and twenty entrypoints.
  Startup, one- and two-center PM6 Fock, two-molecule D3/H4/HH,
  explicit-water, and full-d H2S Grid KATs passed on
  `Apple M2 Pro` (`registryId=0x1000003c0`, unified memory); the tested
  `native-compute.v20.metallib` SHA-256 is
  `341d858756cfd33438304e0d643d4ad647081df7678f88e407cc2734e87a2c84`.
- The native closed-shell NDDO oracle now has separate AM1, PM3, PM6_SP, and
  AM1* parameter packs instead of method aliases. AM1, PM3, and PM6_SP cover
  their complete pinned 11-, 25-, and 10-element upstream domains; AM1* is the
  published CHNO model. PM6-family nuclear
  repulsion uses its distinct PWCCT equation. The complete pinned 83x83 CSV is
  compiled into 674 nonzero symmetric native pair records with SHA-gated
  generation; no runtime CSV parser is required. At the
  pinned mlxmolkit commit, explicit-water total energies and oxygen charges
  match all four upstream method paths within `1e-4 eV` and `1e-5 e`.
  Grid method selection is implemented for all eight method identities. H4/HH
  have CPU and Metal reference paths, and the complete pinned Z=1--94 D3 table
  is compiled into 8,836 ordered pairs and 64,516 reference records for native
  CPU and Metal execution. PM6_D is the full-d PM6 identity; PM6_D3H4 adds the
  density-independent D3/H4/HH energy correction after SCF. The
  complete pinned 40-element PM6 parameter domain is compiled into a typed
  native table, including 18 d-basis elements and all tail/Slater-Condon
  fields. The 243-term PM6 one-center W integral table is also generated
  natively from 11 Slater-Condon radial parameters and matches pinned sulfur
  and iron oracles. Its 45-output packed-density Fock contraction now produces
  a complete symmetric 9x9 native CPU block with pinned matrix parity.
  Proper 3x3 bond-frame rotations now produce parity-checked real-harmonic
  5x5 Wigner matrices and d-d/d-p/d-s overlap blocks. A bounded 48-point
  prolate-spheroidal STO oracle now supplies d-s, d-p, and d-d radial overlap
  for principal quantum numbers one through five, including iodine and the
  hydrogen s-only boundary. The transition-metal/main-group AIJL,
  Slater-Condon, and POIJ derivation now supplies d-basis charge separations
  and `rho3` through `rho6` for all 18 parameterized d elements, with S/Fe/I
  parity against the pinned PYSEQM port. The first complete two-center d
  branch now produces the rotated 9x9 `(mu nu | ss)` YH matrix and both
  electron-core terms for a d-basis atom paired with hydrogen; arbitrary-axis
  sulfur-hydrogen parity is pinned at `2e-10`. The 450-entry local YX tensor
  for a d-basis/sp-only pair is now mechanically generated from a SHA-pinned
  PYSEQM AST; sulfur-oxygen selected entries, sparsity, and aggregate parity
  pass at `2e-10`. Its pair-basis transform now produces the dense molecular
  `9x9x4x4` d extension and matches the full arbitrary-axis PYSEQM tensor after
  excluding the separately owned sp block. The same SHA-gated generator now
  produces the 2025-entry local YY tensor for two d-basis atoms. Native packed
  pair rotation expands it into the dense molecular `9x9x9x9` d extension;
  sulfur-sulfur local parity covers 398 nonzero entries, while an arbitrary-axis
  tensor covers 6305 nonzero entries and matches the complete pinned oracle
  aggregate. Native YX/YY d-extension electron-core contractions now include
  the PM6 transition-metal `rho_core` override and match arbitrary-axis S-O,
  S-S, and Fe-Fe PYSEQM values. The separately owned sp core block, Metal W
  is now merged with the d extension in a variable-basis PM6 pair pack for
  1-, 4-, and 9-orbital atoms, with a general two-center Fock contraction.
  PM6 now truthfully selects the full d basis while PM6_SP remains sp-only.
  Full variable-basis CPU SCF assembly now combines neutral-atom initialization,
  adaptive damping/DIIS, sp+d overlap, one- and two-center Fock terms, and the
  complete PWCCT nuclear energy. H2S electronic/nuclear energies and all atomic
  charges match the pinned PM6_D oracle. Metal one- and two-center contraction
  plus the bounded eigensolver now run the same full-d H2S Grid path on M2 Pro
  with per-dispatch CPU parity. The same v20 Grid path dispatches full
  PM6_D3H4 corrections on Metal and prevents double application by keeping the
  correction outside the density, charges, electronic, and nuclear terms.
- Restart tests preserve valid published artifacts, remove canonical orphans,
  reject unknown artifact entries, and disable compute after artifact
  corruption.

These checks prove the source implementation, the current v20 hash-bound Metal
runtime, the 100k/dense/memory-pressure benchmark gates, and a current installed
ad-hoc development package. They do not claim a Developer ID production
signature, notarization, or UI-triggered installed-app acceptance run.

## Remaining Implementation And Production Gates

1. Complete the required M1-class 8 GB and M3/M4 Max 64 GB hardware matrix in
   addition to the current M2 Pro evidence.
2. Exercise clustering, conformer generation, optimization, alignment, and
   semiempirical evaluation through the actual installed Grid controls and
   capture the visible backend labels, columns, 3D outputs, and artifacts.
3. Build with Developer ID and hardened runtime, then notarize and verify the
   nested and outer production signatures without changing the pinned runtime.
4. Extend scientific corpora when new upstream/reference releases are pinned;
   current deterministic, RDKit, mlxmolkit, PYSEQM/OpenMOPAC, CPU/Metal, dense,
   cutoff-boundary, and memory-pressure gates remain required in CI.

## Next Implementation Order

1. run the installed-app and hardware acceptance matrices;
2. sign with Developer ID, verify hardened runtime, notarize, and publish the
   v20 benchmark and scientific-parity evidence with the release.
