# Chemical-space Metal benchmark: MOSES 10K on Apple M2 Pro

Date: 2026-07-23

Device: Apple M2 Pro, 19-core integrated GPU, Metal supported.

Runtime: `burrete-native-metal-v22`

Metallib SHA-256:
`765166a64f5e5713a4796711c8288fbadf6b40a6eb7e55682e330d700390b923`

Dataset: `moses-10k.csv`, first 10,000 rows, SHA-256
`df4cd79b9497d47c6d5a6adbe85ab691d639af412a4914be2cc8dba553e1c64c`.

## Parameters

- RDKit `2025.03.4`
- Morgan radius 2, 2,048 bits, chirality enabled, feature invariants disabled
- Exact Tanimoto top-K with `k=15`
- 500 embedding epochs
- `min_dist=0.1`, `spread=1.0`, learning rate `1.0`
- Random seed 42
- 4 GiB admitted memory

RDKit produced 9,917 valid fingerprints and rejected 83 records during
sanitization. Fingerprint generation took 4,306.7 ms. All reported embedding
runs used the same valid 9,917-record subset.

## Results

| Method | Dimensions | Tanimoto GPU | Embedding GPU | Native host total | Process wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| UMAP | 2D | 8,874 ms | 986 ms | 10,379.1 ms | 10,623.5 ms |
| t-SNE | 2D | 8,892 ms | 987 ms | 10,377.6 ms | 10,543.4 ms |
| PaCMAP | 2D | 8,869 ms | 975 ms | 10,353.5 ms | 10,527.9 ms |
| LocalMAP | 2D | 8,864 ms | 982 ms | 10,343.1 ms | 10,505.5 ms |
| TriMap | 2D | 8,874 ms | 989 ms | 10,375.9 ms | 10,536.3 ms |
| DREAMS | 2D | 8,905 ms | 984 ms | 10,406.3 ms | 10,585.0 ms |
| CNE | 2D | 8,866 ms | 989 ms | 10,437.5 ms | 10,662.9 ms |
| MMAE | 2D | 8,873 ms | 988 ms | 10,368.7 ms | 10,628.5 ms |
| UMAP | 3D | 8,866 ms | 983 ms | 10,375.0 ms | 10,586.5 ms |
| t-SNE | 3D | 8,830 ms | 985 ms | 10,307.4 ms | 10,538.8 ms |
| PaCMAP | 3D | 8,884 ms | 991 ms | 10,389.9 ms | 10,612.6 ms |
| LocalMAP | 3D | 8,876 ms | 991 ms | 10,334.4 ms | 10,506.1 ms |
| TriMap | 3D | 8,857 ms | 985 ms | 10,350.2 ms | 10,516.8 ms |
| DREAMS | 3D | 8,862 ms | 989 ms | 10,365.5 ms | 10,525.2 ms |
| CNE | 3D | 8,851 ms | 983 ms | 10,347.2 ms | 10,501.6 ms |
| MMAE | 3D | 8,864 ms | 988 ms | 10,351.6 ms | 10,512.1 ms |

The eight-method average was 10,380.2 ms in 2D and 10,352.6 ms in 3D.
Across all runs, exact Tanimoto top-K consumed 85.6% of native host time.
The active 2D and 3D coordinates share the same `float4` storage, so 3D did
not produce a measurable slowdown on this workload.

The current workflow rebuilds exact Tanimoto top-K for every method change.
Caching the fingerprint-derived neighbor graph would remove about 8.87 seconds
from repeat method or dimension switches on this machine.

`Native host total` is measured inside the chemical-space operation and
excludes RDKit preprocessing and process startup. `Process wall` includes
loading the standalone benchmark backend. The desktop app keeps its native
runtime alive, so `Native host total` is the more representative repeat-run
metric.

## Reproduction

```bash
cargo build \
  --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --bin burrete-compute-dev-backend

node scripts/benchmark-chemical-space.mjs \
  --input /path/to/moses-10k.csv \
  --runtime-root /path/to/ComputeMetal \
  --records 10000 \
  --dimensions 2,3 \
  --epochs 500 \
  --output build/reports/chemical-space-moses-10k-metal.json
```
