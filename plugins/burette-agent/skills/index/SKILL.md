---
name: index
description: "Primary router for Burrete. Use when the plugin is at-mentioned or for molecular workspace work: opening structures, operating Mol*, reviewing SDF/property collections, trajectories, workflow result bundles, molecular reports, or Browser/Computer visual QA."
---

# Burrete

Route broad molecular workspace requests to the right focused workflow. Treat a
direct Burrete invocation as intent to use this plugin.

## Mandatory Preflight

Before opening files, acting on Mol*, rendering panels, or drafting a handoff,
load [user-context](../user-context/SKILL.md) and run:

```bash
node plugins/burette-agent/scripts/burette_agent_preflight.mjs
```

Use the returned envelope as the source of truth for available transports,
preferred mode, workflow routes, and current blockers. Do not use preflight as a
substitute for runtime `observe`.

## Routing

Choose the smallest focused workflow that covers the request:

- [external-agent-contract](../external-agent-contract/SKILL.md): operate
  Burrete through a short `workspaceSessionId` contract for external agents,
  hiding URL/session-directory transport details unless advanced control is
  needed.
- [open-workspace](../open-workspace/SKILL.md): open local structures,
  collections, trajectories, or result bundles in Browser preview or desktop
  app.
- [molstar-scene](../molstar-scene/SKILL.md): run high-level Mol* scene actions
  such as focus ligand, hide waters, surface, color, contacts, and reset camera.
- [molecule-collection](../molecule-collection/SKILL.md): review SDF/grid/table
  collections, properties, filtering outputs, and selected molecule handoff.
- [trajectory-review](../trajectory-review/SKILL.md): review trajectories,
  representative frames, RMSD/RMSF/contact metrics, and trajectory bundles.
- [workflow-results](../workflow-results/SKILL.md): accept externally prepared
  protein/ligand/docking/MD artifacts and display their results.
- [molecular-report](../molecular-report/SKILL.md): render adjacent markdown,
  table, chart, or report panels with provenance.
- [visual-qa](../visual-qa/SKILL.md): verify Browser preview and real desktop
  app state with Browser or Computer.

## Operating Principle

The CLI is the execution contract. MCP tools wrap it. Browser and Computer
verify visual reality. Do not replace typed `observe` and `act` with screenshot
interpretation.

For external agent workflows, prefer the short MCP facade first:
`burrete.get_context`, `burrete.open_workspace`,
`burrete.observe_workspace`, `burrete.control_viewer`, and
`burrete.render_panel`. These tools return a stable `workspaceSessionId` and
compact `modelContext`; the advanced Burrete tools remain available for
docking, fragments, reports, trajectories, and lower-level scene operations.

For Browser work, distinguish two local surfaces:

- `auto`: the default route. It starts the full browser agent shell when the
  shell can start and falls back to tokenized browser-preview when the shell
  runtime is unavailable.
- `browser-agent-shell`: the full Burrete Browser shell, started by
  `scripts/burrete-agent.mjs open --mode browser-agent-shell ...` on a fresh
  local port and opened as
  `http://127.0.0.1:<fresh-port>/?devFiles=<encoded absolute path>&agentLayout=focus`.
  The focus layout starts with the outer Projects, Info, and bottom panels
  closed so the molecular canvas has the available space; their normal toggle
  controls remain available. Use it
  when the user wants the normal app UI: sidebar, files/projects, tabs, right
  dock, bottom dock, command palette, or behavior matching the browser shell.
  Do not reuse another browser-dev port unless the user explicitly asks to
  attach to that exact surface.
- `browser-preview`: the tokenized agent preview opened through
  `scripts/burrete-agent.mjs open --mode browser-preview ... --no-launch`.
  Use it when typed MCP/CLI `observe` and `act` over a tokenized localhost
  transport are required.

Browser means the Codex in-app Browser plugin for both surfaces. Create or use
local URLs without launching an external browser and navigate them in the
in-app Browser. Do not use macOS `open`, Arc, Chrome, Safari, or another
external browser unless the user explicitly asks for an external browser.

## Completion Gate

A Burrete workflow is complete only when:

- the requested workspace or artifact is opened or a typed blocker is reported;
- `observe.activeDocument.ready` is true and the Mol* `viewerAgent` reports
  available/ready when the active renderer is Mol*;
- Browser or Computer visual QA is run when the user asked to see the UI or the
  change affects visible layout;
- the central molecular canvas is visibly nonblank when a rendered structure
  was requested; structure counts from Info or `structureSummary` are not
  visual evidence;
- any unsupported capability is labeled `unsupported`, `partial`, or
  `external_workflow` with the reason.

Treat `completionState: "not_ready"`, `VIEWER_NOT_READY`, a false readiness
flag, or a blank central canvas as a failed completion gate. Never summarize
such a result as a successful load.
