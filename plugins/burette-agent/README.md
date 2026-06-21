# Burrete Plugin

Burrete turns Burrete into an agent-operable molecular workspace. The
plugin is intentionally layered:

- skills decide the workflow and user-facing handoff;
- MCP tools/resources expose stable app and widget surfaces;
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
  molecule-collection/   SDF/grid/property workflows
  trajectory-review/     trajectory/result-bundle review
  workflow-results/      external workflow artifact intake
  molecular-report/      notes, charts, tables, reports
  visual-qa/             Browser and Computer verification

mcp/
  server.mjs
  registrations/         tool/resource registrations
  widget-assets/         browser assets only
  lib/                   validation, CLI bridge, resource helpers

scripts/
  burette_agent_preflight.mjs
  validate_molecular_artifact.mjs
```

This mirrors the split used by the reference plugins:

- Data Analytics: router plus focused skills, read-only preflight, bounded
  snapshot validation before rendering, and source-backed artifacts.
- Product Design: mandatory context gate before visual/build work and focused
  workflows for audit, ideation, prototype, and QA.
- Creative Production: MCP server registrations separated from browser widget
  assets and durable run folders.
- Browser: in-app browser verification for localhost and visual UI state.
- Computer: native desktop fallback for accessibility-tree and screenshot QA.

See [REFERENCE_ALIGNMENT.md](REFERENCE_ALIGNMENT.md) for the explicit
plugin-by-plugin alignment checklist.

## Execution Contract

The source of truth is the repository CLI:

```bash
bun scripts/burrete-agent.mjs open --mode auto samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode browser-agent-shell samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode desktop-app samples/mini.pdb
bun scripts/burrete-agent.mjs observe --session-dir /tmp/burrete-agent-session
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"reset_camera"}'
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"apply_scene","components":[{"selector":"protein","label":"Protein","highlight":true},{"selector":{"chain":"A","range":[45,58]},"label":"Active loop","select":true,"focus":true}]}'
bun scripts/burrete-agent.mjs render-panel --session-dir /tmp/burrete-agent-session --kind markdown --file notes.md
```

MCP tools wrap this CLI instead of reimplementing the app control layer.

External agents should use the short facade first:

```text
burrete.get_context
burrete.open_workspace
burrete.observe_workspace
burrete.control_viewer
burrete.render_panel
```

`burrete.open_workspace` returns a stable `workspaceSessionId` and a
`viewerSessionId` compatibility alias. Follow-up calls should pass that handle
instead of carrying raw URLs, session directories, or transport modes. The
advanced tools remain available for docking setup, fragment extraction,
trajectory review, bounded report rendering, and lower-level scene operations.

`auto` is the default because it does not require the full Browser shell to be
available. It tries `browser-agent-shell` first and falls back to the tokenized
`browser-preview` server for basic molecular opening and observation.

The full `browser-agent-shell` is self-contained when the plugin bundle is built
with:

```bash
bun run build:agent-shell
```

That command writes the runtime files into the plugin bundle:

- `plugins/burette-agent/scripts/burrete-agent.mjs`
- `plugins/burette-agent/scripts/agent-shell-server.mjs`
- `plugins/burette-agent/scripts/agent-preview.mjs`
- `plugins/burette-agent/browser-shell-dist/`
- `plugins/burette-agent/preview-web/`

When `browser-shell-dist/index.html` is present, the plugin-local CLI serves
those static assets plus the runtime `/__burette/agent-session/*`,
`/__burette/read-file`, and `/__burette/file-bundle` endpoints without `vp` and
without needing the source repository checkout. If the prebuilt bundle is
missing in a source checkout, the CLI falls back to `vp dev`.

## Local Codex Installation

The current Codex CLI does not expose a direct
`codex plugin install <plugin-dir>` command. For a clean local install from this
repository, build the self-contained plugin runtime, install the bundle into the
local plugin cache, install the MCP dependencies, and enable the plugin in the
Codex config:

```bash
cd /path/to/Burette
bun run install:plugin
```

The installer runs `bun run build:agent-shell` when it is executed from a source
checkout, copies the self-contained plugin bundle into
`~/.codex/plugins/cache/<marketplace>/burrete/0.1.0`, installs production MCP
dependencies, registers `burrete` in `~/.agents/plugins/marketplace.json`,
updates the `~/.agents/plugins/burrete` symlink, and enables
`burrete@<marketplace>` in `~/.codex/config.toml`.

On a fresh machine, `<marketplace>` defaults to `burrete`, so the plugin id is
`burrete@burrete`. If `~/.agents/plugins/marketplace.json` already exists, the
installer keeps its existing marketplace name to avoid renaming unrelated local
plugins. To force the Burrete marketplace name, run:

```bash
BURRETE_PLUGIN_MARKETPLACE=burrete bun run install:plugin
```

Use `--skip-build` only when installing an already prebuilt plugin directory:

```bash
bun scripts/install-local.mjs --skip-build
```

The `.burette-agent-install.json` file is useful for source-checkout fallbacks
and repository-local summaries, but the Browser shell and Browser preview paths
must work from the plugin cache itself after `bun run build:agent-shell`.

Restart Codex after changing the marketplace or plugin config. A running Codex
process can keep the old MCP tool surface and cached plugin process alive until
the next session.

## MolViewSpec Scene Language

The Mol* scene skill uses MolViewSpec as the vocabulary for agent requests:
component selectors, representation, color, opacity, labels, tooltips, focus,
camera, canvas, transforms, primitives, volumes, and animations.

There are two execution paths:

- `apply_scene` is the fast active-viewer action DSL. It maps MVS-like
  component operations to allowlisted Burrete commands such as
  `colorSelection`, `selectResidues`, `focusSelection`, `focus_ligand`,
  `contacts`, and `reset_camera`.
- `load_mvs` is for complete MolViewSpec scenes (`mvsj`/`mvsx`) that should be
  loaded through Mol* `loadMvsData`. Use this for full representation graphs,
  durable opacity/labels/tooltips/primitives, explicit camera/canvas settings,
  transforms/instances, volumes, and animations.

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
- Desktop mode requires explicit `--burrete-agent-session`.
- Tools operate on local files, explicit session directories, or bounded widget
  payloads.
- Destructive overwrites and remote job submissions are outside this interface
  and require separate workflow confirmation.
