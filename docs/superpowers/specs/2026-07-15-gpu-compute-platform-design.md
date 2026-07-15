# Burrete GPU Compute Platform Design

Status: approved target architecture; written specification pending user review;
implementation is split into separately reviewed vertical slices.

Date: 2026-07-15

Upstream reference: `guillaume-osmo/mlxmolkit` at
`9e7337f6f93c40a39ad0187991151944a4f1e274`.

## Summary

Burrete will own a local-first GPU compute platform for Apple Silicon rather
than expose `mlxmolkit` directly or scatter copied functions across existing
preview code. `mlxmolkit` is an algorithm donor and replaceable MLX engine.
Burrete owns the job protocol, canonical molecular data model, scheduling,
runtime distribution, provenance, validation, artifacts, and product surfaces.

The platform is hybrid by design:

- RDKit owns chemical parsing, sanitization, atom ordering, stereochemistry,
  bounds, and parameter extraction.
- Native Metal owns stable high-throughput primitives and promoted hot kernels.
- A persistent MLX engine owns rapidly evolving batched numerical algorithms.
- RDKit, xTB, CREST, and independent references remain validators and explicit
  fallback engines.

One logical scheduler owns the GPU. Native Metal and MLX never compete for the
device at the same time. GPU residency is guaranteed only inside one
`EngineIsland`; moving data between a native process and the MLX process is an
explicit `materialize` stage with measured copies. CPU preparation and artifact
writing overlap with GPU execution through bounded pipelines.

This subsystem produces immutable derived artifacts. It does not silently
modify source files and does not turn Finder Quick Look, browser preview, or the
iPhone source app into compute runtimes.

## Product Boundary

Burrete remains a molecule-first file workspace, not a general molecular
modeling suite. GPU computation exists to accelerate focused file workflows:

- cluster a collection and select a diverse subset;
- generate and inspect conformer ensembles;
- compare conformers and molecules by shape and electrostatics;
- produce molecular surface fields and meshes;
- calculate fast, clearly scoped charges or energies for supported chemistry;
- create validated artifacts for downstream review, export, or agent workflows.

The UI remains contextual. Grid and Structure Inspector actions submit a closed
set of curated workflow templates; the existing jobs dock presents progress and
results. There is no automatic computation when a file is opened, arbitrary DAG
editor, general script runner, or separate dashboard product.

## Goals

1. Maximize useful Apple GPU execution while preserving chemical and numerical
   correctness.
2. Keep coordinates and parameters resident across compatible GPU stages
   inside one engine island and make every cross-island materialization visible.
3. Give desktop, browser development, CLI, and agent workflows one typed job
   contract.
4. Make every result reproducible and auditable down to the effective backend,
   runtime versions, input hashes, parameters, and random seeds.
5. Isolate GPU crashes, memory pressure, and experimental methods from the
   desktop process.
6. Allow mature MLX kernels to move to native Metal without changing consumers.
7. Preserve existing RDKit, xTB, CREST, Mol*, Grid, Quick Look, and iPhone
   behavior unless a later vertical-slice spec explicitly changes it.

## Non-Goals

- Running MLX inside Finder Quick Look or the iPhone source app.
- Replacing RDKit as the canonical chemistry semantics implementation.
- Claiming that every stage is GPU-resident when a method still uses CPU work.
- Replacing xTB or CREST for unsupported, open-shell, solvent, or
  precision-sensitive workflows.
- Shipping arbitrary Python execution, user-installed Python environments, or
  network access during a compute job.
- Shipping learned models without versioned weights, licensing, provenance,
  and held-out validation.
- Treating the current upstream PM6_D or AM1-BCC paths as production-ready.

## Alternatives Considered

### Monolithic Python and MLX worker

This gives the shortest path to upstream code but makes Python package details
part of product contracts. It provides weak isolation between scheduling,
runtime lifecycle, memory admission, and chemistry implementations. It is a
useful spike shape, not the target architecture.

