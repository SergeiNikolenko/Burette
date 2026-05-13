# Renderer Support

## Overview

Burette supports several renderer paths. The Writer-like shell presents these
paths through settings, tabs, command palette actions, and preview metadata, but
renderer policy and artifact generation remain owned by Burette's runtime.

## Renderer Modes

The desktop settings expose these modes:

- Auto
- Fast XYZ SVG
- Mol* Interactive
- External xyzrender

The runtime normalizes mode names in
`apps/desktop/src-tauri/src/preview/formats.rs` and resolves unsupported
combinations back to a compatible renderer.

## Format Support

Mol* interactive preview is used for:

- PDB, ENT, PDBQT, PQR
- CIF, MCIF, MMCIF, BCIF
- SDF, SD
- MOL, MOL2
- XYZ and GRO when explicitly selected or resolved by the runtime

Inside the desktop Writer-like shell, Mol* loads through an iframe that is inset
below the top chrome. This keeps Mol* toolbar controls and canvas overlays from
stacking under Burette's tabs/titlebar while preserving the same runtime inside
the iframe. The Mol* runtime toolbar defaults to a collapsed icon-only state and
expands on hover/focus, so the molecule canvas remains the primary surface while
panel, theme, and renderer controls stay available.

Fast XYZ SVG is used for text XYZ input when the selected or automatic renderer
allows it. It parses the first frame in
`apps/desktop/src-tauri/src/preview/xyz.rs`.

External `xyzrender` is used for XYZ-like text inputs when selected, and is the
required path for extension groups that are external-renderer-only:

- CUB, CUBE
- IN, LOG, OUT
- VASP

SDF, SMILES, CSV, and TSV collection previews use the grid runtime in
`PreviewExtension/Web/grid-viewer.js` and related Quick Look grid code.

## Runtime Artifacts

The Tauri runtime writes per-preview artifacts under the preview cache and
returns metadata to the React shell. Artifacts can include:

- source data files
- generated HTML
- generated SVG for fast XYZ or external xyzrender paths
- renderer metadata
- external renderer logs

The Quick Look extension writes its own cache under the extension container and
uses the bundled web runtime in `PreviewExtension/Web/`.

## External xyzrender

`apps/desktop/src-tauri/src/preview/xyzrender.rs` searches for the executable in:

- `~/.local/bin/xyzrender`
- directories from `PATH`
- `/opt/homebrew/bin/xyzrender`
- `/usr/local/bin/xyzrender`

If the executable is missing, the runtime returns an explicit error. The caller
should surface that error in the shell rather than silently falling back, because
users choose external xyzrender for a specific output style.

## Verification

After renderer runtime changes, run:

```bash
npm run test:agent
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

After changes that can affect Finder previews, also run:

```bash
./scripts/build.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```
