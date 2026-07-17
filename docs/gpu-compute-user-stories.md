# Native Compute User Stories

This document describes how a Burrete user reaches each native compute
workflow, what input it accepts, what it produces, and how the same interaction
contract applies across supported molecular collections.

## Common Entry Point

1. Open an SDF, SMI/SMILES, CSV, or TSV molecular collection in Burrete.
2. Select molecules in the Grid card or table view. Search and filters may be
   used before selection.
3. Confirm the compute badge in the upper-right corner of Grid:
   `Metal ready` means a verified Apple GPU runtime is available. A CPU or
   unavailable badge must not be interpreted as GPU execution.
4. Run an action from the compute controls beside the renderer controls.
5. Inspect results in Grid. Workflows that create structures also open a Mol*
   tab and keep their report as a background document.

The first selected row is significant only for alignment, where it becomes the
reference pose. For all other workflows, source order is preserved only as a
stable identity and tie-break rule.

## Input And Action Matrix

| Action | Minimum input | Coordinate requirement | Primary result |
| --- | --- | --- | --- |
| Cluster | selected, filtered, or all molecular rows | none | cluster and representative columns in Grid |
| Find similar | exactly one selected row plus a successful cluster run | none | ranked top-50 analysis in Grid |
| Export diverse | a successful cluster run | none | structures, CSV table, and provenance bundle |
| Generate 3D | one or more rows with SMILES or molfile structure data | none | ranked conformers in Mol* and Grid |
| Optimize geometry | one or more selected molfiles | explicit coordinates on every selected row | optimized structures in Mol* and Grid |
| Energy & charges | one to 256 selected molfiles | explicit coordinates on every selected row | method-specific energies, charges, and report |
| Align & compare | two to 256 compatible poses | explicit coordinates on every selected row | aligned SDF, RMSD, shape, and optional ESP scores |

Disabled controls are intentional preflight feedback. In particular, a SMILES
row can be sent directly to `Generate 3D`, but it cannot be optimized, aligned,
or evaluated semiempirically until an explicit-coordinate structure exists.
Generate 3D first, then use the resulting structure collection for those
operations.

## US-1: Cluster A Molecular Library

As a cheminformatician, I want to group a collection by exact fingerprint
similarity so that I can inspect chemical series without creating a dense
pairwise matrix.

Where: Grid toolbar, `Similarity` cutoff and `Cluster selected`, `Cluster
filtered`, or `Cluster all`.

How:

1. Optionally select rows. With no selection, an active search/filter defines
   the scope; without either, the complete collection is used.
2. Choose a Tanimoto cutoff. `0.70` is the general-purpose default; higher
   values split a library into tighter series.
3. Click `Cluster ...`. Clicking the action again requests cancellation at the
   current durable stage boundary.
4. Inspect `clusterId`, representative, status, and error columns in Grid.

Result: fingerprints are packed once, Metal builds blockwise Tanimoto
neighbours and CSR without an `N x N` matrix, and deterministic CPU Butina
assigns clusters. The snapshot and artifacts remain tied to the exact source
row identities. The workflow supports large-library scheduling, including the
100k test class, subject to the current machine's checked memory plan.

## US-2: Find Molecules Similar To One Query

As a medicinal chemist, I want to select one molecule and retrieve its nearest
library neighbours so that I can explore an analogue series.

Where: Grid toolbar, `Find similar`.

How:

1. Complete clustering for the intended library snapshot.
2. Select exactly one query molecule from that snapshot.
3. Click `Find similar`.
4. Sort or filter the derived analysis by similarity or rank.

Result: Burrete reuses the verified packed fingerprints and performs an exact
top-50 Tanimoto query. It excludes the query itself and uses stable source row
identity to resolve equal scores. The action is disabled when there is no valid
cluster snapshot or the selection is not exactly one row.

## US-3: Select A Diverse Subset

As a screening scientist, I want one deterministic representative per cluster
so that I can reduce a library while retaining chemical diversity.

Where: Grid toolbar, `Export diverse` after clustering.

How:

1. Cluster the intended selected, filtered, or complete scope.
2. Click `Export diverse` and choose a destination.
3. Use the exported SDF/SMI structures and CSV table together; the provenance
   report records the source snapshot, cutoff, runtime, and representative
   decisions.

Result: export reads the immutable clustering artifacts rather than the
current mutable visual sort order.

## US-4: Generate And Rank 3D Conformers

As a molecular modeller, I want conformers for selected 2D molecules so that I
can continue with 3D inspection, optimization, scoring, or docking.

Where: Grid toolbar after selecting rows, conformer preset, MMFF selector, and
`Generate 3D`.

How:

1. Select one or more rows containing valid SMILES or molfile structure data.
2. Choose DG, KDG, ETDG, ETDGv2, ETKDG, ETKDGv2, ETKDGv3, or srETKDGv3.
   ETKDGv3 is the general default; srETKDGv3 is intended for small rings.
3. Choose MMFF94 or MMFF94s for post-embedding optimization and ranking.
4. Click `Generate 3D` and wait for the Mol* result tab.
5. Inspect per-conformer convergence, stereo status, retry count, energy, and
   seed in Grid/report rather than assuming every requested conformer passed.

