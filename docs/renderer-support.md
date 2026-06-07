# Renderer Support

Burrete supports multiple renderer paths. The desktop shell selects a renderer
from user settings and runtime policy; Finder Quick Look uses the extension
runtime under `PreviewExtension/`.

## Renderer Modes

- `auto`: choose the fastest compatible renderer for the file.
- `molstar`: interactive Mol* preview.
- `xyzrender-external`: call an external `xyzrender` executable when configured.
- `grid`: collection preview for table-like molecule files.

## Format Support

Mol* interactive preview is used for:

- PDB, ENT, PDBQT, PQR
- CIF, MCIF, MMCIF, BCIF
- SDF, SD
- MOL, MOL2
- XYZ and GRO when selected or resolved by policy

External `xyzrender` is used for text XYZ input when selected or when `auto`
resolves to the default preview path. It is also the required path for
external-renderer-only groups:

- CUB, CUBE
- ABI, COM, FDF, IN, INP, NW, OUT, PSI4, QCIN
- VASP

SDF, SMILES, CSV, and TSV collection previews use the grid runtime.

## Ketcher Editing

The embedded Ketcher page is currently a small-molecule and reaction editor.
It exposes import and export actions for SMILES, Extended SMILES, Molfile,
RXN, KET, SDF, RDF, SMARTS, CML, CDXML, CDX, InChI, InChIKey, and SVG when the
installed Ketcher packages support the format.

Macromolecule editing is intentionally disabled in the current integration.
Do not expose HELM, FASTA, sequence, IDT, or AxoLabs import/export controls
until `ketcher-macromolecules` is installed and verified with the same Ketcher
version as `ketcher-core`, `ketcher-react`, and `ketcher-standalone`. Validate
that the small-molecule toolbar, the Ketcher zoom selector, and the Burette
scale control stay synchronized before enabling that path.

## Runtime Artifacts

The desktop app writes generated preview artifacts through the Tauri preview
service. Quick Look writes its own cache under the extension container. Artifacts
can include source copies, generated HTML, generated SVG, renderer metadata, and
external renderer logs.

Desktop and Quick Look web assets are grouped by runtime profile in
`config/web-runtime-profiles.json`. See [Performance architecture](performance.md)
for profile membership, cache layout, binary payload loading, RDKit WASM
loading, grid search, and no-regression guardrails.

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
