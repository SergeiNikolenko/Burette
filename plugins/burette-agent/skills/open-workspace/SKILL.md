---
name: open-workspace
description: "Use when opening molecular artifacts in Burette Browser preview or desktop app sessions and establishing an observable workspace."
---

# Open Workspace

Use this workflow to open local structures, SDF collections, trajectory bundles,
or workflow result bundles in Burette.

## Native Codex side pane and compact inline viewer

Use `burette.open_viewer` for local structures, SDF/SMILES/CSV collections,
Ketcher sketches, docking scenes and packaged MVSX Stories in the native Codex
workspace. Ketcher defaults to inline chat; other views default to the side pane.
Inline uses full chat width with content-adaptive height. Its shadcn
button at the bottom right opens the side pane or returns to chat. Use
`set_display_mode` with `fullscreen` only when the user requests right-side
placement; do not repeat that request on resize. Use `burette.open_inline_viewer`
only when the user wants a compact PDB/mmCIF chat card. The native opener runs
the full shared workspace; the compact resource is separate. Both use the same
session and control tools without a localhost server or upload.
Pass up to seven `additionalFiles` to `open_viewer` (16 MiB total). Switching,
closing and reordering stay in that workspace. Inspect
`activeDocument`, `activeSurface`, and `tabs`; control tabs using `activate_tab`,
`close_tab`, `close_other_tabs`, `close_all_tabs`, or `move_tab`, with `tabId`
and a zero-based `toIndex` for movement. Re-observe after switching before
sending molecular commands. Unvisited tabs stay cold; visited pages remain
mounted until their tab closes or the host unmounts the workspace.
Use `view: "ketcher"` to seed from the first MOL/SDF/SMILES/KET file, or
`view: "docking"` with `file` as receptor and `additionalFiles` as ligands.
For native follow-up controls, send `control_inline_viewer.action` with
`type: "control_ketcher"`, observed `surfaceId`/`expectedRevision`, and the
Ketcher command. `set_structure` takes top-level `format` and `content`.
Native Story controls use `type: "story_control"` and `operation: "next"`,
`previous`, `goto`, `play`, or `pause`. Do not substitute a Browser workspace.

1. Open once per task, then keep the same native workspace. For subsequent
   files call `control_inline_viewer` with its `sessionId` and
   `action: { type: "open_files", paths: ["/absolute/new-file.pdb"] }`.
   The public control call authorizes and snapshots new files before opening
   internal tabs; duplicates focus the existing file. The whole session remains
   bounded to 8 unique files and 16 MiB. A suspended pane must be brought back,
   not replaced by another opener. Only use an opener for the first file,
   an expired/closed session, or an explicitly requested separate workspace.
2. Keep its `sessionId`; a successful open means created, not rendered.
   For the first open, supply a fresh UUID v4 `openRequestId` and retain it.
   If the opener times out, retry with the same ID, paths and options: this
   returns the same temporary snapshot and session (`reused: true`), even if
   source files changed or disappeared. A conflict or closed-session error
   must not be worked around with a new ID unless a new workspace is intended.
   The host may still show a second card; the newest card takes over the
   session and the earlier one steps aside without closing it.
   The key expires with the OS-temporary session; it is not durable project ID.
3. Call `burette.observe_inline_viewer` until `ready` is true. Report a mounting
   or rendering blocker if it remains false; do not reopen repeatedly or add
   a fixed long sleep. Skip Browser/Computer setup for this native path unless
   the user explicitly requests a separate accessible visual QA surface.
4. If the user asks to expand this compact viewer, send
   `burette.control_inline_viewer` with
   `{"type":"set_display_mode","mode":"fullscreen"}`. The host decides the
   actual placement. Do not promise a right pane on hosts without that mapping
   or describe fullscreen as the full Burette workspace.
5. Do not close the native workspace after showing a result. Display-mode changes
   and closing its last internal document do not terminate it. Host unmount
   releases the renderer and selection context, but retains the session for a
   later host remount. Do not create duplicate panels to work around an unmount.
   A new explicit opener is needed only for an actually closed/expired session.
6. Control calls wait up to `waitMs` (default 12 seconds) for acknowledgement.
   Inspect `status`: `completed`, `failed`, or still `queued`. Observe the matching
   `lastAction.actionId` and actual `displayMode`. A queued action is not completion. Preserve and report
   any viewer error, including an empty molecular selection.

Typed checks and a visible nonblank scene are separate requirements. An MCP
protocol test or Browser host harness is not proof of native Codex mounting.
After plugin updates, new tools may require a new task or host reload.

## Workflow

