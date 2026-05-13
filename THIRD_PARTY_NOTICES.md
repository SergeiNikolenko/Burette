# Third-party notices

## Writer Computer

Burrete's migrated desktop shell, repository skeleton, docs reference material,
and migration specs use Writer Computer as source material with author
permission. The upstream Writer Computer checkout used for this migration
includes a GNU GPL v3 license file; a copy is preserved at
`THIRD_PARTY_LICENSES/Writer-Computer-GPL-3.0.txt`.

## Mol*

The preview engine vendors `molstar/build/viewer/molstar.js` and `molstar/build/viewer/molstar.css` from the `molstar` npm package at build time. Mol* is MIT-licensed by its contributors. See the `molstar` package and repository for the authoritative license text.

## QuickLookProtein

This project follows the same broad product idea as QuickLookProtein: a host macOS app that packages a Quick Look extension and renders protein/3D structure files in a WebKit view. No QuickLookProtein source files are vendored here.

## xyzrender

Burrete can call a user-installed `xyzrender` executable from the standalone app and includes an independent dependency-free JavaScript Fast XYZ renderer for Quick Look and app previews. The `xyzrender` Python package is MIT-licensed by Alister S. Goodfellow and contributors. `xyzrender` itself is not bundled with Burrete.
