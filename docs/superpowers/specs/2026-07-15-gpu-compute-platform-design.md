# Burette Native GPU Compute Layer

Status: authoritative target architecture and delivery contract.

Date: 2026-07-15

Upstream algorithm source: `guillaume-osmo/mlxmolkit` pinned at
`9e7337f6f93c40a39ad0187991151944a4f1e274` (2026-07-08).

This document replaces the earlier hybrid MLX runtime proposal. Production
Burette must not bundle or require Python, MLX, user environments, wheels, or a
Python worker. Python/MLX may be used only outside the shipped application as a
version-pinned reference oracle, fixture generator, and benchmark comparator.

## Decision

Burette will absorb the useful algorithms and Metal ideas from `mlxmolkit` into
one lightweight native Apple Silicon Compute Layer. Burette owns the runtime,
protocol, memory planner, scheduling, crash recovery, backend attestation,
artifacts, and user experience. Upstream package structure is not a product
dependency and is not reproduced wholesale.

The production backend set is deliberately small:

- `nativeMetal`: signed native Metal pipelines dispatched by the Burette
  compute helper;
- `referenceCpu`: deterministic native reference implementations used for
  parity, validation, unsupported domains, and explicitly permitted fallback;
- `rdkit`: a pinned native chemistry-semantics provider for parsing,
  sanitization, fingerprints, bounds, torsions, stereochemistry, and force-field
  parameters where Burette has not replaced those semantics;
- `coordinator`: durable orchestration and artifact I/O, never reported as GPU
  work.

`MLX` is not a production backend. Oracle provenance belongs in test fixture
metadata, not in a job's effective backend.

## Product Goal

The final product is not a clustering plug-in. It is a native GPU compute layer
available from Grid and 3D structure workflows for:

- clustering selected, filtered, or complete molecular collections;
- similarity search and diverse representative selection;
- conformer generation with DG, KDG, ETDG, ETDGv2, ETKDG, ETKDGv2, ETKDGv3,
  and srETKDGv3;
- MMFF94 and MMFF94s geometry optimization with BFGS/L-BFGS and deterministic
  retry of unconverged structures;
- quaternion/Horn alignment, RMSD, shape similarity, electrostatic similarity,
  conformer-ensemble comparison, and docking-pose comparison;
- scoped semiempirical energies, charges, and relative conformer ranking for
  RM1, AM1, PM3, PM6, PM6_SP, PM6_D, and AM1* only after each method passes its
  own domain and parity gates;
- result writeback to Grid and opening results as structures, tables, and
  reports.

Each family is complete only when it is a packaged-app user workflow. An
internal module, kernel, or passing unit test is not a completed stage.

## Product Boundary

Compute is local, explicit, and artifact-producing. It does not run inside
Finder Quick Look, browser Quick Look, or the source-built iPhone app. Opening a
file never starts a computation. Source molecular files are not silently
mutated; Grid writeback is an explicit, revision-checked action.

The desktop app remains responsive and does not host untrusted or long-running
GPU code in the UI process. A crash-isolated native helper owns the Metal
device, command queues, pipeline cache, shared buffers, and watchdog. The Tauri
coordinator owns job intent and durable state.

## Legal, Attribution, and Provenance Gate

The project owner reports direct permission from Guillaume to copy and adapt
the code. That permission must be preserved as a release-auditable record before
adapted source is shipped. Private correspondence does not need to be committed,
but the repository must record the permission date, scope, evidence identifier,
author, repository URL, and pinned commit.

The pinned upstream tree has no top-level `LICENSE` file. Its `pyproject.toml`
declares MIT, but that declaration alone is not a complete license grant for all
files. Upstream also identifies derived or translated material from nvMolKit,
Shivam Patel's `mlxmolkit`, PYSEQM, and OpenMOPAC. Guillaume's permission does
not remove those secondary notices.

Before any adapted file is merged, it must have a provenance entry containing:

| Field | Requirement |
| --- | --- |
| Burette path | Exact destination path |
| Upstream path | Exact source path or paths |
| Upstream commit | Full 40-character commit |
| Contribution type | `adapted`, `translated`, `formula-only`, or `reference-only` |
| Primary author | Guillaume and any file-level author |
| Secondary source | nvMolKit, Shivam Patel, PYSEQM, OpenMOPAC, or none |
| License basis | Explicit grant and all applicable upstream licenses |
| Validation | Fixture and parity test IDs |