1. Run Burette preflight through [user-context](../user-context/SKILL.md).
2. Choose mode:
   - `auto` for the default agent path. It starts `browser-agent-shell` when
     the full Browser UI is available and falls back to `browser-preview` when
     the shell cannot start.
   - `browser-agent-shell` when the user asks for the normal Browser UI, right
     or bottom docks, sidebars, tabs, files/projects, or app-like browser
     behavior. This is the full agent-owned Browser application shell and should use a
     URL shaped like
     `http://127.0.0.1:<port>/?devFiles=<encoded absolute path>&agentLayout=focus`.
     The visualization-only plugin profile hides the project sidebar and
     bottom-dock toggles, Compute/Tools engines, and Jobs. The right inspector,
     Mol* controls, tabs, and Ketcher remain available. Ketcher import/export
     can open its output panel. Use `manage_burette_tabs` for tab operations.
     This mode prefers the prebuilt `apps/desktop/dist` bundle served by
     `scripts/agent-shell-server.mjs`; in a source checkout without that bundle,
     it falls back to `vp dev`.
   - `browser-preview` when the task needs the tokenized agent transport,
     typed MCP/CLI `observe` and `act`, quick visual QA, screenshots, or a
     localhost preview without the full app shell.
   - `desktop-app` when the user asks for the real Burette application or wants
     results left open in the app.
3. For `auto`, call the CLI and use the returned `mode`:

```bash
bun scripts/burette-agent.mjs open --mode auto <file>
```

If the result mode is `browser-preview`, inspect `result.fallback` before
deciding whether the task still satisfies the user request. Preview fallback is
acceptable for opening/observing a molecule; it is not a substitute for a task
that explicitly needs app chrome such as tabs, docks, or sidebars.

4. For `browser-agent-shell`, navigate the Codex in-app Browser to the
   agent-owned full Browser shell URL returned by the CLI. The CLI must start
   a fresh local port for this agent session; do not reuse another Browser tab,
   a user-provided Browser development port, or an already-running app unless the user
   explicitly asks to attach to that exact surface.

In Codex, show that Browser workspace in the right panel and include its clickable
URL in the handoff. Do not also create an inline MCP viewer for the same open
request. The full workspace is the default; the compact chat card is opt-in.

```bash
bun scripts/burette-agent.mjs open --mode browser-agent-shell <file>
```

Use the returned URL shaped like:

```text
http://127.0.0.1:<fresh-port>/?devFiles=<url-encoded absolute file path>&agentLayout=focus
```

Open that URL only through the Codex in-app Browser plugin. Do not start a
separate tokenized agent preview only to get sidebars, the right dock, or the
bottom dock.

### Separate tabs versus one scene

Multiple files open as separate Burette tabs by default. Each tab owns its
camera, selection, and viewer state. Use one workspace and one Browser tab:

```bash
bun scripts/burette-agent.mjs open --mode browser-agent-shell <first-file> <second-file>
```

The public MCP opening tools accept `file` plus `additionalFiles`. Omit `scene`
for separate tabs. Pass `scene: "structureAll"` only for an explicit request to
show the structures together. Do not infer alignment from opening together.
To add another file later, use `manage_burette_tabs` with `open_file` in the same
workspace. To compare existing files together, `open_burette_docking_view`
creates a combined-scene tab without removing their individual tabs.

### Opening a folder as one Mol* scene

By default every path becomes its own Burette tab. When the user wants a set of
related structures compared in a single viewer — a folder of simulation stages,
docked poses, or model variants — pass `--scene` with a folder or with two or
more files:

```bash
bun scripts/burette-agent.mjs open --mode browser-agent-shell <folder> --scene structureAll
```

That returns a URL shaped like
`http://127.0.0.1:<port>/?devDocking=<newline-separated paths>&devScene=structureAll&agentLayout=focus`,
which opens one combined Mol* scene instead of one tab per file. Use
`structureAll` to start with every structure overlaid and `structurePoses` to
start on a single structure. In the scene the user can step through structures,
pick one by file name, and press `Align` to superimpose them.

Keep the returned `sessionDir`. In agent shell mode, `observe` and `act` use
the same CLI session contract as desktop app mode:

```bash
bun scripts/burette-agent.mjs observe --session-dir <sessionDir>
bun scripts/burette-agent.mjs act --session-dir <sessionDir> '{"type":"focus_ligand","selector":{"comp_id":"PYZ"},"allowAmbiguous":true}' --wait-ms 12000
```

Use `manage_burette_tabs` for tab strip work inside Burette:

