# MolComputeKit relationship

The reusable molecular compute platform is published independently as
[MolComputeKit](https://github.com/SergeiNikolenko/MolComputeKit). The first
public release is
[`v0.1.0`](https://github.com/SergeiNikolenko/MolComputeKit/releases/tag/v0.1.0),
extracted from Burrete commit
`3da922d2eb0d57008793c36e2af198345f1fb8b2`.

MolComputeKit owns the portable CPU/reference algorithms, verified Apple Metal
runtime, bounded protocol and artifact contracts, reviewed kernels, RDKit
parameter-extractor source, semiempirical provenance assets, and authenticated
out-of-process helper.

Burrete remains the product host. It owns Grid scopes, document snapshots,
database writeback, menu and Tauri commands, Mol* opening, result tables, and
reports. Those product adapters must not move into the standalone framework.

The v1 `burrete.*`, `BURRETE_COMPUTE_*`, EnginePack, ResultPack, BCEX, BMFX, and
Metal entrypoint identifiers are preserved across the extraction. They are
compatibility identities rather than product-layer dependencies. A future
neutral protocol requires a versioned v2 migration with dual readers.

The current Burrete branch retains its source-compatible integration copy while
active protocol work is in progress. Future synchronization must use a pinned
MolComputeKit tag or commit and must pass Burrete's Grid-to-3D and packaged
helper acceptance tests before the local copy is removed. Burrete must never
consume an unpinned framework `main` branch in production builds.

