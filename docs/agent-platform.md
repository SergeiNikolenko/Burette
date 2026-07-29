# Agent Platform

Burette exposes molecular workspace control through a layered agent platform.
The goal is to let agents open structures, observe workspace state, act on the
active viewer, and render bounded side panels without treating screenshots as
the source of truth.

## Layers

| Layer | Path | Responsibility |
| --- | --- | --- |
| Hosted public plugin | `apps/burette-public-plugin` | Public HTTPS MCP tools for one authorized attachment or public PDB entry, plus the sandboxed Burette workspace. |
| Repository CLI | `scripts/burette-agent.mjs` | Source-of-truth execution contract for open, observe, act, and render-panel workflows. |
| Browser preview server | `scripts/agent-preview.mjs` | Tokenized preview surface for typed browser agent sessions. |
| Browser shell session | `apps/desktop/vite/browser-dev/agent-session.ts`, `apps/desktop/src/hooks/use-agent-session.ts` | Browser-dev shell observe/action files and event delivery. |
| Desktop app session | `apps/desktop/src/hooks/use-agent-session.ts`, `apps/desktop/src/lib/ketcher-agent.ts`, Tauri agent session commands | Desktop file-session observe/action bridge for Mol* and the Ketcher chemical editor. |
| Plugin skills | `plugins/burette-agent/skills/*/SKILL.md` | Workflow routing, preflight, task-specific instructions, and completion gates. |
| MCP registrations | `plugins/burette-agent/mcp/registrations/*` | Stable tools wrapping the CLI and bounded artifact validation. |

Repository-local maintenance skills under `.codex/skills` are not part of the
packaged Burette agent plugin. Use them for development-time PR review, release
readiness, contract checks, and PR body drafting.

## Hosted Public Plugin

The hosted plugin is a separate runtime boundary from the local desktop bridge:

- Plugin documentation: <https://burette-landing.vercel.app/docs/plugin>
- Production MCP: <https://burette-plugin.vercel.app/mcp>
- `preview_molecular_file` accepts one OpenAI-authorized PDB, ENT, PDBQT, CIF,
  mmCIF, SDF, SD, XYZ, or extended XYZ attachment.
- `preview_pdb_structure` accepts one four-character public PDB ID.
- `open_ketcher` and `control_ketcher` expose an isolated revision-checked
  chemical editor surface with bounded inline structures and exports.
- The model receives bounded structured composition data. Raw structure text is
  placed only in result `_meta` for the sandboxed Burette workspace.
- Downloads are capped at 3 MiB and 200,000 lines, redirects are revalidated,
  and HTTPS connections are pinned to DNS addresses already checked as public.
- Attachments are processed in memory and are not written to Burette
  application storage.

The MCP widget mounts the production build of the real Burette browser shell
directly and passes the tool result into its existing inline-document path. The
root deployment URL redirects to the public plugin documentation; it is not a
second standalone product or a persistent web workspace. The local desktop app
remains the primary Burette workspace, while each hosted widget receives only
the current MCP tool result inside the user's chat. The packaged local plugin
continues to use the local MCP and CLI bridge for local files and installed-app
control on the same Mac. The bundle, submission metadata, review tests, and
directory skill live together under `apps/burette-public-plugin`; the main
repository remains the source of truth.

## CLI And Skill Map

The CLI owns execution. Skills decide which workflow to run and how to hand the
result back to the user.

