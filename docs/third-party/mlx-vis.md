# mlx-vis adaptation notice

Burrete's native dimensionality-reduction implementation adapts algorithmic
flow from [hanxiao/mlx-vis](https://github.com/hanxiao/mlx-vis), pinned at
commit `06c8a75ad007820b35185937f83c03e09ab6bd5b` (version 0.7.0).

The upstream package declares the Apache-2.0 license in `pyproject.toml`. The
upstream checkout at the pinned commit does not contain a standalone license
file. Authorization to adapt the source was additionally confirmed directly
with the upstream author by the Burrete product owner.

Production Burrete does not bundle Python, NumPy, or MLX. The relevant
objectives are adapted into bounded Rust graph preparation and native Metal
kernels. Chemical Space exposes UMAP, t-SNE, PaCMAP, LocalMAP, TriMap, DREAMS,
CNE, and MMAE-style manifold matching. All methods deliberately consume the
same exact Morgan-fingerprint Tanimoto neighbor graph instead of mlx-vis's
Euclidean input graph.

The MMAE option maps the manifold-matching distance objective; it does not
expose mlx-vis's reusable neural encoder or out-of-sample transform. NNDescent
is not used in this first product surface because Burrete already computes an
exact deterministic Tanimoto top-k graph on Metal. The interactive 2D renderer
uses the desktop canvas, while the rotatable 3D viewport uses Three.js/WebGL
with orbit controls and raycast picking. Embedding coordinate generation stays
on Metal, with CPU/GPU times reported separately.
