# Native Metal clustering kernels

This directory contains Burrete-owned, reviewed Metal source. It is an
independent implementation of the mathematical contract in the GPU compute
design; it does not copy or adapt `mlxmolkit` source.

`tanimoto-neighbors.v1.metal` implements only exact neighbor graph generation
for fixed 2,048-bit fingerprints. The host dispatches logical row/column tiles.
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
