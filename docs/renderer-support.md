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

### Scientific files in the browser

Ordinary Open, project-folder selection and file drop classify scientific files
through `lib/workbench/scientific-files.ts`. FCHK/FCH, Molden (`.molden`, `.molf`,
`molden.input`), ORCA `.hess`, Cube/CUB, Z-matrix and `.qcschema` use their declared
names. `.out`/`.log` require ORCA or Gaussian evidence in the first 64 KiB;
`.json` requires a recognised QCSchema `schema_name` at the root. A nested schema
field does not reroute unrelated JSON. Ordinary XYZ retains its normal structure
route; the explicit scientific import function also accepts XYZ.

The import uses the isolated `runReaderTask` parser. Scientific uploads and
decoded text are bounded at 16 MiB; the explicit scientific batch accepts at
most 16 files. Compressed classification inspects a bounded decoded prefix,
then the actual bounded decoder and reader validate the full input. A stored
scientific marker is a route hint, not permission to skip parsing. Recognised
malformed input reports a named failure and never silently opens as bare text
or geometry. Other readable files in the selection retain their own routes.

The opened representation is XYZ with the supported parsed data
attached to its document. The source owner reads the current XYZ even when its
durable upload path ends in `.fchk`, `.molden`, `.json` or `.out`. Logical scene
sources take priority. The uploaded Original is separate: its immutable name
and bytes retain UTF-8 BOM, CRLF and, for compressed input, the outer compressed
bytes. Browser originals persist in the bounded IndexedDB import store. Closing
a document releases its live science/Original claim, not that stored upload;
a fresh open reparses it. Geometry edits do not rewrite Original.

Reopening an already live scientific document preserves its identity and draft.
An in-flight preparation observes its exact source owner until publication: a
newer same-path document publication or close invalidates the old result,
including a transition back to no document. A later explicit reopen is a new
request. Different paths can prepare independently. Cancellation and supersession release only the
request's temporary normalized cache; successful publication transfers host
text to the durable path and also releases that temporary entry.

Focused source/consumer checks are:

```bash
vp run test:scientific-import
vp run test:scientific-browser-open
vp run test:scientific-source-representation
vp run test:scientific-open-entrypoints
vp run test:scientific-original
```

These cover real readers, source ownership, durable reopen, chooser/drop
consumers and the Geometry/Original download component, including its compiled
subscription. The browser file controls expose that component; their focused
integration check is `vp run test:scientific-original-header`.

A fixed compiled browser build exercised the actual file chooser with Molden,
ORCA output and gzip-wrapped Molden containing BOM and CRLF. Downloaded Original
bytes matched all three inputs exactly. Closing the ORCA document, reopening its
actual downloaded Original and downloading again also preserved those bytes.
The initial geometry download contained the final ORCA coordinates and energy.
The menu was checked at 760 pixels in light and dark themes without horizontal
overflow or console errors.

That browser run also confirmed an outstanding integration failure: Text → Edit
source rejects the generated scientific XYZ as read-only. The source-controller
admission and editor-history integration must be completed before accepting the
full edit/download workflow. Actual file-drop and normal reload/restoration
acceptance remain pending. Earlier working-tree observations do not substitute
for those checks. Packaged macOS, Finder Quick Look and iPhone acceptance remain
separate; their file registration is unchanged by this browser import path.

Single native trajectories play through a registered Mol* animation using native
`ModelFromTrajectory` transforms. Its relative stride uses a conservative 1/16-loop cap and coprime stride
at saturation to avoid short-cycle absolute-time aliasing under slow rendering; target FPS describes source-frame
progress, not guaranteed redraw FPS. Stop drains the in-flight update before
seek or scene replacement; resume advances from the displayed frame. Segmented
tracks use the same stride policy with their own bounds. Ordinary playback
does not implicitly enable smoothing; unused native animation controls must not
start a competing trajectory clock.

