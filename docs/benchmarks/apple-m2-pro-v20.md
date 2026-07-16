# Native Metal v20 benchmark: Apple M2 Pro

Date: 2026-07-16

Runtime: `burrete-native-metal-v20`

Metallib SHA-256:
`341d858756cfd33438304e0d643d4ad647081df7678f88e407cc2734e87a2c84`

Device: Apple M2 Pro, unified memory, registry ID `0x1000003c0`.

The reproducible ignored test is
`runtime::tests::benchmarks_large_fingerprint_libraries_on_the_real_gpu` in
`burrete-compute-metal`. It uses deterministic synthetic 2,048-bit
fingerprints so scale, exact-count parity, bounded CSR allocation, and device
timing are isolated from RDKit extraction time.

## Results

| Operation | Records | Edges | GPU time | Host time |
| --- | ---: | ---: | ---: | ---: |
| Exact Tanimoto query | 100,000 | n/a | 1-2 ms | 7-10 ms |
| Exact cutoff-0.95 CSR count | 100,000 | 0 | 27,567 ms | 29,594 ms |
| Dynamic-count Butina over the 100k CSR | 100,000 | 0 | CPU | 66 ms |
| Exact cutoff-1.0 CSR count and fill | 10,000 | 5,000 | 526 ms | 590 ms |

The 100k graph test uses a 512 MiB admission limit and never materializes an
`N x N` matrix. The empty-edge corpus intentionally measures the complete
quadratic exact-count path without output-density allocation. The paired 10k
corpus separately exercises CSR fill and deterministic Butina membership.

The prior linear-scan Butina representative selection was `O(N^2)` for an
isolated graph. The benchmark gate now uses a lazy deterministic priority queue
and preserves maximum-live-degree selection with the lowest source index as the
tie-break. Its memory admission includes the worst-case stale queue entries.

These numbers are engineering evidence for this named machine and runtime, not
a cross-device performance promise. Real Morgan fingerprint density and cutoff
change edge count and fill cost; release qualification should retain a real
chemical-library benchmark in addition to this deterministic scale fixture.

## Commands

```bash
BURRETE_METAL_RUNTIME_ROOT=/tmp/burrete-metal-v20.final \
BURRETE_METAL_GRAPH_BENCHMARK_COUNT=100000 \
cargo test -p burrete-compute-metal \
  benchmarks_large_fingerprint_libraries_on_the_real_gpu \
  -- --ignored --nocapture
```
