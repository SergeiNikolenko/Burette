# Burrete Titlebar Window Behavior Spec

## Summary

Preserve standard macOS window behavior while using a custom Tauri titlebar.
Burrete should feel native: the user can drag the window from the chrome,
resize from normal window borders, and double-click the titlebar according to
the system preference.

## Goals

- Keep normal window dragging from the titlebar, tab strip, and other
  non-interactive chrome regions.
- Keep native resize borders available.
- Honor macOS titlebar double-click behavior:
  - zoom;
  - minimize;
  - none.
- Avoid triggering zoom/minimize from tab clicks or buttons.
- Keep behavior predictable on non-macOS platforms if the Tauri shell is ever
  built there.

## Non-Goals

- Replacing native traffic lights.
- Borderless windows.
- Custom resize handles around the whole window.

## Approach

- Keep `decorations: true`.
- Use Writer's declarative Tauri titlebar pattern: place
  `data-tauri-drag-region` on the top drag strip, sidebar spacer, and tab
  containers instead of calling `startDragging()` manually from React events.
- Let Tauri's native drag-region script handle titlebar dragging and
  double-click behavior so the shell stays aligned with Writer's chrome model.
- Keep interactive controls as normal buttons/tabs and avoid parallel
  drag-blocking state unless a specific control needs its own mouse handling.

## Expected Files

- `apps/desktop/src/App.tsx`
- `apps/desktop/src-tauri/src/lib.rs` for a small macOS preference command if needed
- `apps/desktop/src-tauri/tauri.conf.json`

## Acceptance Criteria

- The user can drag the window from titlebar, tab strip, sidebar spacer, and
  other non-interactive chrome.
- Native resize borders work.
- Double-clicking empty titlebar zooms/restores or minimizes according to system
  settings.
- Double-clicking a tab, Open button, or sidebar toggle does not zoom the
  window.
- The behavior is covered by a manual smoke checklist.
