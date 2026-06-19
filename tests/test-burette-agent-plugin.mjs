#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { extractStructureComponentFile } from "../plugins/burette-agent/mcp/lib/structure-components.mjs";
import { summarizeStructureFile } from "../plugins/burette-agent/mcp/lib/structure-summary.mjs";
import { validateMolecularArtifact } from "../plugins/burette-agent/mcp/lib/validation.mjs";

const pluginRoot = path.resolve("plugins/burette-agent");

async function read(relativePath) {
  return readFile(path.join(pluginRoot, relativePath), "utf8");
}

function runNode(args, cwd = ".") {
  return spawnSync("node", args, {
    cwd,
    encoding: "utf8",
  });
}

const manifest = JSON.parse(await read(".codex-plugin/plugin.json"));
assert.equal(manifest.name, "burrete");
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.equal(manifest.interface.displayName, "Burrete");
assert.equal(manifest.interface.composerIcon, "./assets/composer-icon.png");
assert.equal(manifest.interface.logo, "./assets/app-icon.png");
assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read", "Write"]);
assert.match(manifest.interface.longDescription, /observe scene state as structured JSON/);

const compatibility = JSON.parse(await read("compatibility.json"));
assert.equal(compatibility.schema, "burette_agent_compatibility.v1");
assert.equal(compatibility.plugin.name, "burrete");
assert.equal(compatibility.plugin.version, manifest.version);
assert.equal(compatibility.requires.burreteApp, ">=0.10.44");
assert.equal(compatibility.requires.agentCli, "burette-agent-cli/v1");
assert.equal(compatibility.requires.controlApi, "burette-agent-control/v1");
assert.equal(compatibility.bundle.relativePath, "plugins/burette-agent");

const mcpConfig = JSON.parse(await read(".mcp.json"));
assert.equal(mcpConfig.mcpServers.burette_agent_mcp.command, "node");
assert.deepEqual(mcpConfig.mcpServers.burette_agent_mcp.args, ["./mcp/server.mjs", "--stdio"]);

const packageJson = JSON.parse(await read("package.json"));
assert.match(packageJson.scripts.check, /mcp\/server\.mjs/);
assert.match(packageJson.scripts.check, /scripts\/burette_agent_preflight\.mjs/);
assert.match(packageJson.scripts.check, /mcp\/registrations\/fetch\/register\.mjs/);
assert.match(packageJson.scripts.check, /mcp\/registrations\/molecular-workspace\/register\.mjs/);

const server = await read("mcp/server.mjs");
assert.match(server, /new McpServer/);
assert.match(server, /registerFetch\(server\)/);
assert.match(server, /registerMolecularWorkspace\(server\)/);
assert.match(server, /registerMoleculeTable\(server\)/);
assert.match(server, /registerTrajectoryReview\(server\)/);
assert.match(server, /registerMolecularReport\(server\)/);

const fetchRegistration = await read("mcp/registrations/fetch/register.mjs");
assert.match(fetchRegistration, /registerAppTool/);
assert.match(fetchRegistration, /"fetch"/);
assert.match(fetchRegistration, /max_length/);
assert.match(fetchRegistration, /start_index/);
assert.match(fetchRegistration, /raw/);
assert.match(fetchRegistration, /openWorldHint: true/);
assert.match(fetchRegistration, /Local, private, and link-local hosts are blocked/);
assert.match(fetchRegistration, /MAX_RESPONSE_BYTES/);

const workspaceRegistration = await read("mcp/registrations/molecular-workspace/register.mjs");
assert.match(workspaceRegistration, /registerAppTool/);
assert.match(workspaceRegistration, /open_burrete_workspace/);
assert.match(workspaceRegistration, /summarize_burrete_structure/);
assert.match(workspaceRegistration, /summarizeStructureFile/);
assert.match(workspaceRegistration, /structureSummary/);
assert.match(workspaceRegistration, /manage_burrete_tabs/);
assert.match(workspaceRegistration, /type: "manage_tabs"/);
assert.match(workspaceRegistration, /operation: z\.enum\(\["list", "focus", "next", "previous", "open_file", "new", "close", "move"\]\)/);
assert.match(workspaceRegistration, /manage_burrete_structure_component/);
assert.match(workspaceRegistration, /extractStructureComponentFile/);
assert.match(workspaceRegistration, /type: "clear_selection"/);
assert.match(workspaceRegistration, /hide_components/);
assert.match(workspaceRegistration, /open_burrete_docking_view/);
assert.match(workspaceRegistration, /type: "open_docking_view"/);
assert.match(workspaceRegistration, /sceneMode: z\.enum\(\["structureAll", "structurePoses"\]\)/);
assert.match(workspaceRegistration, /observe_burrete_workspace/);
assert.match(workspaceRegistration, /act_molstar_scene/);
assert.match(workspaceRegistration, /declarative Mol\* scene action/);
assert.match(workspaceRegistration, /runBurreteAgent/);
assert.match(workspaceRegistration, /visibility: \["model"\]/);
assert.match(workspaceRegistration, /openai\/outputTemplate/);
assert.match(workspaceRegistration, /widgetData/);

