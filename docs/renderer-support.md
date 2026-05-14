# Renderer Support

Burrete supports multiple renderer paths. The desktop shell selects a renderer
from user settings and runtime policy; Finder Quick Look uses the extension
runtime under `PreviewExtension/`.

## Renderer Modes

- `auto`: choose the fastest compatible renderer for the file.
- `molstar`: interactive Mol* preview.
- `fast-xyz`: lightweight SVG for XYZ first frames.
- `xyzrender-external`: call an external `xyzrender` executable when configured.
- `grid`: collection preview for table-like molecule files.

## Format Support

Mol* interactive preview is used for:

- PDB, ENT, PDBQT, PQR
- CIF, MCIF, MMCIF, BCIF
- SDF, SD
- MOL, MOL2
- XYZ and GRO when selected or resolved by policy

Fast XYZ is used for text XYZ input when selected or when `auto` resolves to the
fast path.

External `xyzrender` is used for XYZ-like text inputs when selected. It is also
the required path for external-renderer-only groups:

- CUB, CUBE
- IN, LOG, OUT
- VASP

SDF, SMILES, CSV, and TSV collection previews use the grid runtime.

## Runtime Artifacts

The desktop app writes generated preview artifacts through the Tauri preview
service. Quick Look writes its own cache under the extension container. Artifacts
can include source copies, generated HTML, generated SVG, renderer metadata, and
external renderer logs.

## Verification

Use the lightweight checks first:

```bash
bun run ci:fast
```

For renderer behavior changes, also verify forced previews:

```bash
./scripts/build.sh
./scripts/install.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```
