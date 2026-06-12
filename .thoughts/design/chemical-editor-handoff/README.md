---
date: 2026-06-08
feature: chemical-editor-handoff
service: apps/desktop
---

# Chemical Editor Handoff

## Goal

Add a compact "Open in..." control to Burrete that mirrors the launcher block
shown in the Codex screenshot:

- top-right chrome button with the preferred external app icon and a chevron
- dropdown of compatible installed chemical editors/viewers
- fallback actions for Finder and default system open
- native launch of the active file in the selected application

The feature should discover installed apps automatically, but the matching logic
must be conservative so Burrete does not show unsuitable apps for every file.

## Scope

In scope:

- active file launcher for the current structure/text file tab
- installed app discovery from common macOS application directories
- compatibility filtering by file extension and known chemical app profiles
- external app launch through Tauri/native layer
- compact UI and status/error reporting
- contract tests for command wiring and UI placement

Out of scope:

- embedding external chemical editors in a webview
- synchronizing edits back from external apps
- controlling Maestro/PyMOL/ChimeraX sessions after launch
- long-running conversion or docking workflows
- making a global integration marketplace

## Recommended Implementation Order

1. Add native app discovery and launch commands.
2. Add a typed frontend model and `ShellActions` methods.
3. Add the top-right launcher component.
4. Extend the Radix menu type for icon rows.
5. Add known chemical app compatibility profiles.
6. Add tests and one real packaged-app smoke.

## Files

- [research.md](research.md)
- [01-architecture.md](01-architecture.md)
- [02-behavior.md](02-behavior.md)
- [03-decisions.md](03-decisions.md)
- [04-testing.md](04-testing.md)
