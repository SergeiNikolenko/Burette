---
name: index
description: "Primary router for Burette. Use when the plugin is at-mentioned or for molecular workspace work: opening structures, operating Mol* or Ketcher, reviewing SDF/property collections, trajectories, workflow result bundles, molecular reports, or Browser/Computer visual QA."
---

# Burette

Route broad molecular workspace requests to the right focused workflow. Treat a
direct Burette invocation as intent to use this plugin.

## Operate the scene, not the source code

Follow-up requests such as "color the chains green and purple", "focus this
ligand", or "draw aspirin" operate the current molecular workspace. Recover
this task's `sessionId`, observe it, then use an acknowledged control action.
Do not search repositories, edit JavaScript, rebuild or reinstall Burette to
fulfil a scene command. Development requires an explicit development request.
For chain colors, use `color_by_chain` with a bounded hex `palette`; see
[molstar-scene](../molstar-scene/SKILL.md). Missing or unsupported control is a
specific capability blocker, not permission to change application defaults.
Tool catalogs and available-plugin lists are context, not a replacement user
request. Do not switch to discussing plugin installation unless asked.

## Direct native viewing

For a first drawing request, call `burette.open_viewer` with `view: "ketcher"`
and `structure: { format: "smi", content: "<requested molecule SMILES>" }`.
For aspirin the content is `CC(=O)Oc1ccccc1C(=O)O`. This seeds the editor
before it reports ready and opens inline in chat. No project folder, dummy
MOL file or repository search is needed. Never substitute an unrelated fixture.
The `burette.open_ketcher` facade requires an existing Browser/desktop workspace
handle; a native `sessionId` is not that handle.

The bundled examples use `burette.open_viewer({ example: "1htb" })` or
`burette.open_viewer({ example: "caffeine" })`. Caffeine is an XYZ document
for xyzrender. These work independently of the current directory.

`view: "xyzrender"` applies to the opener's files and, by default, to files
added later with `open_files`; pass `view: "auto"` or `"xyzrender"` per
`open_files` call to choose. Proteins above 1500 atoms, SDF collections,
sources over 512 KiB and failed renders stay in Mol*: read the opener `notes`
and `activeDocument.externalRenderer.status` (`rendering`, `ready`, `failed`,
`fallback` or `available`) before describing the view. Change the SVG with
`set_xyzrender_view` (`preset`, merged `controls`, or `renderer: "molstar"` /
`"xyzrender"`); `capture_scene` returns the SVG as a PNG and `observe_scene`
reports the renderer status. Mol* commands fail with `XYZRENDER_ACTIVE` there.

`awaiting_mount` means the host has not mounted the widget, not that a project
folder is missing. Codex mounts the card only while the chat is on screen, so a
background or unattended task normally stays in `awaiting_mount`; this is not an
error. Observe once more after a short wait (at most 5 seconds). If still
unmounted, finish the turn: say the session is prepared with the named file and
the card appears when the chat is opened. Do not claim the molecule is shown,
call it a failure, poll repeatedly, or offer alternative viewers. Do not switch
to the standalone desktop app, issue commands to an unmounted editor, or
request fullscreen to repair mounting.
After ready, verify the Ketcher exported structure matches the requested
molecule before reporting a successful drawing.

When a supported local structure/collection/Story path is known and `burette.open_viewer` is
available, this section is the complete opening workflow:

1. Reuse this task's existing native workspace `sessionId`. For another file,
   call `burette.control_inline_viewer` with
   `action: { type: "open_files", paths: ["/absolute/file/path"] }`.
   This snapshots the new files and adds internal tabs without another pane.
   Call `burette.open_viewer` only for the first file or an explicitly requested
   separate workspace. Never use another task's session implicitly.
2. Call `burette.observe_inline_viewer` to check mounted readiness. If not ready,
   retry with short, bounded waits; do not insert a fixed 20-second sleep or reopen.
3. A suspended/not-ready workspace is not permission to create a duplicate.
   Ask the user to bring its existing pane back. Use `burette.control_inline_viewer` only for actions the user requested.
   A completed acknowledgement does not need another identical control call.