Generated `.dylib`, `.metallib`, wheels, caches, benchmark outputs, CLI scripts,
and examples are not copied into the application. Third-party notices must name
Guillaume, link the repository and pinned commit, and preserve all applicable
secondary notices.

## Selective Upstream Inventory

The initial source audit identifies the following useful donors. This is an
inventory, not a claim that upstream behavior is correct or production-ready.

| Family | Candidate upstream sources | Native Burette target |
| --- | --- | --- |
| Fingerprint packing | `mlxmolkit/fp_uint32.py` | Fixed persisted bit-vector ABI plus Metal view conversion |
| Fused Tanimoto/CSR | `mlxmolkit/fused_tanimoto_nlist.py` | Upper-triangle/tiled Metal neighbor construction without an `N x N` matrix |
| Blockwise Tanimoto | `mlxmolkit/tanimoto_blockwise.py` | Bounded unified-memory scheduler for 100k+ records |
| Butina | `mlxmolkit/butina.py` | Explicit tie contract, deterministic CPU reference, then profiled GPU assistance |
| Shared conformer batches | `mlxmolkit/shared_batch.py` | Versioned topology/constraint pack and `molecule x conformer` chunk mapping |
| DG/ETK extraction | `mlxmolkit/dg_extract.py`, `mlxmolkit/etk_extract.py` | Native RDKit parameter extraction into immutable engine packs |
| DG/ETK kernels | `mlxmolkit/conformer_metal.py`, `mlxmolkit/etk_metal.py`, related Metal kernels | Native Metal DG/ETK pipelines with deterministic seed derivation |
| MMFF parameters/energy | `mlxmolkit/mmff_params.py`, `mlxmolkit/mmff_energy_native.py` | Native parameter pack, seven energy terms, MMFF94/MMFF94s |
| MMFF optimization | `mlxmolkit/mmff_minimize.py`, related threadgroup Metal kernels | Per-molecule BFGS/L-BFGS selection and explicit convergence reason |
| Alignment/scoring | selected functions in `mlxmolkit/cheese.py` | Tiled Horn/RMSD/shape/electrostatic pipelines without full pair tensor materialization |
| Semiempirical | `mlxmolkit/rm1/**` and its declared references | Audited native CPU oracle first; complete Metal SCF/integrals only after method-specific gates |

All duplicate generations, packaging, Python orchestration, CLI entry points,
examples, one-off scripts, training experiments, learned models, and compiled
binary artifacts are excluded unless a later provenance review explicitly adds
them.

## Upstream Findings That Burette Must Correct

The port must not preserve these upstream limitations as hidden behavior:

- Morgan fingerprint generation is RDKit CPU work upstream; it is not a GPU
  fingerprint pipeline. Burette must attest fingerprint and packing stages
  separately.
- Upstream Butina tests do not prove RDKit parity. Equal-degree tie-breaking
  differs from current RDKit behavior, so Burette must choose and version a tie
  contract before claiming parity.
- Empty inputs, cutoff/dtype/shape validation, dense-graph edge overflow, and
  CSR integer width require explicit guards.
- Conformer randomness is hard-coded and depends on batch position. Burette
  seeds must derive from immutable job, molecule, conformer, algorithm, and
  retry identifiers and remain invariant under chunk-size changes.
- Upstream retry does not cover every failed-conformer case. Burette retries are
  per conformer and durably checkpointed.
- Upstream MMFF optimizer selection is batch-global. Burette selects BFGS or
  L-BFGS per molecule from a versioned memory/cost policy.
- Upstream MMFF status `0` conflates convergence and a non-descent condition.
  Burette records an explicit convergence reason and never labels the latter as
  converged.
- MMFF94s parity coverage is insufficient and needs independent fixtures.
- Upstream Horn GPU alignment assumes equal atom count/order and can materialize
  an unsafe `poses x references x atoms x 3` tensor. Burette requires an atom
  mapping contract and tiled pair scheduling.
- `PM6_SP` registry and documentation disagree; `PM6` and `PM6_D` are aliases in
  parts of the code. Each method remains unavailable until its identity and
  parameter set are independently verified.