- `list` to read tab ids, indexes, paths, titles, and active state;
- `focus`, `next`, or `previous` to switch active Burette tabs;
- `open_file` to open a file as a Burette tab in the existing workspace;
- `new` to create a blank Burette tab;
- `close` to close a Burette tab by id, index, path, title, or the active tab;
- `move` to reorder a tab with `toIndex`.

Do not open additional Codex Browser tabs when the user asks for additional
Burette tabs.

Use `manage_burette_structure_component` instead of manually driving the
right-click menus when the user asks to select, focus, hide/remove from view,
restore, or open a structure part separately:

- `select` or `focus` with `component`, `chain`, `compId`, `seq`, or `element`;
- `hide` or `show` for polymer, ligand, water, or ion component classes;
- `clear` to clear the active Mol* selection;
- `open_as_tab` to extract a PDB component to a temporary PDB and open it as a
  Burette tab in the same workspace.

This is view/runtime control. Do not delete or rewrite the user's source file
unless they explicitly ask for file mutation.

Use `open_burette_docking_view` when the user asks for a docking view inside
the existing Burette workspace. Pass `receptorPath`, `ligandPaths`, and
optionally `sceneMode: "structureAll"` when the request is to show structures
together rather than pose-paged docking. Do not use a new Codex Browser tab for
this; it must create a Burette tab in the current workspace.

If the visible in-app Browser tab is already on the agent-owned
browser-agent-shell URL but `sessionDir` is missing from the conversation, pass
the URL directly:

```bash
bun scripts/burette-agent.mjs observe --url 'http://127.0.0.1:<port>/?devFiles=...'
bun scripts/burette-agent.mjs act --url 'http://127.0.0.1:<port>/?devFiles=...' '{"type":"focus_ligand","selector":{"comp_id":"PYZ"},"allowAmbiguous":true}' --wait-ms 12000
```

The CLI resolves the live shell session through
`/__burette/agent-session/session.json` and fails quickly when the shell port is
dead.

5. For `browser-preview`, create the preview URL without launching any external
   browser, then open that URL only through the Codex in-app Browser plugin:

```bash
bun scripts/burette-agent.mjs open --mode browser-preview <file> --no-launch
```

Use the returned tokenized URL with Browser. Do not use macOS `open`, Arc,
Chrome, Safari, or another external browser for Browser preview unless the user
explicitly asks for an external browser. If the in-app Browser is unavailable,
report a typed blocker instead of falling back to an external browser.

Use the returned tokenized URL when typed agent control is required. Use it as
the `auto` fallback for molecular opening/observation, but do not treat it as
equivalent to the full browser agent shell when the user is asking about
ordinary Burette UI chrome.

6. For `desktop-app`, open through the CLI:

```bash
bun scripts/burette-agent.mjs open --mode desktop-app <file> --session-dir <dir>
```

7. Run `observe` after the workspace URL is open. Completion requires all of
   the following for a Mol* document:
   - `observe.activeDocument.ready === true`;
   - `observe.viewerAgent.available === true`;
   - `observe.viewerAgent.ready === true` and
     `observe.viewerAgent.viewerReady === true` when those fields are present;
   - no `VIEWER_NOT_READY` or viewer-agent error.

   An HTTP server starting, a tool process exiting zero, an Inspector summary,
   or correct atom/residue counts does not prove that Mol* rendered the
   structure. If `openAsTab` was requested, the file-open action must also
   succeed; creating the derived file alone is only partial completion.
8. Read the structure summary:
   - `open_burette_workspace` returns `structureSummary` for the opened file.
   - If attaching to an existing workspace or if summary is missing, call
     `summarize_burette_structure` with `file`, `url`, or `sessionDir`.
   Use this summary internally to understand the file format, molecular kind,
   atom/residue/chain counts, ligand instances, water, ions, and available
   selectors before choosing viewer actions. Do not show explanatory UI text to
   the user just because the summary was read.
9. If visual confirmation matters, use [visual-qa](../visual-qa/SKILL.md).

## Handoff

Report the mode, session directory, active document title, viewer readiness,
concise structure facts from `structureSummary`, and any typed errors. For
every Browser mode, include the exact URL returned by `open` as a clickable
Markdown link in the final handoff, for example
`[Open Burette in Browser](http://127.0.0.1:<port>/...)`. Include this link even
when the in-app Browser tab is already open and visually verified. A link to
the source file, bundle directory, report, or screenshot does not replace the
Browser workspace link. Do not describe a successful molecular load until the
full readiness gate above passes. When the user wants to see the result, also
require the nonblank central-canvas check from `visual-qa`; counts are not a
substitute.
