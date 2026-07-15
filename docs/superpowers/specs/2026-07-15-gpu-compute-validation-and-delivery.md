# Burrete GPU Compute Validation And Delivery

Status: companion acceptance contract for the approved GPU compute platform
design; written specification pending user review.

Date: 2026-07-15

Architecture: [Burrete GPU Compute Platform Design](2026-07-15-gpu-compute-platform-design.md)

## Validation Principles

- A backend is released by scientific and operational evidence, not by reaching
  a code path labelled GPU.
- Every test distinguishes CPU semantics, numerical compute, validation, and
  artifact I/O.
- `gpuRequired` fails when a planned `numericCompute` stage runs on CPU.
- Browser development verifies contracts; only the packaged Apple Silicon app
  proves Metal execution.
- Missing reference software is a release-environment failure, not a reason to
  skip a scientific gate.

Maturity is evaluated per `workflow x method x chemistry domain x backend x
precision`. The allowed states are `experimental`, `numerically_validated`,
`chemically_validated`, `production`, and `unsupported`. A worker or package
never receives one blanket validation status.

## Contract And Data Tests

- JSON schema compatibility, unknown-field handling, and version rejection;
- fixed workflow-template validation and rejection of arbitrary stages;
- job lifecycle, persistence, revision reads, resume, and cancellation;
- MolecularSnapshot, EnginePack, and ResultPack round trips across Rust, Python,
  and Node clients;
- canonical MolecularSnapshot JSONL records and ordered source-ID/molecule-hash
  digest parity across Rust and Node golden vectors;
- ragged offsets, atom maps, units, dtype, byte order, alignment, and schema
  compatibility;
- immutable job roots, symlink rejection, file truncation, exact byte-size and
  hash checks, and mmap safety;
- source revision conflicts and standalone artifact recovery;
- bounded payload, path authorization, and dedicated Tauri permission checks;
- packaged and browser-dev adapters against the same golden job fixtures.

## Kernel Tests

- differential comparison with scalar or CPU references;
- threshold boundary, duplicate, zero, dense, and overflow cases;
- finite-difference gradients for every DG, ETK, MMFF, and QM energy term;
- chunked versus unchunked parity;
- deterministic behavior for fixed seeds and deterministic modes;
- copy counts and materialization timing at engine-island boundaries;
- memory-boundary and admission rejection before allocation;
- GPU epoch drain, command-buffer timeout, cache eviction, and worker restart.

## Chemistry Corpus

The frozen corpus covers neutral, charged, zwitterionic, aromatic,
stereochemical, macrocyclic, ionic, flexible, fused-ring, metal-containing, and
explicitly unsupported chemistry. It contains small public fixtures and a
separate non-distributable benchmark corpus.

Every fixture declares expected support, total charge, multiplicity, atom and
bond invariants, required reference methods, and allowed numerical tolerance.
Unsupported chemistry must produce a stable reason code before GPU admission.

## Clustering Gates

Library clustering and conformer pruning have separate suites.

For `cluster.v1`:

- the fingerprint contract pins RDKit version, Morgan radius, bit count,
  chirality, feature mode, sanitization, and input order;
- fingerprint bit vectors exactly match that declared RDKit baseline;
- Tanimoto threshold comparison uses integer or rational cross-multiplication,
  or proves exact boundary parity against a double-precision reference;
- neighbor sets match for zero fingerprints, duplicates, ties, threshold
  boundaries, sparse data, and adversarial dense graphs;
- CSR uses `uint64` offsets and edge counts; `maxEdges` is the explicit maximum
  number of qualifying undirected record pairs (one `{i, j}` pair counts once,
  while symmetric CSR stores two entries), and tiled cancellable dispatches
  replace one unbounded `O(N^2)` command;
- Butina cluster membership, ordering, and chosen representatives match the
  frozen CPU reference;
- selected, filtered, and all-row scopes use the frozen Grid revision;
- namespaced analysis runs never overwrite descriptor values or another run;
- representative subset export round-trips molecule identity and provenance.

For conformer pruning:

- symmetry-aware RMSD is compared with the designated reference mapping;
- atom ordering and symmetry classes are preserved;
- pruning thresholds and representative selection are deterministic.

The product term is `representative`, not `centroid`, unless a future algorithm
computes a defined geometric centroid.

## Conformer Gates

- exact graph, element, isotope, formal charge, bond order, atom-map, and stereo
  preservation for every supported output;
- independent checks that DG, collapse, ETK, and MMFF stages changed the intended
  objective and did not silently no-op;
- finite-difference gradient tests per energy and restraint term;
- MMFF energy comparison by term and total at each supported dtype;
- random starts derived only from global seed, stable molecule ID, conformer
  ordinal, and algorithm version;
- identical random starts across chunk size, retry, job order, and memory
  pressure changes;
- same-device coordinate reproducibility within a declared epsilon, plus
  cross-device validity and statistical ensemble parity rather than false
  bit-exactness claims;
- MMFF single-point energy and maximum gradient-component differences at most
  `1e-3 kcal/mol` and `1e-3 kcal/mol/angstrom` for the normal validated domain;