The native opener defaults to the side pane except Ketcher, which stays inline
unless expansion is explicitly requested. Use `set_display_mode` with
`mode: "inline"` only when the user wants the chat card. To arrange the active
workspace use `set_workspace_panel` with `area: "right" | "bottom"`, `open: true`
and optionally an observed open-tab `documentId`. Close with `open: false`.
The bottom dock is visible only in side-pane mode. These are internal workspace
docks, not additional Codex windows; observe and verify each requested view.

Do not load Browser, Computer, unrelated scientific workflow skills, or a broad
capability inventory for this direct path. Only load another focused workflow
when the requested action needs it. If native visual inspection is unavailable,
state that limitation once; do not open a duplicate Browser view for proof.
Readiness is typed evidence, not a screenshot.

## Preflight for setup or other workflows

For setup diagnosis, missing native tools, Browser/desktop workflows or artifacts,
load [user-context](../user-context/SKILL.md) and run:

```bash
node plugins/burette-agent/scripts/burette_agent_preflight.mjs
```

Use the returned envelope as the source of truth for available transports,
preferred mode, workflow routes, and current blockers. Do not use preflight as a
substitute for runtime `observe`.

## Routing

### Choose the surface by intent

- Draw or edit a molecule/reaction: `open_ketcher`, then revision-checked
  `control_ketcher`. Do not open a collection merely because the input is SDF.
- Browse or compare molecule rows/properties: `open_files` with SDF, SMILES,
  CSV or TSV; keep the grid. Do not replace the collection with a blank editor.
- Inspect a protein/complex: open its structure in Mol*.
- Inspect docking results: authorize receptor and ligand files using
  `open_files`, then `open_docking_view` in this same session. These are supplied
  poses, not a new docking calculation.
- Inspect a self-contained multi-frame XYZ/PDB: `open_files`; the user steps
  frames with the viewer's timeline. The native widget has no model-driven frame
  commands (`observe_frames`/`control_frames` are not available); say so rather
  than substituting spin or wiggle.

Opening a tab is not proof of readiness. Check the selected grid, editor or
viewer after each switch; keep unrelated tabs and the same workspace session.

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

For local molecular work in Codex, use `burette.open_viewer`: it opens
the shared workspace in a native side-pane MCP App, with no Browser
tab or localhost server. Keep its `sessionId` for `observe_inline_viewer` and
`control_inline_viewer`. Do not substitute a Browser or protocol test host for
an explicit native side-pane request.

The native opener supports structure and collection tabs with optional `additionalFiles`
(up to seven extra files, 16 MiB total); do not open separate viewers per file.
Use `view: "ketcher"` for a seeded sketch and `view: "docking"` for a receptor
plus ligands; open self-contained `.mvsx` files for Stories. Read
[open-workspace](../open-workspace/SKILL.md) for those native workflows.
The plugin is visualization-only: no calculation engines,
Compute/Tools menus, Chemical Space, folding or Jobs panels. The project sidebar
is hidden; the inline widget hides the bottom dock and its resize handle, while
the side pane retains it. The right dock retains viewing tools and Ketcher uses right Text.

For visual self-checks, call `control_inline_viewer` with
`action: { type: "capture_scene" }`. The tool returns actual PNG image blocks,
not just scene metadata. A selected ligand adds its matching RDKit 2D depiction.
Use `scope: "ligand"` to require a selected ligand or `scope: "scene"` for 3D only.
Inspect the images and `depiction.status`; never claim a missing 2D image exists.

For that Browser-specific workflow, open the full workspace in the right-side Browser and give its
clickable URL; do not automatically add an inline card as a second view.
Multiple files use separate Burette tabs by default (`additionalFiles`), while
an explicit request to show them together uses `scene: "structureAll"`. Both
modes stay in one workspace, and neither implies automatic alignment.

Use `burette.open_inline_viewer` only when the user explicitly requests a
compact inline MCP viewer. Follow the optional inline section of
[open-workspace](../open-workspace/SKILL.md); expanding that same viewer changes
its placement, not its capabilities. It does not become the full workspace.

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
  The focus layout starts with the inspector and output panels closed so the
  molecular canvas has the available space. Use it when the user wants the
  shared app UI for structures, tabs, Ketcher, inspection, and import/export.
  Use `manage_burette_tabs` to list or switch tabs. UI selection is available
  in the active document's bounded `observe.scene.selection`; deselection and
  switching to another surface must not carry the previous selection forward.
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
