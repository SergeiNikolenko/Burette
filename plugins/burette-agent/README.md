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

`auto` is the default because it does not require the full Browser shell to be
available. It tries `browser-agent-shell` first and falls back to the tokenized
`browser-preview` server for basic molecular opening and observation.

The full `browser-agent-shell` prefers a prebuilt agent-shell web bundle served
by `scripts/agent-shell-server.mjs`. Build that bundle with:

```bash
bun run build:agent-shell
```

When `apps/desktop/dist/index.html` is present, the CLI serves those static
assets plus the runtime `/__burette/agent-session/*`, `/__burette/read-file`,
and `/__burette/file-bundle` endpoints without `vp`. If the prebuilt bundle is
missing in a source checkout, the CLI falls back to `vp dev`.

## Local Codex Installation

The current Codex CLI does not expose a direct
`codex plugin install <plugin-dir>` command. For a clean local install from this
repository, install the bundle into the local plugin cache, record the source
repository root, install the MCP dependencies, and enable the plugin in the
Codex config:

```bash
cd /path/to/Burette
bun run build:agent-shell
rm -rf ~/.codex/plugins/cache/nikolenko-local/burrete
install_root="$HOME/.codex/plugins/cache/nikolenko-local/burrete/0.1.0"
mkdir -p "$install_root"
rsync -a --delete --exclude node_modules plugins/burette-agent/ "$install_root/"
cat > "$install_root/.burette-agent-install.json" <<EOF
{
  "repoRoot": "$PWD"
}
EOF
(cd "$install_root" && bun install --production)
node <<'NODE'
const fs = require("fs");
const path = `${process.env.HOME}/.agents/plugins/marketplace.json`;
const data = JSON.parse(fs.readFileSync(path, "utf8"));
data.plugins = (data.plugins || []).filter((plugin) => plugin.name !== "burrete");
data.plugins.push({
  name: "burrete",
  source: { source: "local", path: "./.agents/plugins/burrete" },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Science"
});
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
NODE
rm -f ~/.agents/plugins/burrete
ln -s "$install_root" ~/.agents/plugins/burrete
grep -q '^\[plugins."burrete@nikolenko-local"\]' ~/.codex/config.toml || cat >> ~/.codex/config.toml <<'EOF'

[plugins."burrete@nikolenko-local"]
enabled = true
EOF
```

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
