# Burette Architecture

Burette is a windowed macOS desktop app built on a Tauri
shell, plus a Swift Finder Quick Look extension, a source-built iPhone preview
app, a hosted public plugin, and a packaged agent plugin — all for molecular
structure files.

## Repository Boundaries

- `apps/desktop/` owns the React desktop shell.
- `apps/desktop/src-tauri/` owns the Tauri app, IPC commands, preview service,
  menu events, update checks, native window integration, and the native
  compute service (`src/compute/`, helper binaries
  `src/bin/burette-compute-service.rs` and
  `src/bin/burette-compute-dev-backend.rs`).
- `apps/burette-public-plugin/` owns the hosted public plugin: the Next.js
  app, public MCP endpoint, and submission metadata deployed to Vercel.
- `PreviewExtension/` owns the Swift Quick Look extension.
- `PreviewExtension/Web/` owns the bundled web runtime used inside Finder
  previews and mirrored into the packaged agent plugin.
- `ios/BuretteMobile/` owns the source-built iPhone preview app (a second
  Swift runtime alongside the Quick Look extension).
- `crates/` owns the Rust workspace crates: `burette-core`,
  `burette-compute-core`, `burette-compute-metal`, `burette-compute-protocol`,
  `burette-mdsmooth`.
- `compute/` owns the reviewed Metal kernel sources, kernel contracts, model
  runners, and packaged compute runtimes; `schemas/compute/` owns the compute
  JSON schemas and fixtures.
- `packages/` owns the workspace packages: `burette` (the Bun CLI installer)
  and `ketcher-agent-contract` (shared Ketcher agent types).
- `plugins/burette-agent/` owns the packaged Codex agent plugin: skills, MCP
  registrations, and generated runtime copies.
- `Burette.xcodeproj` owns the Swift build targets: `BurettePreview`,
  `BuretteThumbnail`, and `BuretteMobile`. The macOS app itself is built by
  Tauri through `scripts/build.sh`, not by an Xcode app target.
- `scripts/` owns local build, install, release, vendor, preview, and
  diagnostic workflows; the root `vite.config.ts` is the browser-dev/Vite+
  entry that composes `apps/desktop/vite.config.ts`.
- `config/preview-formats.json` owns the format registry (extensions, content
  types, renderer routing, grid routing, Quick Look limits);
  `config/web-runtime-profiles.json` owns the web asset profile manifest used
  by desktop and Quick Look runtime packaging checks.
- `templates/mvs-story/` owns the MolViewSpec story template descriptors;
  `packaging/dmg/` owns the DMG layout assets; `tests/` owns the repository
  contract tests; `samples/` owns checked-in sample files.
- `docs/` owns current documentation.

Root scripts are the public command surface. They delegate into `apps/desktop`
where needed so agents do not need to remember nested Tauri commands.

## Desktop Shell

Page rendering uses React Router with a memory navigator per mounted tab
(`components/editor-area/tab-router.tsx`). The registered page kinds supply
routes; settings use `/settings/:section`. Scientific document identities live
in route state, not in the browser URL. No browser history or server rewrite is
required in Tauri, browser-dev, or an embedded workspace.

The existing molecule store owns each tab's serializable back/current/forward
history. The router navigator and native Back/Forward actions share that cursor
rather than maintaining two independent histories. Session restoration and
workspace undo therefore keep the same payload shape. Tab keep-alive limits,
dirty-view retention, and file-opening guards remain in their existing owners.
Within a visible tab, `tab-history-pages.tsx` retains the last three visited file
views so Back/Forward reuses the iframe and camera rather than rebuilding it.
Inactive tabs retain only their current view, with unsaved grids and assembled
scenes protected from eviction. When branching discards Forward entries, a
protected view remains in the same tab and is restored to Back history so its
original editor stays reachable. Hidden history views receive the existing visibility signal to pause
trajectory playback; stable DOM order avoids iframe reloads during navigation.

Explicitly opening a live Mol* document in a Files dock captures its camera and
source viewport before mounting the destination. The private host message
`captureRendererViewState` receives `rendererViewStateCaptured` from the exact
source iframe, matched by request and document IDs, with a one-second timeout.
`rendererViewStateResponse` can then carry the captured `viewState` and optional
`sourceViewport`. The destination scales camera distance once by the ratio of
the viewports' short-side fit factors, preserving target, orientation and zoom
relative to a fitted view. It does not fit scene bounds or infer viewport sizes
for authored MOLJ/MOLX files. Without a live source, normal restoration applies.

