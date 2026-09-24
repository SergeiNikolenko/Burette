---
name: index
description: "Primary router for Burette. Use when the plugin is at-mentioned or for molecular workspace work: opening structures, operating Mol* or Ketcher, reviewing SDF/property collections, trajectories, workflow result bundles, molecular reports, or Browser/Computer visual QA."
---

# Burette

Route broad molecular workspace requests to the right focused workflow. Treat a
direct Burette invocation as intent to use this plugin.

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
  Burette through a short `workspaceSessionId` contract for external agents,
  hiding URL/session-directory transport details unless advanced control is
  needed.
- [open-workspace](../open-workspace/SKILL.md): open local structures,
  collections, trajectories, or result bundles in Browser preview or desktop
  app.
- [molstar-scene](../molstar-scene/SKILL.md): run high-level Mol* scene actions
  such as focus ligand, hide waters, surface, color, contacts, and reset camera.
- [mvs-story](../mvs-story/SKILL.md): create, validate, package, observe, and
  navigate multi-step MolViewSpec molecular narratives.
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
`burette.get_context`, `burette.open_workspace`,
`burette.open_ketcher`, `burette.observe_workspace`, `burette.control_viewer`,
`burette.control_ketcher`, `burette.render_panel`, `burette.create_story`,
`burette.validate_story`, `burette.observe_story`, and
`burette.control_story`. These tools return a
stable `workspaceSessionId` and
compact `modelContext`; the advanced Burette tools remain available for
docking, fragments, reports, trajectories, and lower-level scene operations.

For Browser work, distinguish two local surfaces:

- `auto`: the default route. It starts the full browser agent shell when the
  shell can start and falls back to tokenized browser-preview when the shell
  runtime is unavailable.
- `browser-agent-shell`: the full Burette Browser shell, started by
  `scripts/burette-agent.mjs open --mode browser-agent-shell ...` on a fresh
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
  `scripts/burette-agent.mjs open --mode browser-preview ... --no-launch`.
  Use it when typed MCP/CLI `observe` and `act` over a tokenized localhost
  transport are required.

Browser means the Codex in-app Browser plugin for both surfaces. Create or use
local URLs without launching an external browser and navigate them in the
in-app Browser. Do not use macOS `open`, Arc, Chrome, Safari, or another
external browser unless the user explicitly asks for an external browser.

## User handoff links

When a response presents an opened molecular file, project, PDB entry, or saved
scene, include a clickable "Open in Burette" link in the chat without waiting
for another request. Use `burette.create_link` and its returned `deepLink`;
the repository CLI `link` command is the fallback. Do not hand-encode paths.
Prefer the exact local file for a file-based result, a PDB link for an explicit
PDB lookup, or a registered desktop session link for that desktop session.
An inline MCP session ID is not a registered desktop session ID.
For unsaved/virtual documents, do not fabricate a file link or silently save:
offer an export, or clearly label a link as opening the original source.
A file/PDB link opens the source in the installed app on this Mac; it does not
transfer unsaved widget edits, camera, or selection. Omit the link for unrelated
discussion or when no valid target is available.

## Updated-plugin acceptance

For development updates, use the plugin-creator update workflow and the native
source checkout's development documentation before presenting the result.
Keep four separate facts: source/build, installed package, live MCP resource,
and the exact mounted panel. None proves the next.

- Verify the installed version and requested UI markers in its actual shell
  assets. Compare the live resource with the corresponding installed resource,
  not with a different shell bundle. Keep diagnostic output bounded.
- Updating in the same task has worked; do not claim that a new task or an app
  restart is always required. Its refresh trigger is not established. Check the
  current connection first; an old resource connection does not prove every
  tool connection is old, and a new server process does not prove panel refresh.
- Do not present another old pane as the updated result. Preserve current
  sessions and avoid repeated opener calls. A new task is a documented fallback
  for tool pickup, not a guaranteed fix; create one only at the user's request.
  Do not restart the host, kill MCP processes, or patch caches to force refresh.
- For UI changes, inspect the requested header, buttons, labels, menus and their
  clicks in the real plugin. A ready molecule or capture_scene image proves only
  the molecular canvas, not the surrounding interface. Browser/component tests
  are supporting checks, never native acceptance.
- Report installed, live-connection-verified and visually verified separately.
  If native inspection is unavailable, keep that gate incomplete. Do not call
  the task finished or promise a refresh that has not been observed.

## Completion Gate

A Burette workflow is complete only when:

- the requested workspace or artifact is opened or a typed blocker is reported;
- when a Browser workspace URL was created, the final handoff includes that
  exact live URL as a clickable Markdown link, even when the Browser tab is
  already open; a file or report link is not a substitute for the workspace
  link;
- `observe.activeDocument.ready` is true and the Mol* `viewerAgent` reports
  available/ready when the active renderer is Mol*;
- when the active surface is Ketcher, `activeSurface.ready` is true and
  `chemicalEditor.phase` is `ready`;
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