| Surface | Path | Use |
| --- | --- | --- |
| Workspace opener | `bun scripts/burette-agent.mjs open` | Opens browser preview, browser-dev shell, or desktop app sessions. |
| Workspace observer | `bun scripts/burette-agent.mjs observe` | Reads typed state from a session directory. |
| Workspace action | `bun scripts/burette-agent.mjs act` | Sends typed shell or Mol* actions and waits for completion. |
| Ketcher surface | `burette.open_ketcher` / `burette.control_ketcher` | Opens and controls the active chemical editor with bounded, revision-checked actions. |
| MolViewSpec Story | `story-template-list` / `story-template-create` / `story-create` / `story-validate`; `burette.list_story_templates` / `burette.create_story_from_template` / `burette.create_story` / `burette.validate_story` / `burette.observe_story` / `burette.control_story` | Lists reusable scientific scaffolds, authors schema-valid multi-state MVSJ/MVSX, verifies resources, and exposes typed Story state and playback. |
| Panel renderer | `bun scripts/burette-agent.mjs render-panel` | Opens bounded markdown/table/chart output in a docked panel. |
| Tokenized preview | `bun scripts/agent-preview.mjs` | Starts typed browser preview sessions for direct observe/act checks. |
| Router skill | `plugins/burette-agent/skills/index/SKILL.md` | Routes molecular workspace requests to the right focused skill. |
| User context | `plugins/burette-agent/skills/user-context/SKILL.md` | Performs scoped preflight and capability checks. |
| Open workspace | `plugins/burette-agent/skills/open-workspace/SKILL.md` | Opens files in Browser, browser-shell, or desktop surfaces. |
| Mol* scene | `plugins/burette-agent/skills/molstar-scene/SKILL.md` | Applies or reviews Mol* scene actions and MVS-like operations. |
| MolViewSpec Story | `plugins/burette-agent/skills/mvs-story/SKILL.md` | Builds and verifies an ordered molecular explanation with complete scenes per step. |
| Molecule collection | `plugins/burette-agent/skills/molecule-collection/SKILL.md` | Handles SDF, SMILES, CSV, TSV, and grid workflows. |
| Trajectory review | `plugins/burette-agent/skills/trajectory-review/SKILL.md` | Reviews trajectory or result-bundle artifacts. |
| Workflow results | `plugins/burette-agent/skills/workflow-results/SKILL.md` | Intakes external workflow artifacts and maps them to Burette surfaces. |
| Molecular report | `plugins/burette-agent/skills/molecular-report/SKILL.md` | Builds bounded notes, charts, tables, and report artifacts. |
| Visual QA | `plugins/burette-agent/skills/visual-qa/SKILL.md` | Uses Browser or Computer verification after typed state checks. |

Do not add a new MCP tool or skill until the repository CLI contract is clear.
The Ketcher facade is intentionally separate from Mol* scene actions because a
chemical-editor mutation has different revision, payload, export, and
user-persistence rules. Reuse the workspace session and action-file transport;
do not invent a second local session protocol.

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

## MolViewSpec Story Contract

A Story is standard MolViewSpec multi-state data: `kind: "multiple"`, global
metadata, and ordered snapshots. Each snapshot contains a complete MVS root plus
a unique key, title, markdown or plain-text description, linger duration, and
transition duration. Burette treats Story as the primary agent-to-user surface
for ordered explanations such as overview, binding site, ligand pose,
interactions, comparison, and conclusion.

`story-create` normalizes a compact storyboard or accepts the standard shape,
validates every scene through the Mol* MVS schema, validates unique keys and
bounds, and refuses implicit overwrite. `.mvsx` is the required handoff for
local sidecars: every relative `download.url` must have a matching archive
resource. `.mvsj` may reference accessible HTTP(S) resources or files present
beside the document; opening fails early when a local sidecar is missing.
Mol*'s standard `./assets/...` paths are normalized safely. `file:` URLs and
absolute filesystem paths are rejected rather than leaking host paths into a
browser scene.

`story-template-list` exposes the installed catalog with declared inputs,
step-by-step scientific purpose, evidence expectations, and caveats.
`story-template-create` performs bounded string substitution, rejects missing
or unknown variables, then follows the same validation and safe-write path as
`story-create`. The source descriptors live in `templates/mvs-story/` and are
packaged under `assets/mvs-story-templates/`. They are starting points, not
analysis engines: contacts, scores, alignment metrics, and biological claims
must be supplied from explicit calculations or observations.

