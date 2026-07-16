# Native Metal compute kernels

This directory contains reviewed Metal source owned or adapted by Burrete.
Each adapted numeric map is tied to its pinned upstream path and commit in the
provenance ledger; production kernels do not load Python or MLX.

`tanimoto.v2.metal` implements exact neighbor graph generation and exact
one-query-to-library scoring for fixed 2,048-bit fingerprints. Graph generation
dispatches logical row/column tiles. Query scoring emits one `uint2` containing
the integer `(intersection, union)` counts per source record in bounded row
batches; ranking stays deterministic on the CPU and no floating-point score is
part of the Metal ABI.

`mmff-energy.v1.metal` evaluates all seven supported MMFF94/MMFF94s energy
terms for conformer batches and exposes a bounded central-difference gradient
used as an independent bring-up/parity path. Production optimization may reuse
the energy evaluator but must not claim analytic gradients until a separately
verified analytic kernel replaces this reference entrypoint.

`alignment-score.v1.metal` performs mapped Horn/quaternion alignment, weighted
RMSD, analytic Gaussian shape overlap, and ESP-Sim Gaussian Coulomb scoring.
One thread owns one admitted pair and emits only a rigid transform plus scalar
scores. Probe/reference atom arrays and mappings are shared across descriptors,
so ensemble and docking-pose comparisons do not materialize a
`poses x references x atoms x 3` tensor. Fixed-pose scoring is an explicit mode;
mapped alignment never assumes equal atom order implicitly.

`rm1-fock.v1.metal` contracts pre-rotated RM1/NDDO two-center repulsion
tensors into Coulomb and exchange Fock contributions. One thread owns one
matrix element, loops pairs and local orbitals in canonical order, and writes
without atomics. The runtime compares every SCF contraction with the float64
CPU reference before accepting the GPU result.

`rm1-eigen.v1.metal` diagonalizes batches of symmetric matrices through order
32 with one 32-thread threadgroup per matrix. A maximum-pivot Jacobi sweep
emits sorted eigenpairs from fixed padded slots. The host applies a trace shift
and spectral scaling, verifies eigenvalues, residuals, and orthogonality against
the float64 oracle, then switches only the converged tail of SCF to float64 when
the changing Fock matrix reaches the float32 accuracy floor.

`rm1-pair-rotate.v1.metal` generates compact local RM1 two-center integrals,
then transforms them into complete molecular-frame pair tensors and both core-attraction matrices.
One thread owns one atom pair, including the explicit heavy/H transpose path.
The runtime compares every emitted tensor element with the float64 CPU oracle
before the prepared pair pack is admitted to core-Hamiltonian and SCF use.

`pm6-h4-hh.v1.metal` evaluates the Rezac-Hobza H4 hydrogen-bond and
short-range H-H correction terms for molecule batches. One thread owns one
molecule, so independent library molecules execute concurrently without
cross-molecule atomics or intermediate triple tensors. Every two-component
result must pass the bounded float64 CPU oracle before it is reported as GPU
work.

`pm6-d3.v2.metal` evaluates zero-damping D3 dispersion over the complete pinned
Z=1--94 table using checked-in compact C6/CN interpolation records and r0 pair
radii. It shares the one-thread-per-molecule batch shape and is composed with
H4/HH only after both GPU outputs pass their float64 CPU references.

`pm6-one-center-fock.v1.metal` contracts batched 243-term PM6 W tables with
symmetric 9x9 density blocks. One GPU thread owns one of the 45 packed output
elements and writes its symmetric pair without atomics. The integer map is
generated from the pinned upstream/PYSEQM reference; every output element must
pass the native float64 CPU contraction before the block is admitted.

`pm6-pair-fock.v1.metal` contracts complete variable-basis PM6 pair tensors
for 1-, 4-, and 9-orbital atoms. Descriptors carry the exact tensor stride, so
unequal 9x1 and 9x4 pairs never use the fixed RM1 4x4 layout. One thread owns
one molecular Fock element, accumulation order is deterministic, and every
dispatch is compared elementwise with the float64 CPU contraction.

The canonical EnginePack row is little-endian `u64[32]`. Metal reads the same
256 bytes as `uint32[64]`, low 32 bits then high 32 bits for each canonical
word. This is a byte-identical view on supported little-endian Apple Silicon;
it is not a second persisted fingerprint format.
One thread owns one row for the entire dispatch, so degree accumulation and CSR
fill need no atomics. The ordered logical rectangles must be a gapless,
non-overlapping partition of `[0, N) x [0, N)`. Columns advance contiguously for
each row; this makes every CSR row ascending without a GPU sort. Dispatches that
touch the same row execute serially on one command queue, and fill repeats the
exact count-pass tile sequence.

Before dispatch, the host must validate the checked-in kernel contract, the
precompiled library hash, buffer sizes, normalized cutoff, `recordCount <=
UINT32_MAX`, and the contract's 1,024-by-1,024 tile bounds. It must zero
degree/status buffers, initialize each cursor from its row offset, and assert
the host `TanimotoTileV1` size/alignment/field offsets against the machine
contract. It must enforce the undirected edge budget as
`sum(degrees) / 2`, and reject odd degree sums. After fill, every status must be
zero and every cursor must equal the next row offset. A mismatch is a typed
failure; output is never truncated.

The cutoff comparison is integer-only. With 2,048 fingerprint bits and cutoff
terms no larger than `2^53 - 1`, either cross product fits `uint64`. A zero union
matches only when the cutoff numerator is zero.

Build the reviewed source explicitly when inspecting or testing an individual
runtime generation:

```bash
compute/metal/build-metallib.sh /explicit/output/directory
```

`scripts/build.sh` invokes this generator in its isolated build tree before
Tauri packages resources, so a package cannot silently omit the GPU runtime.
The generator fails if the active Xcode SDK cannot execute `metal` and
`metallib`.
It publishes one complete generation through an atomic `current.json`
pointer. The generation contains AIR, metallib, and metadata with source,
contract, compiler, linker, and SDK identities. Runtime compilation is not
supported.