- The upstream GPU Fock path is incomplete for d orbitals; D3/H4/HH is CPU
  NumPy post-SCF. Burette must not claim GPU d-orbital or D3H4 execution until
  native Metal parity proves it.
- Semiempirical support is closed-shell only upstream. Spin/open-shell,
  unsupported elements, solvent, and charged-domain limitations must fail
  explicitly rather than fall through.

## Runtime Architecture

```text
Grid / 3D Inspector / Agent action
              |
      typed workflow request
              v
Tauri Compute Coordinator
  - exclusive compute-root lease
  - durable SQLite state and events
  - immutable molecular snapshots
  - admission, cancellation, retry, recovery
  - artifact publication and revision-checked writeback
              |
     authenticated local IPC + FD handoff
              v
Native Compute Helper
  - native RDKit chemistry semantics
  - Metal device and command queues
  - pipeline/library integrity cache
  - unified-memory planner and chunk scheduler
  - native CPU reference implementations
  - watchdog and stage-level backend evidence
              |
      immutable ResultPack/artifacts
              v
Grid columns / 3D structures / tables / reports
```

No payload is handed to the helper by a mutable path. The coordinator freezes a
Grid revision, writes a canonical snapshot, syncs and atomically renames it,
verifies the same retained read-only descriptors, and transfers those
descriptors over authenticated IPC. Path strings are diagnostic only.

## General Workflow Contract

The durable protocol must not embed `cluster.v1` as the only possible job
shape. Before the second workflow family lands, the protocol must use a generic
envelope with workflow-owned typed payloads:

```text
WorkflowRequest
  template_id
  template_version
  canonical_payload
  source_scope
  execution_policy
  common_limits

JobSnapshot
  immutable request and source identities
  workflow-independent lifecycle
  stages[]
  chunks[]
  attempts[]
  artifacts[]
```

Stages represent semantic boundaries. Chunks/microbatches represent durable,
independently retryable work and carry their own molecule/conformer range,
backend, device, kernel, precision, seed range, memory estimate, checkpoint,
timings, and transferred-byte evidence. CPU preparation, GPU dispatch, and
artifact writing may overlap as separate lanes; their timings must not be
collapsed into a false all-GPU stage.

Every workflow has:

- a normalized request schema and canonical hash;
- immutable source and parameter packs;
- versioned output and artifact schemas;
- domain/element/size admission rules;
- a native CPU reference path;
- an explicit backend and fallback policy;
- deterministic seeds where randomness exists;
- cancellation and retry boundaries;
- Grid/3D actions and result presentation;
- parity, pressure, crash, and packaged-app tests.

## Memory and Scheduling

The native helper owns one GPU scheduler. It may overlap CPU preparation and
artifact I/O, but it serializes or explicitly budgets Metal command-buffer
epochs so independent workflows cannot overcommit unified memory.

Admission accounts for:

- live immutable snapshots and durable filesystem reservations;
- persisted input/output packs;
- pipeline-specific buffers and scratch space;
- CSR worst-case edge capacity and integer-width bounds;
- conformer coordinates, constraints, optimizer history, and checkpoints;
- alignment tiles rather than the complete Cartesian pair tensor;
- SCF density/Fock/integral buffers and method-specific orbital dimensions;
- a non-allocatable system headroom reserve.

The planner chooses tile/chunk sizes from checked formulas and observed device
limits, never from an unchecked `vm_stat` heuristic. OOM produces a typed
admission or retry outcome, not an invisible CPU fallback.

## Workflow Delivery Order

### 1. Shared compute runtime

Complete process ownership, crash-safe snapshot publication, authenticated
same-FD helper handoff, durable job/chunk state, cancellation, recovery,
artifact publication, native Metal pipeline dispatch, and honest capability
reporting.

### 2. Similarity and clustering vertical slice

Deliver Grid actions for cluster, similarity search, and diverse selection;
native fingerprint semantics; fixed fingerprint ABI; fused and blockwise
Tanimoto; bounded CSR; versioned Butina semantics; result table/report;
selection/writeback; and real Apple GPU validation at 100k+ scale.

### 3. Conformer generation vertical slice

