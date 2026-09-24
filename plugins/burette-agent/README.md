# Burette Plugin

Development and no-restart verification: [Native widget development](../../docs/native-widget-development.md).

UI selections (including whole structures and chains) are reported in the active
document's `observe.scene.selection`. Selection context is capped at 24 KiB;
atom identity samples are capped at 96 and
marked when truncated. Clearing the selection clears that context. The inline
MCP App additionally publishes selection through the host's `updateModelContext`
capability when available; the host controls whether it renders a composer chip.
Only a nonempty active selection publishes that context; opening an unselected
structure creates no composer attachment. Deselecting, closing, or switching
documents clears the previous attachment with an empty context update.
Its selected text-only context requests a single Codex card using the plugin's static
composer icon, not a second image attachment. The whole context is capped at
48 KiB UTF-8 (text: 8 KiB): counts, up to 8 structure objects, 24 chains
and 24 ligands per object, 24 representation layers, camera, and selection.
It reflects the current viewer, not experimental evidence or a simulation.
The full Browser workspace and the inline MCP App are separate host surfaces:
opening a Browser workspace does not itself create a native chat attachment.
For molecular work in Codex, `burette.open_viewer` opens a compact native chat
workspace without Browser or localhost, opening in the side pane by default.
Returning to chat uses full chat width and content-adaptive height. The bottom-right button directly opens the side pane or returns to chat, outside the
file-actions menu. The inline widget hides the bottom dock and its resize handle;
the side pane retains them. Host unmount releases the renderer without
terminating the session; display-mode changes do not close the workspace.
Native cards hide the internal browser-style top bar in both display modes.
They retain a separate current-file header: path breadcrumbs, full-path copying,
right/bottom dock toggles, a default-application action and an Open With menu
containing Reveal in Finder. The shared
`WorkspaceFileHeader` uses the existing allowlisted file actions; it does not
rename host-owned Codex tabs or manufacture a system application menu.
Mol* left/right controls use panel icons; workspace dock controls live in the
file header, not the molecular toolbar. Internal documents remain accessible through the tab
tools; hiding their bar does not turn them into host-owned Codex tabs.
The native control action `set_workspace_panel` accepts `area: "right" | "bottom"`,
`open: boolean`, and optional `documentId` from an already open molecular tab.
It changes the active tab's dock, not the host placement or molecular coordinates.
Use side-pane mode for the bottom dock; it remains hidden in inline cards.
Keep the task's `sessionId` for subsequent files: `control_inline_viewer` with
`action: { type: "open_files", paths: ["/absolute/new-file.pdb"] }` adds internal
tabs in that same pane. Existing paths are focused rather than duplicated. New
snapshots share the session's 8-file/16-MiB limit. Do not call another opener
unless the session expired/closed or a separate workspace was requested.
Its control tool supports styles/colors, camera rotation, spin/rock
and procedural wiggle, and waits for acknowledgement rather than merely queueing.
The native opener accepts up to seven `additionalFiles` (16 MiB aggregate)
in the full shared Burette workspace: structures, collections, Ketcher,
docking and packaged Stories. Resources arrive through authenticated MCP
chunks; unvisited pages remain cold. Visited pages stay mounted until their tab
closes or the host unmounts the workspace, preserving live renderer state.
Switch, reorder, close/close others/close all, inspect and reopen tabs directly
while the workspace remains open. Closing its last document leaves an empty
workspace, not a terminated session. Explicitly closed sessions cannot be replayed;
use a new opener call to intentionally start another viewer.
The legacy UI resource also honors full-workspace sessions, so a retained
host tool binding cannot silently downgrade a new opening to the compact viewer.
Finder/Open With actions use the same local allowlisted implementation as the
Browser workspace. Native `view: "ketcher"` seeds the editor; `view: "docking"`
combines the receptor and ligand inputs. No network compute service is implied.

Burette's Codex plugin turns the app into an agent-operable molecular workspace. The
plugin is intentionally layered:

- skills decide the workflow and user-facing handoff;
- MCP tools expose stable app surfaces;
- the repository CLI remains the readable execution contract;
- Browser and Computer are QA surfaces, not the source of molecular truth.

## Architecture