`lib/dock-camera-transfer.ts` retains at most 64 transient workspace/area/document
views, each bounded to 8192 characters and positive viewport dimensions up to
32768 pixels. Documents are window-global, while workspace identity is the
owning main tab ID. `captureDockTarget()` binds that ID and its setters before
any await; a delayed camera reply cannot open the result in the newly active
workspace. Closed workspace IDs are pruned and late replies cannot recreate
those checkpoints or panels. `.dock-panel[data-workspace-id]` and a content key
bind each iframe to its actual workspace. Read-only iframe caches stay local
and never write the shared document sessionStorage cache. Subsequent
camera checkpoints consume the transfer dimensions and stay independent of the
source tab. Resizing, Files/Info remounts, and opening an already mounted Files
view do not repeat the transfer. File formats and ordinary file selection are
unchanged; native popout scene transfer remains a separate workflow.


The desktop shell is a compact molecule workspace:

- sidebar for project folders and nested structures
- tab strip for active structure pages and settings
- command palette for app actions
- native macOS menu bar with stateful, context-dependent items
- macOS Dock menu for New Workspace, Open Structure, up to seven recent
  documents, Resume Last Session, Open from Clipboard, and Settings. Commands
  reuse the File/App menu handlers; recent entries refresh when the Dock menu
  opens. Resume restores missing saved windows and focuses the saved active
  window without replacing currently open work. Clipboard contents are validated
  by the existing import flow after selection. Custom Dock commands are available
  while the app is running; macOS owns the menu shown when it is quit.
- native context menus for sidebar files, folders, projects, and sidebar menu buttons;
  editor tabs also use the native menu adapter. Pinned tabs persist in workspace
  sessions, stay at the left edge, and survive Close Other Tabs / Close Tabs to
  the Right. Explicit Close Tab and Close All Tabs remain available.
  macOS draws the pinned OpenAI Apps SDK UI icons, separators, and submenus in AppKit through
  `popup_macos_context_menu`, including the live controls some menus carry:
  number fields become slider rows, swatches a scrolling colour carousel with an
  inline hue picker (`context_menu_controls.m`), and a select a submenu with the
  current option checked. Slider and colour changes apply while the menu stays
  open. Other desktop platforms use the Tauri menu API for command-only menus
  and the web menu for menus with controls; browser sessions use the existing
  web menu. The right-panel action opens the
  structure viewer directly; text tabs explicitly open a text panel. File, project
  and tab menus share short labels and Open, Copy, Export and Close submenus;
  unavailable actions and duplicate Save As entries are omitted.
- Mol* scene tree rows open their menu natively through the shared viewer menu
  adapter. Measurement rows combine Mol*'s selection and representation cells
  into one visible row and show the measured source or custom text. Their
  right-click menu and hover-only settings button send a dedicated
  `sceneTreeContextMenu` message instead, so the custom text is an inline field
  next to the colour swatches and size sliders; one undo step per control is
  recorded when the menu closes. Browser previews use the viewer menu.
- settings page for renderer, preview, compute, and update preferences
- right (Inspector) and bottom docks, hidden by default
- iframe-backed preview pages generated by the Tauri preview service

Open molecule pages stay mounted while inactive when their renderer state should
survive tab switches. The warm-page budget never evicts a grid with unsaved
changes. Only active and previously visited tabs join that budget; opening a
batch does not initialize unseen viewers. Grid Save acknowledgements carry the saved source revision; newer edits
remain dirty. Save As temporarily disables editing until the host finishes,
fails, or cancels the document switch.

Settings that require new runtime HTML are applied when each open file next
becomes active, after its unsaved edits have been resolved. Live theme and style
changes are broadcast without rebuilding the viewer. Theme defaults to Auto
(system); the viewer's icon button cycles Auto, Light, and Dark. The preference
also sets the native application appearance so AppKit menus and window materials
match the web shell. Auto removes the native override and follows system
changes. Leaving Settings returns
to the tab that was active on entry. Settings stays outside the visible tab
strip and is never selected as a fallback when a workspace tab closes. Closing
the last visible tab returns to the launcher. Unsaved grids show a tab marker, and the
Inspector molecule card resets its retained hover state when its document changes.

The Mol* 2D molecule card keeps its hidden state for the current viewer document.
Changing or clearing selection, Escape, and viewport resize do not reopen it;
the bottom restore chip does. Viewer teardown resets that state. The card uses
one hide control and edge resizing, with actions below the depiction.

