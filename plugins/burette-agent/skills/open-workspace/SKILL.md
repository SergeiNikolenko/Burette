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
   - `browser-dev-shell` when the user asks for the normal Browser UI, right
     or bottom docks, sidebars, tabs, files/projects, or app-like browser
     behavior. This is the full browser-dev application shell and should use a
     URL shaped like `http://127.0.0.1:<port>/?devFiles=<encoded absolute path>`.
   - `browser-preview` when the task needs the tokenized agent transport,
     typed MCP/CLI `observe` and `act`, quick visual QA, screenshots, or a
     localhost preview without the full app shell.
   - `desktop-app` when the user asks for the real Burrete application or wants
     results left open in the app.
3. For `browser-dev-shell`, navigate the Codex in-app Browser to the
   agent-owned full Browser shell URL returned by the CLI. The CLI must start
   a fresh local port for this agent session; do not reuse another Browser tab,
   a user-provided browser-dev port, or an already-running app unless the user
   explicitly asks to attach to that exact surface.

```bash
bun scripts/burrete-agent.mjs open --mode browser-dev-shell <file>
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

If the visible in-app Browser tab is already on the agent-owned
browser-dev-shell URL but `sessionDir` is missing from the conversation, pass
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
`browser-preview` as a substitute for the full browser-dev shell when the user
is asking about ordinary Burrete UI chrome.

5. For `desktop-app`, open through the CLI:

```bash
bun scripts/burrete-agent.mjs open --mode desktop-app <file> --session-dir <dir>
```

6. Run `observe` after the app reports readiness when the selected mode exposes
   typed state.
7. If visual confirmation matters, use [visual-qa](../visual-qa/SKILL.md).

## Handoff

Report the mode, session directory or tokenized URL, active document title,
viewer readiness, and any typed errors. Do not describe a successful molecular
load until `observe.activeDocument.ready` or equivalent viewer readiness is
true.
