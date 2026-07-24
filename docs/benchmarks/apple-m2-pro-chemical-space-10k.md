# Chemical-space Metal benchmark: MOSES 10K on Apple M2 Pro

Date: 2026-07-23

Device: Apple M2 Pro, 19-core integrated GPU, Metal supported.

Runtime: `burette-native-metal-v22`

Metallib SHA-256:
`765166a64f5e5713a4796711c8288fbadf6b40a6eb7e55682e330d700390b923`

Dataset: 10,000 valid molecules assembled from:

- 9,917 accepted records from `moses-10k.csv`, SHA-256
  `df4cd79b9497d47c6d5a6adbe85ab691d639af412a4914be2cc8dba553e1c64c`
- 83 accepted records from the bundled Datamol ChEMBL sample, SHA-256
  `91de31d15601dd8c8d909f33c9655c8b9073fb311ff52985a4afd2a9c9556cfc`

## Parameters

- RDKit `2025.03.4`
- Morgan radius 2, 2,048 bits, chirality enabled, feature invariants disabled
- Exact Tanimoto top-K with `k=15`
- 500 embedding epochs
- `min_dist=0.1`, `spread=1.0`, learning rate `1.0`
- Random seed 42
- 4 GiB admitted memory

RDKit attempted 10,083 records, produced exactly 10,000 valid fingerprints,
and rejected 83 MOSES records during sanitization. Fingerprint generation
took 4,556.4 ms. All reported embedding runs used the same valid 10,000-record
set.

## Results

| Method | Dimensions | Tanimoto GPU | Embedding GPU | Native host total | Process wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| UMAP | 2D | 8,275 ms | 981 ms | 9,750.6 ms | 9,994.3 ms |
| t-SNE | 2D | 8,265 ms | 990 ms | 9,738.9 ms | 9,897.4 ms |
| PaCMAP | 2D | 8,277 ms | 986 ms | 9,759.4 ms | 9,918.0 ms |
| LocalMAP | 2D | 8,267 ms | 985 ms | 9,760.4 ms | 9,922.8 ms |
| TriMap | 2D | 8,273 ms | 990 ms | 9,775.7 ms | 9,945.2 ms |
| DREAMS | 2D | 8,279 ms | 989 ms | 9,778.4 ms | 9,944.1 ms |
| CNE | 2D | 8,268 ms | 984 ms | 9,763.2 ms | 9,941.4 ms |
| MMAE | 2D | 8,275 ms | 985 ms | 9,778.5 ms | 9,951.1 ms |
| UMAP | 3D | 8,268 ms | 987 ms | 9,747.1 ms | 9,918.0 ms |
| t-SNE | 3D | 8,262 ms | 987 ms | 9,746.3 ms | 9,908.5 ms |
| PaCMAP | 3D | 8,273 ms | 980 ms | 9,775.2 ms | 9,940.4 ms |
| LocalMAP | 3D | 8,262 ms | 985 ms | 9,751.8 ms | 9,911.7 ms |
| TriMap | 3D | 8,262 ms | 988 ms | 9,756.6 ms | 9,918.6 ms |
| DREAMS | 3D | 8,263 ms | 987 ms | 9,747.0 ms | 9,909.6 ms |
| CNE | 3D | 8,263 ms | 986 ms | 9,755.0 ms | 9,923.7 ms |
| MMAE | 3D | 8,265 ms | 988 ms | 9,757.7 ms | 9,919.3 ms |

The eight-method average was 9,763.1 ms in 2D and 9,754.6 ms in 3D.
Across all runs, exact Tanimoto top-K consumed 84.7% of native host time.
The active 2D and 3D coordinates share the same `float4` storage, so 3D did
not produce a measurable slowdown on this workload.

The current workflow rebuilds exact Tanimoto top-K for every method change.
Caching the fingerprint-derived neighbor graph would remove about 8.27 seconds
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
  --bin burette-compute-dev-backend

node scripts/benchmark-chemical-space.mjs \
  --input /path/to/moses-10k.csv \
  --supplement /path/to/chembl_samples.csv \
  --runtime-root /path/to/ComputeMetal \
  --records 10000 \
  --dimensions 2,3 \
  --epochs 500 \
  --output build/reports/chemical-space-moses-10k-metal.json
```