Native DCD, XTC, TRR and Desmond trajectories use disk-backed indexes and read
one original frame at a time, retaining all source frames and their timing.
MOLX/MOLJ scenes containing these trajectories store local source references
rather than embedding the full coordinate run. They reopen on the same machine
while the original files remain at their saved paths and revisions; a missing
index is rebuilt. Missing or changed sources fail explicitly. These scenes are
not self-contained trajectory archives for transfer to another machine.

Pose/overlay collections retain their bounded controls. Smooth motion
is a separate derived-coordinate operation, not new molecular-dynamics data.
Paired MD smoothing writes DCD coordinates and reuses the original topology,
rather than repeating the topology in a multi-model PDB. On macOS the result is
staged inside the document's preview runtime and read through its scoped file
bridge. The Info panel shows smoothing as enabled only after the viewer confirms
that it loaded the result; returning to Original also waits for acknowledgement.
Failed loads restore the prior scene and do not commit the smoothed state.
The Python smoothing path splines only solute coordinates. Recognised water and
ions retain their per-frame coordinates, subject only to the common rigid Align
transform. Frames outside selected keyframe bounds are copied unchanged.
Unaligned DCD keeps per-frame unit cells; aligned DCD explicitly omits cells
because a rotated lattice basis cannot be represented by DCD lengths/angles.
DCD files use standard AKMA time (0.04888821 ps/unit). The version-locked
Mol* 5.11 adapter corrects its inverse conversion, saved-step stride (NSAVC),
initial step and empty-cell handling. Desmond index publication is atomic.
Long Desmond runs still use a bounded
preview topology in PDB format: independent CT components and overflow residue
blocks get unused one-character chain identifiers, without changing atom order.
These are derived display identifiers, not original CMS chain identifiers.
The finite PDB atom/chain namespace is a limitation; conversion fails rather
than silently merging residues when no distinct identifier remains. The CMS
source file is not modified.
This visual spline is not constrained MD: do not use derived solute bond lengths,
contacts, or energies as scientific trajectory measurements.

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

In `3D renders`, cards use white paper in both themes. Their 2D/3D control
switches between a fresh flat layout and the original 3D pose (or a generated
conformer for SMILES and flat input). It changes only the preview, not the
collection. The separate `buret.grid.xyzrenderUse3DCoords` preference defaults
to 3D; the existing RDKit input-coordinate preference retains its meaning.

In editable collections, double-click a compound's name in the table or on its
card, or choose **Rename…** from its context menu. Enter or leaving the field
applies the name; Escape cancels. Use **Save** to write the collection, or
**Save As** to create a copy. For SDF, renaming updates the molfile title and
the Name property while preserving structures, identifiers, and other data.
Renaming participates in the collection's Undo/Redo history.

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

### Mol* context menu

In the desktop app, a right click in the Mol* viewer opens a macOS menu. The
viewer still decides every row: it sends `molstarContextMenu` with a request ID,
the click point and the rows as data (items, submenus, labels, choices,
checkboxes, sliders and colour swatches). The shell parses them with
`molstarContextMenuItems`, which prefixes IDs with `molstar-menu:` and holds the
rows to the AppKit command's bounds. The shell answers with
`molstarContextMenuResult`: `select` for a chosen row and for every slider or
swatch move while the menu is open, then `closed`. The viewer records one undo
step per live control on `closed`. A new picking level reopens the menu at the
same point. Browser-dev and hosts without native menus answer `unsupported`, and
the viewer opens its own web menu. The iPhone host keeps its `mobileContextMenu`
path. The web menu's custom colour picker and representation hover preview have
no native counterpart.

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
noise do not enter text editing on click. Animation defaults to 30 fps and
384 px / 120 frames. Generated motion supports 24–240 frames within the pixel
budget; resolution and frame count are available in GIF settings. Actual preview cadence is limited by the
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
Browser-dev uses HTTP endpoints; desktop uses the native bridge described below.
Neither creates a Mol* scene.

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