```text
skills/
  index/                 router skill
  external-agent-contract/ short handle-based agent facade
  user-context/          scoped preflight and capability registry
  open-workspace/        open Browser preview or desktop sessions
  molstar-scene/         allowlisted Mol* actions and scene inspection
  mvs-story/             author, validate, observe, and control MolViewSpec Stories
  molecule-collection/   SDF/grid/property workflows
  trajectory-review/     trajectory/result-bundle review
  workflow-results/      external workflow artifact intake
  molecular-report/      notes, charts, tables, reports
  visual-qa/             Browser and Computer verification

mcp/
  server.mjs
  registrations/         tool registrations
  lib/                   validation, CLI bridge, response helpers

scripts/
  burette_agent_preflight.mjs
  validate_molecular_artifact.mjs
```

This mirrors the split used by the reference plugins:

- Data Analytics: router plus focused skills, read-only preflight, bounded
  snapshot validation before rendering, and source-backed artifacts.
- Product Design: mandatory context gate before visual/build work and focused
  workflows for audit, ideation, prototype, and QA.
- Creative Production: MCP server registrations separated from durable run
  folders.
- Browser: in-app browser verification for localhost and visual UI state.
- Computer: native desktop fallback for accessibility-tree and screenshot QA.

See [REFERENCE_ALIGNMENT.md](REFERENCE_ALIGNMENT.md) for the explicit
plugin-by-plugin alignment checklist.

## Execution Contract

The source of truth is the repository CLI:

```bash
bun scripts/burette-agent.mjs open --mode auto samples/mini.pdb
bun scripts/burette-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burette-agent.mjs open --mode browser-agent-shell samples/mini.pdb
bun scripts/burette-agent.mjs open --mode desktop-app samples/mini.pdb
bun scripts/burette-agent.mjs observe --session-dir /tmp/burette-agent-session
bun scripts/burette-agent.mjs act --session-dir /tmp/burette-agent-session '{"type":"reset_camera"}'
bun scripts/burette-agent.mjs act --session-dir /tmp/burette-agent-session '{"type":"apply_scene","components":[{"selector":"protein","label":"Protein","highlight":true},{"selector":{"chain":"A","range":[45,58]},"label":"Active loop","select":true,"focus":true}]}'
bun scripts/burette-agent.mjs render-panel --session-dir /tmp/burette-agent-session --kind markdown --file notes.md
bun scripts/burette-agent.mjs story-create --spec story.json --output story.mvsx --asset protein.cif=/path/protein.cif
bun scripts/burette-agent.mjs story-validate --file story.mvsx
bun scripts/burette-agent.mjs story-template-list
bun scripts/burette-agent.mjs story-template-create --template binding-site-tour --output story.mvsx --var protein_url=protein.pdb --var ligand_url=ligand.sdf --asset protein.pdb=/path/protein.pdb --asset ligand.sdf=/path/ligand.sdf
bun scripts/burette-agent.mjs story-schema --schema scene
bun scripts/burette-agent.mjs story-schema --schema scene --node component
```

MCP tools wrap this CLI instead of reimplementing the app control layer.

External agents should use the short facade first:

```text
burette.get_context
burette.open_workspace
burette.open_ketcher
burette.observe_workspace
burette.control_viewer
burette.control_ketcher
burette.get_mvs_authoring_reference
burette.list_story_templates
burette.create_story_from_template
burette.create_story
burette.validate_story
burette.observe_story
burette.control_story
burette.render_panel
```

`burette.open_workspace` returns a stable `workspaceSessionId` and a
`viewerSessionId` compatibility alias. Follow-up calls should pass that handle
instead of carrying raw URLs, session directories, or transport modes. The
advanced tools remain available for docking setup, fragment extraction,
trajectory review, bounded report rendering, and lower-level scene operations.

Ketcher is exposed as a separate active surface. Call `burette.open_ketcher`
with the workspace handle, then use `burette.control_ketcher` with an action
that includes `apiVersion: "burette-ketcher-agent/v1"`, the observed
`surfaceId`, and the current `expectedRevision`. Structure edits, exports,
selection/highlight state, and dirty/persisted revisions are returned in the
bounded `chemicalEditor` snapshot. A stale revision or a tab switch fails
closed; observe the workspace again before retrying. `request_persist` only
prepares a user-confirmation request and never writes a file silently.

