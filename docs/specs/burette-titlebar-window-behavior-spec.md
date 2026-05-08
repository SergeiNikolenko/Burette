# Burrete Titlebar Window Behavior Spec

## Summary

Preserve standard macOS window behavior while using a custom Tauri titlebar.
Burrete should feel native: the user can drag the window from the chrome,
resize from normal window borders, and double-click the titlebar according to
the system preference.

## Goals

- Keep normal window dragging from the empty titlebar region.
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
- Use `data-tauri-drag-region` only on empty chrome regions.
- Add a small titlebar double-click handler that:
  - reads `AppleActionOnDoubleClick` on macOS;
  - calls the corresponding Tauri window action;
  - defaults to zoom if the preference is unavailable.
- Stop propagation on tabs and interactive titlebar controls.

## Expected Files

- `src/App.tsx`
- `src-tauri/src/lib.rs` for a small macOS preference command if needed
- `src-tauri/tauri.conf.json`

## Acceptance Criteria

- The user can drag the window from empty chrome.
- Native resize borders work.
- Double-clicking empty titlebar zooms/restores or minimizes according to system
  settings.
- Double-clicking a tab, Open button, or sidebar toggle does not zoom the
  window.
- The behavior is covered by a manual smoke checklist.