### Hybrid Burrete compute platform

This is the selected design. Burrete owns stable contracts and a signed native
coordinator while native Metal, MLX, and reference engines remain replaceable.
It requires more platform work initially but supports scientific validation,
runtime rollback, bounded memory, and incremental kernel promotion.

### Full native Metal rewrite

This maximizes low-level control but requires a large scientific port and loses
the development speed of MLX for differentiable and experimental methods. It is
an optimization direction for proven hot kernels, not a prerequisite for the
platform.

## System Architecture

```text
React / Grid / Agent / browser-dev
                 |
          typed job contract
                 |
                 v
       Tauri Compute Coordinator
       - durable job registry
       - versioned workflows and policies
       - progress and cancellation
       - runtime integrity
                 |
                 v
        Signed Compute Service
       - GPU lease and scheduler
       - memory admission
       - native Metal engine
       - persistent MLX child
       - RDKit semantics engine
       - reference validators
                 |
                 v
       snapshots / engine packs / artifacts
       - bounded mmap typed arrays
       - SQLite metadata
       - content-addressed outputs
```

### Repository ownership

The implementation will use focused boundaries rather than grow central app
files:

```text
schemas/compute/
  workflow-templates/
  protocol/
  artifacts/

crates/burrete-compute-protocol/
  src/

apps/desktop/src-tauri/src/compute/
  coordinator/
  store/
  commands/
  doctor/

compute/worker/
  pyproject.toml
  src/burrete_compute/
    snapshots/
    engine_packs/
    scheduler/
    engines/
    validation/
    artifacts/

compute/metal/
config/compute-runtime-manifest.json
third_party/mlxmolkit/
tests/fixtures/compute/
```

`apps/desktop/src/App.tsx`, the preview viewer, and Vite configuration remain
composition boundaries. Product hooks call a typed compute client instead of
managing engine processes directly.

## Surface Contract

| Surface | Capability |
| --- | --- |
| Packaged Apple Silicon desktop | Full local GPU compute and artifact review |
| Desktop agent session | Submit, observe, cancel, and open compute results |
| Browser development | Same job schema through a local development adapter; not proof of packaged Metal execution |
| Tokenized browser preview | View prepared artifacts only |
| Finder Quick Look | View prepared artifacts and hand off to desktop |
| iPhone source app | View and hand off prepared artifacts |
| Intel Mac or macOS below the GPU floor | Explicit GPU-unavailable state and existing reference paths |
| Hosted/public plugin | No access to the user's local GPU; bounded artifact intake only |

The initial GPU support floor is native arm64 on macOS 14 or later. A runtime
capability handshake, not architecture inference in React, decides availability.

## Control Plane

### Durable job model

The coordinator stores `jobs`, `stages`, `attempts`, `artifacts`, and bounded
`events` in SQLite. A job survives window closure and can be recovered after an
app or helper restart. Events are notifications carrying a new job revision;
`getJob` and `listJobs` snapshots are the source of truth.

Every job contains:

- `schemaVersion`;
- `jobId`, creation time, owner surface, and priority;
- input artifact references and content hashes;
- a versioned workflow template and normalized parameters;
- an immutable input snapshot identity and source revision;
- method parameters and deterministic seeds;
- execution policy and resource limits;
- status, progress, warnings, and per-molecule outcomes;
- result artifact manifest references;
- runtime, engine, and provenance records.

The public lifecycle is:

```text
queued -> preparing -> waiting_gpu -> running
       -> validating -> publishing -> succeeded

running -> cancel_requested -> cancelled
any active state -> failed | interrupted
```

`succeeded_with_failures` records valid partial per-molecule output. On service
restart, `running` becomes `interrupted`; only stages declared idempotent may be
retried automatically. Publication uses a temporary file, sync, validation, and
atomic rename so partial artifacts never appear successful.

