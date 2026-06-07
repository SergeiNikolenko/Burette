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
bun scripts/burrete-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode desktop-app samples/mini.pdb
bun scripts/burrete-agent.mjs observe --session-dir /tmp/burrete-agent-session
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"reset_camera"}'
bun scripts/burrete-agent.mjs render-panel --session-dir /tmp/burrete-agent-session --kind markdown --file notes.md
```

MCP tools wrap this CLI instead of reimplementing the app control layer.

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
