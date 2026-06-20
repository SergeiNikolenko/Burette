#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const sourcePluginRoot = path.resolve("plugins/burette-agent");
const sampleMini = path.resolve("samples/mini.pdb");

function moduleUrl(...parts) {
  return pathToFileURL(path.join(...parts)).href;
}

function createFakeServer() {
  return {
    tools: new Map(),
    resources: new Map(),
  };
}

async function installMcpStubs(pluginRoot) {
  const extAppsRoot = path.join(pluginRoot, "node_modules", "@modelcontextprotocol", "ext-apps");
  const zodRoot = path.join(pluginRoot, "node_modules", "zod");
  await mkdir(extAppsRoot, { recursive: true });
  await mkdir(zodRoot, { recursive: true });
  await writeFile(
    path.join(extAppsRoot, "package.json"),
    JSON.stringify({ type: "module", exports: { "./server": "./server.js" } }, null, 2),
  );
  await writeFile(
    path.join(extAppsRoot, "server.js"),
    [
      'export const RESOURCE_MIME_TYPE = "text/html+skybridge";',
      "export function registerAppTool(server, name, config, handler) {",
      "  server.tools.set(name, { name, config, handler });",
      "}",
      "export function registerAppResource(server, name, uri, config, handler) {",
      "  server.resources.set(uri, { name, uri, config, handler });",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(zodRoot, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }, null, 2),
  );
  await writeFile(
    path.join(zodRoot, "index.js"),
    [
      "const schema = {};",
      "for (const name of ['trim', 'min', 'max', 'default', 'optional', 'int', 'passthrough', 'url']) schema[name] = () => schema;",
      "export const z = {",
      "  string: () => schema,",
      "  number: () => schema,",
      "  boolean: () => schema,",
      "  unknown: () => schema,",
      "  enum: () => schema,",
      "  array: () => schema,",
      "  record: () => schema,",
      "  object: () => schema,",
      "  union: () => schema,",
      "};",
      "",
    ].join("\n"),
  );
}

async function registerAll(pluginRoot) {
  await installMcpStubs(pluginRoot);
  const server = createFakeServer();
  const { registerFetch } = await import(moduleUrl(pluginRoot, "mcp", "registrations", "fetch", "register.mjs"));
  const { registerMolecularWorkspace } = await import(moduleUrl(pluginRoot, "mcp", "registrations", "molecular-workspace", "register.mjs"));
  const { registerMoleculeTable } = await import(moduleUrl(pluginRoot, "mcp", "registrations", "molecule-table", "register.mjs"));
  const { registerTrajectoryReview } = await import(moduleUrl(pluginRoot, "mcp", "registrations", "trajectory-review", "register.mjs"));
  const { registerMolecularReport } = await import(moduleUrl(pluginRoot, "mcp", "registrations", "molecular-report", "register.mjs"));
  registerFetch(server);
  registerMolecularWorkspace(server);
  registerMoleculeTable(server);
  registerTrajectoryReview(server);
  registerMolecularReport(server);
  return server;
}

async function copyPlugin(tempRoot, name) {
  const pluginRoot = path.join(tempRoot, name);
  await cp(sourcePluginRoot, pluginRoot, { recursive: true });
  return pluginRoot;
}

async function testMcpRegistrations(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "registration-plugin");
  const server = await registerAll(pluginRoot);
  assert.deepEqual([...server.resources.keys()].sort(), [
    "ui://widget/burette-agent/molecular-report-20260607.html",
    "ui://widget/burette-agent/molecular-workspace-20260607.html",
    "ui://widget/burette-agent/molecule-table-20260607.html",
    "ui://widget/burette-agent/trajectory-review-20260607.html",
  ]);
  assert.deepEqual([...server.tools.keys()].sort(), [
    "act_molstar_scene",
    "fetch",
    "manage_burrete_structure_component",
    "manage_burrete_tabs",
    "observe_burrete_workspace",
    "open_burrete_docking_view",
    "open_burrete_workspace",
    "render_molecular_report_widget",
    "render_molecular_workspace_widget",
    "render_molecule_table_widget",
    "render_trajectory_review_widget",
    "summarize_burrete_structure",
    "validate_molecular_report_artifact",
    "validate_molecule_collection_artifact",
    "validate_trajectory_review_artifact",
  ]);

  for (const [uri, resource] of server.resources) {
    const payload = await resource.handler();
    assert.equal(payload.contents[0].uri, uri);
    assert.equal(payload.contents[0].mimeType, "text/html+skybridge");
    assert.match(payload.contents[0].text, /<!doctype html>/i);
  }
  const workspaceResource = await server.resources.get("ui://widget/burette-agent/molecular-workspace-20260607.html").handler();
  assert.match(workspaceResource.contents[0].text, /__BURETTE_AGENT_PLUGIN_VERSION__/);
}

