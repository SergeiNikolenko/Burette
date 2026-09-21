# GPU Compute Foundation And `cluster.v1` Implementation Plan

Status: source vertical slice implemented; scientific and packaged release
gates active

Date: 2026-07-15

Implementation snapshot: 2026-07-16

The source tree now completes immutable Grid snapshotting, bounded RDKit worker
fingerprinting, checked CPU/native-Metal Tanimoto CSR construction,
deterministic Butina, immutable artifact publication and restart validation,
typed Grid writeback/readback, and `Cluster all`/`Cluster selected` controls.
The production capability remains unavailable when a reviewed precompiled
Metal library is absent, and the UI reports the durable per-stage backend
rather than inferring GPU use. See
[Native GPU Compute Layer Implementation Status](../../gpu-compute-status.md)
for the exact proof surface and remaining gates.

The following planned deliverables are intentionally still open: the packaged
helper decision, signed/notarized `.metallib`, filtered-scope UI, representative
export, browser-development CPU adapter, mid-stage cancellation polling,
scientific parity corpus, 100k+ benchmark, and installed-app proof.

Design:
[GPU Compute Platform](../specs/2026-07-15-gpu-compute-platform-design.md)

Acceptance:
[GPU Compute Validation And Delivery](../specs/2026-07-15-gpu-compute-validation-and-delivery.md)

## Scope

This plan delivers only the first complete vertical slice: stable compute
contracts, durable coordination, Grid snapshots, RDKit Morgan fingerprint
preparation, native Metal Tanimoto neighbor generation, deterministic CPU
Butina clustering, namespaced Grid analysis results, representative export,
and packaged-app proof.

Conformer, MMFF, alignment/scoring, and semiempirical product implementation
starts only after this slice passes its scientific and release gates.
Python/MLX remains reference-oracle tooling and is never part of the production
runtime.

No `mlxmolkit` source is copied or vendored in this slice. Its referenced
commit has no root license file, and clustering can be implemented from the
independently specified RDKit and mathematical contracts.

## Delivery Rules

- Keep protocol, storage, Metal, Grid, and product adapters in separate modules.
- Keep each non-mechanical implementation commit below roughly 500 changed
  lines and independently testable.
- Use durable `getJob` and `listJobs` snapshots as truth; events carry only a
  job ID and a new revision.
- Never send a rendered Grid page or inline molecular batch as compute input.
- Never store cluster output in `descriptor_values`.
- Never claim GPU execution without a per-stage backend trace.
- Expose only fixed workflows, bounded payloads, and coordinator-issued paths.
- Preserve Quick Look, iPhone, hosted, and tokenized-preview behavior.

## Stage 0: Packaging Spike

### Files

- Add reviewed Metal source under `compute/metal/`.
- Add `crates/burette-compute-service/` as the signed arm64/macOS 14 helper.
- Add a build script that compiles `.metal` to a precompiled `.metallib`
  with the active macOS SDK before Tauri packaging.
- Add `config/compute-runtime-manifest.json` with protocol, workflow, kernel,
  platform, and integrity identities.
- Bundle the helper under `Contents/Helpers` and the library under
  `Contents/Resources/Compute/Metal`.
- Extend packaging checks to assert helper architecture, nested signature,
  resource hash, outer signature, and release notarization.

### Contract

The app keeps macOS 12 support. Compute reports unavailable unless the process
is native arm64 on macOS 14 or later, a Metal device exists, the reviewed
library hash matches, and the expected kernel pipeline can be created.

The helper owns Metal probing and execution. The desktop transports its typed
capability report rather than recreating architecture or device heuristics.
Runtime source compilation is not accepted as packaged proof.

### Verification

- Compile the unavailable backend on non-macOS.
- Run a known-answer kernel through the packaged helper and precompiled library.
- Build one unique development flavor and verify its nested and outer signatures.
- Keep Developer ID hardened-runtime/notarization proof as a stop-ship release
  gate rather than treating an ad-hoc signature as equivalent.

## Stage 1: Stable Protocol And Schemas

### Files

- Add JSON schemas under `schemas/compute/protocol/`.
- Add the fixed template at
  `schemas/compute/workflow-templates/cluster.v1.schema.json`.
- Add valid, boundary, and rejected fixtures under
  `schemas/compute/fixtures/`.
- Add `crates/burette-compute-protocol/` and update the workspace lockfile.

### Contract

The protocol crate owns:

- protocol ranges and fixed workflow IDs;
- `gpuRequired`, `gpuPreferred`, and `referenceCpu`;
- immutable `cluster.v1` requests and normalized fingerprint settings;
- selected, filtered, and all-row Grid scopes;
- job, stage, attempt, artifact, event, execution-plan, and provenance types;
- exhaustive job-state transitions with distinct `cancelRequested`;
- typed public error codes and bounded field/list/file limits;
- rational Tanimoto threshold normalization and integer comparison semantics;
- separate Snapshot, EnginePack, ResultPack, and manifest versions;
- a length-prefixed bounded JSON helper/service wire contract.

Unknown workflows, client-supplied stage arrays, incompatible major versions,
NaN values, negative limits, and unbounded collections are rejected before
snapshot creation or GPU admission.

