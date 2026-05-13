# Command Palette

## Summary

Burette should use a Writer-style command palette as the primary keyboard
surface for app actions. The command palette replaces the current sidebar-search
only `Cmd+P` behavior.

## Commands

- Open Structure
- Search Open Structures
- Open Settings
- Renderer: Auto
- Renderer: Mol*
- Renderer: Fast XYZ
- Renderer: xyzrender external
- Clear Preview Cache
- Reset Quick Look
- Open Logs Folder
- Check for Updates
- Close Active Structure
- Close All Structures
- Clear Recent Structures
- Open Recent: `<title>`
- Open Structure: `<title>`

## Requirements

- `Cmd+P` opens the palette.
- Typing filters commands and open structures.
- With an empty query, commands are grouped into Writer-like sections:
  `Suggested`, `Renderer`, `Recent`, and `Open`.
- With a non-empty query, matching items are grouped under `Results`.
- Selecting a structure activates its molecule tab.
- Selecting a renderer command updates the existing renderer preference.
- Maintenance commands call existing Burette actions before adding new backend
  APIs.
- Escape closes the palette without side effects.

## Acceptance Criteria

- Palette actions are keyboard reachable.
- Palette grouping is present in the live browser UI, not only in static code.
- Commands do not duplicate backend logic.
- Active molecule reload behavior remains controlled by existing preferences.
- Quick Look reset and log opening still route through existing commands.