`auto` is the default because it does not require the full Browser shell to be
available. It tries `browser-agent-shell` first and falls back to the tokenized
`browser-preview` server for basic molecular opening and observation.

The full `browser-agent-shell` is self-contained when the plugin bundle is built
with:

```bash
bun run build:agent-shell
```

That command writes the runtime files into the plugin bundle:

- `plugins/burette-agent/scripts/burette-agent.mjs`
- `plugins/burette-agent/scripts/agent-shell-server.mjs`
- `plugins/burette-agent/scripts/agent-preview.mjs`
- `plugins/burette-agent/browser-shell-dist/`
- `plugins/burette-agent/preview-web/`

The plugin builds this checkout's Burette interface with
`VITE_BURETTE_AGENT_SHELL=1`. The recovery checkout is not automatically updated
from the main repository: rebuilding it alone does not include newer main UI.
See the source-boundary checks in `docs/native-widget-development.md` before
claiming UI parity. Its visualization-only
profile omits molecular Compute/Tools and Jobs, and hides project-sidebar and
bottom-dock toggle buttons. Ketcher import/export still uses its output panel.
The shared preview receives `visualizationOnly: true`; desktop builds retain
their compute features. Run the plugin and UI contract checks after rebuilding
so upstream UI changes do not reintroduce calculation controls.

When `browser-shell-dist/index.html` is present, the plugin-local CLI serves
those static assets plus the runtime `/__burette/agent-session/*`,
`/__burette/read-file`, and `/__burette/file-bundle` endpoints without `vp` and
without needing the source repository checkout. If the prebuilt bundle is
missing in a source checkout, the CLI falls back to `vp dev`.

## Codex Plugin Shape

Burette is packaged as a Codex-local plugin with bundled skills and a local
stdio MCP server. This is the appropriate shape for a macOS application that
must open user-selected local files and control local Browser or desktop
sessions. This local bundle is not itself the hosted public plugin and does not
reference an entry in `.app.json`.

The same repository also owns the hosted plugin-plus-skills target at
[`apps/burette-public-plugin`](../../apps/burette-public-plugin). It exposes
<https://burette-plugin.vercel.app/mcp> and renders one authorized attachment or
public PDB entry in the real sandboxed Burette browser workspace. The hosted
target does not open arbitrary local files or control the desktop application.

MolViewSpec Story authoring and the bundled Browser transports are self-contained
in plugin `0.2.2`. Native `desktop-app` Story observation and control require
Burette `2.1.16` or newer; older app releases are intentionally excluded by
`compatibility.json`.