Deliver all eight requested DG/ETK variants, deterministic `N x K` scheduling,
adaptive batching, per-conformer failure/retry, 3D ensemble artifacts, Grid
summary columns, and structure-viewer inspection.

### 4. MMFF optimization vertical slice

Deliver MMFF94/MMFF94s parameter identity, seven terms, per-molecule
BFGS/L-BFGS policy, explicit convergence reasons, warm-start retry, energy
tables, optimized structures, and parity against RDKit.

### 5. Alignment and scoring vertical slice

Deliver mapped/tiled Horn alignment, RMSD, shape and electrostatic similarity,
ensemble and docking-pose comparison, pair tables, aligned 3D structures, and
reports.

### 6. Semiempirical vertical slices

Deliver methods separately, starting with a complete audited CPU reference.
Each of RM1, AM1, PM3, PM6, PM6_SP, PM6_D, and AM1* has its own parameter,
element, orbital, convergence, correction, charge, energy, and Metal parity
gate. D3, H4, HH, DIIS, damping, and d-orbital support are capabilities with
independent evidence, not implied by the method label.

### 7. Cross-workflow optimization

Profile real packaged workflows on supported Apple Silicon families, improve
pipeline residency and batching, and publish a reproducible benchmark suite.
Experimental SES, CHEESE variants, and learned models remain outside this
required sequence.

## Validation Contract

Every algorithm or promoted kernel requires:

- a deterministic known-answer fixture;
- an upstream-oracle fixture pinned to the full commit and exact command;
- an independent reference where available: RDKit, PYSEQM, or MOPAC;
- native CPU versus Metal comparison;
- documented exactness or numerical tolerance rationale;
- edge cases, unsupported-domain cases, overflow, cancellation, and corruption
  tests;
- memory-pressure and adaptive-chunk tests;
- a real Metal dispatch test, not a JavaScript or CPU simulation;
- a packaged Burette UI smoke using a real sample;
- stage/chunk backend evidence proving that no fallback is labelled GPU.

Fixture manifests record oracle name/version, source commit, command, input
hash, seed, expected-output hash, tolerance, platform, and provenance entries.
Upstream self-consistency tests alone do not establish independent parity.

## Honest Capability and UI Rules

- `GPU unavailable` is a valid result and blocks `gpuRequired` jobs.
- `gpuPreferred` may fall back only where the workflow explicitly permits it;
  every affected stage/chunk records the requested and effective backend plus a
  reason.
- A job-level GPU badge appears only when every user-relevant numeric stage ran
  on Metal. Mixed jobs are labelled `Mixed` and expose the stage breakdown.
- CPU fingerprint generation plus Metal similarity is `Mixed`, never `GPU`.
- CPU Butina plus Metal CSR is `Mixed`, never `GPU`.
- Capability reports remain unavailable until the packaged helper has verified
  its signed manifest and successfully dispatched a known-answer kernel on the
  current device.

## Current Implementation Status

Implemented foundation:

- versioned compute protocol and `cluster.v1` request/job/artifact contracts;
- deterministic CPU Tanimoto/CSR/Butina reference core;
- initial Metal Tanimoto kernel and ABI contract, without packaged dispatch;
- durable SQLite job state, normalized source binding, revision CAS, and events;
- exclusive process-wide compute-root lease with replacement detection;
- durable snapshot publication intents and aggregate reservation accounting;
- descriptor-relative Grid snapshot publication and same-FD verification;
- fail-closed capability report and submission gate.

Not yet implemented and therefore not claimable:

- packaged native helper or real Metal dispatch;
- authenticated descriptor handoff;
- startup snapshot filesystem reconciliation;
- clustering Grid/3D user flow and writeback;
- 100k+ real-GPU benchmark;
- conformer, MMFF, alignment/scoring, or semiempirical product workflows;
- copied/adapted upstream source with completed provenance records.

## Definition of Done

The Compute Layer is complete only when every useful upstream capability is
either delivered through a packaged Burette workflow or listed with a specific
technical, scientific, provenance, or licensing reason for exclusion; ordinary
operation requires no Python/MLX; Metal is used wherever parity and memory
evidence permit; results are reproducible and independently checked; Grid and
3D surfaces expose the workflows; provenance and attribution are complete; and
the production build passes on real Apple Silicon.
