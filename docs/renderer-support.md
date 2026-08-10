# Renderer Support

Burette supports multiple renderer paths. The desktop shell selects a renderer
from user settings and runtime policy; Finder Quick Look uses the extension
runtime under `PreviewExtension/`.

## Renderer Modes

The user-facing global renderer setting exposes `auto`, `molstar`, and
`xyzrender-external`:

- `auto`: choose the fastest compatible renderer for the file.
- `molstar`: interactive Mol* preview.
- `xyzrender-external`: call an external `xyzrender` executable when configured.

Per-document renderers are selected by the format registry rather than the
global setting: `grid2d` (collection preview for table-like molecule files),
the Mesoscale runtime, and the spectrum viewer.

## Format Support

Mol* interactive preview is used for:

- PDB, ENT, XPDB, PDBQT, PQR
- CIF, MCIF, MMCIF, BCIF
- SDF, SD
- MOL, MDL, MOL2
- MMTF
- XYZ and GRO when selected or resolved by policy
- MolViewSpec scene files: MVSJ and MVSX
- volume/density maps: CCP4, MRC, MAP
- reflection data: MTZ (2Fo-Fc and signed Fo-Fc maps)
- converted pharmacophore models: PH4
- converted Schrödinger structures: MAE, MAE.GZ, MAEGZ, CMS
- molecular dynamics trajectories with trajectory controls: topology plus
  coordinate pairs (for example XTC/TRR next to a topology), and trajectories
  without a topology through synthetic topology generation

Mesoscale documents (`molj`, `molx`, `.mesozip` packages, and
CellPack/Petworld-style CIF paths) open in the dedicated Mesoscale runtime
rather than the standard Mol* viewer.

External-renderer text formats (CUB/CUBE, ABI, COM, FDF, FHIAIMS, GMS, IN,
INP, LOG, NW, OUT, PSI4, QCIN, VASP, XYZR) are converted to PDB through the
required `text-coordinates-to-pdb` converter and open in Mol* on `auto`; the
external `xyzrender` renderer is the registered fallback and is used when the
conversion fails or when the user selects `xyzrender-external`.

SDF, SMILES, CSV, TSV, and DataWarrior (`.dwar`) collection previews use the
`grid2d` runtime. DataWarrior IDCode and coordinate columns are decoded
locally with the bundled OpenChemLib runtime; ordinary table properties remain
available for search, sorting, and inspection. CSV/TSV files without molecule
columns still open as generic delimited data tables in the same grid surface.

Mass-spectrometry formats (MS, MAGMA, MGF, MSP, MZML, MZXML) open in the
dedicated spectrum viewer.

Coordinate-free computational outputs resolve to an explicit `not-renderable`
document state instead of a blank viewer.

OpenMM, Amber, and CHARMM coordinate artifacts render as structures when they
contain standalone coordinates. This includes INPCRD, RST7, RESTRT, CRD, RST,
STATE, and XML files with `<Position>` entries. Burette also opens the raw text in the
document surfaces so the parsed coordinates remain inspectable. Parameter,
topology, stream, key, and checkpoint artifacts that do not contain standalone
coordinates open through the text-file surface instead. Binary checkpoint
artifacts show metadata only because OpenMM checkpoints are not portable
structure files.

MolViewSpec files are loaded through the Mol* `loadMvsData` path instead of the
coordinate trajectory parser. This keeps MVS usable as a declarative scene and
agent-control format for camera, components, selections, annotations, and
representation state.

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