Collection tables show a floating molecule preview when hovering the Mol cell
with the right dock closed. Opening the dock dismisses that preview. The shell
includes `rightDockOpen` in its `gridViewportCover` message; standalone grid
previews default to showing the hover preview when this field is absent.
The right-dock molecule preview has a persistent height handle, shared by 2D
and 3D modes. Its 2D structure is drawn from the row's molecular source at the
measured preview size instead of enlarging the grid card's 260px SVG; SMARTS
highlight atom and bond indices and the input-coordinate choice travel with
the bounded hover message.

Clicking a Chemical Space point reveals its source molecule in the collection
cards or table. The `chemicalSpaceSelectionChanged` message optionally includes
`focusSourceRecordId` for point navigation; lasso selection and hover do not
request a jump. The grid resolves that identity in the current sort/filter
order, paging as needed, and cancels navigation when a newer query or selection
replaces it. A filtered-out molecule leaves the filters intact. Point navigation also
opens the exact source molecule in Mol*, or selects it in the related visible
structure. SDF subsets retain an ordered `moleculeSource` mapping of source
file/document and record IDs. Lasso, group and cliff-pair selections stay sets;
they do not choose a pose. Changing the displayed molecule replaces the map
selection. A dock resolves the map from its current file or explicit source,
never the first unrelated collection in the workspace.

The desktop host sends `chemicalSpaceRequestSelection` and
`chemicalSpaceFocusMolecule` (`documentId`, `sourcePath`, `sourceRecordId`) to the
owning Mol* frame. `chemicalSpaceMoleculeChanged` reports the source-file-local
record ID; a multi-file scene must not use the global pose offset as that ID.
`dockingPoseChanged` also carries optional `sourceRecordId`, retaining the
existing global `activePose` field. The standalone Quick Look/iPhone runtime can
emit these messages without a map host; only the desktop/browser shell consumes
them. `chemicalSpaceOpenMolecule` resolves unloaded rows by their source index and
opens them in the current tab, retaining the collection in history. Its
`navigationDocumentId` cancels an asynchronous open after the user switches
documents. Extracted grid structures send bounded `sourceRecordIds` with
`openSdfMolstarDocument`; absent metadata leaves legacy documents unlinked.

Composition rows for chains, ligand instances and ion species offer the same
hide/show/remove actions as scene components. Their component actions carry an
optional exact PyMOL `query` and `componentLabel`; inspector groups and children
use queries so hide/show preserves representations. Legacy kind-only actions keep their
existing meaning. The viewer splits overlapping components into a remainder
and a separately controllable subset, copying representation parameters before
hiding it. Remove drops just the queried subset from the scene; the source file
is unchanged. The operation runs in a Mol* transaction and preserves selection.
`compositionVisibilityChanged` reports at most 128 registered queries and their
visibility and presence, so Composition follows changes made in the scene tree too.
Removed subsets leave the list; hidden subsets remain available to show again.
Snapshots include live atom, residue, chain and residue-type counts, computed over
the union of matching components. Empty scenes also report absence. The
inspector registers its bounded query list with `compositionVisibilityRequest`
on mount. Snapshots also include a uniform colour when the matched representations
agree; the read-only query evaluation does not create scene cells.
Composition context menus also accept `edit_components` with an exact PyMOL
query and a discriminated `edit` (`representation`, `opacity`, `color`). Subsets split using the same component path as visibility actions;
style edits preserve visibility and sibling representations. Inspector menus
offer commands rather than a fabricated single value for mixed components.

Normal app launch remains a visible full-window launch. Registration-only
maintenance may opt into `BURETTE_LAUNCH_MODE=register`; file-open, Dock, and menu
paths still show the full app. See [Launch modes](launch-modes.md).

Panel, floating-pane and native window resize gestures send `hostLayoutGesture`
to mounted viewer frames. Frames reflow with the shell so controls remain on
their edges; Mol* holds canvas allocation until the gesture finishes. Overlapping
gestures are counted per shell root, including detached panes, and release after
panel transitions and final layout corrections settle.

## Preview Runtime

The Tauri preview service prepares runtime artifacts for the desktop app. The
Quick Look extension prepares its own artifacts in the extension container.

Both paths use the same bundled viewer assets where possible:

- Mol* for interactive structure previews (a custom self-vendored bundle built
  by `scripts/vendor-molstar.mjs`)
