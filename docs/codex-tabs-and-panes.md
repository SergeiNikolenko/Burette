# Tabs, Screens, And Panes

A screen is a `MoleculeTab` whose `location` selects a page kind. The main tab
strip, right side panel and browser floating surface share screen placement
state. A native detached window has a separate runtime and transfers a saved
checkpoint instead of moving a live iframe between windows.

## Screens And Placement

| Screen | Content |
| --- | --- |
| `file` | Molecular viewer, collection, spectrum or illustration sheet |
| `text-file`, `document` | Source editor, notes, PDF or image |
| `launcher`, `ketcher` | New tab or molecular sketcher |
| `jobs`, `chemical-space` | Calculations or collection projection |
| `pose-review`, `fep-setup`, `fep-network` | Pose and FEP workflows |
| `settings` | Full-window settings; placed screens step aside |

`TabKindIcon` supplies the shared glyph. Optional tab titles label the screen
without renaming its source file. Titles are trimmed, limited to 200 characters
and included in session snapshots and closed-tab restoration.

| Place | Layout and ownership |
| --- | --- |
| Main | Multiple screens with one active tab |
| Side panel | One resizable right-hand region containing both screen tabs and inspector/tool tabs |
| Browser floating surface | One in-page floating screen; movable, resizable and minimizable |
| Native detached window | A separate Tauri workspace window for a supported molecular scene or illustration sheet |

`MoleculeTab.pane` records `side`, `floating` or main placement.
`sidePaneTabId` selects a placed screen. Bringing a placed screen to the main
workspace clears its placement. Settings temporarily hides placed surfaces.

### One Right Panel

The right panel has one width and one header. `DockHeader` lists moved screens
alongside the active main tab's dock tools. Selecting a screen shows its page;
selecting a dock tab shows the corresponding inspector/tool content. These
choices occupy the same region, not adjacent columns.

`rightPanelContent` and `sideHidden` in `workspace-panes-store` preserve the
content choice. Dock tabs, selected dock tool, open state and width live in
`tab-workspace-store`. The legacy `sideWidth` field remains readable for old
snapshots; it no longer controls a second column. Panels offers Side panel and
Bottom dock. The bottom dock remains a separate region.

## Placement And Runtime Lifetime

Within one browser document, `ViewerArea` owns a single `.page-stack`.
Placement changes the CSS position of an existing `.page-surface`; it does not
reparent the iframe. The side surface uses the right panel's measured edge,
while the floating surface uses its stored rectangle. Browser floating starts
at 470 × 640, with a 400 × 400 minimum, and is clamped to the viewport.

This placement mechanism does not promise that every page stays mounted
forever. Inactive main tabs use a bounded warm cache: normally 10 pages,
reduced to 6 on low-memory devices and 4 under detected heap pressure. Visible
placed pages and placed keep-alive pages are retained separately. Protected
unsaved documents are not evicted by this cache. Hidden viewer frames are
excluded from active-frame operations and can pause their rendering.

### Back And Forward

`TabHistoryPages` retains the current page plus up to two recently visited,
reachable file pages in an active tab. Inactive tabs retain their current page
and protected unsaved views. Unvisited history entries do not instantiate a
viewer just because they exist in Back or Forward.

Dirty grids, unsaved scenes and combined scenes are protected beyond this
ordinary three-page bound. If navigating a new branch removes one of these
views from Forward, it is retained in Back in the same tab. Moving it into a
new tab would recreate its iframe and could lose edits. Surviving page nodes
keep a stable DOM order to avoid iframe reloads during Back/Forward changes.
Older clean pages may be recreated when revisited after eviction.

Closing a tab is different from navigating its history: its runtime may unload.
Reopen closed tab reads file content again and restores the saved label when a
new matching tab is created; it is not a live viewer undo operation.

## Native Pop Out And Return

`pane-actions` routes Pop out to `native-popout` in Tauri. In a browser it uses
the floating placement described above. Native transfer supports Mol* scenes
and XYZ illustration sheets. It does not share a WebGL context across windows.

The source becomes inert while a checkpoint is captured. A destination window
opens that checkpoint and acknowledges a nonempty loaded viewer before the
source tab is closed. Transfer failure leaves the source scene open. The
handoff carries the tab label, pin state and original order for return.

