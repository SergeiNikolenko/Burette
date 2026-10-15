# Tabs, Screens, And Panes

Burette's workspace follows the Codex window shell (see the atlas entries
`kit-window-shell`, `kit-tab-strip`, `kit-new-tab-menu`, `kit-hotkey-window`
and `kit-detached-window`): every piece of work is a **screen**. A screen is
shown in one **place**, and moving it never reloads it.

## Screens

A screen is a tab (`MoleculeTab` in `apps/desktop/src/stores/molecule-store.ts`)
whose `location` picks a page kind from
`apps/desktop/src/components/editor-area/page-kinds`.

| Kind | Glyph | Notes |
| --- | --- | --- |
| `file`, `text-file`, `document` | file kind glyph from the sidebar | Viewer, grid or text source; kept alive (`keepAlive`) |
| `launcher` | Plus | Start page ("New Tab") |
| `ketcher` | Edit | Sketcher |
| `jobs` | Stopwatch | Calculations list, also a bottom-dock tab |
| `chemical-space` | Chart | Map of a collection; follows the front collection unless opened for one |
| `fep-setup`, `fep-network` | Flask | Opened by FEP actions |
| `pose-review` | Compare | Opened by docking results |
| `settings` | Settings | Full-window mode, never placed |

`TabKindIcon` (`editor-area/tab-kind-icon.tsx`) draws the glyph in the tab
strip and in pane headers.

## Places

| Place | Holds | Where it is drawn |
| --- | --- | --- |
| Main window | any number of screens, one in front | tab strip in the title bar row |
| Floating window | one screen | 16 px rounded window over the workspace, 470 x 640 by default, at least 400 x 400 |

`MoleculeTab.pane` (`"floating" | undefined`) records the place.
`activeTabId` always names a main tab; making a placed screen active (sidebar,
deep link, open actions) brings it back to the main window. Tabs saved by
older builds in the retired side panel (`pane: "side"`) load into the main
strip; the right dock covers what the side panel showed.

### No remount

All screens stay children of the one `.page-stack` in `ViewerArea`. A placed
screen's `.page-surface` is laid out over the floating window with
`position: fixed` (`workspace-panes/workspace-panes.css`), and the floating
header positions its own surface. Moving an iframe to another parent would
reload it and rebuild the Mol* scene.

## Interactions

| Action | Where |
| --- | --- |
| Pop Out, Move to Main Window | tab context menu, pane switcher |
| Switch screen, show a main tab here, open Jobs, Chemical Space, Ketcher | pane switcher (title and chevron) |
| New screen of any kind | right-click "+" in the tab strip; click "+" is New Tab (Cmd+T) |
| Open New tab, Jobs, Chemical space, Ketcher in the main strip | sidebar rows under the title (Codex's New chat and Scheduled rows); the row of the front screen is highlighted |
| Hide or show the right dock | panel button at the end of the title bar, or Opt+Cmd+B |
| Hide or show the bottom dock | Cmd+J only; the title bar has no button for it |
| Move, resize, minimize the floating window | drag the header, drag the bottom-right corner, "-" button |
| Close a screen | Close in any of the menus above, or its tab |
| Rename tab | tab context menu or pane switcher; changes the label without renaming the source file |

Settings is a full-window mode: the floating window and the docks step aside while it is open and
come back unchanged.

## Persistence

- Screen places persist with the session (`burette.molecule.session`):
  `pane` on each tab.
- Optional tab `title` labels persist in the session and exported session
  snapshots. Labels are trimmed and limited to 200 characters; older sessions
  without a label continue to use the page title.
- Floating window geometry persists in `burette.workspace-panes`: its
  rectangle and minimized flag.
- With `restoreSessionOnLaunch` off, tabs and their places start fresh; the
  geometry is kept as a window preference.

Save scene exports the current Mol* snapshot as `.molj`. After a successful
native save, the saved file opens and is pinned in the sidebar. Cancellation
and failure leave the sidebar unchanged. Browser downloads do not return a
filesystem path, so they cannot be pinned automatically. This action currently
uses the agent session export transport, whose inline payload limit is 2 MiB.

## Docks

| Dock | Holds | Toggle |
| --- | --- | --- |
| Right dock | per-tab tools (Info, Text, Files, Ketcher, Jobs, Chemical space, ...) following the front tab | title bar panel button, Opt+Cmd+B |
| Bottom dock | shared tools (Jobs, logs) | Cmd+J |

The right dock is the only panel beside the main column; the separate side
panel was removed because it duplicated the right dock's tools.

## Stages

1. Done: screen kinds with glyphs; Jobs and Chemical Space open as tabs; "+"
   context menu with screen kinds.
2. Done, then retired: a separate side panel column. The right dock holds
   the same tools.
3. Done: floating window with drag, resize, minimize and switcher; places and
   geometry persist and follow `restoreSessionOnLaunch`.
4. Next: the atlas tab switching commands (Shift+Cmd+[ and ]) in
   `lib/keyboard-shortcuts.ts`; close others and reopen closed tab are done.
5. Next: drag a tab out of the window.