- the Mesoscale Explorer runtime for mesoscale documents
- external `xyzrender` when configured
- RDKit/grid runtime for SDF, SMILES, CSV, TSV, and DataWarrior collections
  (DataWarrior decoding uses the bundled OpenChemLib runtime)
- the spectrum viewer for mass-spectrometry formats

Runtime asset selection, generated runtime cache layout, binary payload loading,
RDKit WASM loading, grid search, and performance budgets are documented in
[Performance architecture](performance.md).

## Quick Look Boundary

The Quick Look preview and thumbnail extensions are Swift runtime boundaries
(the iPhone app is the third Swift runtime). The extension identifiers are:

```text
com.local.BuretteV10.Preview
com.local.BuretteV10.Thumbnail
```

The shipped app bundle must contain:

```text
build/Burette.app/Contents/PlugIns/BurettePreview.appex
build/Burette.app/Contents/PlugIns/BuretteThumbnail.appex
```

Keep the identifiers stable unless doing an explicit Quick Look registration
migration.

## Documentation Graph

Use [docs/README.md](README.md) as the documentation map. Current specs live in
the active engineering docs above. Historical reference snapshots and migration
handoffs are intentionally not part of the repository docs graph.

### File and table context actions

Sidebar file mutations use the desktop-only `operate_sidebar_file` command. Its
`request` is tagged by `operation`: `rename` takes `path` and `name`, `duplicate`
and `trash` take `path`, and `saveCopy` takes `path` and `destination`.
Paths are absolute; operations require regular files and never overwrite existing destinations.
Trash uses macOS NSFileManager and, like Finder, runs without a confirmation
dialog and plays the system move-to-trash sound; a dialog appears only to report
a failure. Rename and Trash pass through the existing
unsaved-document close guard before changing disk state. Browser previews omit
these mutation actions. Project Rename changes the sidebar label; file and nested
folder Rename change their names on disk without replacing existing destinations.

Sidebar folder rows are drop targets like Finder folders. Files and folders
dropped on a row (from Finder or from other sidebar rows) go through the
`moveInto` operation, which takes `path` and `destination`: a move within one
volume renames, a move to another volume copies and keeps the original, and an
existing item with the same name is never replaced. Molecule records dropped on
a row are still saved as new files there. On macOS, dragging a sidebar row
starts a native file drag (`start_file_drag`), so Finder and other apps receive
copies of the real files or folder; in-app drops of that drag keep the row's
structure payload. Right-dock file tabs use the same drag. AppKit does not
always report a drop on Burette's own window to the webview, so when nothing
accepts the drag and the button is released over the window, the command
returns that point and the page runs the drop there.

Grid row/cell menus use the desktop host menu when embedded in the workspace,
with the web menu as a standalone fallback. Column-header menus remain owned
by the shared grid web runtime. Column sorting, filtering, pinning, visibility, width reset, and loaded
row statistics share the existing table state. Selected-row copy/export resolves
remote selections before exporting. Native grid paging accepts `desc:` and
`numeric:` prefixes on property sort keys (for example
`desc:numeric:prop:pIC50`); property names remain SQL parameters. Analysis
column sorting remains unavailable for remote pages.

### Grid inspector opening

The mini Mol* inspector sends `burette-inspector-open` to its parent on a click (not a drag). The host dispatches `structure.open-in-molstar` with `rowIndex`; the grid emits `openSdfMolstarDocument` with `openTarget: "new-tab"`. The SDF message handler adds the prepared document as a new tab, preserving the source collection. Existing messages without `openTarget` retain their active-tab behavior.


### xyzrender canvas inspector selection

In the browser/app viewer, `xyzrenderActiveItem` publishes the selected sheet
item's stable `itemId`, source and appearance to the inspector. The host routes
it as `burette:xyzrender-active-item`; `setXyzrenderControls` with an `itemId`
updates that item only. A missing or removed target is ignored. Appearance and
orientation remain on the sheet item; animation settings are remembered per item
for the editor session (up to 32 entries). Ready animations remain mounted per item while switching selection, preserving
playback and avoiding repeated renders. Canvas playback uses the display clock;
only the visible inspector updates its frame label, at most ten times a second.
`xyzrenderItemRemoved` releases the removed item's animation and aborts its pending
render. Changing animation parameters invalidates only that item's frames.

Decoded animation storage is reserved before rendering, with a shared limit of
200 million RGBA pixels. New renders that exceed the budget ask for a smaller
image or removal of another animation; existing movies are not evicted.