async function testValidationAndRenderHandlers(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "validation-plugin");
  const server = await registerAll(pluginRoot);
  const manifest = {
    version: 1,
    surface: "molecular-report",
    title: "Ligand Review",
    blocks: [
      { type: "markdown", body: "# Ligand Review\n\nReviewed ligands." },
    ],
  };
  const snapshot = {
    version: 1,
    status: "ready",
    datasets: {
      ligands: [
        { id: "L1", smiles: "CCO", score: -7.2 },
      ],
    },
  };

  const validReport = await server.tools.get("validate_molecular_report_artifact").handler({ manifest, snapshot });
  assert.equal(validReport.structuredContent.ok, true);
  assert.equal(validReport.structuredContent.summary.datasetCount, 1);

  const renderedReport = await server.tools.get("render_molecular_report_widget").handler({ manifest, snapshot });
  assert.equal(renderedReport.structuredContent.widget, "molecular-report");
  assert.equal(renderedReport.structuredContent.title, "Ligand Review");
  assert.equal(renderedReport._meta["openai/outputTemplate"], "ui://widget/burette-agent/molecular-report-20260607.html");

  const blockedReport = await server.tools.get("render_molecular_report_widget").handler({
    manifest: { ...manifest, blocks: [] },
    snapshot,
  });
  assert.equal(blockedReport.structuredContent.ok, false);
  assert.match(blockedReport.content[0].text, /render blocked/);

  const renderedTable = await server.tools.get("render_molecule_table_widget").handler({
    title: "Docked Molecules",
    datasetId: "poses",
    rows: [{ id: "pose-1" }, { id: "pose-2" }],
  });
  assert.equal(renderedTable.structuredContent.widget, "molecule-table");
  assert.equal(renderedTable.structuredContent.rowCount, 2);

  const renderedTrajectory = await server.tools.get("render_trajectory_review_widget").handler({
    metrics: [{ name: "rmsd", value: 1.2 }],
    artifacts: [{ kind: "frame", path: "/tmp/frame.pdb" }],
  });
  assert.equal(renderedTrajectory.structuredContent.widget, "trajectory-review");
  assert.equal(renderedTrajectory.structuredContent.metricCount, 1);
  assert.equal(renderedTrajectory.structuredContent.artifactCount, 1);
}

async function testFetchAndWorkspaceHandlers(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "workspace-plugin");
  const server = await registerAll(pluginRoot);
  let processId = null;
  try {
    const blockedFetch = await server.tools.get("fetch").handler({ url: "http://127.0.0.1:9" });
    assert.equal(blockedFetch.structuredContent.ok, false);
    assert.match(blockedFetch.structuredContent.error.message, /Local, private, and link-local hosts are blocked/);

    const summary = await server.tools.get("summarize_burrete_structure").handler({ file: sampleMini });
    assert.equal(summary.structuredContent.ok, true);
    assert.equal(summary.structuredContent.summary.format, "PDB");
    assert.equal(summary.structuredContent.summary.counts.atoms, 9);

    const opened = await server.tools.get("open_burrete_workspace").handler({
      file: sampleMini,
      mode: "browser-preview",
      noLaunch: true,
    });
    processId = opened.structuredContent.result.processId;
    assert.equal(opened.structuredContent.ok, true);
    assert.equal(opened.structuredContent.result.mode, "browser-preview");
    assert.match(opened.structuredContent.result.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(opened.structuredContent.structureSummary.counts.atoms, 9);

    const observed = await server.tools.get("observe_burrete_workspace").handler({
      url: opened.structuredContent.result.url,
    });
    assert.equal(observed.structuredContent.ok, true);
    assert.equal(observed.structuredContent.observe.activeDocument.path, sampleMini);

    const tabs = await server.tools.get("manage_burrete_tabs").handler({
      operation: "list",
      url: opened.structuredContent.result.url,
    });
    assert.equal(tabs.structuredContent.ok, true);
    assert.equal(Array.isArray(tabs.structuredContent.tabs), true);

    const action = await server.tools.get("act_molstar_scene").handler({
      url: opened.structuredContent.result.url,
      action: { type: "reset_camera", label: "Reset camera" },
    });
    assert.equal(action.structuredContent.ok, true);
    assert.equal(action.structuredContent.result.action.type, "reset_camera");
  } finally {
    if (processId) {
      try {
        process.kill(processId, "SIGTERM");
      } catch {
        // The smoke server may already have exited.
      }
    }
  }
}

async function testCliBridgeErrors(tempRoot) {
  const failureRoot = await copyPlugin(tempRoot, "failure-plugin");
  await writeFile(
    path.join(failureRoot, "scripts", "burrete-agent.mjs"),
    [
      "#!/usr/bin/env node",
      'console.error(JSON.stringify({ ok: false, error: { code: "TEST_FAILURE", message: "synthetic failure" } }));',
      "process.exit(7);",
      "",
    ].join("\n"),
  );
  const failureBridge = await import(moduleUrl(failureRoot, "mcp", "lib", "cli-bridge.mjs"));
  const failure = await failureBridge.runBurreteAgent(["open", "--mode", "browser-preview", sampleMini]);
  assert.equal(failure.ok, false);
  assert.equal(failure.exitCode, 7);
  assert.equal(failure.error.code, "TEST_FAILURE");
  assert.equal(failure.error.message, "synthetic failure");

  const timeoutRoot = await copyPlugin(tempRoot, "timeout-plugin");
  await writeFile(
    path.join(timeoutRoot, "scripts", "burrete-agent.mjs"),
    [
      "#!/usr/bin/env node",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  const timeoutBridge = await import(moduleUrl(timeoutRoot, "mcp", "lib", "cli-bridge.mjs"));
  const timeout = await timeoutBridge.runBurreteAgent(["observe"], { timeoutMs: 25 });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.exitCode, 124);
  assert.equal(timeout.signal, "TIMEOUT");
  assert.equal(timeout.error.code, "CLI_FAILED");
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "burrete-agent-mcp-test-"));
try {
  assert.match(await readFile(path.join(sourcePluginRoot, ".codex-plugin", "plugin.json"), "utf8"), /"name": "burrete"/);
  await testMcpRegistrations(tempRoot);
  await testValidationAndRenderHandlers(tempRoot);
  await testFetchAndWorkspaceHandlers(tempRoot);
  await testCliBridgeErrors(tempRoot);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("burette-agent MCP tests passed");
