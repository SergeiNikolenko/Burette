# Native GPU Compute Layer Implementation Status

Status: `cluster.v1`, immutable representative export, and derived exact
`Find similar` Grid analysis complete at source level; deterministic conformer
variant/seed/adaptive batching, packaged native RDKit extraction, raw job
submission, adaptive CPU/Metal distance-geometry execution, Metal ETK
refinement, stereo-aware retry, and final Metal stereo validation implemented;
conformer EnginePack/ResultPack publication and Grid-to-Mol* workflow
implemented; selectable MMFF94/MMFF94s extraction, CPU/Metal optimization, retry,
energy-ranked ResultPack v2/XYZ publication, Grid writeback, and standalone
input-coordinate geometry optimization implemented;
production release, scientific-corpus parity, and scale proof pending

Updated: 2026-07-16

Target architecture:
[Native GPU Compute Layer](superpowers/specs/2026-07-15-gpu-compute-platform-design.md)

Acceptance contract:
[GPU Compute Validation And Delivery](superpowers/specs/2026-07-15-gpu-compute-validation-and-delivery.md)

Upstream ledger:
[mlxmolkit Provenance and Adaptation Ledger](third-party/mlxmolkit-provenance.md)

## Current Outcome

Burrete now has one complete source-level desktop workflow for molecular
clustering:

1. Grid freezes an immutable selected or all-record molecular snapshot.
2. A bounded package-owned Web Worker computes the pinned RDKit Morgan
   fingerprints.
3. The native coordinator validates every chunk against frozen record identity.
4. A checked memory plan selects native Metal or the deterministic Rust
   reference implementation for blockwise Tanimoto neighbor construction.
5. Deterministic CPU Butina assigns clusters and representatives without an
   `N x N` matrix.
6. Burrete publishes immutable EnginePack and ResultPack files, commits the
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
Broader RDKit/upstream fixtures and packaged UI proof remain incomplete. The
paired `conformer.result-pack.v2` ABI is defined and
strictly validates ragged coordinate offsets, Cartesian positions, molecule and
conformer identity, DG and ETK status/objective values, stereo failure flags,
embedding attempt counts, MMFF94s energies, explicit optimizer and convergence
status, and the exact 128-bit seed words used for every generated structure.

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

The first conformer Metal primitive, `burrete_conformer_initialize_v1`, now
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
entrypoint. Runtime v10 adds a fused per-conformer optimizer that keeps
central-difference gradient evaluation, full BFGS for molecules through 32
atoms, bounded L-BFGS for larger molecules, and Armijo line search inside one
Metal dispatch. Its package binds eight sources, eight contracts, eight AIR
files, and twelve entrypoints by hash. Startup KATs compare every term and the
full gradient against the float64 CPU oracle, then require the GPU optimizer to
reduce a known MMFF bond objective before the runtime becomes available.
The pinned native RDKit adapter source also exposes a separate `BMFX` v1 MMFF94/
MMFF94s parameter boundary with partial charges and seven fixed-width term
groups. Its C++ serializer and strict Rust decoder are tested; rebuilding and
vendoring the augmented WASM artifact is complete. The hash-locked packaged
module was executed against `CCO` and returned both `BCEX` and `BMFX` payloads
from the pinned RDKit revision.
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
admits `gpuRequired` for both numeric stages. Publication remains a separate
unfinished stage, so no completed user-facing conformer claim is made yet.

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
wired; restart recovery for in-flight prepared arrays and Grid/3D presentation
remain in progress.

## Product Truth By Surface

| Surface | Current truth |
| --- | --- |
| macOS desktop source build | `Cluster all`, `Cluster selected`, immutable `Export diverse`, and exact `Find similar` are wired end to end in Grid |
| Native CPU backend | Implemented and used as the deterministic reference/fallback backend |
| Native Metal backend | Real graph, exact query, conformer initialization, fused DG/ETK L-BFGS, stereo-aware retry, final validation, seven-term MMFF evaluation, fused automatic BFGS/L-BFGS MMFF optimization, and mapped Horn/RMSD/shape/ESP scoring on Apple M2 Pro |
| Packaged development Metal | The earlier cluster-only v1 app package is proven; the current v11 runtime generation passes package verification and real-GPU startup, while a refreshed v11 desktop package remains pending |
| Packaged production Metal | Pending Developer ID signing, hardened-runtime verification, notarization, scientific-corpus parity, and installed-app UI evidence |
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
scope derived from the current selection:

- no selected rows means the immutable all-record scope;
- selected rows produce an explicit, sorted, deduplicated source-index scope;
- progress distinguishes fingerprinting, similarity/clustering, and
  publication;
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

Filtered-scope clustering and a public artifact/report inspector remain
separate product increments.

## Owning Modules

| Responsibility | Primary source |
| --- | --- |
| Fixed request/job/artifact contracts | `crates/burrete-compute-protocol/` |
| Exact fingerprint ABI, CPU Tanimoto/CSR, Butina | `crates/burrete-compute-core/` |
| Metal runtime, tiling, dispatch, GPU timings | `crates/burrete-compute-metal/` |
| Reviewed Metal kernels | `compute/metal/tanimoto.v2.metal`, `compute/metal/conformer-initialize.v1.metal`, `compute/metal/conformer-distance.v1.metal`, `compute/metal/conformer-optimize.v1.metal`, `compute/metal/conformer-stereo.v1.metal`, `compute/metal/conformer-etk.v1.metal`, `compute/metal/conformer-etk-optimize.v1.metal`, `compute/metal/mmff-energy.v1.metal` |
| Frozen source verification and RDKit chunk sessions | `apps/desktop/src-tauri/src/compute/fingerprint_session.rs` |
| Durable job execution and lifecycle | `apps/desktop/src-tauri/src/compute/coordinator.rs`, `job_lifecycle.rs` |
| Conformer preflight admission and queued snapshot | `apps/desktop/src-tauri/src/compute/conformer_plan.rs`, `job_factory.rs` |
| Conformer extractor validation and canonical array assembly | `apps/desktop/src/lib/conformer-extractor.ts`, `crates/burrete-compute-core/src/conformer_extract.rs`, `conformer_pack.rs` |
| Packaged conformer extraction and raw submission | `compute/rdkit-conformer/`, `apps/desktop/src/workers/conformer-extract.worker.ts`, `apps/desktop/src/lib/compute-conformer.ts`, `apps/desktop/src-tauri/src/compute/conformer_session.rs` |
| Adaptive CPU/Metal conformer distance execution | `apps/desktop/src-tauri/src/compute/conformer_executor.rs`, `coordinator.rs` |
| Artifact materialization and restart reconciliation | `apps/desktop/src-tauri/src/compute/artifact_publisher.rs` |
| Immutable representative export and provenance | `apps/desktop/src-tauri/src/compute/representative_export.rs` |
| Verified fingerprint reuse and exact similarity ranking | `apps/desktop/src-tauri/src/compute/similarity_artifact.rs`, `similarity_search.rs` |
| Grid analysis writeback/readback | `apps/desktop/src-tauri/src/preview/grid_analysis.rs`, `grid_store.rs` |
| RDKit Web Worker and desktop workflow | `apps/desktop/src/workers/cluster-fingerprint.worker.ts`, `apps/desktop/src/lib/compute-cluster.ts` |
| Grid bridge and controls | `apps/desktop/src/hooks/use-app-grid-compute-messages.ts`, `PreviewExtension/Web/grid-viewer.js` |

## Validation Completed In This Slice

- 66 focused desktop compute tests pass, including the real Grid-to-artifact
  workflow and representative export before and after coordinator restart.
- 32 Grid store tests pass; the 50,000-row performance smoke remains opt-in.
- Metal crate unit/parity tests pass, including real graph and exact query-count
  dispatches on the local 19-core Apple M2 Pro GPU reported with Metal 4
  support.