The required manifest lives at `.codex-plugin/plugin.json`, the MCP server is
declared in `.mcp.json`, and the repository marketplace is declared at
`.agents/plugins/marketplace.json`. This follows the current
[Codex plugin structure and marketplace guidance](https://developers.openai.com/codex/build-plugins).

## Local Codex Installation

For a clean local install from this repository, stage a self-contained plugin
in a personal marketplace and ask the Codex CLI to register that marketplace
and install the plugin:

```bash
cd /path/to/Burette
bun run install:plugin
```

The repository contains a prebuilt MCP server with its runtime dependencies
bundled, so standard Codex marketplace installation does not require
`node_modules`. The installer stages that bundle and its marketplace descriptor
under `~/.codex/plugins/burette-widget-marketplace`, then runs
`codex plugin marketplace add` and `codex plugin add burette@burette-widget`. This
separate namespace prevents legacy desktop auto-refresh from overwriting the
native-widget package. Remove the old `burette` marketplace registration and
staged plugin after migration; keep source checkouts and recovery backups.
Codex owns
the installed cache copy and the enabled state in `~/.codex/config.toml`. After
the new plugin is active, the installer removes earlier Burette plugin ids and
marketplace entries while preserving unrelated plugins. If no working Codex CLI
can be found, the installer uses the same cache and config layout as a
compatibility fallback and reports that method explicitly.

Use `--build` when developing the plugin and intentionally regenerating the MCP,
Browser shell, and Browser preview bundles before installation:

```bash
bun scripts/install-local.mjs --build
```

The `.burette-agent-install.json` file records the source checkout or app bundle
used for the install. The MCP server, Browser shell, and Browser preview paths
must work from the installed plugin copy without the source checkout.

Verify the installation with `codex plugin list`, then compare the active MCP
resource with the installed build and observe the requested card. Follow
`docs/native-widget-development.md`; do not routinely restart Codex or confuse
installation with a refreshed, mounted widget.

Public Plugins Directory submission remains a separate deployment target from
this local stdio bundle. The hosted plugin provides the public HTTPS endpoint,
support/privacy/terms URLs, review test cases, and accurate tool annotations;
verified publisher identity and OpenAI review remain portal-side release gates.

## MolViewSpec Scene Language

The Mol* scene skill uses MolViewSpec as the vocabulary for agent requests:
component selectors, representation, color, opacity, labels, tooltips, focus,
camera, canvas, transforms, primitives, volumes, and animations.

There are two execution paths:

- `apply_scene` is the fast active-viewer action DSL. It maps MVS-like
  component operations to allowlisted Burette commands such as
  `colorSelection`, `selectResidues`, `focusSelection`, `focus_ligand`,
  `contacts`, and `reset_camera`.
- `load_mvs` is for complete MolViewSpec scenes (`mvsj`/`mvsx`) that should be
  loaded through Mol* `loadMvsData`. Use this for full representation graphs,
  durable opacity/labels/tooltips/primitives, explicit camera/canvas settings,
  transforms/instances, volumes, and animations.

For an explanation that should unfold step by step, use a MolViewSpec Story:
`burette.get_mvs_authoring_reference` returns the installed MolViewSpec version,
official documentation map, supported scene or animation nodes, and the exact
parent/parameter contract for one requested node. Use it before unfamiliar
selectors, annotations, cameras, primitives, volumes, or animations instead of
guessing syntax from memory.
`burette.list_story_templates` returns reusable structure-overview,
binding-site, docking-comparison, and aligned-structure scaffolds with declared
inputs, storyboard purposes, and scientific caveats.
`burette.create_story_from_template` instantiates one through the same safe
validation/write path; customize its generic prose with observed evidence.
`burette.create_story` writes a standard multi-state document,
`burette.validate_story` checks the official Mol* schema and bundled resources,
and `burette.observe_story` / `burette.control_story` expose the current step and
playback controls without DOM automation. Every snapshot is a complete scene,
so overview, pocket, pose, contacts, comparison, and conclusion remain
reproducible and independently loadable. Package local sidecars in `.mvsx`;
standalone `.mvsj` is appropriate only when all referenced URLs are accessible.

Use `apply_scene` for commands like "highlight the protein", "select and focus
the active loop", or "show the ligand pocket". Use `load_mvs` when the user
asks for a reproducible scene file or geometry-level scene changes.

## Artifact Contract

Reports, tables, and trajectory reviews use bounded molecular artifacts:

```json
{
  "version": 1,
  "surface": "molecular-report",
  "title": "Ligand Review",
  "blocks": [{"type": "markdown", "body": "# Ligand Review"}],
  "sources": [{"label": "Prepared SDF", "path": "/tmp/ligands.sdf"}]
}
```

```json
{
  "version": 1,
  "status": "ready",
  "datasets": {
    "ligands": [{"id": "L1", "smiles": "CCO", "score": -7.2}]
  },
  "artifacts": [{"kind": "sdf", "path": "/tmp/ligands.sdf"}]
}
```

Snapshots must stay bounded and reviewed before rendering:

- at most 50 datasets;
- at most 2,000 rows per dataset;
- at most 3 MB of inline JSON;
- status is `ready`, `partial`, `blocked`, or `fixture`;
- missing required inputs are visible as access issues or blockers;
- optional caveats belong in notes, not blocker fields.

## Security

- No arbitrary JavaScript execution.
- No arbitrary shell execution from the app bridge.
- Every local HTTP surface is token gated.
- Desktop mode requires explicit `--burette-agent-session`.
- Tools operate on local files, explicit session directories, or bounded
  payloads.
- Destructive overwrites and remote job submissions are outside this interface
  and require separate workflow confirmation.
