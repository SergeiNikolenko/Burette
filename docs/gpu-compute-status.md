# Native GPU Compute Layer Implementation Status

Status: `cluster.v1` source implementation complete; packaged Apple Silicon
release proof pending

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

The ordinary runtime does not require Python or MLX. No `mlxmolkit` source has
been copied into this slice: the fingerprint ABI, exact Tanimoto contract,
Metal kernels, CSR builder, and Butina policy were independently implemented.
The upstream repository remains an attributed reference and future adaptation
source subject to the provenance gate.

## Product Truth By Surface

| Surface | Current truth |
| --- | --- |
| macOS desktop source build | `Cluster all` and `Cluster selected` are wired end to end in Grid |
| Native CPU backend | Implemented and used as the deterministic reference/fallback backend |
| Native Metal backend | Real command-buffer dispatch is implemented and passes the Metal known-answer test when a verified runtime is supplied |
| Packaged production Metal | Not available until a reviewed precompiled `.metallib` is produced, bundled, signed, and verified on a real Apple Silicon package |
| Browser development | Compute is explicitly reported unavailable; it never claims Metal execution |
| Finder Quick Look | Read-only rendering remains unchanged; no compute commands are granted |
| iPhone source app | Rendering remains unchanged; no macOS Metal compute workflow is exposed |
| Agent/plugin surface | Durable compute contracts exist internally, but no new public agent tool is released in this slice |

The current Xcode installation on the implementation machine does not include
the optional Metal Toolchain, so `xcrun metal` cannot produce the release
library. Runtime source compilation is permitted only by the Metal crate's
test harness and is not accepted as production availability.

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
  graph rather than silently converted into valid molecules.

`Find similar molecules`, diverse-representative export, filtered-scope
clustering, and a public artifact/report inspector are still separate product
increments. The ResultPack already contains the data required for those
features, but they must not be described as available UI operations yet.

## Owning Modules

| Responsibility | Primary source |
| --- | --- |
| Fixed request/job/artifact contracts | `crates/burrete-compute-protocol/` |
| Exact fingerprint ABI, CPU Tanimoto/CSR, Butina | `crates/burrete-compute-core/` |
| Metal runtime, tiling, dispatch, GPU timings | `crates/burrete-compute-metal/` |
| Reviewed Metal kernels | `compute/metal/tanimoto-neighbors.v1.metal` |
| Frozen source verification and RDKit chunk sessions | `apps/desktop/src-tauri/src/compute/fingerprint_session.rs` |
| Durable job execution and lifecycle | `apps/desktop/src-tauri/src/compute/coordinator.rs`, `job_lifecycle.rs` |
| Artifact materialization and restart reconciliation | `apps/desktop/src-tauri/src/compute/artifact_publisher.rs` |
| Grid analysis writeback/readback | `apps/desktop/src-tauri/src/preview/grid_analysis.rs`, `grid_store.rs` |
| RDKit Web Worker and desktop workflow | `apps/desktop/src/workers/cluster-fingerprint.worker.ts`, `apps/desktop/src/lib/compute-cluster.ts` |
| Grid bridge and controls | `apps/desktop/src/hooks/use-app-grid-compute-messages.ts`, `PreviewExtension/Web/grid-viewer.js` |

## Validation Completed In This Slice

- 66 focused desktop compute tests pass, including the real Grid-to-artifact
  end-to-end workflow.
- 32 Grid store tests pass; the 50,000-row performance smoke remains opt-in.
- Metal crate unit/parity tests pass, including a real test-only GPU dispatch
  on the local 19-core Apple M2 Pro GPU reported with Metal 4 support.
- The pinned RDKit 2025.03.4 runtime reproduces four frozen Morgan
  known-answer vectors byte for byte, and Rust decodes the same vectors through
  the canonical EnginePack ABI.
- Desktop Rust clippy passes with warnings denied.
- The production web bundle builds with the dedicated RDKit worker and pinned
  WASM asset.
- Tauri ACL, shell bridge, generated Grid UI, JavaScript syntax, and clustering
  workflow contract checks pass.
- Restart tests preserve valid published artifacts, remove canonical orphans,
  reject unknown artifact entries, and disable compute after artifact
  corruption.

These checks prove the source implementation, not the release package. They do
not replace the scientific corpus, 100k-scale benchmark, hardened-runtime
signature, notarization, or real packaged UI evidence.

## Remaining Cluster Release Gates

1. Install the Xcode Metal Toolchain and generate the reviewed precompiled
   `.metallib` through the repository build path.
2. Bundle and attest the library in a unique development flavor, then verify
   nested/outer signatures and runtime generation pinning.
3. Run fingerprint parity against pinned native RDKit and upstream fixtures,
   plus exact CPU-versus-Metal CSR parity over the frozen scientific corpus.
4. Run sparse, dense, invalid-record, cutoff-boundary, cancellation,
   memory-pressure, and 100k+ benchmarks on named Apple Silicon hardware.
5. Exercise the actual installed desktop UI with real SDF/SMILES/CSV samples,
   restart the app mid-workflow, and inspect Grid columns and artifact output.
6. Add representative subset export, artifact/report inspection, and
   cancellation polling between bounded Metal command buffers.
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
