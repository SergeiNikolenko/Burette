# Renderer Support

Burette supports multiple renderer paths. The desktop shell selects a renderer
from user settings and runtime policy; Finder Quick Look uses the extension
runtime under `PreviewExtension/`.

The viewer, Mesoscale runtime and MolViewSpec schema are built together from
the immutable Mol* revision in `config/molstar-source.json`. The current
`6.0.0-dev.0` snapshot includes 5.13.1 and the subsequent volume, contact and
surface changes; it is an unreleased upstream snapshot, not a published v6
release. Archive integrity and generated assets are checked by the vendor lock.
WebGL remains the default graphics backend: automatic WebGPU selection produced
a depth/stencil pipeline failure in browser acceptance. Hosts that explicitly
request WebGL 1 retain that setting. The new volume and surface features work
through WebGL; no WebGPU compatibility or speedup is claimed.

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

### Cube coordinate units

The [Cube format](https://paulbourke.net/dataformats/cube/) uses signed voxel
counts. The pinned Mol* reader applies this consistently: three positive
counts declare Bohr, three negative counts declare Angstrom. The same scale
applies to the origin, oblique voxel axes and atom coordinates. Mixed signs,
zero counts and nonintegral counts are rejected before a field is produced.
The atom-count sign remains the orbital-dataset flag and does not choose units.
The source-owned `molstar-cube-units.mjs` adapter is applied to both interactive
Mol* and Mesoscale builds; it refuses an unexpected upstream version or shape.

`test:molstar-cube-units` covers actual native atom/volume construction and the
scientific reader. The native Cube dataset selector deinterleaves each voxel's values using the
selected index as the offset and the number of datasets as the stride. Out-of-range
and nonintegral indices fail before a volume is produced. `test:molstar-cube-datasets`
covers all three fields, native state selection/Undo and unchanged single-field
output. The scientific import reads the same fields, in file order, into `gridDatasets` (orbital
datasets keep their MO numbers); its first field stays the document's scalar grid, and all
fields together stay within one million values. These checks and generated
bundle builds do not establish packaged, Quick Look or browser UI acceptance.

The interactive Mol* build adapts the native Cube editor's Update action through
`molstar-cube-ui-history.mjs`. Only a changed dataset enters the viewer's existing
scene Undo/Redo owner, which captures/restores native StateTree snapshots and keeps
its 20-step bound. Original Cube bytes/assets, atoms and axes remain source-owned;
no single-field rewrite or molecular-file export is involved. Existing Apply-menu
Undo/Redo and host shortcuts consume that same owner. Custom updates, other
transform editors and hosts without the callback retain their native behavior.
A completion from a retired viewer or removed Cube node cannot append old state
to the current scene history.
The build adapter and viewer registration must ship together. `test:cube-ui-history`
uses the real native React editor, original viewer history functions and existing
Apply controls; independent omissions of either half fail the same UI assertions.
Actual Browser/WebGL and packaged acceptance remain separate from these tests.

ORCA's Molden files (`created by orca_2mkl` in their title) give the coefficient of each
unnormalized primitive and the m = ±3 (f, g) and ±4 (g) real harmonics with the opposite sign;
the Molden reader undoes both for those files only, which makes their orbitals orthonormal.

### Scientific files in the browser

Ordinary Open, project-folder selection and file drop classify scientific files
through `lib/workbench/scientific-files.ts`. FCHK/FCH, Molden (`.molden`, `.molf`,
`molden.input`), ORCA `.hess`, Cube/CUB, Z-matrix and `.qcschema` use their declared
names. `.out`/`.log`/`.dat` require ORCA, Gaussian, GAMESS/Firefly, NWChem, Psi4,
Q-Chem, Molpro or xtb evidence (program banner, or the `energy: … gnorm: … xtb:` comment of an
`xtbopt.log` trajectory) in the first 64 KiB;
`*.property.txt`/`*_property.txt` require the ORCA 6 property banner or ORCA 5's
`!PROPERTIES!` banner; `.json` requires a recognised QCSchema `schema_name` at the root. A nested schema
field does not reroute unrelated JSON. Ordinary XYZ retains its normal structure
route; the explicit scientific import function also accepts XYZ.

The import uses the isolated `runReaderTask` parser. Scientific uploads and
decoded text are bounded at 16 MiB; the explicit scientific batch accepts at
most 16 files. Compressed classification inspects a bounded decoded prefix,
then the actual bounded decoder and reader validate the full input. A stored
scientific marker is a route hint, not permission to skip parsing. Recognised
malformed input reports a named failure and never silently opens as bare text
or geometry. Other readable files in the selection retain their own routes.

Explicit local server selections (`devFiles`, authorized workspace paths, and
selected folders) use the same scientific parser through the existing authenticated
`/@fs/` route. The client reads at most 16 MiB, checks stream length even when
headers are absent or inaccurate, and discards stale selections before publication.
This does not authorize arbitrary URLs or filesystem paths and does not change
server allow-roots. Non-scientific logs and JSON keep their ordinary routes.
Server originals retain their selected filename, bytes and compressed wrapper;
they are read again on a fresh open rather than copied into the browser import store.

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
vp run test:scientific-server-startup
vp run test:scientific-source-representation
vp run test:scientific-open-entrypoints
vp run test:scientific-original
```

These cover real readers, source ownership, durable reopen, chooser/drop
consumers and the Geometry/Original download component, including its compiled
subscription. The browser file controls expose that component; their focused
integration check is `vp run test:scientific-original-header`.

Compiled browser acceptance covers the actual file chooser with Molden, ORCA
output and gzip-wrapped Molden containing BOM and CRLF. Original downloads match
the input bytes, including the gzip wrapper. Closing an ORCA document, reopening
its downloaded Original and downloading again preserves those bytes. Explicit
CLI startup paths also open ORCA and gzip Molden through the scientific route.

Imported XYZ supports Text editing and the Geometry dock. Browser checks cover
coordinate changes, a changed geometry download, unchanged Original downloads,
Geometry Undo and Text Undo after switching panels. A downloaded XYZ reopens
with the changed coordinates and fresh editor history. The input-export dialog
opens once and saves an ORCA input containing the current coordinates.

Z-matrix browser checks cover shared variables, reference points, definition
export, Undo/Redo and atom addition. Both O–H bonds follow their shared variable;
reference points remain outside the exported atom list. After topology changes,
the reader waits for the source session's confirmed active frame before creating
a new model binding. Atom-add Undo/Redo and subsequent coordinate editing have
been exercised against the compiled browser runtime. The dock retains its state
through Settings and works at 760 pixels in explicit light and dark themes
without page-level horizontal overflow.

Focused checks are `test:geometry-ui`, `test:geometry-topology-binding` and
`test:scientific-server-startup`. These do not establish complete parity.
Restored logical XYZ/MOLX atom-count changes, actual file-drop and normal
reload/restoration acceptance remain pending. Packaged macOS, Finder Quick Look
and iPhone acceptance remain separate; their file registration is unchanged by
this browser import path.

Vibrations is available through Compute and the command palette when the current
scientific source has normal modes, or a Hessian with the masses its source states. A
geometry with only such a Hessian offers Compute modes: a worker projects translations and
rotations out of the mass-weighted Hessian and diagonalizes it (`normal-modes.ts`; 3N − 6, or
3N − 5 for a linear geometry). Modes as JSON saves each mode's columns with its Cartesian
displacement vectors and the atoms they displace. IR and Raman use separate physical units;
older ORCA output carrying only squared transition dipoles keeps its T² atomic
units. Peak-height Gaussian curves and the supplemental sticks/area-normalized
view remain distinct. Mode selection, live Mol* animation, frame-specific data,
trajectory/displaced geometry and source CSV/JSON/Hessian exports share the
current source owner. The external renderer retains its own animation path.

Actual browser acceptance at `2ab996833985087d9e482097e510f3f16db45967`
used an immutable build from that exact Git tree. The Gaussian water FCHK and
ORCA 3.0.2 methane Hessian fixtures exercised Compute, command-palette focus,
IR/Raman/T² selection, keyboard peak selection, axis editing and Animate/Stop.
The water trajectory opened with 20 seekable frames; all exported trajectory
and negative-displacement coordinates matched the original normal vectors to
floating-point precision. CSV/JSON retained the source quantities, and all
81 Hessian elements matched the packed source matrix. Original FCHK downloads
remained byte-exact after animation and after another source was closed.
Reduced motion prevented automatic animation while allowing explicit Animate.
Light and dark themes at 760 pixels had no page-level horizontal overflow;
closing a source with its panel hidden preserved the other open source.

Focused checks are `test:vibrational-spectrum-ui`, `test:vibrations-panel`,
`test:vibrations-owner`, `test:vibrations-activation` and
`test:scientific-source-lifetime`. These browser observations do not establish
packaged macOS, Quick Look, iPhone or external-renderer acceptance. The six
additional spectral data/plot/reader foundations are separate from normal-file
routing, scene persistence and their future user interfaces.

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
Mol* source adapter corrects its inverse conversion, saved-step stride (NSAVC),
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

Chemical JSON (`.cjson`) files render directly through `xyzrender`, including on
`auto`. The original file is passed to the renderer so its bonds, per-atom colors,
unit cell and authored camera remain available. This route uses a dedicated
extension and content type; ordinary `.json` files retain their existing handling.
The source remains inspectable as JSON. On iPhone, CJSON opens in the read-only
text view because the external Python renderer is not available there.

Finder Quick Look renders bundled CJSON through the same pinned xyzrender
interpreter inside its extension process, since its sandbox denies subprocess
launches. Calls are serialized; Python initialization ignores ambient settings,
and per-render arguments, paths, streams, tracing and RDKit's `RDBASE` change are
restored. Input is limited to 64 MiB, render arguments to 1 MiB, SVG output to
32 MiB and logs to 64 KiB. The 25-second Python deadline is cooperative: it
cannot interrupt a blocked native-library call. A native renderer crash ends the
extension process. Custom external executables keep their existing launch path.
Run `BURETTE_XYZRENDER_ENV=/path/to/pinned/venv bun tests/test-embedded-xyzrender.mjs`
to verify repeated rendering, invalid-input recovery, initialization failure and
environment isolation with `process-fork` denied.

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

## Envelope Representation

**Envelope** in the Style menu draws an approximate, coarsened surface of a
structure using the `blob-surface` representation. It is also available for an
individual scene component and for collection/XYZ background structures.
The existing scene editor controls its colour, opacity, solid/wireframe fill,
envelope size, surface smoothness and detail. Envelope is a visual overview;
it does not replace the molecular surface for inspecting atomic-scale pockets.
It is saved in scene snapshots and can be selected as the default style for
new desktop, Quick Look and source-built iPhone previews.

## Volume Segmentation

For a loaded density map, **Scene → Segment map** opens the body segmentation
controls. Set the density threshold, add a body, and draw a polygon around it.
Finish with Enter, a double-click, or a click on the first vertex; Escape cancels
and Backspace removes a vertex. Arrow keys add vertices in 10-pixel steps for
keyboard input. Rotate the map between polygons: each body's views intersect in
3D. **Exclude** inverts a view, and body order determines priority where bodies
overlap. **Remainder** collects unassigned voxels above the threshold.

Preview the source, active body, or all body masks. Extend and soft-edge widths
are in voxels. **Undo** restores body definitions; source density is preserved by
segmentation and mask export. Body names, view polygons, threshold, per-body mask widths and preview choice
are serialized into MOLJ/MOLX state as bounded definitions. Voxel labels are
recomputed from those definitions when the scene is reopened, before mask
previews load. Definitions are limited to 255 bodies, 64 views per body, 1024
vertices per view, 16384 vertices in total and 1 MiB of JSON.

Export the active body as a float32 MRC mask or all nonempty bodies in a ZIP.
Masks retain the source box, world origin and grid geometry, regardless of the
source tensor's axis order. Export uses the regular native Save dialog or browser
download, bounded to 128 MiB per map/mask or ZIP. For a larger combined export,
choose individual active masks or work with a smaller map.

The **Map tools** disclosure also provides dust removal and handedness reversal.
These operations require an explicit Apply in the panel and modify a copy of
the loaded density; the source file is unchanged. **Undo map edit** removes the
last operation. Up to 64 map edits are recorded in the scene and replayed before
body labels and mask previews are restored. **Export map** writes a separate MRC
containing those edits. The iPhone preview can inspect and segment maps, but
export controls are omitted because its host does not expose a binary save bridge.

## 3D Model Export

The viewport Screenshot menu ends with **Export 3D model**, a folded group with
one action per format: PLY, glTF, OBJ, X3D, VRML and POV-Ray. Image export
(PNG/JPEG/WebP up to 8K, transparency, axes, crop) stays in the same menu above
it. Each action writes the visible Mol* scene to `<document>.<ext>` through the
viewer's ordinary download path (host `exportData`/`exportText`, or a browser
download when no host is attached).

`scripts/molstar-scene-export.js` (bundled into `molstar.js` as
`molstar.BuretteSceneExport`) tessellates every visible render object with Mol*'s
geo-export `MeshExporter`: meshes, GPU texture meshes, impostor spheres and
cylinders, and lines and points as thin tubes and small spheres. Unlike Mol*'s own
GLB/OBJ/STL/USDZ exporters it does not recentre, scale or quantize: positions stay
in scene coordinates in ångström, each instance is expanded with its own
transform, normals use the inverse transpose, and reflecting or flip-sided
instances keep outward winding. Each vertex carries the drawn colour (palette and
overpaint) and an opacity from the object alpha and per-group transparency.
Hidden objects, fully transparent objects and triangles that are fully transparent
at every corner are left out. Text labels, images, direct-volume rendering and
clipping cannot be held by a triangle mesh and stop the export with a message.
Hover and selection markers are neither exported nor a reason to refuse.

Limits: tessellated size is checked against 64 MiB before any object is built or
its instances are expanded, GPU readback of a texture mesh is checked before its
buffers are allocated, coordinates must be finite and within ±1,000,000 Å, every
output file is at most 64 MiB, and an empty scene is an error. The export runs as
a Mol* task with progress and Abort in the viewer's task overlay, checked inside
the loops of a single large object and between batches of text output. The scene
is snapshotted when the export is requested (render objects, visibility, opacity
and the value cell of every exported property); a change before the file is
complete or downloaded, such as a playing trajectory frame, rejects the export
without pausing anything. A failed or cancelled export changes neither the scene
nor its source.

`scripts/ply-mesh.mjs` validates the tessellated chunks and writes binary
little-endian PLY; `scripts/scene-mesh-formats.mjs` writes the other formats from
the same chunks:

| Format | File | Colour and opacity | View |
| --- | --- | --- | --- |
| PLY | `.ply`, binary, float32 xyz/normal + RGBA bytes | per vertex | — |
| glTF | `.glb`, one indexed primitive, `extras.lengthUnit = "angstrom"` | linear `COLOR_0` RGBA, `BLEND` when translucent | — |
| OBJ | `.obj` with `v x y z r g b` and `vn` | per vertex RGB; translucent scenes are refused | — |
| X3D 3.3 | `.x3d`, `IndexedTriangleSet`, `<unit … conversionFactor="1e-10">` | `ColorRGBA` per vertex | viewport `Viewpoint`/`OrthoViewpoint`, background |
| VRML 2.0 | `.wrl`, `IndexedFaceSet` | per vertex RGB, one shape per opacity; opacity varying across a face is refused | viewport `Viewpoint`, background |
| POV-Ray 3.7 | `.pov`, `mesh2` with per-vertex textures | `srgbt` per distinct colour | viewport camera (right-handed), headlight, background |

glTF, OBJ, X3D and VRML have no ångström unit of their own; one model unit is one
ångström (X3D also declares it). Avogadro 2 exports POV-Ray and VRML from its
ball-and-stick primitives; these exports carry every visible Mol*
representation instead, including surfaces and cartoons. No Avogadro code is
ported.

Verification: `bun test tests/molstar-scene-export.test.mjs` covers transforms,
winding, colours, refusals, limits, Abort and scene changes on real Mol* render
objects; `bun tests/test-scene-export-readers.mjs` exports a headless Mol* scene of
`tests/fixtures/scene-export/ethanol.sdf` in every format and reads it back with
plyfile, trimesh and XML parsing through `uv`
(`tests/fixtures/scene-export/read-exports.py`), plus VTK's VRML importer and a
POV-Ray render when those are installed.

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

The locked runtime is xyzrender 0.3.9+burette.1, a reviewed upstream snapshot
with an additional standalone density-projection correction. The immutable source,
local patch and wheel hashes are recorded in `config/xyzrender/source.json`.
It preserves ESP magnitude, density silhouettes, CJSON camera orientation,
colours and cells, and hydrogens bonded to R/S stereocentres. `Essential H`
hides nonessential C-bound hydrogens; `Auto H` follows the selected style.
See `config/xyzrender/README.md` for regeneration and focused regressions.
`scripts/prepare-xyzrender-runtime.py` creates an isolated environment; native
development builds can use its returned path through `BURETTE_XYZRENDER_ENV`.
Bundling follows `scripts/bundle-quicklook-xyzrender-launcher.sh`.

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

The binding covers one structure with one model and one atomic unit from a
single-frame XYZ, a MOL or a one-record SDF. For XYZ the baseline is the source
text. For MOL/SDF it is a generated single-frame XYZ of the model atoms in source
order (element symbol and the shortest decimal that keeps each float32
coordinate); the MOL/SDF bytes are never rewritten. `update_geometry` refuses a
changed atom count or element order, keeps the file's declared bonds (XYZ bonds
are still rechecked against distance) and keeps the camera.

### Atom dragging

`atom_drag` `{ enabled, lease }` turns drag mode on or off for the structure
behind a Geometry lease; enabling fails once the lease no longer owns the scene.
The viewer loads `atom-drag.js` on first use. In drag mode a plain left press on
an atom moves that atom, or the whole selection when the atom is selected, in the
camera plane through it. Presses on empty space or with Shift, Ctrl, Alt or Cmd
reach Mol* unchanged, so the camera still rotates and selection bindings still
work. Escape, `pointercancel` or a lost focus cancels the drag and restores the
text read at the press.

The viewer applies the moved coordinates itself through the same Geometry queue,
so dragging works without an optimizer. It posts
`{ type: 'atom-drag', phase: 'start' | 'move' | 'end' | 'cancel', lease, atoms, positions }`
to the host: `atoms` are zero-based source atom indices, `positions` their
coordinates in Å, equal to the decimals written into the Geometry text. `move`
is posted at most once per animation frame; `cancel` carries the restored start
positions. While a drag holds atoms, every applied `update_geometry` text has the
held atoms' rows replaced by the pointer positions, so an optimizer can move the
other atoms without pulling the dragged ones back; drag frames never supersede a
queued host update. A stale lease ends drag mode at the next press, and a drag
whose lease goes stale posts `cancel`. The host side is `lib/atom-drag.ts`.

With `manipulate: true` (the Edit panel's Move tool, Avogadro's Manipulate and
Bond-Centric tools) drag mode also takes bond presses and Alt presses:

| Press | Effect | `atoms` |
| --- | --- | --- |
| drag a bond | turns the smaller side about the bond axis, π/360 rad per pixel | atoms of that side |
| Alt-drag a bond | stretches the bond along its axis, moving the smaller side; at least 0.5 Å | atoms of that side |
| Alt-drag a selected atom | rotates the selection rigidly about its centre, around the screen axis perpendicular to the drag | the selection |

A bond in a ring has no smaller side and stays with Mol*. The Move tool records
each `end` as one `positions` draft operation, so every drag is one Undo step.

### Drawing

`atom_draw` `{ enabled, lease }` turns the Draw tool on or off in the active
viewer; `atom-drag.js` holds both pointer tools. The canvas shows a crosshair.
A plain left click on empty space, a click on an atom or a bond, and a drag from
an atom each post one
`{ type: 'atom-draw', lease, gesture, atoms?, position? }` to the host:

| `gesture` | Press | `atoms` | `position` |
| --- | --- | --- | --- |
| `empty` | click on empty space | — | under the pointer, at the depth of the camera target |
| `atom` | click on an atom | `[atom]` | — |
| `drag` | drag from an atom into space | `[atom]` | under the pointer, at the atom's depth |
| `bond` | drag from an atom onto another | `[from, to]` | — |
| `bond-click` | click on a bond | `[a, b]` | — |

Atoms are zero-based source indices and positions model coordinates in Å. A
press that moves on empty space still rotates the camera and posts nothing;
presses with a modifier key reach Mol* unchanged; Escape drops a drag in
progress. The Edit panel turns each gesture into one graph-draft operation
(`draw`), so every stroke is one Undo step, and renews the mode with a new lease
whenever the draft reloads the scene.

### Vector images and movies

`export_svg` `{ transparent? }` returns `{ svg, atoms, bonds }` for the visible
ball-and-stick, licorice (ball-and-stick with equal radii) and spacefill
representations, from the current camera. The viewer loads `scene-media.js` on
first use. Colours and radii come from each representation's own colour and size
themes and its `sizeFactor` and `sizeAspectRatio`, so the drawing matches the
render. Shapes are painted back to front: each atom is one `<circle>` with a
radial gradient and a `<title>` such as `O1`, and each bond one `<g class="bond">`
with a half in each atom's colour and one stroke per bond order. Other
representation types are not drawn; a scene with none of the supported ones is
refused.

`record_movie` `{ seconds, fps, spin }` records the canvas with MediaRecorder for
1–60 s at 24, 30 or 60 fps (12, 25 and 50 are accepted too) and returns
`{ dataUri, type, bytes }`. The format is MP4 where the runtime records it (WebKit
in the Mac app), otherwise WebM. With `spin` the camera turns once about the
screen's vertical axis through its target and returns to its start; without it
the view is recorded as shown, which captures vibrations and trajectories that
play during the recording. The host offers both as File → Export → Vector
Image… and Movie…, and in the command palette.
