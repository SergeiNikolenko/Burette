# Agent Platform

Burrete exposes molecular workspace control through a layered agent platform.
The goal is to let agents open structures, observe workspace state, act on the
active viewer, and render bounded side panels without treating screenshots as
the source of truth.

## Layers

| Layer | Path | Responsibility |
| --- | --- | --- |
| Hosted public plugin | `apps/burrete-public-plugin` | Public HTTPS MCP tools for one authorized attachment or public PDB entry, plus the sandboxed Burrete workspace. |
| Repository CLI | `scripts/burrete-agent.mjs` | Source-of-truth execution contract for open, observe, act, and render-panel workflows. |
| Browser preview server | `scripts/agent-preview.mjs` | Tokenized preview surface for typed browser agent sessions. |
| Browser shell session | `apps/desktop/vite/browser-dev/agent-session.ts`, `apps/desktop/src/hooks/use-agent-session.ts` | Browser-dev shell observe/action files and event delivery. |
| Desktop app session | `apps/desktop/src/hooks/use-agent-session.ts`, Tauri agent session commands | Desktop file-session observe/action bridge. |
| Plugin skills | `plugins/burette-agent/skills/*/SKILL.md` | Workflow routing, preflight, task-specific instructions, and completion gates. |
| MCP registrations | `plugins/burette-agent/mcp/registrations/*` | Stable tools wrapping the CLI and bounded artifact validation. |

Repository-local maintenance skills under `.codex/skills` are not part of the
packaged Burrete agent plugin. Use them for development-time PR review, release
readiness, contract checks, and PR body drafting.

## Hosted Public Plugin

The hosted plugin is a separate runtime boundary from the local desktop bridge:

- Plugin documentation: <https://burrete-landing.vercel.app/docs/plugin>
- Production MCP: <https://burrete-plugin.vercel.app/mcp>
- `preview_molecular_file` accepts one OpenAI-authorized PDB, ENT, PDBQT, CIF,
  mmCIF, SDF, SD, XYZ, or extended XYZ attachment.
- `preview_pdb_structure` accepts one four-character public PDB ID.
- The model receives bounded structured composition data. Raw structure text is
  placed only in result `_meta` for the sandboxed Burrete workspace.
- Downloads are capped at 3 MiB and 200,000 lines, redirects are revalidated,
  and HTTPS connections are pinned to DNS addresses already checked as public.
- Attachments are processed in memory and are not written to Burrete
  application storage.

The MCP widget mounts the production build of the real Burrete browser shell
directly and passes the tool result into its existing inline-document path. The
root deployment URL redirects to the public plugin documentation; it is not a
second standalone product or a persistent web workspace. The local desktop app
remains the primary Burrete workspace, while each hosted widget receives only
the current MCP tool result inside the user's chat. The packaged local plugin
continues to use the local MCP and CLI bridge for local files and installed-app
control on the same Mac. The bundle, submission metadata, review tests, and
directory skill live together under `apps/burrete-public-plugin`; the main
repository remains the source of truth.

## CLI And Skill Map

The CLI owns execution. Skills decide which workflow to run and how to hand the
result back to the user.

| Surface | Path | Use |
| --- | --- | --- |
| Workspace opener | `bun scripts/burrete-agent.mjs open` | Opens browser preview, browser-dev shell, or desktop app sessions. |
| Workspace observer | `bun scripts/burrete-agent.mjs observe` | Reads typed state from a session directory. |
| Workspace action | `bun scripts/burrete-agent.mjs act` | Sends typed shell or Mol* actions and waits for completion. |
| Panel renderer | `bun scripts/burrete-agent.mjs render-panel` | Opens bounded markdown/table/chart output in a docked panel. |
| Tokenized preview | `bun scripts/agent-preview.mjs` | Starts typed browser preview sessions for direct observe/act checks. |
| Router skill | `plugins/burette-agent/skills/index/SKILL.md` | Routes molecular workspace requests to the right focused skill. |
| User context | `plugins/burette-agent/skills/user-context/SKILL.md` | Performs scoped preflight and capability checks. |
| Open workspace | `plugins/burette-agent/skills/open-workspace/SKILL.md` | Opens files in Browser, browser-shell, or desktop surfaces. |
| Mol* scene | `plugins/burette-agent/skills/molstar-scene/SKILL.md` | Applies or reviews Mol* scene actions and MVS-like operations. |
| Molecule collection | `plugins/burette-agent/skills/molecule-collection/SKILL.md` | Handles SDF, SMILES, CSV, TSV, and grid workflows. |
| Trajectory review | `plugins/burette-agent/skills/trajectory-review/SKILL.md` | Reviews trajectory or result-bundle artifacts. |
| Workflow results | `plugins/burette-agent/skills/workflow-results/SKILL.md` | Intakes external workflow artifacts and maps them to Burrete surfaces. |
| Molecular report | `plugins/burette-agent/skills/molecular-report/SKILL.md` | Builds bounded notes, charts, tables, and report artifacts. |
| Visual QA | `plugins/burette-agent/skills/visual-qa/SKILL.md` | Uses Browser or Computer verification after typed state checks. |

Do not add a new MCP tool or skill until the repository CLI contract is clear.
When a workflow can be expressed as an existing `open`, `observe`, `act`, or
`render-panel` operation, reuse that path.

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

## Agent RCA

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| Skill opens the wrong surface | Router chose `browser-preview`, `browser-dev-shell`, or `desktop-app` incorrectly. | `plugins/burette-agent/skills/index/SKILL.md`, CLI `open` arguments |
| MCP tool succeeds but the panel is empty | Widget snapshot is unbounded, malformed, or missing the expected artifact shape. | MCP registration output, `plugins/burette-agent/mcp/widget-assets/*`, `render-panel` payload |
| `observe` returns no active document | Wrong session directory, closed Browser tab, or desktop session not attached. | CLI `sessionDir`, shell logs, `apps/desktop/src/hooks/use-agent-session.ts` |
| `act` times out | Action was sent to the shell when the active Mol* viewer was not ready, or the action contract changed. | Last `observe` result, `apps/desktop/src/hooks/use-agent-session.ts`, viewer bridge tests |
| Plugin preflight fails | Packaged plugin paths, CLI availability, or local runtime capabilities are out of sync. | `plugins/burette-agent/scripts/burette_agent_preflight.mjs`, `plugins/burette-agent/AGENTS.md` |
| Browser screenshot disagrees with typed state | Visual QA inspected the wrong tab or stale runtime while `observe` targeted another session. | Browser URL, CLI JSON metadata, `observe` output |

## Plugin Contract

- Run `node plugins/burette-agent/scripts/burette_agent_preflight.mjs` before
  plugin workflows that open files, render panels, or act on Mol*.
- Skills route workflows. MCP registrations expose tools. The CLI does app
  control. Keep those responsibilities separate.
- Validate molecular artifacts before surfacing reports, tables, trajectories,
  or workspace payloads.

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

For the hosted public plugin:

```bash
cd apps/burrete-public-plugin
bun run test
bun run typecheck
bun run build
```

For app-side shell action/session changes:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
```
