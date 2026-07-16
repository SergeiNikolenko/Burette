# Native Metal compute kernels

This directory contains Burrete-owned, reviewed Metal source. It is an
independent implementation of the mathematical contract in the GPU compute
design; it does not copy or adapt `mlxmolkit` source.

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
