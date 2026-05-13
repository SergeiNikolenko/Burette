# Multi Window Spec

## Status

**v1 shipped (2026-04-23) — single-process, per-window state.** Every window is a Tauri `WebviewWindow` inside the same OS process; the former global `AppState` was split so a process-wide `AppState` container maps a window label to a per-window `WorkspaceState` (workspace root, file index, watcher handle, gitignore matcher, pending-open queue, settings layer). IPC handlers look up the calling window's state via `webview.label()` and emit events back via `handle.emit_to(&label, ...)` so two windows hosting different workspaces never cross-talk. Opening a workspace from the sidebar switcher, welcome screen, command palette, or a cross-workspace dock/drag-drop builds a new window with a UUID label and pre-queues a pending-open payload; the new window hydrates onto it during its normal startup flow. If a window already hosts the requested workspace it's focused rather than duplicated. The window close event removes the state, which drops the watcher and cancels FSEvents/inotify subscriptions. `tauri-plugin-single-instance` is registered with a handler that opens a new window for secondary launches.

Known limitations:

- Recent-workspaces and session JSON files live in app data and are shared across windows; concurrent writes from two windows race at the filesystem layer.
- Global settings are loaded into each window's `Settings` independently, so a global-setting change in window A is not reflected in window B until B's Settings reload.
- No macOS Window menu entries, no session-restore of multiple windows at quit, no tab tear-off — these are tracked as future work in TODOS.md.

## Summary

Allow Writer to open multiple workspace windows at once. Today the app is single-window; opening a second workspace replaces the current one.

## Goals

- `File > New Window` and `Cmd+Shift+N` open a fresh workspace window.
- Each window has independent state: workspace, tabs, sidebar, history.
- Closing one window does not affect the others.
- Restoring a session restores every window that was open at quit.
- Cross-window communication is minimal in v1: just shared workspace data on disk.

## Non-Goals

- Tab tear-off (drag a tab to a new window).
- Cross-window drag and drop in v1.
- Window-to-window state syncing beyond what the filesystem already provides.

## Architectural Implications

This is a significant architectural change because much of the current app assumes a single global Zustand store and a single Rust workspace state.

Decisions for v1:

- The Rust side adopts a per-window state map keyed by Tauri window label. Workspace root, file index, and watcher handle move from `state.rs` global state into per-window slots.
- The frontend continues to use Zustand stores but each window mounts its own store instance scoped to that window's React tree.
- Tauri commands learn to look up state by the originating window label.

## UX Decisions

- New windows default to the welcome screen unless they were restored from session.
- The macOS `Window` menu lists open Writer windows.
- The Dock badge / app icon does not change.
- Each window has its own command palette, sidebar, and tab strip.

## Conflict Behavior

- If two windows have the same file open and the user edits it in one and saves, the other window's open buffer should reload (or prompt) just like the existing watcher-driven reload path.
- Two unsaved divergent edits to the same file from two windows: surface a conflict warning before save in the second window.

## Files Expected To Change

- `apps/desktop/src-tauri/src/state.rs` (per-window state map)
- every command in `apps/desktop/src-tauri/src/commands/` (accept window label or `tauri::Window`)
- `apps/desktop/src-tauri/src/lib.rs` (window creation API + event handling)
- `apps/desktop/src/stores/*` (per-window store boundaries)
- `apps/desktop/src/App.tsx`
- new `apps/desktop/src/hooks/use-window-id.ts`
- session restore logic
- comprehensive Rust and frontend tests

## Acceptance Criteria

- The user can open multiple Writer windows simultaneously, each with its own workspace and tabs.
- Closing one window does not impact others.
- Quitting and relaunching restores all previously open windows.
- Conflicting edits between windows are detected and surfaced rather than silently lost.