### R-group result persistence

`rgroup_store_results` replaces all columns owned by the `rgroup` calculation
in one SQLite transaction, preserving unrelated descriptors. Its bounded payload
contains the source structures and the complete result. Applying results checks
the source row IDs and structures again under the write transaction; a changed
collection requires a new calculation. Failed writes preserve the previous run.
See [Scaffold and R-group analysis](sar-analysis.md) for chemistry semantics,
limits, result columns, and focused verification.

### Opening docking folders

Opening a fresh local selection containing one protein and ligand files together
creates a docking run, with poses grouped by source file. Comparison sets and
watched folders retain the incremental scene batch flow. Cancelling a pending
docking open prevents the prepared document from entering the workspace.

### Adding files to an open scene

Dropping structures or collection records onto a Mol* document appends them to
that document's mounted scene. The receptor's representations and camera stay
intact; SDF imports retain all models. Both native and browser drop routes use
the same scene import operation as Add to Scene. SDF ligands dropped onto a
receptor or docking document default to the docking view instead, because only
that view pages through SDF records as poses; Add to scene stays in the drop
menu. Trajectory pairing retains its separate document workflow. Combined scenes can be saved through Export → Scene.
Add to Scene skips files the target already holds, and a combined scene's tab
menu adds the whole scene, including files and records added to it earlier, to
another open scene, so scenes can be chained.
SSH allows three native requests at a time and reuses OpenSSH connections through
an app-private 0700 control-socket directory with a 60-second idle lifetime.
Strict known-host checking, batch authentication, and disabled forwarding remain
in force; the user's SSH configuration and credentials are never changed.
Browser-dev keeps its existing sequential per-host worker, admits three requests
at a time, and queues up to 200 more for at most 45 seconds each. Disconnected
requests leave the queue before acquiring a worker. Both transports revalidate remote device/inode,
size, modification and change timestamps before reusing a preview. Changed files
get immutable new local paths; open previews are never deleted to make room.
Cache admission preserves the 256-file / 512-MiB bounds, with a 64-MiB file limit.
The internal preview response is a bounded JSON header followed by raw bytes;
remote paths still travel only as JSON on stdin. Refreshing a remote project
keeps its cached tree visible.

### Native conformers in Mol* collections

Before standalone conformer generation or optimization, `conformer-input.ts`
rejects sources whose records all contain explicit R-group (`R#`) or wildcard
(`*`) atoms. It checks V2000/V3000 atom fields and SMILES atom tokens, not alias
labels or SDF properties. The extraction worker applies the same check per
record, preserving the existing partial-result path for mixed collections.
This narrow admission check does not replace parsing, sanitization or geometry
validation, and does not alter source files or choose substituents. Such
generalized structures remain suitable for 2D depiction; their aliases must be
preserved separately from concrete-molecule 3D operations.

Generate 3D on an SDF/MOL document restores the native artifact coordinates
into its source records by the artifact molecule ordinal. The active tab keeps
the source name and SDF topology/properties, so Grid and pose alignment remain
available. A single-conformer calculation replaces coordinates rather than
appending the old geometry. Failed source records remain unchanged; ensemble
mode retains multiple generated conformers per source. The durable compute
artifact and report remain available separately.

### Pose navigation camera

Next/Prev, keyboard steps, slider and playback keep the current camera. Cached
pose replacement temporarily suppresses Mol* automatic camera resets while
removing and rebuilding the foreground, then restores its prior reset policy even if the replacement fails. Camera
input remains live, and holding the viewport pointer does not pause playback. Initial loading and explicit focus
retain their framing behavior. Unsupported Align controls are hidden; supported
alignment remains visible, including its temporary busy state.

Native Analyze commands also accept a file-backed SDF opened in Mol*. The desktop
menu's `canOpenCollectionAnalysis` capability enables these commands; choosing one
opens the same file in Grid and dispatches the analysis only after its records
are ready. Leaving the target tab cancels the pending analysis. Grid-specific
selection, unsaved-edit, and Python RDKit requirements still apply. Opening all
rows in Mol* keeps the collection title, and 2D alignment preserves SD properties.

Spread arranges collection molecules in a grid in the 3D scene without changing
the source coordinates. All/Spread loads each molecule as a separate structure,
so selection and scene-tree operations stay scoped to that molecule. Stepping
changes foreground styling without replacing the other structures. Align remains
a separate operation and is hidden when the collection cannot be aligned.