### Verification

- Round-trip every golden fixture through Rust and Node.
- Test every allowed and forbidden state transition.
- Reject oversized frames, incompatible versions, arbitrary stages, invalid
  threshold rationals, and invalid resource limits.
- Check that schemas and Rust discriminants use the same public spellings.

## Stage 2: Durable Coordinator

### Files

- Add focused modules under `apps/desktop/src-tauri/src/compute/`:
  `commands.rs`, `coordinator.rs`, `store.rs`, `artifacts.rs`,
  `capability.rs`, `scheduler.rs`, and `doctor.rs`.
- Register one managed `ComputeCoordinator` in the Tauri builder.
- Add `apps/desktop/src-tauri/permissions/compute.toml`.
- Add a dedicated compute capability for trusted `main` and `workspace-*`
  windows; do not add these commands to `allow-viewer-commands`.

### SQLite model

The app-data coordinator database uses WAL, foreign keys, full synchronous
publication metadata, a busy timeout, and optimistic revision updates.

- `jobs`: immutable request, snapshot, runtime pin, state, progress, revision,
  timestamps, and terminal error.
- `stages`: fixed stage plan, class, requested/effective backend, progress,
  and trace.
- `attempts`: runtime/kernel identity, timings, retry reason, and outcome.
- `artifacts`: manifest identity, relative capability path, hash, size, media
  type, pin/retention, and publication state.
- `events`: bounded revision notifications without molecular payloads.

State plus revision plus event are written in one immediate transaction. On
startup, active non-idempotent work becomes `interrupted`. Runtime versions
remain pinned until all GPU epochs drain.

### Public commands

- `compute_capabilities`
- `compute_submit_job`
- `compute_get_job`
- `compute_list_jobs`
- `compute_cancel_job`
- `compute_get_artifact_manifest`
- `compute_purge_job`

The owner surface is derived from trusted command context. No command accepts
an arbitrary executable, script, stage graph, worker path, or output path.

### Artifact publication

Publication writes a same-volume temporary file, syncs it, validates exact
size/hash/schema, renames atomically, syncs the parent, and only then commits
the published artifact state. Recovery either finalizes a valid staged artifact
or reports `ArtifactCorrupt`; SQLite and filesystem operations are never
described as one atomic transaction.

### Verification

- Transition, revision, restart, cancellation, bounded-event, and concurrent
  read tests against temporary SQLite databases.
- Symlink, traversal, truncation, wrong-size/hash, disk-full, and interrupted
  publication tests.
- ACL tests proving viewer/preview/hosted surfaces have no compute grant.

## Stage 3: Frozen Grid Scope And Analysis Storage

### Files

- Add Grid-owned snapshot, predicate, and analysis modules beside
  `grid_store.rs`; do not add compute orchestration to page rendering.
- Add `grid_metadata`, `analysis_runs`, `analysis_values`, and
  `analysis_artifacts`.
- Add `molecule_content_hash` and a transactional source revision.
- Extend page/query code with typed analysis columns separate from descriptors.

### Scope

Submission waits for indexing, opens a read transaction, captures the document
fingerprint and source revision, and resolves exactly one scope:

- selected: explicit stable source indexes, deduplicated, bounded, and ordered;
- filtered: one shared predicate plan for search, column, descriptor, and
  analysis filters, without sort, offset, or limit;
- all: every row ordered by stable source identity.

The current desktop bridge drops `columnFilters`; that contract must be fixed
before filtered snapshots are accepted. UI `Select all` means loaded rows and
must never be reinterpreted as filtered/all scope.

Unified Search currently performs SMARTS matching in RDKit.js while the backend
query is text-only. The initial filtered scope therefore accepts text search
only; SMARTS results use explicit selected source indexes. The ideal follow-up
adds a versioned backend chemistry predicate carrying the pattern and RDKit
baseline so SMARTS scope identity is reproducible.

Grid virtual edits are currently frontend-only and a save does not rebuild the
SQLite runtime. The ideal implementation moves replace/delete/append into
transactional backend commands with revision bumps. Until that migration is
complete, compute submission rejects any runtime with a virtual-edit generation,
including one merely marked clean after a frontend save.

The coordinator copies resolved records and hashes to its immutable job root.
Closing the transient Grid runtime cannot invalidate the snapshot.

The frozen `MolecularSnapshot v1` writes two typed identity arrays and one
canonical source-record stream at `pack/molecular-records.v1.jsonl`. Records use
the public `burette.molecular-snapshot-record.v1` contract and remain raw
preparation input; normalized chemistry and fingerprints belong to EnginePacks.
The ordered identity digest is a domain-separated stream of strictly increasing
big-endian source IDs and raw molecule SHA-256 bytes, with cross-language golden
vectors. The manifest requires the exact records path and media type.

### Analysis model

Each run is insert-only and namespaced by `run_id`, with workflow, source
revision, snapshot/settings hashes, maturity, representative policy,
provenance, and opaque artifact references. Values are keyed by run, molecule,
and typed value ID.