Clients cannot submit arbitrary stages. The initial workflow templates are
`cluster.v1`, `conformer_ensemble.v1`, `shape_screen.v1`, `surface.v1`, and
`qm_single_point.v1`. Internal stage graphs remain implementation details of the
selected template.

### Execution policies

- `gpuRequired`: every `numericCompute` stage declared in the accepted execution
  plan must execute on GPU; CPU chemistry semantics, validation, and artifact
  I/O remain allowed.
- `gpuPreferred`: supported stages use GPU; a declared fallback is allowed and
  recorded.
- `referenceCpu`: force the designated reference path for differential testing
  or unsupported hardware.

No policy permits silent fallback. Before admission, the coordinator returns a
per-molecule execution plan containing the requested and effective engine,
planned CPU/GPU stages, precision, memory estimate, and unsupported or fallback
reason. Mixed batches are partitioned by capability.

Random streams are independent of chunking and scheduling. A conformer start is
derived from `hash(globalSeed, moleculeStableId, conformerOrdinal,
algorithmVersion)`, never from chunk index, retry count, job order, or device.

### Protocol

The coordinator and service use a versioned, length-prefixed, bounded JSON
control protocol over a Unix domain socket. Control messages are intentionally
small and schema-validated. Protocol output never shares stdout with worker
logs. Large molecular or tensor payloads travel only through coordinator-issued
job capabilities and immutable files inside the job root.

The initial command family is:

```text
capabilities
submit_job
watch_job
cancel_job
get_job
get_artifact_manifest
shutdown_if_idle
```

The repository CLI is the source of truth for agent-facing submission and
observation. MCP wrappers are added only after the CLI contract stabilizes.

## Snapshot And Pack Contracts

The stable logical contract is split into three independently versioned parts.
RDKit objects, pickles, and implementation-specific Python classes are not
persistence or IPC formats.

### MolecularSnapshot

`MolecularSnapshot v1` contains only source chemistry and identity:

- stable molecule, source row, atom, and conformer identifiers;
- atom offsets and atomic numbers;
- isotope, formal charge, aromaticity, and atom-map arrays;
- bond offsets, endpoint indexes, bond order, and stereo arrays;
- total charge and multiplicity;
- conformer offsets, coordinates, coordinate units, and dtype;
- distance, chirality, and torsion constraints;
- per-molecule validity masks and structured errors;
- the source document fingerprint, source revision, source record key, and
  molecule content hash.

### EnginePack

An `EnginePack` contains derived tensors such as fingerprints, ETK torsions,
MMFF parameters, or QM basis data. Its cache identity is:

```text
snapshotHash + engineId + engineVersion + normalizedSettingsHash
```

### ResultPack

A `ResultPack` contains coordinates, energies, scores, masks, structured
per-molecule errors, and per-stage provenance. Results are applied back to a
live Grid only when its source revision still matches the snapshot. Otherwise
they remain a standalone artifact.

The logical schema does not require Arrow. Physical packs use bounded flat typed
arrays with explicit dtype, shape, byte order, alignment, offsets, exact file
sizes, and hashes. Arrow IPC may be adopted only through a separate ADR after
measuring bundle size, parse time, data copies, and peak RSS. The first
Tanimoto slice needs only a packed `u64[N,W]` fingerprint matrix and chunked CSR
output.

The coordinator snapshots inputs into an immutable job directory before queueing
work. The worker receives a capability for that root, never an arbitrary path
from React, browser-dev, or Agent. Canonicalization, symlink rejection, quotas,
shape bounds, file-size checks, and hashes are verified before mmap. Mapped files
are never truncated or modified.

## Scheduler And Unified Memory

The scheduler is the only logical owner of Burrete compute work on the GPU. It
cannot reserve the integrated GPU from WebKit, Mol*, or the operating system,
so admission also considers renderer activity, system memory pressure, thermal
state, and power policy.