After opening, `observe_story` reports the current snapshot and ordered bounded
metadata from Mol*'s snapshot manager. `control_story` supports next, previous,
goto by index/key/id, play, and pause. The visible Story dock mirrors that state
and exposes Previous, Play/Pause, and Next. Completion requires schema/resource
validation, ready workspace state, typed next/previous checks, and Browser
verification of two nonblank steps.

## Ketcher Agent Contract

The Ketcher surface uses API version `burette-ketcher-agent/v1`. The desktop
controller is registered per tab and reports it through `observe.json` as:

```json
{
  "activeSurface": {
    "kind": "ketcher",
    "tabId": "tab-1",
    "surfaceId": "desktop-ketcher:tab-1",
    "phase": "ready",
    "ready": true
  },
  "chemicalEditor": {
    "surfaceId": "desktop-ketcher:tab-1",
    "structureRevision": 3,
    "interactionRevision": 4,
    "persistedRevision": 2,
    "dirty": true
  }
}
```

`burette.control_ketcher` accepts `set_structure`, `clear_structure`,
`highlight_atoms`, `get_structure`, and `request_persist`. Every action carries
an idempotent `actionId`, the target `surfaceId`, and `expectedRevision`.
Structural edits advance `structureRevision`; highlight/selection changes only
advance `interactionRevision`. A revision mismatch, stale tab, oversized
structure, unsupported format, or unresolved `contentRef` is a typed failure.
Inline content is bounded to 64 KiB, atom-index lists to 256 entries, and
inline exports to 64 KiB. Persistence stops at `awaiting_user` until a user
confirms the file write.

The hosted public plugin mirrors the same action schema through
`open_ketcher`/`control_ketcher` and the resource
`ui://burette/ketcher-editor-v1.html`. Its relay is process-local and ephemeral:
it is suitable for the current MCP widget turn, not a durable shared workspace;
reference-backed content fails closed until an authenticated artifact relay is
added.

## Agent RCA

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| Skill opens the wrong surface | Router chose `browser-preview`, `browser-dev-shell`, or `desktop-app` incorrectly. | `plugins/burette-agent/skills/index/SKILL.md`, CLI `open` arguments |
| MCP tool succeeds but the panel is empty | Widget snapshot is unbounded, malformed, or missing the expected artifact shape. | MCP registration output, `plugins/burette-agent/mcp/widget-assets/*`, `render-panel` payload |
| `observe` returns no active document | Wrong session directory, closed Browser tab, or desktop session not attached. | CLI `sessionDir`, shell logs, `apps/desktop/src/hooks/use-agent-session.ts` |
| `act` times out | Action was sent to the shell when the active Mol* viewer was not ready, or the action contract changed. | Last `observe` result, `apps/desktop/src/hooks/use-agent-session.ts`, viewer bridge tests |
| Story opens but has no steps | The input is a single-state MVS document, an old runtime is active, or Mol* did not install snapshots. | Run `story-validate`, then `observe_story`; confirm `kind: "multiple"` and restart after plugin updates. |
| Story validation reports a missing resource | A relative `download.url` is absent from MVSX or beside MVSJ. | Pass the exact archive path through `--asset` / `resources`, then recreate the MVSX. |
| `control_ketcher` returns `REVISION_CONFLICT` | Another edit, selection change, or tab switch advanced the editor state. | Refresh `burette.observe_workspace` and use the returned `surfaceId`/`structureRevision`. |
| `control_ketcher` returns `STALE_TARGET` | The requested surface is no longer the active Ketcher tab or was unmounted. | Reopen Ketcher with `burette.open_ketcher`; do not reuse the old surface id. |
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
bun tests/test-burette-agent-cli.mjs
bun tests/test-agent-preview-server.mjs
bun tests/test-burette-agent.mjs
bun tests/test-mvs-story.mjs
```

For plugin changes:

```bash
bun tests/test-burette-agent-plugin.mjs
bun run test:agent
```

For the hosted public plugin:

```bash
cd apps/burette-public-plugin
bun run test
bun run typecheck
bun run build
```

For app-side shell action/session changes:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
```
