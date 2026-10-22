# Tabs, Screens, And Panes

A screen is a `MoleculeTab` whose `location` selects a page kind. The main tab
strip and the browser floating surface share screen placement state. Native
windows have a separate runtime and receive serialized page inputs or a saved
scene instead of a live iframe moved between windows.

## Screens And Placement

| Screen | Content |
| --- | --- |
| `file` | Molecular viewer, collection, spectrum or illustration sheet |
| `text-file`, `document` | Source editor, notes, PDF or image |
| `launcher`, `ketcher` | New tab or molecular sketcher |
| `jobs`, `chemical-space` | Calculations or collection projection |
| `pose-review`, `fep-setup`, `fep-network` | Pose and FEP workflows |
| `tool` | Independent Info, Text, Basket, Compare and other dock tools |
| `settings` | Full-window settings; placed screens step aside |

`TabKindIcon` supplies the shared glyph. Optional tab titles label the screen
without renaming its source file. Titles are trimmed, limited to 200 characters
and included in session snapshots and closed-tab restoration.

| Place | Layout and ownership |
| --- | --- |
| Main | Multiple screens with one active tab |
| Right / bottom split | Independent tabs; resize with pointer or arrow keys |
| Browser floating surface | One in-page floating screen; movable, resizable and minimizable |
| Native preview window | A compact Tauri window holding a copy of a file screen (Pop out) |
| Native workspace copy | Open in New Window copies a page and its source bindings into a separate workspace |
| Native detached window | A separate Tauri workspace window that owns a moved molecular scene or illustration sheet (Move to New Window) |

`MoleculeTab.pane` (`"right" | "bottom" | "floating" | undefined`) records the place.
`activeTabId` names the focused view in any group. Activating a placed screen
preserves its placement. Right and bottom splits have independent tab selection
and resizable bounds. Full View hides other groups without moving or rebuilding
the selected view; Exit Full View restores the split. Tabs saved by older
builds in the retired side panel (`pane: "side"`) load into the main strip.
Settings temporarily hides placed surfaces.

## Docks

| Dock | Holds | Toggle |
| --- | --- | --- |
| Right dock | Per-tab tools (Info, Text, Files, Ketcher, Jobs, Chemical space, ...) following the front tab | title bar panel button, Opt+Cmd+B |
| Bottom dock | Shared tools (Jobs, logs) | Cmd+J only; the title bar has no button for it |

Context tools can be opened as workspace tabs, then placed in either split or
Full View. The Files entry opens the existing editable screen in that group.
The right inspector remains contextual; bottom tools use one window-owned
workspace (`window-tools`) and survive source tab changes and closure. Source
pins persist by path, resolving the new document ID after restoration. Missing
pinned sources never fall back to unrelated structures. Basket/Compare inputs
are copied when their tool becomes an independent tab.

## Placement And Runtime Lifetime

Within one browser document, `ViewerArea` owns a single `.page-stack`.
Placement changes the CSS position of an existing `.page-surface`; it does not
reparent the iframe. The floating surface uses its stored rectangle. Browser
floating starts at 470 × 640, with a 400 × 400 minimum, and is clamped to the
viewport.

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

## Open In New Window

`workspace-panes/native-page-window.ts` copies a page through a private,
host-validated relay. Page metadata and tool inputs have a combined 2 MiB limit;
tool inputs are limited to 60 entries. The host supplies sender identity, and
the opener accepts acknowledgements only from the destination window. Retries
are idempotent and stop after 60 seconds. Failure always retains the source.

Files are reopened from their paths; sketches export their current KET. This
operation copies inputs, not every local filter, camera, selection or undo
stack. Use Move to New Window below for a checkpointed molecular scene. Text
sources must be present in the destination registry before success is reported.

## Native Pop Out, Move And Return

In Tauri, Pop out on a file screen copies it into a compact native preview
window (`workspace-panes/native-popout.ts`): a Mol* scene travels as an
exported session, other files by path. The main tab stays where it is. The
preview window's Return button sends the current scene back to the main window
and closes the preview. In a browser, and for non-file screens, Pop out uses
the floating placement described above.

Move to New Window (`workspace-panes/native-scene-window.ts`) moves a supported
Mol* scene or XYZ illustration sheet into an independent workspace window. It
does not share a WebGL context across windows.

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

| Action | Where |
| --- | --- |
| Full View, Move to Right/Bottom Split, Move to Main Tabs, Open in New Window, Pop out, Move to New Window | tab context menu, pane switcher |
| Switch screen, show a main tab here, open Jobs, Chemical space, Ketcher | pane switcher (title and chevron) |
| New screen of any kind | right-click "+" in the tab strip; click "+" is New Tab (Cmd+T) |
| Hide or show the right dock | panel button at the end of the title bar, or Opt+Cmd+B |
| Hide or show the bottom dock | Cmd+J |
| Move, resize, minimize the floating window | drag the header, drag the bottom-right corner, "-" button |
| Rename tab | tab context menu or pane switcher; changes the label without renaming the source file |

Jobs and Chemical space are not permanent sidebar cards.

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
session. Browser floating geometry uses the window-scoped workspace-panes store;
per-tab right tools and window-owned bottom tools use the tab-workspace store.
All independently created Ketcher tabs retain their identities during restoration.
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
- Native preview: `workspace-panes/native-popout.ts`,
  `native-preview-layout.tsx` and `open_new_workspace_window`.
- Native move: `workspace-panes/native-scene-window.ts`, native
  `commands/popout_scene.rs` and the private viewer snapshot handlers.
- Native file drag: `editor-area/tab-file-drag.ts`, `editor-tabs.tsx` and
  `lib/native-file-drag.ts`.

Component and contract tests cover state transitions, history protection,
serialization and cancellation. Browser checks establish in-page placement;
actual native window transfer, return, Finder drag and resize require native
acceptance. Build success alone does not establish those interactions.
