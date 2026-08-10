# Window Content Zoom Design

**Status:** Approved direction as of 2026-08-10, based on branch
`claude/screen-scaling-feature-7fafe4` at `21d05ec6`.

## Goal

Let the user scale the whole application content with standard keyboard
shortcuts, the way browsers do:

- **Zoom In** `⌘=`, **Zoom Out** `⌘-`, **Actual Size** `⌘0`;
- the zoom applies to everything rendered in the window — workspace chrome,
  text, panels, and embedded viewers (Mol*, Ketcher) alike;
- one shared zoom factor for all workspace windows: changing it in any window
  changes every open window, and new windows open at the current factor;
- the factor is ephemeral: every app launch starts at 100%.

## Non-goals

- No persistence of the zoom factor across launches.
- No per-window zoom.
- No UI-chrome-only scaling (IDE-style "UI scale"); the 3D viewers zoom too.
- No zoom percentage indicator, toast, or status readout.
- No pinch-gesture zoom and no command-palette entry.
- No CSS `zoom` on the document root — the app relies on measured-pixel layout
  (resizable panels, pixel guards), which CSS zoom would skew.

## Approach

Handle zoom entirely on the Rust side. The native menu already owns the
keyboard accelerators, and Tauri's `Webview::set_zoom` maps to WKWebView
`pageZoom` on macOS, which scales all webview content natively. Menu commands
for zoom are *not* forwarded to the frontend; they short-circuit in the Rust
menu event handler, mirroring how `file.new-window` is handled. This keeps the
change free of new capabilities/ACL permissions and makes the all-windows
broadcast trivial.

Native menu accelerators fire regardless of focus — including when focus is
inside the Mol* or Ketcher iframe, where a JS `keydown` listener would never
see the event.

### Accelerator choice: `⌘=` rather than `⌘+`

muda 0.19 rejects `+`/`Plus` as an accelerator key (`UnsupportedKey`), and the
physical gesture browsers respond to is `⌘` plus the unshifted `=/+` key —
i.e. `Cmd+=`. The menu therefore uses `CmdOrCtrl+=` and macOS renders `⌘=` next
to Zoom In. `CmdOrCtrl+-` and `CmdOrCtrl+0` parse and render as expected.

## Design

### Menu (apps/desktop/src-tauri/src/menu/build.rs)

New section in the View menu, placed before the Enter Full Screen item,
following the Safari ordering:

| Item        | Id                 | Accelerator   |
| ----------- | ------------------ | ------------- |
| Actual Size | `view.zoom-actual` | `CmdOrCtrl+0` |
| Zoom In     | `view.zoom-in`     | `CmdOrCtrl+=` |
| Zoom Out    | `view.zoom-out`    | `CmdOrCtrl+-` |

All three are always enabled. At the ladder bounds, Zoom In/Out become no-ops
(clamped) instead of disabling menu items — this avoids coupling zoom to the
native-menu state sync machinery.

### Zoom module (apps/desktop/src-tauri/src/zoom.rs, new)

- `ZOOM_LEVELS: [f64; 13] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5,
  1.75, 2.0, 2.5, 3.0]` — Chrome-style discrete ladder. An index into the
  ladder, not float multiplication, is the source of truth, so repeated in/out
  steps stay on round levels and return to exactly 1.0.
- `DEFAULT_ZOOM_INDEX` — index of `1.0`.
- Pure transition functions over indices (`zoomed_in`, `zoomed_out`), clamping
  at the ends; unit-tested.
- `WindowZoom` managed state: `Mutex<usize>` holding the current index,
  registered via `app.manage()` in `lib.rs` alongside the other registries.
- `handle_menu_command(app, id) -> bool`: recognizes the three menu ids,
  updates the index, and applies the resulting factor to every webview window.
  Returns `false` for unrelated ids so the menu handler falls through.
- `apply_current_zoom(window)`: applies the current factor to a single window
  when it is not the default; called for newly created workspace windows in
  `windows.rs::create_workspace_window`.

### Menu event handling (apps/desktop/src-tauri/src/menu/events.rs)

`handle_event` delegates to `zoom::handle_menu_command` before the
`FORWARDED_COMMANDS` lookup, in the same style as the `file.new-window`
special case. The zoom ids are not added to `FORWARDED_COMMANDS`.

## Error handling

- `set_zoom` failure on one window: log a warning with the window label and
  continue applying to the remaining windows. Zoom must never crash or abort
  the broadcast midway.
- Poisoned zoom mutex: recover the inner value and continue; zoom state is a
  single `usize` with no invariants to violate.

## Testing

- Unit tests in `zoom.rs` for the ladder logic: clamping at both ends,
  in/out round-trips returning to the default, default level being `1.0`,
  ladder strictly increasing.
- `tests/test-tauri-structure.mjs`: assert the three menu ids and their
  accelerators exist in the menu build source, following the existing
  native-menu contract assertions.
- Manual dev-run check: `⌘=`/`⌘-`/`⌘0` with focus in the main UI and with
  focus inside the Mol* viewer; a second window picks up the current factor
  on open; relaunch starts back at 100%.

## Documentation

- `docs/keyboard-shortcuts.md`: add the three shortcuts.
- `apps/desktop/src/components/settings-panel/keyboard-shortcuts-section.tsx`:
  add matching entries (`⌘=`, `⌘-`, `⌘0`) so the in-app shortcut list stays
  complete.
