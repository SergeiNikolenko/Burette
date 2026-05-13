# Burrete UI Accessibility Spec

## Summary

Make the Burette Tauri shell usable with keyboard and assistive technologies.
The app has a compact sidebar, tab strip, Settings page, status surface, and
embedded preview controls; each needs predictable focus, labels, and shortcuts.

## Goals

- Every interactive shell surface is reachable by keyboard.
- Focus order is logical:
  titlebar controls -> tabs -> Open -> sidebar -> main stage -> status/settings.
- Icon-only controls have accessible names.
- Focus indicators are visible.
- Keyboard shortcuts are documented and centralized.
- Preview iframe has a descriptive title.

## Non-Goals

- Full WCAG certification in v1.
- Screen-reader-perfect narration inside Mol* or RDKit canvases.
- Localization.

## Canonical Shortcuts

- `Cmd+O`: open structure files.
- `Cmd+P`: open the command palette.
- `Cmd+\\`: toggle sidebar.
- `Cmd+,`: open Settings page.
- `Cmd+W`: close active structure.
- `Cmd+1` through `Cmd+9`: activate the matching tab.
- `Esc`: dismiss transient surfaces when they exist.

## Required Semantics

Sidebar:

- Search input has an accessible name.
- Project list uses `role="list"` or equivalent semantic structure.
- Project rows expose file name and renderer in their accessible name.
- Close buttons are focusable and labeled.

Command palette:

- The palette has dialog semantics and an accessible name.
- Search input has an accessible name.
- Escape dismisses the palette from any focused element inside it.
- Global shell shortcuts are disabled while the palette is open.

Tab strip:

- Tabs use `role="tab"` semantics or clear button labels.
- Active tab is programmatically distinguishable.
- New/open button has an accessible label.

Settings:

- Each select has a visible label.
- Maintenance actions describe the effect.

Launcher:

- Welcome actions are reachable from keyboard.
- The primary open action remains visible and labeled before any structure is
  loaded.

Fallback:

- The shell error boundary uses `role="alert"` and exposes a retry button.

Preview:

- iframe title uses the active document name.
- Runtime toolbar controls use visible text or accessible labels.

## Implementation Notes

- Avoid global `outline: none`; replace with `:focus-visible`.
- Do not rely on color alone for active rows.
- Keep hover-only controls keyboard reachable.
- Keep `docs/keyboard-shortcuts.md` synchronized with the global shortcut hook.

## Acceptance Criteria

- A keyboard-only user can open, switch, close, and search structures.
- Settings can be opened and edited without a pointer.
- Every icon-only button has an accessible name.
- Focus is visible on all focusable controls.
- Screen readers can identify active document, Settings, and Open actions.
- Screen readers can identify the launcher and error fallback states.
