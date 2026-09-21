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

For standard mmCIF/BinaryCIF previews, coordinate-bearing data blocks load
as separate structures in the same scene, preserving their original coordinates.
This includes PyMOL exports with a protein and ligand in separate blocks.
Metadata-only blocks do not become structures; models within each block retain
the normal model-selection behavior. The viewer and agent treat `HETATM UNK`
records as unnamed ligands; `ATOM UNK` retains unknown-amino-acid behavior.

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

### xyzrender sheet editing

The desktop/browser sheet preserves each item's placement and rotation while
replacing rendered SVG content. Shift/Command-click adds items to the selection;
selected items move together and can receive a preset together. Canvas actions
provide duplication, selection and arrangement. Lasso starts on empty canvas as
well as inside an image, and selects visible graphics across the sheet.

The browser context menu reuses the Mol* menu components, including its nested
menus and keyboard navigation. The desktop viewer sends `xyzrenderContextMenu`
with a request ID, label and selection/hidden flags to the shell. The shell builds
a fixed menu through the native menu adapter and returns
`xyzrenderContextMenuResult` with the request ID and selected action. Unsupported
native menus fall back to the browser menu. This bridge does not accept arbitrary
commands from the viewer.

`Orientation & animation` uses xyzrender through the browser renderer. Its
orientation editor rotates an XYZ reference around the centroid, rerenders with
`--ref`, and applies the resulting reference to the originating sheet item.
Changing a preset subsequently retains that reference. Crystal orientation uses
the crystallographic direction control instead (`--ref` is not supported upstream).

The shadcn inspector groups atom/bond styling, selection rules, TS/NCI,
surfaces, hulls/pores, overlays/ensembles, labels/property colours/vectors and
crystal options. Search filters the groups. Lasso selections can populate atom
selector fields. Core settings use `XyzrenderControls`; advanced settings use the
existing `extraArguments` contract with an argument codec, not shell execution.
Text/numeric drafts commit on blur or Enter. Surface mappings accept explicit
ESP/interaction cube paths instead of assuming one cube serves both roles.

The dock opens with the illustrated style/display galleries; detailed fields
and search are behind Advanced settings. Orientation and animation controls live
in this same dock, with previews applied on the primary canvas rather than in a
second modal scene. Apply GIF to canvas leaves an animated image on the card;
changing its style returns it to a static editable rendering. Canvas camera keys
match Mol*: W/S zoom, A/D horizontal movement, R/F vertical movement, Q/E roll.
Text inputs and modified command shortcuts retain their normal keyboard behavior.
Orientation angles and animation speed/amplitude use the shared Kinetic
ScrubNumberField (Calligraph and Motion): drag to change. Speed and assembly
noise do not enter text editing on click. Animation defaults to 60 fps and
640 px / 240 frames; speed ranges from 30 to 120 fps, and 120 frames are available
in the collapsed GIF settings section. Actual preview cadence is limited by the
display refresh rate. GIF export resamples to at most 50 fps with delays of at
least 20 ms, preserving duration to GIF timing precision. Style changes notify the active animation editor by
document identity, including inline sheet sources whose path is only a label,
and cancel the previous render before replacing its frames.
Orientation sliders render serially while dragging, coalescing pending angles
to the latest value instead of repeatedly aborting Python. Up to 16 small SVG
orientations are cached for the current source/style. Opening at zero angles
reuses the reference-building render. In browser-dev, static SVG requests use a
serial, persistent Python CLI worker when the installed executable has a Python
shebang. This reuses scientific imports without changing renderer flags; other
executable wrappers retain subprocess rendering. Aborts/timeouts stop the worker,
and the next request restarts it. GIF rendering retains separate processes.
Single-frame XYZ trajectory requests return an unavailable-mode response before
launching the renderer, and the inspector offers full rotation instead.
Browser GIF rendering defaults to four
Python workers and single-threaded BLAS; explicit environment settings override
these defaults.

Animation supports rotation, adjustable rocking, trajectory with per-frame bond
rebuilding, TS vibration, and decorative assembly/scatter with anchor atoms.
Combined rotation is available for trajectory, vibration and assembly. The editor
keeps the current SVG while loading. Closing or superseding a request aborts the
browser request and its renderer process. Preview decoding is capped at 240
frames / 100 million pixels; large trajectories must be shortened before editing.
The browser render has a 120-second timeout and a 16 MB output limit.
The orientation editor exports SVG, PNG, PDF and TIFF; animation exports GIF.
PDF on macOS supplies the Homebrew Cairo library lookup path to the child process.
These orientation/animation/export endpoints are browser-dev only; native
animation bridging is not implemented. They do not create a Mol* scene.

The tested local runtime is xyzrender 0.3.8, installed with
`uv tool install --upgrade 'xyzrender[all]==0.3.8'`. This updates the external user
runtime, not an already packaged application's embedded runtime. Bundling follows
`scripts/bundle-quicklook-xyzrender-launcher.sh`.

In desktop xyzrender mode, Appearance toggles the xyzrender dock. Mol* panel
shortcuts and viewport rail are hidden; sheet history uses the existing host
history controls. Sheet selection and inspector accents use neutral grey tokens.

The xyzrender animation editor decodes real rendered GIF frames for a neutral
slider with play/pause and an export range. Speed is editable from 1 to 30 fps
(GIF timing is rounded to 10 ms). Save encodes the selected composited frames,
preserves transparency, writes a real GIF through the browser export route, and
provides an HTTP attachment link. The route retains up to 20 download links per
server instance; saved files remain in temporary export directories until OS
cleanup. Browser rendering and export have focused codec and HTTP tests.

Animation preview uses the parent-to-viewer `applyXyzrenderAnimationFrame` message
with `itemId`, integer `width`/`height` (1–1024), and an exact-sized RGBA
`Uint8ClampedArray` named `pixels`. Only the parent window is accepted. The viewer
reuses a canvas, avoiding PNG encoding on playback. Committed GIFs continue using
`applyXyzrenderAnimation`. The molecular editor hides Miller directions for
non-CIF inputs; those directions require crystal lattice data.

### Native xyzrender editor

The desktop Orientation & animation editor renders through the `render_xyzrender_editor` Tauri command using the bundled xyzrender runtime. It does not require a browser-dev server. GIF, SVG, PNG, PDF and TIFF exports use the native save dialog. Trajectory and vibration rendering read the original source file; the selected inline frame remains the input for static orientation and synthetic sheet items. Browser-dev keeps its HTTP transport. Native rendering stages input in a temporary cache directory, bounds inputs/outputs to 16 MiB and animation decoding to 100 million pixels, and allows two concurrent renders with a 120-second animation timeout. Closing a panel discards its result; an already running native render finishes within its timeout before releasing its slot.

Orientation and animation controls share one inspector. Changing angles keeps the existing movie playing until its replacement is ready, retaining the playback position and export range. Native animation renders are queued; obsolete queued requests are discarded. Image presets span 256–1024 pixels and generated motion detail spans 24–240 frames within the pixel budget. Sheet positions track viewport center changes when docks open or resize.
