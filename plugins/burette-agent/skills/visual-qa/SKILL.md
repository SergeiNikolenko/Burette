---
name: visual-qa
description: "Use when visually verifying Burette Browser preview or desktop app state without replacing typed observe/action contracts."
---

# Visual QA

Use Browser and Computer as verification surfaces.

## Browser

Use Browser for:

- full Browser shell URLs started by
  `scripts/burette-agent.mjs open --mode browser-agent-shell ...`, such as
  `http://127.0.0.1:<fresh-port>/?devFiles=<encoded absolute path>`, when the user
  wants ordinary Burette UI chrome, sidebars, right dock, bottom dock, tabs, or
  app-like behavior;
- tokenized localhost browser-preview URLs;
- screenshot and canvas nonblank checks;
- DOM or Playwright checks for preview panels;
- visual QA when the user asks to watch inside Codex.

Browser means the Codex in-app Browser plugin. Do not use macOS `open`, Arc,
Chrome, Safari, or another external browser for Browser visual QA unless the
user explicitly asks for an external browser. If the in-app Browser cannot open
the local URL, report that blocker and keep the URL available for the user
instead of silently switching browsers.

Prefer browser agent shell over tokenized browser-preview when the user is
checking menus, docks, sidebars, tabs, or other shell-level UI. Prefer
tokenized browser-preview when the QA depends on MCP agent transport,
`observe`, `act`, or action logs.

Do not reuse another browser-dev port for a new agent-owned shell. Reuse an
already useful Browser tab only when the user explicitly asks to keep working
on that exact surface or when a reload is required after a code or asset
change.

## Computer

Use Computer for:

- real macOS Burette app windows;
- accessibility tree checks for Tauri shell and Mol* controls;
- clicking native/Tauri controls when the CLI contract is insufficient;
- confirming that the user-visible desktop app is open and usable.

Computer can see some Mol* toolbar elements, but it cannot reliably provide
chains, ligands, waters, atoms, residues, or selections as typed molecular
state. Always prefer `observe` for molecular truth.

## Completion

Visual QA should cite what was checked:

- target app or URL;
- active document;
- visible controls or panels;
- screenshot/canvas/accessibility evidence;
- any gap between typed observe state and visible UI.

For a requested molecular visualization, inspect the central viewer canvas,
not only the shell chrome or Info/Inspector counts. A black, empty, or otherwise
non-rendered central canvas fails QA even if the file name and molecular counts
are correct elsewhere in the app.

If the central canvas is blank after typed readiness passes, run exactly one
`reset_camera` action, observe again, and take another screenshot. If it is
still blank, report the visualization as failed with the typed state and visual
evidence; do not claim success and do not loop on camera resets.