### Native 3D card preparation

Normal desktop startup prepares two renderer workers while the shell loads;
registration-only launches do not. Opening a molecular grid fills the bounded
pool (up to six workers) in the background. Once the
initial table or 2D card view has rendered, the native bridge prepares at most 24
initial 3D thumbnails through the same bounded queue used by visible cards.
Switching to 3D joins in-flight work or consumes ready images; visible requests
outrank unmounted prefetch targets. Browser-dev and Quick Look do not perform this
native prefetch. Idle workers still retire after 120 seconds.

For SMILES-only grid thumbnails, the worker builds one deterministic ETKDGv3
conformer (seed 42), optimizes it with MMFF94 and renders it with the existing
style. This avoids the full renderer's ten-conformer energy search. These are
illustrative 3D layouts, not lowest-energy conformer results. Coordinate-bearing
inputs preserve their supplied coordinates; opening/exporting a structure through
the full renderer retains its existing behavior. Failed single embeddings use the
existing renderer fallback. Prepared molecules of at most 256 atoms (including H) and 4096 SMILES characters
are cached up to 32 per worker;
SMILES thumbnail disk entries have a separate versioned cache namespace.

Cold imports and genuinely new structures still require computation. Preparing
cards early improves view-switch latency; it is not proof of zero cold-launch
latency. Validate cold document-open and warm/prepared view-switch times separately.

Native packaging precompiles the renderer's imported startup modules with its
bundled Python after pruning and before signing. These checked-hash caches remain
valid after relocating the app, invalidate when source changes, and avoid runtime
bytecode writes. Only the startup import set is cached (about 10 MiB for the current
runtime), rather than every installed scientific module.

### Native xyzrender editor

The desktop Orientation & animation editor renders through the `render_xyzrender_editor` Tauri command using the bundled xyzrender runtime. It does not require a browser-dev server. GIF, SVG, PNG, PDF and TIFF exports use the native save dialog. Trajectory and vibration rendering read the original source file; the selected inline frame remains the input for static orientation and synthetic sheet items. Browser-dev keeps its HTTP transport. Native rendering stages input in a temporary cache directory, bounds inputs/outputs to 16 MiB and animation decoding to 100 million pixels, and allows two concurrent renders with a 120-second animation timeout. Closing a panel discards its result; an already running native render finishes within its timeout before releasing its slot.

Orientation and animation controls share one inspector. Changing angles keeps the existing movie playing until its replacement is ready, retaining the playback position and export range. Native animation renders are queued; obsolete queued requests are discarded. Image presets span 256–1024 pixels and generated motion detail spans 24–240 frames within the pixel budget. Opening or resizing docks preserves the sheet zoom and item dimensions, moving the sheet with the viewport center. Orientation commands target only the inspected document. XYZ frame and alignment rebuilds retain the selected Mol* appearance.

Full-range GIF application and export at up to 50 fps retime the rendered GIF
without decoding and quantizing it again. This preserves the compressed frames,
palette and transparency. Trimming and higher frame rates retain the existing
compositing and resampling encoder. The same fast path applies to selected items.

Desktop animations run the same xyzrender command line inside a warm grid
worker, which keeps a four-process pool for GIF frames between requests. A
default 384 px / 120-frame rotation takes about 1.5 s there instead of about
4 s for a new process, with identical output. Without the bundled Python
runtime, rendering falls back to a separate process.

## Private Geometry runtime ownership

The desktop's `geometry_binding` action reads an opaque runtime lease together with
the effective XYZ baseline. The host pins its source generation and viewer frame
before reading, and constructs the editing model from that same text. Every
`update_geometry` preview, commit and rollback carries the retained lease; it may
not acquire a new owner for an already computed edit. Verified own coordinate
updates retain the lease; renderer StateTree Undo, source replacement and MOLX restoration
invalidate it. Both actions remain private to the desktop and outside CLI/MCP.