Each admitted `GpuEpoch` identifies an engine island, memory budget, deadline,
and maximum dispatch duration. An island reports `drained` only after all Metal
command buffers have synchronized. A timeout marks the island unhealthy and
restarts it before another lease is granted.

The scheduler provides:

- priorities for interactive, visible-grid, and background work;
- coalescing of compatible requests from different documents;
- buckets by engine, atom count, constraint density, element set, basis size,
  dtype, and optimizer;
- adaptive micro-batches based on current allocation, memory pressure, and a
  platform safety reserve;
- one admitted GPU chunk at a time;
- double or triple buffering so CPU preparation, GPU execution, and artifact
  writing overlap;
- resident caches for compiled kernels, fingerprints, parameter tables, and
  active packed graphs;
- backpressure instead of unbounded queues or allocations;
- cancellation and checkpoint boundaries between bounded dispatches;
- one automatic smaller-batch retry after an admission estimate is exceeded;
- BFGS to L-BFGS selection from a declared memory model.

User policies are `interactive`, `balanced`, and `throughput`. Interactive mode
applies a frame-pacing gate while a molecule viewer is active. Throughput mode
may coalesce larger batches but never bypasses hard memory or dispatch limits.

The service must not run independent MLX workers concurrently. Multiple clients
share the same scheduler and GPU lease. MLX owns chained coordinate workflows
such as DG, ETK, MMFF, RMSD pruning, and immediate CHEESE scoring so their arrays
can remain resident. Native Metal initially owns independent workflows with a
stable CPU boundary, such as fingerprint-to-CSR similarity. Any transfer between
islands is a measured `materialize` stage in provenance.

Dense Tanimoto graphs and volumetric surfaces have explicit edge and voxel
budgets. Admission fails before allocation if a declared hard limit cannot be
met.

## Engines And Functional Scope

### RDKit chemistry semantics engine

This intentional CPU island owns parsing, sanitization, aromaticity,
stereochemistry, canonical atom mapping, bounds, torsion extraction, and force
field parameter extraction. GPU engines never reinterpret chemistry silently.

### Native Metal engine

The target native engine owns stable high-throughput operations:

- Morgan/ECFP graph hashing and folding after exact parity is established;
- fused popcount, Tanimoto, threshold, top-K, and neighbor CSR generation;
- prefix scans, reductions, compaction, sorting, and bounded selection helpers;
- Horn alignment, RMSD matrices, conformer pruning, and deduplication only after
  a benchmark proves that leaving the MLX coordinate island is beneficial;
- Gaussian shape and electrostatic overlap after promotion from MLX;
- SES distance fields, cavity operations, and eventual mesh primitives.

The first production candidate is the fused Tanimoto and neighbor-list path.
Butina selection remains on CPU until a deterministic replacement is validated.
Production CSR uses bounded tiled dispatches, cancellable row ranges, and
`uint64` offsets and edge counts. Threshold semantics are exact and versioned;
float32 boundary behavior is not accepted as an implicit contract.

### Persistent MLX engine

The MLX engine owns algorithms that benefit from tensor composition,
autodifferentiation, or faster iteration:

- batched distance geometry, 4D collapse, ETK refinement, and MMFF
  optimization;
- differentiable scoring and conformer refinement;
- CHEESE exact fixed-pose Gaussian shape and electrostatic pair scoring;
- initial GPU surface-field implementations;
- research NDDO and SCF methods;
- learned embeddings only after a separate model-readiness gate.

Stable, profiled MLX hot kernels may be promoted to native Metal behind the same
engine interface only after parity, copy-cost, and end-to-end throughput gates.

### Reference engines

RDKit, xTB, CREST, and independent numerical references remain available for:

- unsupported chemistry;
- accuracy-sensitive workflows;
- differential validation;
- open-shell, solvent, or method combinations outside the GPU capability map;
- recovery selected explicitly by `gpuPreferred`.

The effective engine and every CPU/GPU stage are written to provenance.

### Maturity and release state