for (const registration of [
  "mcp/registrations/molecule-table/register.mjs",
  "mcp/registrations/trajectory-review/register.mjs",
  "mcp/registrations/molecular-report/register.mjs",
]) {
  const source = await read(registration);
  assert.match(source, /validateMolecularArtifact/);
  assert.match(source, /registerWidgetResource/);
  assert.match(source, /visibility: \["model"\]/);
  assert.match(source, /openai\/outputTemplate/);
}

for (const widget of [
  "mcp/widget-assets/molecular-workspace/widget.html",
  "mcp/widget-assets/molecule-table/widget.html",
  "mcp/widget-assets/trajectory-review/widget.html",
  "mcp/widget-assets/molecular-report/widget.html",
]) {
  const source = await read(widget);
  assert.match(source, /__BURETTE_AGENT_WIDGET_CSS__/);
  assert.match(source, /__BURETTE_AGENT_WIDGET_JS__/);
}

const indexSkill = await read("skills/index/SKILL.md");
assert.match(indexSkill, /Mandatory Preflight/);
assert.match(indexSkill, /open-workspace/);
assert.match(indexSkill, /molstar-scene/);
assert.match(indexSkill, /molecule-collection/);
assert.match(indexSkill, /trajectory-review/);
assert.match(indexSkill, /workflow-results/);
assert.match(indexSkill, /molecular-report/);
assert.match(indexSkill, /visual-qa/);
assert.match(indexSkill, /Completion Gate/);

const userContextSkill = await read("skills/user-context/SKILL.md");
assert.match(userContextSkill, /burette_agent_preflight/);
assert.match(userContextSkill, /capability registry/);
assert.match(userContextSkill, /Do not store arbitrary molecule facts/);

const referenceAlignment = await read("REFERENCE_ALIGNMENT.md");
assert.match(referenceAlignment, /Data Analytics/);
assert.match(referenceAlignment, /Product Design/);
assert.match(referenceAlignment, /Creative Production/);
assert.match(referenceAlignment, /Browser/);
assert.match(referenceAlignment, /Computer/);
assert.match(referenceAlignment, /Completion Bar/);

const visualQaSkill = await read("skills/visual-qa/SKILL.md");
assert.match(visualQaSkill, /Browser/);
assert.match(visualQaSkill, /Computer/);
assert.match(visualQaSkill, /cannot reliably provide/);

const goodManifest = {
  version: 1,
  surface: "molecular-report",
  title: "Ligand Review",
  blocks: [
    { type: "markdown", body: "# Ligand Review\n\nReviewed ligands." },
  ],
};
const goodSnapshot = {
  version: 1,
  status: "ready",
  datasets: {
    ligands: [
      { id: "L1", smiles: "CCO", score: -7.2 },
    ],
  },
  artifacts: [
    { kind: "sdf", path: "/tmp/ligands.sdf" },
  ],
};
const valid = validateMolecularArtifact({
  manifest: goodManifest,
  snapshot: goodSnapshot,
  surface: "molecular-report",
});
assert.equal(valid.ok, true);
assert.equal(valid.summary.datasetCount, 1);

const invalid = validateMolecularArtifact({
  manifest: { ...goodManifest, blocks: [] },
  snapshot: {
    version: 1,
    status: "ready",
    datasets: {
      ligands: new Array(2001).fill(0).map((_, index) => ({ id: `L${index}` })),
    },
    accessIssues: [{ message: "should not be here when ready" }],
  },
  surface: "molecular-report",
});
assert.equal(invalid.ok, false);
assert.match(invalid.errors.join("\n"), /manifest.blocks/);
assert.match(invalid.errors.join("\n"), /maximum is 2000/);
assert.match(invalid.errors.join("\n"), /accessIssues/);

const tableShapeInvalid = validateMolecularArtifact({
  manifest: goodManifest,
  snapshot: {
    version: 1,
    status: "ready",
    datasets: {
      ligands: { columns: [{ key: "id" }], rows: [{ id: "L1" }] },
    },
  },
  surface: "molecule-table",
});
assert.equal(tableShapeInvalid.ok, false);
assert.match(tableShapeInvalid.errors.join("\n"), /\{columns, rows\}/);

