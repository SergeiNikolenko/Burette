---
name: open-workspace
description: "Open molecular artifacts in Burrete Browser preview or desktop app sessions and establish an observable workspace."
---

# Open Workspace

Use this workflow to open local structures, SDF collections, trajectory bundles,
or workflow result bundles in Burrete.

## Workflow

1. Run Burrete preflight through [user-context](../user-context/SKILL.md).
2. Choose mode:
   - `browser-agent-shell` when the user asks for the normal Browser UI, right
     or bottom docks, sidebars, tabs, files/projects, or app-like browser
     behavior. This is the full agent-owned Browser application shell and should use a
     URL shaped like `http://127.0.0.1:<port>/?devFiles=<encoded absolute path>`.
   - `browser-preview` when the task needs the tokenized agent transport,
     typed MCP/CLI `observe` and `act`, quick visual QA, screenshots, or a
     localhost preview without the full app shell.
   - `desktop-app` when the user asks for the real Burrete application or wants
     results left open in the app.
3. For `browser-agent-shell`, navigate the Codex in-app Browser to the
   agent-owned full Browser shell URL returned by the CLI. The CLI must start
   a fresh local port for this agent session; do not reuse another Browser tab,
   a user-provided Browser development port, or an already-running app unless the user
   explicitly asks to attach to that exact surface.

```bash
bun scripts/burrete-agent.mjs open --mode browser-agent-shell <file>
```

Use the returned URL shaped like:

```text
http://127.0.0.1:<fresh-port>/?devFiles=<url-encoded absolute file path>
```

Open that URL only through the Codex in-app Browser plugin. Do not start a
separate tokenized agent preview only to get sidebars, the right dock, or the
bottom dock.

Keep the returned `sessionDir`. In agent shell mode, `observe` and `act` use
the same CLI session contract as desktop app mode:

```bash
bun scripts/burrete-agent.mjs observe --session-dir <sessionDir>
bun scripts/burrete-agent.mjs act --session-dir <sessionDir> '{"type":"focus_ligand","selector":{"comp_id":"PYZ"},"allowAmbiguous":true}' --wait-ms 12000
```

Use `manage_burrete_tabs` for tab strip work inside Burrete:

- `list` to read tab ids, indexes, paths, titles, and active state;
- `focus`, `next`, or `previous` to switch active Burrete tabs;
- `open_file` to open a file as a Burrete tab in the existing workspace;
- `new` to create a blank Burrete tab;
- `close` to close a Burrete tab by id, index, path, title, or the active tab;
- `move` to reorder a tab with `toIndex`.

Do not open additional Codex Browser tabs when the user asks for additional
Burrete tabs.

Use `manage_burrete_structure_component` instead of manually driving the
right-click menus when the user asks to select, focus, hide/remove from view,
restore, or open a structure part separately:

- `select` or `focus` with `component`, `chain`, `compId`, `seq`, or `element`;
- `hide` or `show` for polymer, ligand, water, or ion component classes;
- `clear` to clear the active Mol* selection;
- `open_as_tab` to extract a PDB component to a temporary PDB and open it as a
  Burrete tab in the same workspace.

This is view/runtime control. Do not delete or rewrite the user's source file
unless they explicitly ask for file mutation.

Use `open_burrete_docking_view` when the user asks for a docking view inside
the existing Burrete workspace. Pass `receptorPath`, `ligandPaths`, and
optionally `sceneMode: "structureAll"` when the request is to show structures
together rather than pose-paged docking. Do not use a new Codex Browser tab for
this; it must create a Burrete tab in the current workspace.

If the visible in-app Browser tab is already on the agent-owned
browser-agent-shell URL but `sessionDir` is missing from the conversation, pass
the URL directly:

```bash
bun scripts/burrete-agent.mjs observe --url 'http://127.0.0.1:<port>/?devFiles=...'
bun scripts/burrete-agent.mjs act --url 'http://127.0.0.1:<port>/?devFiles=...' '{"type":"focus_ligand","selector":{"comp_id":"PYZ"},"allowAmbiguous":true}' --wait-ms 12000
```

The CLI resolves the live shell session through
`/__burette/agent-session/session.json` and fails quickly when the shell port is
dead.

4. For `browser-preview`, create the preview URL without launching any external
   browser, then open that URL only through the Codex in-app Browser plugin:

```bash
bun scripts/burrete-agent.mjs open --mode browser-preview <file> --no-launch
```

Use the returned tokenized URL with Browser. Do not use macOS `open`, Arc,
Chrome, Safari, or another external browser for Browser preview unless the user
explicitly asks for an external browser. If the in-app Browser is unavailable,
report a typed blocker instead of falling back to an external browser.

Use the returned tokenized URL when typed agent control is required. Do not use
`browser-preview` as a substitute for the full browser agent shell when the user
is asking about ordinary Burrete UI chrome.

5. For `desktop-app`, open through the CLI:

```bash
bun scripts/burrete-agent.mjs open --mode desktop-app <file> --session-dir <dir>
```

6. Run `observe` after the app reports readiness when the selected mode exposes
   typed state.
7. Read the structure summary:
   - `open_burrete_workspace` returns `structureSummary` for the opened file.
   - If attaching to an existing workspace or if summary is missing, call
     `summarize_burrete_structure` with `file`, `url`, or `sessionDir`.
   Use this summary internally to understand the file format, molecular kind,
   atom/residue/chain counts, ligand instances, water, ions, and available
   selectors before choosing viewer actions. Do not show explanatory UI text to
   the user just because the summary was read.
8. If visual confirmation matters, use [visual-qa](../visual-qa/SKILL.md).

## Handoff

Report the mode, session directory or tokenized URL, active document title,
viewer readiness, concise structure facts from `structureSummary`, and any
typed errors. Do not describe a successful molecular load until
`observe.activeDocument.ready` or equivalent viewer readiness is true.