- An isolated offline-compiled v5 runtime generation passes the hash-bound
  package verifier and all five startup known-answer paths on `Apple M2 Pro`
  (`registryId=0x1000003c0`, unified memory). The paths cover graph CSR, exact
  query, conformer initialization, DG objective/gradient evaluation, and fused
  DG L-BFGS optimization. The tested `native-compute.v5.metallib` SHA-256 is
  `52e15c9544f0b33cbfd62379ac96d88f75983b1187cc570fd773aeff93c527aa`.
- The earlier unique `com.local.BurreteV10.Dev.gpucompute9a97` cluster-only v1
  package builds and passes
  deep/strict ad-hoc signature verification at
  `build/Burrete-gpucompute9a97.app`.
- That v1 package's `generation.OFdUGZ` metadata SHA-256 is
  `d2d89932677282987c8bfeb7092205b97f2bbad57342afe55a51967975eaf72b`;
  the pinned metallib SHA-256 is
  `fbbf5940ab1925a67ccb382d5cd229ce97086ac60535d30d20f8955c4df13af7`.
- Loading those exact v1 packaged bytes executes the startup known-answer graph on
  the real `Apple M2 Pro` Metal device (`registryId=0x100000444`, unified
  memory) and matches the CPU reference.
- The real desktop process opened `samples/collections/smiles/multi.smi` as a
  ready `grid2d` document with no reported workspace errors. The Mac locked
  before visual canvas inspection and UI-triggered clustering, so those two
  checks remain explicitly pending.
- The pinned RDKit 2025.03.4 runtime reproduces four frozen Morgan
  known-answer vectors byte for byte, and Rust decodes the same vectors through
  the canonical EnginePack ABI.
- Desktop Rust clippy passes with warnings denied.
- The production web bundle builds with the dedicated RDKit worker and pinned
  WASM asset.
- Tauri ACL, shell bridge, generated Grid UI, JavaScript syntax, and clustering
  and similarity workflow contract checks pass.
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
- The verified v11 runtime adds mapped Horn/quaternion alignment, weighted RMSD,
  analytic Gaussian shape Tanimoto/Carbo, and ESP-Sim Carbo/Tanimoto scoring.
  Its startup KAT recovers a known proper transform and matches the independent
  float64 CPU oracle on `Apple M2 Pro` (`registryId=0x1000003c0`, unified
  memory). The tested `native-compute.v11.metallib` SHA-256 is
  `e38da4f671a12a0d31bf8f68b55c77716dad646ca8c987a0fc24d4b2fca09c85`.
- The desktop Grid now exposes `Align & compare` for 2--256 selected 3D poses.
  The lowest selected source index is the reference; every probe must have the
  same explicit atom order and element sequence. The command dispatches the
  bounded v11 Metal batch, rejects CPU/Metal parity drift, writes RMSD, shape
  Tanimoto, optional electrostatic Carbo, and combined similarity back to the
  current Grid identity, then opens an aligned SDF ensemble in Mol*. Molfile
  formal charges are the only charge source in this slice, so neutral inputs
  report electrostatic similarity as unavailable rather than inventing a GPU
  result.
- The desktop Grid now also exposes a persistent method selector and native
  `energy & charges` action for RM1 plus parity-gated CHNO slices of AM1, PM3,
  PM6_SP, and AM1* over 1--256 selected molecules with explicit coordinates.
  Each method writes to its own Grid columns so runs do not overwrite another
  method's electronic, nuclear, and total energies, SCF status/iterations, or
  JSON atomic charges. The frozen Grid lease is parsed without Python/MLX.
  Runtime v17 contracts the dominant
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
- The verified v17 runtime includes `burrete_rm1_pair_fock_v1`. One thread owns one
  Fock-matrix element and accumulates pair tensors in deterministic order with
  no atomics. It adds `burrete_rm1_symmetric_eigen_v1`, with one threadgroup per
  admitted matrix. It adds `burrete_rm1_pair_rotate_v1`, with one thread per
  H-H, heavy-H, or heavy-heavy atom pair. It also adds the batched
  `burrete_pm6_h4_hh_v1` and CHNO `burrete_pm6_d3_chno_v1` correction kernels,
  with one independent molecule per GPU thread and mandatory float64 parity
  for all three output terms. Runtime v17 also adds the 45-thread-per-block
  `burrete_pm6_one_center_fock_v1` kernel with mandatory full-matrix CPU
  parity. The package binds fifteen sources, fifteen contracts, fifteen AIR
  files, and nineteen entrypoints. Startup, one-center PM6 Fock,
  two-molecule D3/H4/HH, and end-to-end explicit-water KATs passed on
  `Apple M2 Pro` (`registryId=0x1000003c0`, unified memory); the tested
  `native-compute.v17.metallib` SHA-256 is
  `973758404696232805913101f15f422b45556be558dfae3dc3298eb3eb47c7f6`.