- Mol* uses a private `workspace_scene_snapshot` operation to serialize a MOLX
  archive with assets, selection and camera. The archive limit is 24 MiB.
- Illustration sheets capture item sources, SVGs, style and orientation,
  geometry, stacking, selection and viewport in a bounded private snapshot.
  Native storage keeps a source copy and its checkpoint sidecar together;
  restore recognizes the application's checkpoint paths, not arbitrary
  neighboring sidecars. Applied GIFs preserve their encoded frames, timing and
  transparency, but start playback from the beginning in the new window. An
  active animation preview must be applied or cancelled before transfer.
- Unsaved or saving source drafts must be saved before transfer. Trajectory
  formats, MVS stories and non-scene docking views are not eligible. A live
  Mol* Story with multiple snapshots is also rejected rather than silently
  discarding current changes. Mol* and illustration undo stacks are not
  transferred to the destination runtime.

Move to Main Window, or closing a detached window, captures its latest state
and returns it to the original window. If the parent no longer exists, a
durable checkpoint becomes the document source for session restoration. A
return closes the detached window only when it has no other working tabs.
Application exit also checkpoints an owned detached scene. Checkpoints remain in
application data without automatic pruning because history and restored sessions
may still reference them.

## Actions And File Drag

Tab context menus and panel headers provide Open in Side Panel, Pop out,
Move to Main Window, Rename and Close as applicable. The new-tab menu offers
New tab, Jobs, Chemical space and Ketcher. Jobs and Chemical space are not
permanent sidebar cards.

Keyboard commands are defined in `lib/keyboard-shortcuts.ts`, including
Back/Forward, sidebar and panel toggles, close others and reopen closed tab.
Settings → Keyboard shortcuts is the user-facing source for current bindings.

Native drag from a file-backed tab starts an AppKit file drag with filesystem
URLs. Selected tabs can contribute multiple files; non-file screens keep
internal reorder behavior without offering plain text to Finder. Generated
text and sketches are materialized in the normal cache before the drag starts.
Combined or unsaved molecular scenes use the private snapshot transport to
produce asset-inclusive `.molx` files, bounded to 24 MiB. Source-editor drafts export their current text. Dirty
collections require Save first, so the original file is not offered as though
it contained unsaved table changes. A mounted sketch exports its current editor
state instead of an older stored draft. Batches are limited to 200 files and
generated text to 24 MiB. Cancelling a drag must not open or reorder a tab.

Internal tab placement, browser drag payloads and native file drag are separate
paths; see [Drag and Drop](drag-and-drop.md) for their routing contracts.

## Persistence And Scene Saving

Screen locations, history, labels and placement are part of the molecular
session. Pane content choice and browser floating geometry use the window-scoped
workspace-panes store; per-tab dock layout uses the tab-workspace store.
Disabling restore-on-launch starts fresh tabs while retaining layout preferences.

Save scene captures the current Mol* state as a `.molx` archive with embedded
assets, selection and camera. After successful native save,
the saved file opens and is pinned in the sidebar. Cancellation or failure
leaves the sidebar unchanged. Browser download has no returned filesystem path,
so it cannot automatically pin a local file. The private workspace snapshot
transport used for complete scene archives has a 24 MiB bound; the public agent
`export_session` transport retains its independent 2 MiB limit.

## Implementation And Validation Boundaries

- Placement and panel content: `components/workspace-panes`, `dock-panel.tsx`,
  `dock-header.tsx`, `app-layout.tsx` and the two workspace stores.
- History lifetime: `editor-area/index.tsx`, `tab-history-pages.tsx` and
  `lib/viewer-frame-visibility.ts`.
- Native transfer: `workspace-panes/native-popout.ts`, native
  `commands/popout_scene.rs` and the private viewer snapshot handlers.
- Native file drag: `editor-area/tab-file-drag.ts`, `editor-tabs.tsx` and
  `lib/native-file-drag.ts`.

Component and contract tests cover state transitions, history protection,
serialization and cancellation. Browser checks establish in-page placement;
actual native window transfer, return, Finder drag and resize require native
acceptance. Build success alone does not establish those interactions.
