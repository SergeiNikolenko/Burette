# Native GPU Compute Layer Implementation Status

Status: `cluster.v1`, immutable representative export, and derived exact
`Find similar` Grid analysis complete at source level; deterministic conformer
variant/seed/adaptive-batching foundation and strict conformer EnginePack ABI
implemented; current desktop packaging, production release, and scale proof
pending

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
unit-incompatible arrays before execution. This remains runtime foundation:
native parameter extraction, DG/ETK kernels, durable publication, and UI are
not yet complete. The paired `conformer.result-pack.v1` ABI is defined and
strictly validates ragged coordinate offsets, Cartesian positions, molecule and
conformer identity, embedding status/objective/attempt counts, and the exact
128-bit seed words used for every generated structure.

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
exact CPU parity. The next Metal primitive evaluates batched distance-bound
energies and analytic `float4` gradients without atomics or a pair matrix. Its
Rust oracle passes a central-difference gradient check, and the packaged Metal
startup KAT matches the oracle within the fixed floating tolerance. Runtime v4
binds all three sources, reviewed contracts, AIR files, five entrypoints, the
compiler, linker, SDK, and final metallib by hash. These primitives are not a
claim of completed distance-geometry optimization or an end-to-end conformer
capability.

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
coordinator execution, recovery execution, and publication remain in progress.

## Product Truth By Surface

| Surface | Current truth |
| --- | --- |
| macOS desktop source build | `Cluster all`, `Cluster selected`, immutable `Export diverse`, and exact `Find similar` are wired end to end in Grid |
| Native CPU backend | Implemented and used as the deterministic reference/fallback backend |
| Native Metal backend | Real graph, exact query, conformer initialization, and DG distance objective/gradient command buffers pass startup parity against CPU references |
| Packaged development Metal | The earlier cluster-only v1 app package is proven; the current v4 runtime generation passes package verification and real-GPU startup, while a refreshed v4 desktop package remains pending |
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
| Reviewed Metal kernels | `compute/metal/tanimoto.v2.metal`, `compute/metal/conformer-initialize.v1.metal`, `compute/metal/conformer-distance.v1.metal` |
| Frozen source verification and RDKit chunk sessions | `apps/desktop/src-tauri/src/compute/fingerprint_session.rs` |
| Durable job execution and lifecycle | `apps/desktop/src-tauri/src/compute/coordinator.rs`, `job_lifecycle.rs` |
| Conformer preflight admission and queued snapshot | `apps/desktop/src-tauri/src/compute/conformer_plan.rs`, `job_factory.rs` |
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
- An isolated offline-compiled v4 runtime generation passes the hash-bound
  package verifier and all four startup known-answer paths on `Apple M2 Pro`
  (`registryId=0x1000003c0`, unified memory). The tested
  `native-compute.v4.metallib` SHA-256 is
  `fd8e1eb6adc5338a539e1245a3a45e7ce3ba4a8af2d8a428a25d5513753fd33b`.
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
- All 75 protocol tests and 27 compute-core tests pass after adding the fixed
  conformer request/pack/plan contracts, identity-derived seed, adaptive batch
  coverage, deterministic coordinate oracle, DG objective/gradient oracle,
  finite-difference gradient validation, rebatching invariance, and memory
  rejection checks. Focused protocol/core/Metal clippy also passes with warnings
  denied.
- Thirteen focused desktop conformer tests pass, including independent GPU
  admission for both numeric stages, honest mixed-backend fallback, bounded
  preflight/result memory rejection, canonical queued snapshot construction,
  and the existing process-boundary conformer safeguards.
- Restart tests preserve valid published artifacts, remove canonical orphans,
  reject unknown artifact entries, and disable compute after artifact
  corruption.

These checks prove the source implementation, an isolated current v4 runtime
generation, and the earlier unique v1 ad-hoc development package, not a current
v4 desktop package or production release. They do not replace the scientific
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

1. conformer EnginePack plus DG/KDG/ETDG/ETKDG variants and deterministic
   `molecule x conformer` scheduling;
2. MMFF94/MMFF94s parameter packs, all supported terms, gradients, and
   per-molecule BFGS/L-BFGS policy;
3. quaternion/Horn alignment, RMSD, shape, electrostatic, ensemble, and docking
   pose scoring;
4. audited semiempirical methods method by method, starting with a native CPU
   oracle and adding Metal only after independent parity gates;
5. combined Apple GPU profiling, memory-pressure testing, package proof, and
   benchmark publication.