const preflight = runNode(["plugins/burette-agent/scripts/burette_agent_preflight.mjs"]);
assert.equal(preflight.status, 0, preflight.stderr);
const preflightPayload = JSON.parse(preflight.stdout);
assert.equal(preflightPayload.schema, "burette_agent_preflight.v1");
assert.equal(preflightPayload.files.cli.status, "available");
assert.equal(preflightPayload.files.browserPreviewServer.status, "available");
assert.equal(preflightPayload.context.transports[0].id, "browser-dev-shell");
assert.equal(preflightPayload.context.transports[1].id, "browser-preview");
assert.equal(preflightPayload.context.transports[2].id, "desktop-app");
assert.equal(preflightPayload.context.workflowRoutes.molstarScene.includes("observe scene"), true);
assert.equal(preflightPayload.context.workflowRoutes.molstarScene.includes("apply MolViewSpec-informed declarative scene schema"), true);
assert.equal(preflightPayload.context.workflowRoutes.molstarScene.includes("load complete MolViewSpec scenes"), true);
assert.equal(preflightPayload.capabilities.molstarActions.apply_scene, "supported");
assert.equal(preflightPayload.capabilities.molstarActions.scene_language, "mvs_informed_active_viewer_dsl");
assert.equal(preflightPayload.capabilities.molstarActions.load_mvs, "supported_for_complete_mvs_payloads");
assert.equal(preflightPayload.capabilities.molstarActions.full_mvs_scene, "supported_via_load_mvs");

const molstarSceneSkill = await read("skills/molstar-scene/SKILL.md");
assert.match(molstarSceneSkill, /apply_scene/);
assert.match(molstarSceneSkill, /MolViewSpec-informed scene language/);
assert.match(molstarSceneSkill, /https:\/\/molstar\.org\/mol-view-spec-docs\/tree-schema\//);
assert.match(molstarSceneSkill, /https:\/\/molstar\.org\/mol-view-spec-docs\/selectors\//);
assert.match(molstarSceneSkill, /camera movement\/orientation/);
assert.match(molstarSceneSkill, /structure movement\/rotation\/instances/);
assert.match(molstarSceneSkill, /"selector": "protein"/);
assert.match(molstarSceneSkill, /"label": "Active loop"/);
assert.match(molstarSceneSkill, /"type": "label_selection"/);

const readme = await read("README.md");
assert.match(readme, /MolViewSpec Scene Language/);
assert.match(readme, /"type":"apply_scene"/);
assert.match(readme, /"selector":"protein"/);
assert.match(readme, /load_mvs/);

const structureSummary = await summarizeStructureFile("tests/fixtures/BurettePreviewSamples/mini.pdb");
assert.equal(structureSummary.format, "PDB");
assert.equal(structureSummary.counts.atoms, 9);
assert.equal(structureSummary.counts.chains, 1);

const extractedLigand = await extractStructureComponentFile({
  file: "tests/fixtures/BurettePreviewSamples/1HTB.pdb",
  component: "ligand",
  chain: "A",
  compId: "NAD",
  seq: 377,
  title: "test-nad-a-377",
});
assert.equal(extractedLigand.atomCount, 44);
assert.match(extractedLigand.outputPath, /test-nad-a-377\.pdb$/);
await unlink(extractedLigand.outputPath);

const syntaxTargets = [
  "plugins/burette-agent/mcp/server.mjs",
  "plugins/burette-agent/mcp/lib/cli-bridge.mjs",
  "plugins/burette-agent/mcp/lib/plugin-root.mjs",
  "plugins/burette-agent/mcp/lib/structure-components.mjs",
  "plugins/burette-agent/mcp/lib/structure-summary.mjs",
  "plugins/burette-agent/mcp/lib/validation.mjs",
  "plugins/burette-agent/mcp/lib/widget-resource.mjs",
  "plugins/burette-agent/mcp/registrations/fetch/register.mjs",
  "plugins/burette-agent/mcp/registrations/molecular-workspace/register.mjs",
  "plugins/burette-agent/mcp/registrations/molecule-table/register.mjs",
  "plugins/burette-agent/mcp/registrations/trajectory-review/register.mjs",
  "plugins/burette-agent/mcp/registrations/molecular-report/register.mjs",
  "plugins/burette-agent/scripts/burette_agent_preflight.mjs",
  "plugins/burette-agent/scripts/validate_molecular_artifact.mjs",
];

for (const target of syntaxTargets) {
  const checked = runNode(["--check", target]);
  assert.equal(checked.status, 0, `${target}\n${checked.stderr}`);
}

console.log("burette-agent plugin tests passed");
