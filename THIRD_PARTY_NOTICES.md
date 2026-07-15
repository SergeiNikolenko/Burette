# Third-party notices

## Mol*

The preview engine vendors `molstar/build/viewer/molstar.js` and `molstar/build/viewer/molstar.css` from the `molstar` package at build time. Mol* is MIT-licensed by its contributors. See the `molstar` package and repository for the authoritative license text.

## QuickLookProtein

This project follows the same broad product idea as QuickLookProtein: a host macOS app that packages a Quick Look extension and renders protein/3D structure files in a WebKit view. No QuickLookProtein source files are vendored here.

## xyzrender

Burrete can call a user-installed `xyzrender` executable from the standalone app and Quick Look previews. The `xyzrender` Python package is MIT-licensed by Alister S. Goodfellow and contributors. `xyzrender` itself is not bundled with Burrete.

## mlxmolkit and native GPU Compute Layer provenance

The Burrete project owner records that Guillaume, author of
[`guillaume-osmo/mlxmolkit`](https://github.com/guillaume-osmo/mlxmolkit),
granted permission to copy and adapt useful code and algorithmic logic for the
Burrete native GPU Compute Layer. The pinned audit source is commit
`9e7337f6f93c40a39ad0187991151944a4f1e274`.

The pinned repository contains no top-level `LICENSE` file, although its
package metadata declares MIT. No upstream source is currently shipped in the
Compute Layer. Before an adapted file is added, Burrete must preserve the
permission evidence and add a file-level provenance record mapping the Burrete
path to the upstream path and commit.

Upstream identifies material derived from or compared with nvMolKit
(Apache-2.0), Shivam Patel's `mlxmolkit` (MIT), PYSEQM (BSD-3-Clause), and
OpenMOPAC (Apache-2.0). Permission from the primary author does not replace
notices or license obligations for those secondary sources. Their applicable
copyright and license texts must be included when such material is adapted.
