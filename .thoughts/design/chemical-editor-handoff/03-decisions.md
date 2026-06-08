---
date: 2026-06-08
feature: chemical-editor-handoff
service: apps/desktop
---

# Decisions

## ADR 1: Keep External Editors External

Decision: Burrete launches installed chemical tools instead of embedding or
controlling them.

Reasoning: Burrete is a preview workspace. Maestro, PyMOL, ChimeraX,
DataWarrior, VESTA, and Avogadro have their own state models and startup costs.
Trying to embed them would turn a small launcher into a brittle integration
surface. Launching a file is enough for the requested block and matches the
Codex screenshot pattern.

## ADR 2: Use Known Profiles Plus Info.plist

Decision: Matching uses Burrete-owned known app profiles first, then explicit
`Info.plist` document extensions.

Reasoning: The inspected local apps include wildcard declarations from Avogadro
and VESTA. Pure `Info.plist` matching would over-advertise. Pure hardcoding
would miss future installed apps. The hybrid approach stays automatic while
remaining conservative.

## ADR 3: Use Tauri Opener, Not Shell Commands

Decision: Launch through `tauri_plugin_opener::open_path(path, Some(app))`.

Reasoning: The project already uses `tauri-plugin-opener`, and the local crate
source confirms `open_path` supports a `with` application argument. This avoids
manual `open -a` process spawning and keeps launch behavior inside the existing
native dependency.

## ADR 4: Extend Existing Menu Components

Decision: Extend `MenuItemSpec` and `RadixDropdownMenu` for optional icon and
description fields instead of introducing a new dropdown library.

Reasoning: Burrete already uses Radix menus for dropdown and context menus.
The requested UI needs the same menu behavior with richer rows.

## ADR 5: Validate Target On Launch

Decision: The open command accepts a target ID, then native code re-discovers
and validates that the target is compatible with the requested file.

Reasoning: The frontend is not a trust boundary. Passing arbitrary app paths
from the webview would create a broader native launch surface than needed.

## Risks

- **App icon extraction may be fiddly.** First implementation can use generic
  molecule/app icons and add bundle icon extraction later.
- **Schrodinger suite app names contain spaces.** Use app paths or validated
  target records rather than manually escaped shell strings.
- **Document type metadata is noisy.** Keep tests around wildcard filtering.
- **External app launch is hard to assert in CI.** Unit/contract tests should
  validate discovery/filtering; real launch can be a local smoke.