The initial Mol* canvas stays hidden until its background is configured. Paint
waits use a timer fallback because WKWebView can suspend animation callbacks for
hidden canvases; startup must not depend on revealing the canvas first.

## PDB transfer to Ketcher

The molecule preview and extracted PDB residues retain their original atom
records and filtered CONECT records. Ketcher import uses local Open Babel
(`obabel -ipdb -osdf`) through `prepare_ketcher_pdb` on desktop or the
browser-dev `prepare-ketcher-pdb` route. It validates atom identity and 3D
coordinates before loading the resulting MOL block. Existing SDF chemistry
is imported directly. Coordinate-only PDB chemistry is inferred, not an
authoritative replacement for a ligand's original SDF.

This conversion requires an installed Open Babel executable. Hosted surfaces
without the local converter reject PDB editor imports with an actionable error
instead of silently replacing bond orders with single bonds. The focused
integration check is `bun tests/test-ketcher-pdb-import.mjs` (Open Babel needed
for chemical perception); the native converter check is
`cargo test --lib ketcher_pdb -- --include-ignored` from the Tauri crate.

### Detached structure previews

On desktop, **Pop out** for a file opens an independent `workspace-preview-*` native window. It can move between displays and appears across macOS workspaces; it starts compact, above normal windows, with the original compact 36 px pane header and the viewer. The header provides Close, Minimize, Return to main window and Expand controls with native dragging. Returning transfers the current scene to an existing normal workspace (or creates one if needed) before closing the preview. Workspace tabs, browser navigation, sidebars and guides are not mounted in this window. Files offer **Open → Popout**, and a single molecule selected in Mol* offers **Open in → Popout**. Geometry and restoration use the existing workspace-window registry. Mol* viewers export the live scene (including camera and representations) to a bounded 24 MiB MOLJ snapshot in the application cache before opening the window. Opening another molecule reuses the existing preview webview, with prior documents available from the compact title menu. Selected-molecule popouts persist the validated source directly and prepare it only in the destination, avoiding construction of an unused viewer in the originating window. Transferred scenes retain their canvas presentation and fit the destination viewport while preserving orientation. Preview windows use a transparent borderless native surface without the workspace backdrop. The title text is a native drag region, with the document menu restricted to its arrow. Preview windows with valid UUIDs participate in desktop compute ownership. Only the main window consumes a process startup agent session; secondary windows accept explicit session attachments. Frontend status errors persist in a 256 KiB application log with one bounded previous copy and at most 20 bounded recent errors in memory. The original tab remains available. Non-Mol* files use the existing path-based open contract; non-file pages and browser previews retain the embedded pane.

`open_new_workspace_window` accepts optional `presentation` (`workspace` by default, or `preview`) and an optional `scene` object (`title`, `dataBase64`). A scene requires preview presentation and no file paths. Snapshot names and payloads are validated before writing; existing callers that supply only paths retain their behavior.

### Dropping structures into scenes

Molecular files dropped onto a Mol* document append directly to that document,
without an action picker or switching to a docking document. Each document has
its own import queue; batches preserve the mounted scene and camera. Repeated
paths are skipped, and failed batches roll back their new objects. Finder
folders use the bounded recursive project scanner before importing; incomplete
or unreadable scans fail rather than silently importing a partial folder.
Scene drops retain all SDF models. Explicit comparison/docking commands remain
available for pose paging and structure alignment.

The grid inspector boots its 3D iframe from an external packaged script and inert JSON, preserving the desktop content security policy. Its first nonempty molecule initializes the viewer; later rows reuse it. Card viewport cover is recalculated when either the iframe, workbench or dock changes size.

### Files in right and bottom panels

The file menu offers both panel destinations. Each Files strip has its own
picker and file names; opening another file selects it only in that panel.
Its file menu and existing drag gesture can open it in the other panel or main
area without removing the source. Images and ordinary CSV use DocumentSurface
in place; molecular CSV, PDB and SDF keep format-based rendering. Path-backed
media use `media:<path>` dock identities rather than molecular registry records.
Async preparation captures its originating workspace before applying a result.

Each dock retains at most four visited previews within a 256 MiB admission
estimate using the existing scene-cost estimator, not a measurement of GPU
memory. Hidden Mol* frames receive the visibility message and stop their render
loop and trajectory playback. Recent views retain zoom, filters and cameras;
evicted views recreate their runtime when selected again.
Browser-picked binary documents retain their original bytes (at most 32 files,
subject to the existing per-file byte limit).
