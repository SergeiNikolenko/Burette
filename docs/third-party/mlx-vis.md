# mlx-vis adaptation notice

Burrete's native dimensionality-reduction implementation adapts algorithmic
flow from [hanxiao/mlx-vis](https://github.com/hanxiao/mlx-vis), pinned at
commit `06c8a75ad007820b35185937f83c03e09ab6bd5b` (version 0.7.0).

The upstream package declares the Apache-2.0 license in `pyproject.toml`. The
upstream checkout at the pinned commit does not contain a standalone license
file. Authorization to adapt the source was additionally confirmed directly
with the upstream author by the Burrete product owner.

Production Burrete does not bundle Python, NumPy, or MLX. The relevant
algorithms are adapted into bounded Rust reference code and native Metal
kernels, with parity tests against pinned upstream fixtures. The initial port
covers UMAP; the same provenance applies as PaCMAP, LocalMAP, t-SNE, TriMap,
DREAMS, CNE, MMAE, NNDescent, and GPU rendering are introduced.