- final gradient norm, finite coordinates and energies, clash checks, and an
  explicit non-convergence reason;
- success rate no worse than RDKit by more than two percentage points in each
  chemistry stratum at equal compute budget;
- median and p90 symmetry-aware best-of-k RMSD no worse than RDKit by more than
  0.10 and 0.20 angstrom respectively;
- minimum distinct-conformer diversity inside the declared energy window;
- macrocycle, ion, fixed-core, unsupported-element, and chirality failure paths;
- ensemble artifact, trajectory, Grid column, and viewer handoff validation.

DG, KDG, ETDG, ETDGv2, ETKDG, ETKDGv2, ETKDGv3, and srETKDGv3 are separate
capabilities. Constraint extraction may not swallow exceptions. Each manifest
records counts and hashes for every active constraint family, and small-ring and
macrocycle fixtures prove that the selected variant activates its intended
terms. Until those gates pass, the product claims only the explicitly validated
feature subset rather than drop-in ETKDG parity.

Corpus revisions and tolerance changes require a versioned benchmark change.
Atropisomerism, disconnected salts, radicals, organometallics, and coordination
chemistry remain explicit rejection domains until they receive separate
contracts.

## Shape, Electrostatics, And Surface Gates

CHEESE scoring requires:

- exact fixed-pose float32 GPU scoring against an independent float64 Gaussian
  shape and ESP formula;
- self-score, A-to-B symmetry, paired/matrix parity, and rigid-transform
  invariance;
- known-transform recovery, mirror/chiral counterexamples, and symmetric or
  near-degenerate principal axes;
- bounded pair tiling with no full unbounded library matrix;
- terminology that separates `exact fixed-pose Gaussian score`, `heuristic rigid
  overlay search`, and `learned approximate retrieval embedding`;
- a heuristic overlay objective no worse than the frozen robust CPU multi-start
  result by more than `1e-4` for at least 99.5% of the frozen pair corpus;
- top-K recall, Spearman correlation, and NDCG against exact-score ranking;
- GPU screening followed by explicitly labelled CPU refinement when used.

SES requires:

- `preview_jfa` field error p50, p95, and maximum against exact EDT;
- `validated_exact` kept as the reference label until an exact GPU EDT exists;
- no silent default van der Waals radius for an unknown element;
- area and volume convergence at 0.5, 0.3, 0.2, and 0.15 angstrom spacing;
- cavity, channel, disconnected-component, narrow-neck, topology, normal, and
  watertightness checks;
- every mesh edge belonging to two faces, with no degenerate triangles or
  detected self-intersections;
- translation, rotation, and grid-origin sensitivity tests;
- hard voxel and axis rejection before allocation;
- field-only and mesh-producing paths tested separately;
- visual snapshots in the packaged viewer without making Mol* depend on compute;
- explicit approximation and uncertainty metadata in every JFA artifact.

## QM And Charge Gates

Each method and element set has an explicit capability entry. NDDO validation
requires:

- total-charge conservation;
- electron count and multiplicity validation;
- density trace, idempotency diagnostics, and SCF convergence;
- frozen independent OpenMOPAC references that are mandatory in release CI;
- identical-geometry heat-of-formation error at most `0.5 kcal/mol` and maximum
  charge error at most `0.002 e` for each allowed method-element combination;
- GPU versus float64 CPU comparison of energy, charges, density, Fock matrix,
  SCF root, residual, commutator, and convergence reason;
- atom-permutation, rigid translation/rotation, batch-padding, and bucket-size
  invariance;
- separate evidence for GPU eigensolve, CPU eigensolve, and mixed paths;
- no promotion of open-shell support from a closed-shell implementation;
- an initial allowlist restricted to proven closed-shell RM1/AM1 sp-only
  chemistry;
- PM3, PM6, PM6_D, radicals, odd-electron species, transition metals, excited
  states, and multiplicity reported as unsupported until independently proven;
- no AM1-BCC claim until parameter data, licensing, and provenance are present.

## Performance And Memory Matrix

Measurements separate runtime startup, Metal compilation, warm execution, CPU
preparation, cross-island materialization, GPU execution, validation, and
artifact writing.

The minimum hardware matrix contains an 8 GB M1-class device, a mid-tier 16 to
32 GB M2/M3-class device, and a 64 GB or larger M3/M4 Max-class device.

Representative workloads:

- one molecule with one and with 64 conformer candidates;
- 20 molecules with 50 candidates each;
- 100 molecules with 10 candidates each;
- 1,000, 10,000, 50,000, and 100,000 fingerprint similarity workloads;
- sparse and intentionally dense neighbor graphs;
- bounded low-, medium-, and high-resolution surface grids;
- fixed-pose pairs, overlay pairs, and 1k/10k/100k shape-search candidates;
- surface spacing at 0.5, 0.3, and 0.2 angstrom on a small drug, macrocycle, and
  cavity-bearing system;
- supported small and medium closed-shell QM buckets.

