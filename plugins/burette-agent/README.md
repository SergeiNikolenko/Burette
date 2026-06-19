# Burrete Agent Plugin

Burrete Agent is the local Codex plugin bundled with Burrete. It teaches an
assistant how to operate Burrete as a molecular workspace instead of treating
the app as an opaque browser screenshot.

The plugin is intentionally layered:

- skills decide the workflow and handoff;
- MCP tools/resources expose stable app and widget surfaces;
- the repository CLI remains the readable execution contract;
- Browser and Computer are QA surfaces, not the source of molecular truth.

## What It Does

Once installed, Codex can:

- fetch public HTTP(S) reference pages as bounded readable text for agent-side
  research;
- open local PDB, CIF, XYZ, SDF, and related molecular files in Burrete;
- observe the active workspace, tabs, documents, scene state, and current
  structure summary as JSON;
- manage Burrete tabs without opening extra browser tabs;
- focus ligands, hide waters, reset the camera, select/highlight components,
  and apply allowlisted Mol* scene actions;
- extract chains, ligands, waters, ions, polymers, or element selections into
  separate Burrete tabs;
- open docking/combined structure views from receptor and ligand files;
- render bounded molecular report, table, trajectory, and workspace widgets;
- validate molecular artifacts before showing them to the user.

## Install

The plugin lives in this repository under `plugins/burette-agent/`. Install it
as a local Codex plugin with id `burrete`.

### From the Burrete App

1. Open Burrete.
2. Go to Settings -> Integrations -> Burrete.
3. Copy the bundle path from the Codex plugin panel.
4. In Codex, install or update the local plugin `burrete` from that path.
5. Return to the Burrete panel and refresh. The panel should report the bundled
   plugin version, installed Codex version, skill availability, and MCP
   registration.

### From the Burrete CLI

```bash
bunx burrete plugin install
bunx burrete plugin status
```

The CLI auto-detects the bundled plugin from a source checkout or installed
`Burrete.app`, installs missing dependencies, and updates the local Codex plugin
cache atomically. Use `--skip-deps` only when dependencies are already present
or managed by Codex.

### From a Source Checkout

Use this plugin directory:

```text
plugins/burette-agent
```

Prompt Codex with:

```text
Install or update the local Codex plugin @Burrete (id `burrete`) from
plugins/burette-agent.
```

If Codex asks for an absolute path, use the full path to this directory in your
checkout or copy it from the Burrete settings panel.

You can pass the same path directly to the CLI:

```bash
bunx burrete plugin install --path plugins/burette-agent
```

## Verify

From the repository root:

```bash
node plugins/burette-agent/scripts/burette_agent_preflight.mjs
bun tests/test-burette-agent-plugin.mjs
```

From the plugin directory:

```bash
npm run preflight
npm run check
```

The preflight output is the quick health check for the plugin root, repository
CLI, available session transports, and current capability registry.

## Prerequisites

- Burrete desktop app or a source checkout containing `scripts/burrete-agent.mjs`.
- Node.js available to run the MCP server and helper scripts.
- Codex with local plugin support.
- Browser plugin for browser-shell visual QA.
- Computer plugin only when real native desktop accessibility or screenshots are
  required.

## How It Is Structured

```text
skills/
  index/                 router skill
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
  registrations/         tool/resource registrations, including bounded fetch
  widget-assets/         browser assets only
  lib/                   validation, CLI bridge, resource helpers

scripts/
  burette_agent_preflight.mjs
  validate_molecular_artifact.mjs
```

The shape follows the same progressive-disclosure principle as compact agent
plugins such as `serve-sim`: Codex discovers the plugin metadata first, reads
the router skill when Burrete is relevant, and loads only the focused skill or
reference needed for the active molecular task.

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
bun scripts/burrete-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode browser-dev-shell samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode desktop-app samples/mini.pdb
bun scripts/burrete-agent.mjs observe --session-dir /tmp/burrete-agent-session
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"reset_camera"}'
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"apply_scene","components":[{"selector":"protein","label":"Protein","highlight":true},{"selector":{"chain":"A","range":[45,58]},"label":"Active loop","select":true,"focus":true}]}'
bun scripts/burrete-agent.mjs render-panel --session-dir /tmp/burrete-agent-session --kind markdown --file notes.md
```

MCP tools wrap this CLI instead of reimplementing the app control layer.
`fetch` follows the standard MCP fetch shape (`url`, `max_length`,
`start_index`, and `raw`) for public HTTP(S) references, returns bounded text,
and blocks localhost, private, and link-local hosts.
`summarize_burrete_structure` is the agent-side structure brief: it reads an
explicit file or the active workspace document and returns the same kind of
high-level content facts used by the Info dock, including format, kind, atom
counts, chains, ligand instances, water, ions, and Mol* selectors for detected
ligands. `open_burrete_workspace` attaches this summary to its structured
result when a file is opened.
`manage_burrete_tabs` controls the Burrete tab strip through the same agent
session: list tabs, focus by id/index/path/title, move tabs, close tabs, create
a blank tab, or open a file into the workspace without creating a separate
Browser tab.
`manage_burrete_structure_component` exposes the structure context-menu
operations as tools: select/focus components in Mol*, hide/show component
classes, clear selection, or extract a chain/ligand/water/ion/polymer/element
from a PDB file into a temporary PDB and open it as a separate Burrete tab.
`open_burrete_docking_view` opens a Mol* docking or combined structure-scene
view as a Burrete tab from a receptor path plus one or more ligand paths.

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