- The native closed-shell NDDO oracle now has separate AM1, PM3, PM6_SP, and
  AM1* CHNO parameter packs instead of method aliases. PM6-family nuclear
  repulsion uses its distinct PWCCT equation. The complete pinned 83x83 CSV is
  compiled into 674 nonzero symmetric native pair records with SHA-gated
  generation; no runtime CSV parser is required. At the
  pinned mlxmolkit commit, explicit-water total energies and oxygen charges
  match all four upstream method paths within `1e-4 eV` and `1e-5 e`.
  This is an experimental organic-domain slice only. Grid method selection is
  implemented for the five parity-gated methods, H4/HH have CPU and Metal
  reference paths, and CHNO D3 has compact native CPU and Metal tables. The
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
  charges match the pinned PM6_D oracle. Metal W/SCF generation, broader D3
  tables, and production PM6-D3H4 composition remain gated.
- Restart tests preserve valid published artifacts, remove canonical orphans,
  reject unknown artifact entries, and disable compute after artifact
  corruption.

These checks prove the source implementation, an isolated current v11 runtime
generation, and the earlier unique v1 ad-hoc development package, not a current
v11 desktop package or production release. They do not replace the scientific
corpus, 100k-scale benchmark, Developer ID hardened-runtime signature,
notarization, or visual UI-triggered clustering evidence.

## Remaining Cluster Release Gates

1. Build with Developer ID and hardened runtime, then notarize and verify the
   nested and outer production signatures without changing the pinned runtime.
2. Unlock the test Mac and exercise clustering and `Find similar` through the
   actual packaged Grid controls, including visible columns, backend labels,
   restart, and artifacts.
3. Run fingerprint parity against pinned native RDKit and upstream fixtures,
   plus exact CPU-versus-Metal CSR parity over the frozen scientific corpus.
4. Run sparse, dense, invalid-record, cutoff-boundary, cancellation,
   memory-pressure, and 100k+ benchmarks on named Apple Silicon hardware.
5. Install the unique package and repeat the desktop UI workflow with real
   SDF/SMILES/CSV samples under memory pressure.
6. Add artifact/report inspection and cancellation polling between bounded
   Metal command buffers.
7. Decide and document whether release execution remains in-process or moves
   to the separately signed helper described by the target architecture.

## Next Implementation Order

After the cluster release gates are evidenced, implementation proceeds in the
fixed order below:

1. complete conformer scientific-corpus and packaged UI release gates for the
   implemented Grid-to-Mol* native workflow;
2. finish MMFF94/MMFF94s scientific-corpus parity and replace the bounded numerical
   gradient with an independently validated analytic Metal gradient;
3. finish alignment corpus parity, chemistry-derived partial charges,
   non-identity atom maps, durable ResultPack/report publication, and packaged
   UI evidence for the implemented Grid/Mol* pose workflow;
4. extend the parity-gated CHNO AM1, PM3, PM6_SP, and AM1* Grid paths to their
   documented element domains, then implement PM6/PM6_D, d orbitals, D3, H4,
   and HH corrections behind independent known-answer and external parity
   gates. The bounded H4 and HH float64 reference terms are implemented and
   pinned and batched on Metal together with the CHNO D3 slice; full D3 tables
   and production PM6-D3H4 SCF composition are the next correction-layer gates;
5. combined Apple GPU profiling, memory-pressure testing, package proof, and
   benchmark publication.