| Capability | Initial state |
| --- | --- |
| Tanimoto threshold/top-K/CSR | Production candidate after parity, overflow, and memory gates |
| CPU Butina over GPU neighbors | Production candidate after deterministic end-to-end parity |
| CHEESE exact fixed-pose shape/ESP scoring | Experimental spike, then candidate after invariance and reference gates |
| Heuristic rigid overlay search | Experimental and reported separately from fixed-pose scoring |
| `preview_jfa` SES field and volume | Experimental approximation with hard voxel budgets and uncertainty metadata |
| `validated_exact` SES | Reference CPU path until an exact GPU EDT passes independent gates |
| DG -> ETK -> MMFF conformers | Experimental opt-in until gradient, stereo, energy, and success-rate gates pass |
| AM1/RM1 closed-shell sp-only charges or energies | Research-only on an explicit method-element allowlist until independent reference gates pass |
| PM6_D GPU path | Blocked until correct d-orbital support exists |
| AM1-BCC | Blocked until parameter data, licensing, and provenance are restored |
| RESP | Research-only while constrained solving and iteration remain partly CPU |
| Learned CHEESE embeddings | Blocked until versioned weights and held-out validation exist |

Maturity is recorded per `workflow x method x chemistry domain x backend x
precision`, not for the worker as a whole. Allowed values are `experimental`,
`numerically_validated`, `chemically_validated`, `production`, and
`unsupported`.

## Product Workflows

### Grid

The Grid Compute entry point supports selected, filtered, and all-row scopes.
Submission freezes the query, sort-independent row identity, source revision,
and molecule hashes. The coordinator reads the SQLite-backed Grid source
directly; it does not materialize only the current page or send inline base64
records through the viewer bridge.

Operations include:

- cluster by a declared fingerprint and cutoff;
- select a diverse subset;
- generate a conformer ensemble;
- compare shape or electrostatics to a reference molecule;
- calculate supported fast charges or energies;
- build a surface field or mesh for selected records.

Library clustering and conformer-ensemble pruning are distinct workflows.
`cluster.v1` uses molecular fingerprints and Tanimoto similarity across records.
`conformer_ensemble.v1` may use symmetry-aware RMSD and must not reuse the
library cluster contract.

Results become typed derived columns such as `cluster_id`, `is_representative`,
`best_energy`, `conformer_count`, `shape_score`, and `esp_score`. They remain
sortable, filterable, exportable, and tied to a result manifest. Large arrays do
not become inline grid cells.

Query-dependent outputs do not use the descriptor value table. The Grid store
adds `analysis_runs`, `analysis_values`, and `analysis_artifacts` keyed by run,
workflow, source revision, record identity, settings, and provenance. A
representative flag always records the selection policy; it is not presented as
a geometric centroid.

### Structure Inspector and viewer

Contextual actions support:

- generating an ensemble and opening it as a trajectory or comparison;
- optimizing a selected conformer;
- comparing two open structures by shape or electrostatics;
- displaying an SES-derived overlay;
- opening the result report, manifest, or log.

Mol* remains the renderer. Compute produces artifacts and typed viewer actions;
it does not add GPU chemistry code to the preview runtime.

### Jobs dock

Existing chemistry job UI evolves into one Compute jobs list. A job exposes:

- operation and source context;
- current stage and progress;
- effective backend badge;
- warnings and per-molecule failure count;
- cancel, retry, open result, report, manifest, and log actions.

The dock remains secondary to files and structures and does not become a
dashboard.

### Agent platform

The repository CLI adds typed submit, status, cancel, and result commands after
the service contract is stable. `observe` exposes bounded job state and artifact
manifests. It never injects complete coordinate ensembles, pair matrices, or
unbounded logs into agent context.

Agent submissions use the same frozen document/query snapshot mechanism as the
desktop UI. Hosted and tokenized preview agents may inspect prepared artifacts
but cannot address or activate the local compute service.