A GPU backend becomes the default only after all scientific gates pass and warm
batch throughput is statistically better on its intended workload. The initial
target is at least a 2x warm batch speedup without a quality regression. Cold
startup and single-molecule latency are always reported and never hidden behind
batch throughput.

Each workload records fresh-process cold compile and warm p50/p95 over at least
five measured runs, with fixed reference versions and thread counts. Kernel-only
and end-to-end results are separate; end-to-end clustering includes CPU
fingerprint generation. GPU utilization alone is not an acceptance metric.

Each workload asserts peak unified memory, swap, CPU RSS, temporary storage,
copy bytes, CPU/GPU time, command-buffer duration, renderer frame pacing, and
memory release under 50%, 80%, and 95% memory-pressure scenarios. Cancellation
should be visible within two seconds at a bounded chunk boundary. A terminated
service should release process-owned memory within five seconds.

## Reliability And Release Matrix

- runtime install, health check, atomic activation, rollback, offline restart,
  uninstall, and update while a job is active;
- helper kill, MLX child crash, Metal command failure or hang, corrupt compiler
  cache, corrupt manifest, corrupt pack, disk full, and incompatible protocol;
- memory-pressure rejection, forced microbatch shrink, and high-watermark worker
  restart;
- cancellation of one job inside a co-batch without corrupting other outputs;
- concurrent client submissions with one logical GPU lease;
- app restart with queued, waiting, running, interrupted, succeeded, and
  partially succeeded jobs;
- dropped or reordered event notifications followed by durable revision reads;
- pinned runtime drain before update activation;
- artifact references, pins, quota, export, purge, and garbage collection;
- signed and notarized packaged execution with no development paths or disabled
  library validation;
- browser-dev contract verification as a separate lane;
- Quick Look and iPhone opening generated SDF, mesh, and report artifacts without
  a running compute service;
- hosted/public surfaces remaining unable to address local compute;
- `gpuRequired` failure whenever a planned numerical GPU stage ran on CPU.

The strict-backend suite intentionally breaks a Metal kernel and verifies a
structured failure instead of CPU fallback. It also verifies the full stage
trace: requested and effective backend, device, precision, kernel ID, GPU and
host time, transfer bytes, and fallback reason.

## Delivery Decomposition

This program is delivered as five separately reviewed design and implementation
cycles.

### 1. Compute foundation and Tanimoto

- Packaging Spike 0 in a signed and notarized app;
- protocol crate and fixed `cluster.v1` template;
- coordinator, immutable snapshots, durable jobs, attempts, bounded events, and
  artifact publication;
- capability handshake, execution plan, GPU epoch/drain, memory admission, and
  typed compute doctor;
- source-built fused Tanimoto, CPU Butina, and namespaced Grid analysis runs;
- selected, filtered, and all-row scopes, progress, cancellation, crash/restart,
  representative export, runtime rollback, and artifact GC.

### 2. Conformer engine

- conformer EnginePack schemas and `N x k` scheduling;
- DG, collapse, ETK, MMFF, RMSD pruning, stereo and energy validation;
- ensemble ResultPack, SDF/trajectory artifacts, and viewer handoff.

### 3. Shape, electrostatics, and surfaces

- tiled CHEESE scoring, top-K screening, and alignment policy;
- ESP artifacts, SES fields, mesh production, and viewer overlays.

### 4. GPU QM and charges

- method capability matrix and execution plans;
- closed-shell AM1/RM1 research path and independent references;
- explicit blocked states for incomplete methods and datasets.

### 5. Unified product and Agent workflows

- final Compute jobs dock migration;
- CLI and observe/action contracts, then bounded MCP wrappers;
- settings, diagnostics, retention controls, and cross-surface release evidence.

The capability release order is native Tanimoto exact-contract, conformer
kernel differential harness, validated conformer product, fixed-pose CHEESE,
heuristic overlay, `preview_jfa` surface, and closed-shell RM1/AM1 sp-only Labs.
PM6/PM6_D, learned CHEESE, and exact GPU SES remain separate research tracks.

## First Vertical Slice Completion Contract

The foundation slice is complete only when a packaged Apple Silicon desktop can:

1. freeze a selected, filtered, or all-row Grid scope;
2. submit `cluster.v1` through the stable protocol;
3. prepare the declared RDKit fingerprint baseline;
4. execute Tanimoto neighbor generation on native Metal inside a bounded GPU
   epoch;
5. perform deterministic CPU Butina selection;
6. publish a namespaced analysis run with cluster and representative columns;
7. export a representative subset and provenance manifest;
8. cancel safely and recover after helper or app restart;
9. prove exact end-to-end parity with the frozen CPU reference;
10. install, activate, roll back, and uninstall its signed runtime components;
11. pass artifact retention and garbage-collection smoke tests.

Browser development must exercise the same request and result schemas, while
the packaged app supplies actual Metal evidence. Quick Look, iPhone, and hosted
surfaces remain unchanged except that they can open generated artifacts.

Only after this slice and its runtime distribution have independent approval
may the conformer engine enter implementation.