Result: the selected `N molecules x K conformers` workload is divided by the
unified-memory-aware adaptive planner. DG, ETK refinement, stereo validation,
and MMFF optimization execute as durable stages; consecutive Metal stages are
valid protocol transitions. Failed structures are retained as explicit row
statuses, and converged structures are ranked by the selected MMFF energy.

## US-5: Optimize Existing Coordinates

As a computational chemist, I want to minimize supplied coordinates without
re-embedding the molecule so that the input pose remains the starting point.

Where: Grid toolbar after selecting coordinate-bearing rows, MMFF selector and
`Optimize geometry`.

How:

1. Open an SDF collection whose selected records contain explicit V2000 or
   V3000 coordinates.
2. Select the intended rows and choose MMFF94 or MMFF94s.
3. Click `Optimize geometry`.
4. Compare input and optimized coordinates in Mol* and inspect convergence and
   energy columns in Grid.

Result: Burrete does not silently generate a replacement conformer. BFGS is
selected for molecules through 32 atoms and L-BFGS for larger molecules;
non-converged cases receive the bounded retry policy and remain explicit if
they still fail.

## US-6: Calculate Approximate Energies And Charges

As a molecular modeller, I want fast approximate electronic energies and
atomic charges so that I can rank structures and supply electrostatic scoring.

Where: Grid toolbar, semiempirical method selector and `<method> energy &
charges`.

How:

1. Select one to 256 coordinate-bearing records.
2. Choose RM1, AM1, PM3, PM6, PM6_D, PM6_D3H4, PM6_SP, or AM1*.
3. Run the action and inspect method-specific total/electronic/nuclear energy,
   SCF convergence, iteration count, and atomic charge columns.
4. Use relative conformer energies only within the same method and compatible
   composition. Do not compare raw totals across different methods as if they
   shared one energy scale.

Result: SCF orchestration uses DIIS and adaptive damping; supported local
integrals, rotations, matrix operations, and corrections are dispatched to
Metal and checked against the CPU reference. PM6_D3H4 adds D3 dispersion,
H4 hydrogen bonding, and HH repulsion. Unsupported elements or non-convergence
are per-row failures, not fabricated values. Provenance reports
`nativeMetalScfHybrid` only after verified GPU work; otherwise it names the CPU
reference backend.

## US-7: Align And Compare Conformers Or Docking Poses

As a docking scientist, I want several poses aligned to one reference and
scored consistently so that I can compare geometry, shape, and electrostatics.

Where: Grid toolbar, `Align & compare`.

How:

1. Open an SDF ensemble and select two to 256 coordinate-bearing poses. The
   lowest selected source row is the reference, independent of click order.
2. If electrostatic similarity is required, first calculate one common
   semiempirical charge method for every selected pose.
3. Click `Align & compare`.
4. Inspect aligned structures in Mol*, RMSD, shape Tanimoto, electrostatic
   Carbo, and combined scores in Grid.

Result: Burrete remaps different atom orders only when element, formal charge,
bond order, and adjacency define the same molecular graph. Incompatible graphs
are rejected. Without a complete common charge run, formal molfile charges are
used; all-zero charges make electrostatic similarity unavailable instead of
reporting a false zero or perfect score.

## Universal Execution Contract

Every workflow follows the same rules:

- Selection is frozen into an immutable molecular snapshot before computation.
- Row identity, not visible sort position, owns writeback.
- Memory is admitted before dispatch and batched for Apple unified memory.
- Metal is preferred for supported numerical stages; required-GPU requests
  fail rather than silently claiming CPU work as GPU work.
- CPU/reference code remains an independent numerical validator and an honest
  fallback where policy allows it.
- Job, stage, backend, device, convergence, fallback reason, and artifacts are
  durable and inspectable.
- Repeated requests use identity-derived seeds and deterministic tie breaks.
- Ordinary production use requires neither Python nor MLX.
- Partial molecular failures remain visible per row while valid rows can still
  complete when the workflow contract permits partial success.

The reusable product boundary is therefore not a set of Grid buttons. It is the
versioned compute protocol plus MolComputeKit/Metal runtime, immutable snapshot
and artifact contracts, and typed result schemas. Grid and Mol* are Burrete
clients of that boundary; future CLI, agent, Swift, or batch clients should use
the same request and provenance contracts rather than reimplementing chemistry.

## Verification Checklist For A New Build

1. Confirm the installed app reports the real backend and Apple GPU identity.
2. Run a one-row cluster edge case, a multi-row cluster, one similarity query,
   and diverse export.
3. Run ETKDGv3 generation from SMILES and verify all durable stages complete.
4. Run both MMFF variants on a coordinate-bearing SDF.
5. Run alignment with reordered but isomorphic atom order and reject a
   different graph.
6. Run all eight semiempirical identities on known-answer coordinate fixtures.
7. Compare CPU and Metal results, inspect artifacts, and verify that fallback
   labels match actual execution.
8. Repeat under memory pressure and with invalid/unsupported rows.
9. Verify the result through the installed Grid and Mol* surfaces, not only a
   library test.