## What Changes And What Remains

The platform eventually replaces:

- separate in-memory conformer and xTB-oriented frontend job bookkeeping with a
  shared durable job model;
- one-process-per-operation GPU execution with a persistent scheduled service;
- sequential per-row conformer generation with bucketed `N x k` batches;
- large JSON chemistry payloads with coordinator-issued snapshot and pack paths;
- implicit backend assumptions with explicit execution policies and provenance.

The platform preserves:

- RDKit parsing and chemical semantics;
- xTB and CREST as user-visible reference workflows;
- Mol* and Grid rendering;
- source-file immutability;
- existing Quick Look and iPhone runtime independence;
- browser-dev and packaged desktop as distinct proof surfaces.

## Runtime Distribution

Packaging is a stop-ship capability, not a task deferred until after chemistry
kernels. The application keeps its current macOS 12 support while compute
capability is arm64 and macOS 14 or later.

The app bundle contains a small signed native compute helper and runtime doctor.
MLX and RDKit ship in a separate signed arm64 runtime pack containing:

- relocatable CPython;
- pinned wheels and dependency hashes;
- the Burrete compute package;
- source-built and compiled Metal libraries;
- a software bill of materials;
- license and third-party notices;
- a signed runtime manifest.

The runtime pack is a signed code bundle or installer artifact. Every Mach-O
component is signed with a compatible identity and must pass hardened runtime,
library validation, and notarization without disabling library validation. A
user-machine `uv pip install` is not a release mechanism.

Runtime packs install atomically into versioned Application Support directories.
The app retains a last-known-good version and can roll back after an integrity or
compatibility failure. Jobs never use arbitrary user Python, install packages,
or access the network.

Protocol compatibility is negotiated before a job is admitted. The control
protocol, workflow template, MolecularSnapshot, EnginePack, ResultPack, artifact
manifest, runtime pack, and engine implementation have separate versions. The
handshake reports protocol ranges, capabilities, and exact runtime identity.

A job pins its runtime version until all epochs drain. Installing a new pack
does not switch running jobs; activation occurs atomically after drain. The
packaging spike must prove offline startup, MLX JIT, one native Metal kernel,
kill/restart, update during an active job, activation, rollback, and uninstall
in a signed and notarized packaged app.

## Provenance And Supply Chain

Copied or adapted upstream code stays isolated and traceable. The vendor ledger
records:

```text
local module -> upstream repository -> commit -> source files
             -> original license/SPDX -> local patches -> validation suite
```

Prebuilt upstream `.dylib` and `.metallib` files are not imported. Metal assets
are built from reviewed source.

No upstream code ships until the root license and transitive provenance are
confirmed. The current upstream metadata declares MIT but the referenced commit
lacks a root `LICENSE` or `NOTICE`. Code derived from nvMolKit, Shivam Patel's
implementation, PYSEQM, MOPAC, or parameter datasets must retain the applicable
notices and modification records.

Every result manifest records:

- app, protocol, runtime, engine, RDKit, MLX, and upstream versions;
- device, OS, architecture, dtype, and relevant compile options;
- requested and effective backend per stage;
- input, MolecularSnapshot, EnginePack, parameter, and output hashes;
- method settings, random seeds, iteration limits, and convergence state;
- cold/warm compile and execution timings;
- peak unified memory and fallback or retry reasons.

Each stage record includes `requestedBackend`, `effectiveBackend`, `device`,
`precision`, `kernelId`, `gpuTimeMs`, `hostTimeMs`, `transferredBytes`, and
`fallbackReason`. No result-level label such as "GPU job" may replace the stage
trace.

### Artifact lifecycle

Content addressing is an internal cache mechanism, not the user-visible job
identity. Jobs use UUIDs. Cache identity includes the snapshot hash, normalized
request, deterministic seed, engine versions, and runtime version; a stochastic
job without a fixed seed is not deduplicated.

