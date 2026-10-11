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
| Side panel | any number of screens, one shown | resizable column between the main column and the right dock |
| Floating window | one screen | 16 px rounded window over the workspace, 470 x 640 by default, at least 400 x 400 |

`MoleculeTab.pane` (`"side" | "floating" | undefined`) records the place.
`activeTabId` always names a main tab; making a placed screen active (sidebar,
deep link, open actions) brings it back to the main window.
`sidePaneTabId` is the screen the side panel shows.

### No remount

All screens stay children of the one `.page-stack` in `ViewerArea`. A placed
screen's `.page-surface` is laid out over its pane with `position: fixed`
(`workspace-panes/workspace-panes.css`): the side panel publishes its width as
`--side-pane-edge`, and the floating header positions its own surface. Moving
an iframe to another parent would reload it and rebuild the Mol* scene.
Placed keep-alive screens stay mounted while their pane shows another screen.

## Interactions

| Action | Where |
| --- | --- |
| Open in Side Panel, Pop Out, Move to Main Window | tab context menu, side panel "..." menu, pane switcher |
| Switch screen, show a main tab here, open Jobs, Chemical Space, Ketcher | pane switcher (title and chevron) |
| New screen of any kind | right-click "+" in the tab strip; click "+" is New Tab (Cmd+T) |
| Open New tab, Jobs, Chemical space, Ketcher in the main strip | sidebar rows under the title (Codex's New chat and Scheduled rows); the row of the front screen is highlighted |
| Hide or show the side panel | panel toggle in the side panel header and in the title bar controls |
| Move, resize, minimize the floating window | drag the header, drag the bottom-right corner, "-" button |
| Close a screen | Close in any of the menus above, or its tab |

Settings is a full-window mode: both panes step aside while it is open and
come back unchanged.

## Persistence

- Screen places persist with the session (`burette.molecule.session`):
  `pane` on each tab and `sidePaneTabId`.
- Pane geometry persists in `burette.workspace-panes`: side panel width and
  hidden flag, floating window rectangle and minimized flag.
- With `restoreSessionOnLaunch` off, tabs and their places start fresh; the
  geometry is kept as a window preference.

## Docks

| Dock | Today | Direction |
| --- | --- | --- |
| Right dock | per-tab inspector tools (Info, Text, Files, ...) following the front tab | Merge into the side panel: its tools become screens bound to the front tab, and Opt+Cmd+B then toggles the side panel as in Codex |
| Bottom dock | shared tools (Jobs, logs) | Stays; Jobs is also a screen |

Until the merge, Opt+Cmd+B keeps toggling the right dock, and the side panel
sits to its left.

## Stages

1. Done: screen kinds with glyphs; Jobs and Chemical Space open as tabs; "+"
   context menu with screen kinds.
2. Done: side panel column with switcher header; placement actions in the tab
   and pane menus; layout of side panel and right dock in one pass.
3. Done: floating window with drag, resize, minimize and switcher; places and
   geometry persist and follow `restoreSessionOnLaunch`.
4. Next: keyboard. Register a side panel command in
   `lib/keyboard-shortcuts.ts` (Opt+Cmd+S, the atlas side chat shortcut) and
   the atlas tab commands (Shift+Cmd+[ and ], Opt+Cmd+W close others,
   Shift+Cmd+T reopen closed tab).
5. Next: drag a tab from the strip onto the side panel or out of the window.
6. Next: merge the right dock into the side panel (see Docks).
