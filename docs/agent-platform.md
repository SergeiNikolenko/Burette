# Agent Platform

Burrete exposes molecular workspace control through a layered agent platform.
The goal is to let agents open structures, observe workspace state, act on the
active viewer, and render bounded side panels without treating screenshots as
the source of truth.

## Layers

| Layer | Path | Responsibility |
| --- | --- | --- |
| Repository CLI | `scripts/burrete-agent.mjs` | Source-of-truth execution contract for open, observe, act, and render-panel workflows. |
| Browser preview server | `scripts/agent-preview.mjs` | Tokenized preview surface for typed browser agent sessions. |
| Browser shell session | `apps/desktop/vite/browser-dev/agent-session.ts`, `apps/desktop/src/hooks/use-agent-session.ts` | Browser-dev shell observe/action files and event delivery. |
| Desktop app session | `apps/desktop/src/hooks/use-agent-session.ts`, Tauri agent session commands | Desktop file-session observe/action bridge. |
| Plugin skills | `plugins/burette-agent/skills/*/SKILL.md` | Workflow routing, preflight, task-specific instructions, and completion gates. |
| MCP registrations | `plugins/burette-agent/mcp/registrations/*` | Stable tools/resources wrapping the CLI and bounded widget artifacts. |
| Widget assets | `plugins/burette-agent/mcp/widget-assets/*` | Browser-rendered molecular reports, tables, workspace, and trajectory views. |

## Surfaces

| Mode | Use When | Notes |
| --- | --- | --- |
| `browser-dev-shell` | The user needs the normal app UI in the Browser: sidebar, tabs, docks, command palette, or shell workflows. | Starts a local browser-dev shell with agent-session endpoints. |
| `browser-preview` | The user needs tokenized typed observe/act against a preview surface. | Use `--no-launch` when the Browser plugin should navigate the URL. |
| `desktop-app` | The user explicitly asks for packaged/native app behavior. | Requires the installed app and a desktop agent session. |

Browser means the in-app Browser plugin unless the user explicitly asks for an
external browser. Computer/native UI control is a QA fallback, not the primary
state channel.

## Observe And Act Contract

- `observe` is the machine-readable state source for active document, open
  documents, panels, viewer readiness, scene selection, and last action result.
- `act` queues a typed action and waits for the shell or active Mol* viewer to
  report completion or a structured failure.
- `render-panel` opens bounded markdown, table, or chart artifacts in a dock
  panel through the normal text-document path.
- Screenshot interpretation must not replace typed `observe`, validation
  output, or CLI/MCP errors.

## Plugin Contract

- Run `node plugins/burette-agent/scripts/burette_agent_preflight.mjs` before
  plugin workflows that open files, render widgets, or act on Mol*.
- Skills route workflows. MCP registrations expose tools. The CLI does app
  control. Keep those responsibilities separate.
- Validate molecular artifacts before rendering reports, tables, trajectories,
  or workspace widgets.

## Validation

For CLI/session changes:

```bash
bun tests/test-burrete-agent-cli.mjs
bun tests/test-agent-preview-server.mjs
bun tests/test-burette-agent.mjs
```

For plugin changes:

```bash
bun tests/test-burette-agent-plugin.mjs
bun run test:agent
```

For app-side shell action/session changes:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
```