Artifacts have references, pins, workspace retention policy, byte quotas,
explicit export, purge, and garbage collection. Raw proprietary content hashes
are not displayed in ordinary UI or shared diagnostics. A result remains pinned
while referenced by a live Grid analysis run, open document, job history entry,
or explicit user export.

## Error Model And Recovery

Public errors are typed:

- `InvalidChemistry`;
- `UnsupportedChemistry`;
- `CapabilityMismatch`;
- `GpuAdmissionDenied`;
- `GpuExecutionFailed`;
- `NumericalFailure`;
- `ValidationMismatch`;
- `WorkerCrashed`;
- `ArtifactCorrupt`;
- `RuntimeIntegrityError`;
- `Cancelled`.

Failures are attached to the narrowest stage and molecule possible. A worker
crash does not crash the desktop app. Completed chunks remain durable. Automatic
recovery is limited to smaller batches, the declared low-memory optimizer, or a
larger iteration budget. Switching to a reference engine requires an execution
policy that explicitly allows it.

The coordinator owns the process group, parent-channel lifetime, heartbeat,
restart budget, and circuit breaker. The worker exits when its parent channel
closes. Required fault states include app, helper, or MLX-child crash; Metal
command failure or hang; corrupt compiler cache; disk-full publication; runtime
upgrade while queued; forced microbatch shrink; cancellation inside a co-batch;
and partial per-molecule failure. `cancel_requested` is distinct from confirmed
`cancelled`.

## Security And Privacy

- The public API accepts only fixed, schema-validated operations.
- Input paths must be explicitly granted by the owning desktop, browser-dev, or
  agent session.
- The service binds only to a private local Unix socket with owner-only
  permissions.
- Runtime and artifact paths are canonicalized and scoped to approved roots.
- Job logs exclude raw proprietary molecule payloads by default.
- Diagnostics include hashes, sizes, versions, timings, and errors rather than
  complete structures.
- Hosted and tokenized preview surfaces cannot submit local compute jobs.
- Runtime packs are signature- and hash-verified before execution.
- Compute commands use a dedicated Tauri permission set limited to trusted main
  and workspace windows. Viewer iframes and PreviewExtension receive no compute
  permission.
- The worker emits one bounded typed `ComputeCapabilityReport`; desktop and
  browser-dev transport it rather than reimplementing capability logic.

## Validation And Delivery

Scientific acceptance gates, performance workloads, failure injection, release
proof, staged delivery, and the first vertical-slice completion contract are
defined in [GPU Compute Validation And Delivery](2026-07-15-gpu-compute-validation-and-delivery.md).

The architecture is intentionally delivered as five reviewed subprojects:
compute foundation and Tanimoto, conformers, shape/electrostatics/surfaces, GPU
QM, and unified product/Agent workflows. No later engine bypasses the foundation
or its packaged-runtime proof.

## Independent Review Record

The written design was challenged by three independent review lanes before its
initial commit:

- Functional review separated library Tanimoto clustering from symmetry-aware
  conformer pruning, required frozen DB-backed Grid scopes, namespaced analysis
  runs, representative subset export, and contextual rather than dashboard UX.
- Module review introduced engine islands and explicit materialization, fixed
  workflow templates instead of a user-defined DAG, immutable snapshots,
  separate Snapshot/EnginePack/ResultPack contracts, GPU epoch drain semantics,
  Packaging Spike 0, artifact lifecycle, and typed permissions/capabilities.
- Scientific review replaced whole-job GPU claims with stage traces, tightened
  clustering overflow and threshold semantics, made conformer randomness
  chunk-independent, separated fixed-pose CHEESE from heuristic overlay,
  labelled JFA surfaces approximate, and restricted initial QM scope to an
  independently validated closed-shell sp-only allowlist.

All stop-ship findings from these reviews are reflected in this design or its
validation companion. Later vertical slices require a fresh functional, module,
and scientific review against their concrete implementation plans.