Apply uses one immediate transaction and requires exact document fingerprint,
source revision, source record identity, and molecule hash matches. Any mismatch
rolls back the whole apply and preserves the ResultPack as a standalone
artifact. Cluster output uses `cluster_id` and `is_representative`, never
`centroid`.

### Verification

- Selected, filtered, and all scopes over the same frozen fixture.
- Filter identity remains stable when sort/page changes.
- Edit/append conflicts prevent apply.
- Multiple runs coexist and descriptors remain unchanged.
- Analysis columns sort, filter, and export with their run identity.

## Stage 4: RDKit Fingerprint EnginePack

Add a pinned package-owned worker with one fixed `fingerprint_morgan_v1`
operation; it is not a Python runner. The signed runtime pack supports manifest
verification, atomic version activation, last-known-good rollback, drain
pinning, uninstall, and offline startup.

The first baseline is RDKit Morgan radius 2, 2,048 bits, chirality enabled,
features disabled, sanitized input, and preserved source order. The EnginePack
contains packed `u64` fingerprints, record IDs, validity/error arrays, and an
exact dtype/shape/byte-order/size/hash manifest. RDKit version and every setting
are provenance.

Verify exact packed-bit parity, invalid chemistry outcomes, runtime corruption,
protocol mismatch, update-during-job, activation, rollback, uninstall, and
offline restart.

## Stage 5: Exact Tanimoto, CSR, And Butina

Add a scalar Rust reference before Metal. Both paths compute integer
intersection/union counts and compare a normalized rational cutoff by integer
cross multiplication. Empty-fingerprint behavior is explicit.

Metal processes bounded two-dimensional tiles and never allocates the full
pair matrix. The host checks cancellation between bounded command buffers,
accumulates counts in `u64`, interprets `maxEdges` as the maximum number of
qualifying undirected `{i, j}` pairs, sorts deterministic pairs, and builds
symmetric CSR with `u64` offsets and two entries per edge. Overflow is a typed
failure, never truncation. A GPU epoch drains only after command-buffer
completion and error checks.

The CPU reference counts matching pairs in a first allocation-free tiled pass,
then admits a conservative logical working set before reserving pair, CSR,
degree, cursor, alive, and cluster-output buffers. Imported Metal CSR is
re-admitted before CPU Butina using the same request `maxMemoryBytes`. The
account is deliberately conservative across known buffers plus fixed headroom;
it is not presented as an exact allocator-byte or process-RSS prediction, and
allocation failures remain typed.

CPU Butina consumes the frozen neighbor graph with versioned deterministic
tie-breaking, cluster order, and representative policy. The representative is
a selected record, not a geometric centroid.

The ResultPack contains bounded CSR, cluster IDs, representative flags,
per-record errors, stage traces, and a manifest. Large arrays never enter job or
Grid JSON.

Verify exact CPU/Metal parity on zeros, duplicates, ties, cutoff boundaries,
sparse/dense graphs, final partial tiles, cancellation, overflow, repeated runs,
and tile-size changes. Strict backend fault injection must fail
`gpuRequired`, not fall back.

## Stage 6: Product And Browser Development Adapters

- Add a typed compute client under `apps/desktop/src/lib/`.
- Add one focused hook under `apps/desktop/src/hooks/`.
- Add a contextual Grid Compute menu for scope, cutoff, and representative
  export.
- Reuse the chemistry jobs area for progress, backend badge, cancel, result,
  manifest, and log actions; do not add a dashboard.
- Give browser development the same schemas with an explicit
  `referenceCpu/dev` capability. It cannot satisfy `gpuRequired` and is not
  packaged Metal proof.
- Export the frozen representative subset plus provenance, never just the
  rendered page.

Verify UI scope requests, browser-dev golden contracts, packaged Metal stage
trace, revision-safe Grid columns, and representative export round trips.

## Stage 7: Release Gates And Review

Run focused tests after each commit:

```bash
cargo test -p burette-compute-protocol
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml compute::
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
vp check
vp test
```

The final package uses a unique development flavor. A release candidate also
proves hardened runtime, signature verification, notarization, offline runtime
startup, actual Metal execution, kill/restart, update/drain,
activation/rollback/uninstall, artifact GC, and the frozen scientific corpus.

Before completion, rerun independent reviews:

- functional: scopes, contextual UX, cancellation, recovery, and export;
- module: protocol, ACL, durability, runtime/artifact lifecycle, GPU ownership;
- scientific: fingerprint parity, exact threshold/CSR, overflow, deterministic
  Butina, backend trace, and performance evidence.

## Commit Sequence

1. Implementation plan.
2. Compute schemas and protocol crate.
3. Packaged helper, capability report, and known-answer Metal spike.
4. Durable coordinator and artifact publication.
5. Grid revision, frozen scopes, and analysis storage.
6. Pinned RDKit EnginePack and runtime lifecycle.
7. CPU reference, Metal neighbor engine, CSR, and Butina ResultPack.
8. Desktop/browser adapters and representative export.
9. Packaged proof, corpus evidence, review fixes, and readiness docs.

Each commit preserves a buildable state or is an isolated schema/data commit
with its own validator. Later commits may refine internal types but may not
weaken fixed-workflow, bounds, provenance, or backend policies.
