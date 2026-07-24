#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const sourcePluginRoot = path.resolve("plugins/burette-agent");
const sampleMini = path.resolve("samples/mini.pdb");
const sample1htb = path.resolve("samples/structures/proteins/1htb.pdb");

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

async function installMockAgentCli(pluginRoot) {
  await writeFile(
    path.join(pluginRoot, "scripts", "burette-agent.mjs"),
    [
      "#!/usr/bin/env node",
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      `const activeFile = ${JSON.stringify(sampleMini)};`,
      "const activePathState = new URL('./mock-active-path.txt', import.meta.url);",
      "const apiVersion = 'burette-agent-cli/v1';",
      "const [command, ...args] = process.argv.slice(2);",
      "function parseArgs(values) {",
      "  const options = {};",
      "  const rest = [];",
      "  for (let index = 0; index < values.length; index += 1) {",
      "    const value = values[index];",
      "    if (value.startsWith('--')) {",
      "      const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());",
      "      if (key === 'noLaunch') {",
      "        options[key] = true;",
      "        continue;",
      "      }",
      "      const next = values[index + 1];",
      "      if (!next || next.startsWith('--')) {",
      "        options[key] = true;",
      "      } else {",
      "        options[key] = next;",
      "        index += 1;",
      "      }",
      "    } else {",
      "      rest.push(value);",
      "    }",
      "  }",
      "  return { options, rest };",
      "}",
      "function ok(result) {",
      "  console.log(JSON.stringify({ ok: true, apiVersion, result }, null, 2));",
      "}",
      "const parsed = parseArgs(args);",
      "if (command === 'open') {",
      "  const simulatedNotReady = String(parsed.options.sessionDir || '').includes('not-ready');",
      "  const simulatedObserveUnavailable = String(parsed.options.sessionDir || '').includes('observe-unavailable');",
      "  ok({",
      "    mode: parsed.options.mode || 'browser-preview',",
      "    url: simulatedNotReady ? 'http://127.0.0.1:49000/index.html?not-ready=1' : simulatedObserveUnavailable ? 'http://127.0.0.1:49000/index.html?observe-unavailable=1' : 'http://127.0.0.1:49000/index.html?token=mock-token',",
      "    sessionDir: parsed.options.sessionDir || '/tmp/burette-mock-session',",
      "    launched: !parsed.options.noLaunch,",
      "    initialPaths: parsed.rest,",
      "    argv: args,",
      "  });",
      "} else if (command === 'observe') {",
      "  const locator = String(parsed.options.url || parsed.options.sessionDir || '');",
      "  if (locator.includes('observe-unavailable')) {",
      "    console.error(JSON.stringify({ ok: false, error: { code: 'OBSERVE_UNAVAILABLE', message: 'Workspace has not reported observe state yet.' } }));",
      "    process.exit(1);",
      "  }",
      "  const observedFile = existsSync(activePathState) ? readFileSync(activePathState, 'utf8') : activeFile;",
      "  const ready = !locator.includes('not-ready') && !observedFile.includes('mock-observe-not-ready');",
      "  const itemCount = locator.includes('large-observe') ? 75 : 1;",
      "  let stress = null;",
      "  if (locator.includes('deep-observe')) {",
      "    stress = {};",
      "    let cursor = stress;",
      "    for (let depth = 0; depth < 3; depth += 1) {",
      "      cursor.items = Array.from({ length: 100 }, (_, index) => ({ index, message: 'x'.repeat(10000) }));",
      "      cursor.next = {};",
      "      cursor = cursor.next;",
      "    }",
      "  }",
      "  ok({",
      "    mode: 'browser-agent-shell',",
      "    activeTabId: 'tab-structure',",
      "    tabs: Array.from({ length: itemCount }, (_, index) => ({ id: `tab-${index}`, title: `structure-${index}.pdb`, path: index === 0 ? observedFile : `/tmp/structure-${index}.pdb` })),",
      "    documents: Array.from({ length: itemCount }, (_, index) => ({ id: `document-${index}`, title: `structure-${index}.pdb`, path: index === 0 ? observedFile : `/tmp/structure-${index}.pdb` })),",
      "    activeDocument: { title: observedFile.split('/').at(-1), path: observedFile, renderer: 'molstar', ready },",
      "    viewerAgent: { available: ready, ready, viewerReady: ready },",
      "    viewer: { ready, representationCount: ready ? 2 : 0 },",
      "    scene: { known: ready, ligands: Array.from({ length: itemCount }, (_, index) => ({ id: `L${index}` })) },",
      "    actions: { recent: Array.from({ length: itemCount }, (_, index) => ({ id: `action-${index}`, status: 'completed' })) },",
      "    stress,",
      "    argv: args,",
      "  });",
      "} else if (command === 'act') {",
      "  const actionText = parsed.rest[0] || '{}';",
      "  const action = JSON.parse(actionText);",
      "  if (action.type === 'open_files' && action.paths?.some(path => path.includes('mock-open-failure'))) {",
      "    console.error(JSON.stringify({ ok: false, error: { code: 'ACT_FAILED', message: 'synthetic open failure' } }));",
      "    process.exit(1);",
      "}",
      "  if (action.type === 'open_files' && action.paths?.[0]) writeFileSync(activePathState, action.paths[0]);",
      "  ok({ ok: true, action: { id: 'act-mock', type: action.type, status: 'queued', payload: action }, argv: args });",
      "} else {",
      "  console.error(JSON.stringify({ ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command}` } }));",
      "  process.exit(2);",
      "}",
      "",
    ].join("\n"),
  );
}

async function testMcpRegistrations(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "registration-plugin");
  const server = await registerAll(pluginRoot);
  assert.deepEqual([...server.resources.keys()].sort(), []);
  assert.deepEqual([...server.tools.keys()].sort(), [
    "act_molstar_scene",
    "burette.control_ketcher",
    "burette.control_viewer",
    "burette.get_context",
    "burette.observe_workspace",
    "burette.open_ketcher",
    "burette.open_workspace",
    "burette.render_panel",
    "edit_burette_fragment",
    "fetch",
    "focus_burette_selection",
    "manage_burette_structure_component",
    "manage_burette_tabs",
    "observe_burette_workspace",
    "open_burette_docking_view",
    "open_burette_workspace",
    "set_burette_representation_style",
    "set_burette_trajectory",
    "summarize_burette_structure",
    "validate_molecular_report_artifact",
    "validate_molecule_collection_artifact",
    "validate_trajectory_review_artifact",
  ]);
}

async function testValidationHandlers(tempRoot) {
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

  const validTable = await server.tools.get("validate_molecule_collection_artifact").handler({
    manifest: { ...manifest, surface: "molecule-table" },
    snapshot,
  });
  assert.equal(validTable.structuredContent.ok, true);

  const validTrajectory = await server.tools.get("validate_trajectory_review_artifact").handler({
    manifest: { ...manifest, surface: "trajectory-review" },
    snapshot,
  });
  assert.equal(validTrajectory.structuredContent.ok, true);
}

async function testFetchAndWorkspaceHandlers(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "workspace-plugin");
  const server = await registerAll(pluginRoot);
  const processIds = [];
  try {
    const blockedFetch = await server.tools.get("fetch").handler({ url: "http://127.0.0.1:9" });
    assert.equal(blockedFetch.structuredContent.ok, false);
    assert.match(blockedFetch.structuredContent.error.message, /Local, private, and link-local hosts are blocked/);

    const summary = await server.tools.get("summarize_burette_structure").handler({ file: sampleMini });
    assert.equal(summary.structuredContent.ok, true);
    assert.equal(summary.structuredContent.summary.format, "PDB");
    assert.equal(summary.structuredContent.summary.counts.atoms, 9);

    const ligandHeavyFile = path.join(tempRoot, "ligand-heavy.pdb");
    const ligandLines = Array.from({ length: 75 }, (_, index) => {
      const serial = String(index + 1).padStart(5, " ");
      const residue = String(index + 1).padStart(4, " ");
      return `HETATM${serial}  C1  LIG A${residue}       0.000   0.000   0.000  1.00 10.00           C`;
    });
    await writeFile(ligandHeavyFile, `${ligandLines.join("\n")}\nEND\n`);
    const ligandHeavySummary = await server.tools.get("summarize_burette_structure").handler({ file: ligandHeavyFile });
    assert.equal(ligandHeavySummary.structuredContent.ok, true);
    assert.equal(ligandHeavySummary.structuredContent.summary.components.ligands.length, 50);
    assert.deepEqual(ligandHeavySummary.structuredContent.summary.bounds["components.ligands"], {
      total: 75,
      returned: 50,
      truncated: true,
    });
    assert.equal(JSON.stringify(ligandHeavySummary.structuredContent.summary).length <= 256 * 1024, true);

    const opened = await server.tools.get("open_burette_workspace").handler({
      file: sampleMini,
      mode: "browser-preview",
      noLaunch: true,
    });
    processIds.push(opened.structuredContent.result.processId);
    assert.equal(opened.structuredContent.ok, true);
    assert.equal(opened.isError, undefined);
    assert.equal(opened.structuredContent.started, true);
    assert.equal(opened.structuredContent.ready, false);
    assert.equal(opened.structuredContent.completionState, "awaiting_browser");
    assert.equal(opened.structuredContent.error, null);
    assert.equal(opened.structuredContent.result.mode, "browser-preview");
    assert.match(opened.structuredContent.result.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(opened.structuredContent.structureSummary.counts.atoms, 9);

    const unopenedAgentShell = await server.tools.get("open_burette_workspace").handler({
      file: sampleMini,
      mode: "browser-agent-shell",
      noLaunch: true,
    });
    processIds.push(unopenedAgentShell.structuredContent.result.processId);
    assert.equal(unopenedAgentShell.structuredContent.ok, true);
    assert.equal(unopenedAgentShell.isError, undefined);
    assert.equal(unopenedAgentShell.structuredContent.started, true);
    assert.equal(unopenedAgentShell.structuredContent.ready, false);
    assert.equal(unopenedAgentShell.structuredContent.completionState, "awaiting_browser");
    assert.equal(unopenedAgentShell.structuredContent.error, null);

    const observed = await server.tools.get("observe_burette_workspace").handler({
      url: opened.structuredContent.result.url,
    });
    assert.equal(observed.structuredContent.ok, false);
    assert.equal(observed.isError, true);
    assert.equal(observed.structuredContent.ready, false);
    assert.equal(observed.structuredContent.completionState, "not_ready");
    assert.equal(observed.structuredContent.observe.activeDocument.path, sampleMini);

    const tabs = await server.tools.get("manage_burette_tabs").handler({
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
    for (const processId of processIds) {
      try {
        process.kill(processId, "SIGTERM");
      } catch {
        // The smoke server may already have exited.
      }
    }
  }
}

async function testMockedWorkspaceToolScenarios(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "mocked-workspace-plugin");
  await installMockAgentCli(pluginRoot);
  const server = await registerAll(pluginRoot);
  const coveredTools = new Set();

  const opened = await server.tools.get("open_burette_workspace").handler({
    file: sampleMini,
    mode: "browser-preview",
    noLaunch: true,
  });
  coveredTools.add("open_burette_workspace");
  assert.equal(opened.structuredContent.ok, true);
  assert.equal(opened.structuredContent.result.mode, "browser-preview");
  assert.deepEqual(opened.structuredContent.result.initialPaths, [sampleMini]);
  assert.equal(opened.structuredContent.result.launched, false);

  const notReady = await server.tools.get("open_burette_workspace").handler({
    file: sampleMini,
    mode: "browser-agent-shell",
    sessionDir: "/tmp/burette-not-ready",
    noLaunch: true,
  });
  assert.equal(notReady.structuredContent.ok, true);
  assert.equal(notReady.isError, undefined);
  assert.equal(notReady.structuredContent.started, true);
  assert.equal(notReady.structuredContent.ready, false);
  assert.equal(notReady.structuredContent.completionState, "awaiting_browser");
  assert.equal(notReady.structuredContent.error, null);

  const publicNotReady = await server.tools.get("burette.open_workspace").handler({
    file: sampleMini,
    mode: "browser-agent-shell",
    sessionDir: "/tmp/burette-not-ready-public",
    noLaunch: true,
  });
  assert.equal(publicNotReady.structuredContent.ok, true);
  assert.equal(publicNotReady.isError, undefined);
  assert.equal(publicNotReady.structuredContent.started, true);
  assert.equal(publicNotReady.structuredContent.ready, false);
  assert.equal(publicNotReady.structuredContent.completionState, "awaiting_browser");
  assert.equal(publicNotReady.structuredContent.error, null);

  const publicAwaitingObserve = await server.tools.get("burette.open_workspace").handler({
    file: sampleMini,
    mode: "browser-agent-shell",
    sessionDir: "/tmp/burette-observe-unavailable-public",
    noLaunch: true,
  });
  assert.equal(publicAwaitingObserve.structuredContent.ok, true);
  assert.equal(publicAwaitingObserve.isError, undefined);
  assert.equal(publicAwaitingObserve.structuredContent.ready, false);
  assert.equal(publicAwaitingObserve.structuredContent.completionState, "awaiting_browser");
  assert.equal(publicAwaitingObserve.structuredContent.error, null);

  const publicStillNotReady = await server.tools.get("burette.observe_workspace").handler({
    workspaceSessionId: publicNotReady.structuredContent.workspaceSessionId,
  });
  assert.equal(publicStillNotReady.structuredContent.ok, false);
  assert.equal(publicStillNotReady.isError, true);
  assert.equal(publicStillNotReady.structuredContent.ready, false);
  assert.equal(publicStillNotReady.structuredContent.completionState, "not_ready");
  assert.equal(publicStillNotReady.structuredContent.error.code, "VIEWER_NOT_READY");

  const publicContext = await server.tools.get("burette.get_context").handler({});
  coveredTools.add("burette.get_context");
  assert.equal(publicContext.structuredContent.ok, true);
  assert.equal(publicContext.structuredContent.apiVersion, "burette-external-agent/v1");
  assert.equal(publicContext.structuredContent.capabilities.canOpenWorkspace, true);

  const publicOpened = await server.tools.get("burette.open_workspace").handler({
    file: sampleMini,
    mode: "browser-preview",
    noLaunch: true,
  });
  coveredTools.add("burette.open_workspace");
  assert.equal(publicOpened.structuredContent.ok, true);
  assert.match(publicOpened.structuredContent.workspaceSessionId, /^bws_/);
  assert.equal(publicOpened.structuredContent.viewerSessionId, publicOpened.structuredContent.workspaceSessionId);
  assert.equal(publicOpened.structuredContent.modelContext.activeDocument.path, sampleMini);
  assert.equal(publicOpened.structuredContent.modelContext.structureSummary.counts.atoms, 9);

  const publicKetcherOpened = await server.tools.get("burette.open_ketcher").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
  });
  coveredTools.add("burette.open_ketcher");
  assert.equal(publicKetcherOpened.structuredContent.ok, true);
  assert.equal(publicKetcherOpened.structuredContent.applied, true);
  assert.equal(publicKetcherOpened.structuredContent.action.type, "open_ketcher");

  const publicKetcherAction = await server.tools.get("burette.control_ketcher").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
    action: {
      apiVersion: "burette-ketcher-agent/v1",
      type: "control_ketcher",
      command: "clear_structure",
      surfaceId: "desktop-ketcher:mock",
      expectedRevision: 0,
    },
  });
  coveredTools.add("burette.control_ketcher");
  assert.equal(publicKetcherAction.structuredContent.ok, true);
  assert.equal(publicKetcherAction.structuredContent.applied, true);
  assert.equal(publicKetcherAction.structuredContent.action.command, "clear_structure");

  const publicObserved = await server.tools.get("burette.observe_workspace").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
  });
  coveredTools.add("burette.observe_workspace");
  assert.equal(publicObserved.structuredContent.ok, true);
  assert.equal(publicObserved.structuredContent.modelContext.activeDocument.path, sampleMini);

  const publicAction = await server.tools.get("burette.control_viewer").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
    action: { type: "reset_camera", label: "Reset camera" },
  });
  coveredTools.add("burette.control_viewer");
  assert.equal(publicAction.structuredContent.ok, true);
  assert.equal(publicAction.structuredContent.result.action.payload.type, "reset_camera");
  assert.equal(publicAction.structuredContent.applied, true);

  const publicPanel = await server.tools.get("burette.render_panel").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
    kind: "markdown",
    file: "/tmp/burette-panel.md",
    area: "right",
  });
  coveredTools.add("burette.render_panel");
  assert.equal(publicPanel.structuredContent.ok, true);
  assert.equal(publicPanel.structuredContent.result.action.payload.type, "render_panel");
  assert.equal(publicPanel.structuredContent.result.action.payload.kind, "markdown");

  const observed = await server.tools.get("observe_burette_workspace").handler({
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("observe_burette_workspace");
  assert.equal(observed.structuredContent.ok, true);
  assert.equal(observed.structuredContent.observe.activeDocument.path, sampleMini);
  assert.equal(observed._meta, undefined);

  const largeObserved = await server.tools.get("observe_burette_workspace").handler({
    url: "http://127.0.0.1:49000/index.html?large-observe=1",
  });
  assert.equal(largeObserved.structuredContent.ok, true);
  assert.equal(largeObserved.structuredContent.result, null);
  assert.equal(largeObserved.structuredContent.observe.documents.length, 50);
  assert.equal(largeObserved.structuredContent.observe.tabs.length, 50);
  assert.equal(largeObserved.structuredContent.observe.scene.ligands.length, 50);
  assert.equal(largeObserved.structuredContent.observe.actions.recent.length, 50);
  assert.deepEqual(largeObserved.structuredContent.observe.bounds.documents, {
    total: 75,
    returned: 50,
    truncated: true,
  });

  const publicLargeObserved = await server.tools.get("burette.observe_workspace").handler({
    url: "http://127.0.0.1:49000/index.html?large-observe=1",
  });
  assert.equal(publicLargeObserved.structuredContent.ok, true);
  assert.equal(publicLargeObserved.structuredContent.result, null);
  assert.equal(publicLargeObserved.structuredContent.observe.documents.length, 50);
  assert.equal(publicLargeObserved.structuredContent.modelContext.tabs.length, 50);

  const stressObserved = await server.tools.get("observe_burette_workspace").handler({
    url: "http://127.0.0.1:49000/index.html?large-observe=1&deep-observe=1",
  });
  const stressObserveJson = JSON.stringify(stressObserved.structuredContent.observe);
  assert.equal(stressObserveJson.length <= 256 * 1024, true, stressObserveJson.length);
  assert.equal(Object.keys(stressObserved.structuredContent.observe.bounds).length <= 100, true);

  const summarizedFromWorkspace = await server.tools.get("summarize_burette_structure").handler({
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("summarize_burette_structure");
  assert.equal(summarizedFromWorkspace.structuredContent.ok, true);
  assert.equal(summarizedFromWorkspace.structuredContent.summary.counts.atoms, 9);
  assert.equal(summarizedFromWorkspace.structuredContent.observe.activeDocument.path, sampleMini);

  const listedTabs = await server.tools.get("manage_burette_tabs").handler({
    operation: "list",
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("manage_burette_tabs");
  assert.equal(listedTabs.structuredContent.ok, true);
  assert.equal(listedTabs.structuredContent.activeTabId, "tab-structure");
  assert.equal(listedTabs.structuredContent.tabs[0].path, sampleMini);

  const focusedTab = await server.tools.get("manage_burette_tabs").handler({
    operation: "focus",
    url: opened.structuredContent.result.url,
    tabId: "tab-structure",
  });
  assert.equal(focusedTab.structuredContent.ok, true);
  assert.equal(focusedTab.structuredContent.result.action.type, "manage_tabs");
  assert.equal(focusedTab.structuredContent.result.action.payload.operation, "focus");
  assert.equal(focusedTab.structuredContent.result.action.payload.tabId, "tab-structure");

  const clearedSelection = await server.tools.get("manage_burette_structure_component").handler({
    operation: "clear",
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("manage_burette_structure_component");
  assert.equal(clearedSelection.structuredContent.ok, true);
  assert.equal(clearedSelection.structuredContent.result.action.payload.type, "clear_selection");

  const selectedChain = await server.tools.get("manage_burette_structure_component").handler({
    operation: "select",
    file: sampleMini,
    url: opened.structuredContent.result.url,
    chain: "A",
  });
  assert.equal(selectedChain.structuredContent.ok, true);
  assert.equal(selectedChain.structuredContent.selector.auth_asym_id, "A");
  assert.equal(selectedChain.structuredContent.result.action.payload.type, "select_residues");

  const hidWater = await server.tools.get("manage_burette_structure_component").handler({
    operation: "hide",
    file: sampleMini,
    url: opened.structuredContent.result.url,
    component: "water",
  });
  assert.equal(hidWater.structuredContent.ok, true);
  assert.equal(hidWater.structuredContent.result.action.payload.type, "hide_waters");

  const openedLigandTab = await server.tools.get("manage_burette_structure_component").handler({
    operation: "open_as_tab",
    file: sample1htb,
    url: opened.structuredContent.result.url,
    component: "ligand",
    chain: "A",
    compId: "NAD",
    seq: 377,
    title: "mock-nad-a-377",
  });
  assert.equal(openedLigandTab.structuredContent.ok, true);
  assert.equal(openedLigandTab.structuredContent.extracted.atomCount, 44);
  assert.equal(openedLigandTab.structuredContent.result.action.payload.type, "open_files");
  assert.deepEqual(openedLigandTab.structuredContent.result.action.payload.paths, [
    openedLigandTab.structuredContent.extracted.outputPath,
  ]);
  await rm(openedLigandTab.structuredContent.extracted.outputPath, { force: true });

  const notReadyLigandTab = await server.tools.get("manage_burette_structure_component").handler({
    operation: "open_as_tab",
    file: sample1htb,
    url: opened.structuredContent.result.url,
    component: "ligand",
    chain: "A",
    compId: "NAD",
    seq: 377,
    title: "mock-observe-not-ready-component",
    waitMs: 25,
  });
  assert.equal(notReadyLigandTab.structuredContent.ok, false);
  assert.equal(notReadyLigandTab.isError, true);
  assert.equal(notReadyLigandTab.structuredContent.ready, false);
  assert.equal(notReadyLigandTab.structuredContent.error.code, "WORKSPACE_DOCUMENT_NOT_READY");
  await rm(notReadyLigandTab.structuredContent.extracted.outputPath, { force: true });

  const dockingView = await server.tools.get("open_burette_docking_view").handler({
    receptorPath: sampleMini,
    ligandPaths: [sample1htb],
    url: opened.structuredContent.result.url,
    activePose: 0,
    sceneMode: "structurePoses",
  });
  coveredTools.add("open_burette_docking_view");
  assert.equal(dockingView.structuredContent.ok, true);
  assert.equal(dockingView.structuredContent.result.action.payload.type, "open_docking_view");
  assert.deepEqual(dockingView.structuredContent.result.action.payload.ligandPaths, [sample1htb]);

  const sceneAction = await server.tools.get("act_molstar_scene").handler({
    url: opened.structuredContent.result.url,
    action: { type: "focus_ligand", selector: { compId: "NAD", chain: "A" }, radiusA: 4 },
  });
  coveredTools.add("act_molstar_scene");
  assert.equal(sceneAction.structuredContent.ok, true);
  assert.equal(sceneAction.structuredContent.result.action.payload.type, "focus_ligand");
  assert.equal(sceneAction.structuredContent.result.action.payload.selector.compId, "NAD");

  const trajectory = await server.tools.get("set_burette_trajectory").handler({
    url: opened.structuredContent.result.url,
    index: 3,
    mode: "sdf-pose",
    poseMode: "single",
  });
  coveredTools.add("set_burette_trajectory");
  assert.equal(trajectory.structuredContent.ok, true);
  assert.equal(trajectory.structuredContent.actionType, "set_sdf_pose_index");
  assert.equal(trajectory.structuredContent.result.action.payload.type, "set_sdf_pose_index");
  assert.equal(trajectory.structuredContent.result.action.payload.index, 3);
  assert.equal(trajectory.structuredContent.results[0].action.payload.type, "set_sdf_pose_mode");

  const style = await server.tools.get("set_burette_representation_style").handler({
    url: opened.structuredContent.result.url,
    style: "ball-and-stick",
  });
  coveredTools.add("set_burette_representation_style");
  assert.equal(style.structuredContent.ok, true);
  assert.equal(style.structuredContent.result.action.payload.type, "set_molstar_style");
  assert.equal(style.structuredContent.result.action.payload.style, "ball-and-stick");

  const focusedSelection = await server.tools.get("focus_burette_selection").handler({
    operation: "focus",
    url: opened.structuredContent.result.url,
    selector: { auth_asym_id: "A", beg_auth_seq_id: 1, end_auth_seq_id: 3 },
    durationMs: 250,
    extraRadius: 2,
  });
  coveredTools.add("focus_burette_selection");
  assert.equal(focusedSelection.structuredContent.ok, true);
  assert.equal(focusedSelection.structuredContent.action.type, "focus_selection");
  assert.equal(focusedSelection.structuredContent.action.args.selector.auth_asym_id, "A");

  const highlightedSelection = await server.tools.get("focus_burette_selection").handler({
    operation: "highlight",
    url: opened.structuredContent.result.url,
    selector: { kind: "polymer" },
    label: "Protein",
    color: "#4f8cff",
  });
  assert.equal(highlightedSelection.structuredContent.ok, true);
  assert.equal(highlightedSelection.structuredContent.action.type, "apply_scene");
  assert.equal(highlightedSelection.structuredContent.action.components[0].selector.kind, "polymer");

  const editedFragment = await server.tools.get("edit_burette_fragment").handler({
    operation: "remove_to_new_file",
    file: sample1htb,
    component: "ligand",
    chain: "A",
    compId: "NAD",
    seq: 377,
    title: "mock-1htb-without-nad",
    openAsTab: true,
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("edit_burette_fragment");
  assert.equal(editedFragment.structuredContent.ok, true);
  assert.equal(editedFragment.structuredContent.edited.operation, "remove_to_new_file");
  assert.equal(editedFragment.structuredContent.edited.removedAtomCount, 44);
  assert.equal(editedFragment.structuredContent.edited.insertedAtomCount, 0);
  assert.equal(editedFragment.structuredContent.opened.action.payload.type, "open_files");
  assert.deepEqual(editedFragment.structuredContent.opened.action.payload.paths, [
    editedFragment.structuredContent.edited.outputPath,
  ]);
  await rm(editedFragment.structuredContent.edited.outputPath, { force: true });

  const failedOpenFragment = await server.tools.get("edit_burette_fragment").handler({
    operation: "remove_to_new_file",
    file: sample1htb,
    component: "water",
    title: "mock-open-failure",
    openAsTab: true,
    url: opened.structuredContent.result.url,
  });
  assert.equal(failedOpenFragment.structuredContent.ok, false);
  assert.equal(failedOpenFragment.isError, true);
  assert.equal(failedOpenFragment.structuredContent.edited.removedAtomCount, 142);
  assert.equal(failedOpenFragment.structuredContent.error.code, "ACT_FAILED");
  await rm(failedOpenFragment.structuredContent.edited.outputPath, { force: true });

  const notReadyFragment = await server.tools.get("edit_burette_fragment").handler({
    operation: "remove_to_new_file",
    file: sample1htb,
    component: "water",
    title: "mock-observe-not-ready",
    openAsTab: true,
    url: opened.structuredContent.result.url,
    waitMs: 25,
  });
  assert.equal(notReadyFragment.structuredContent.ok, false);
  assert.equal(notReadyFragment.isError, true);
  assert.equal(notReadyFragment.structuredContent.ready, false);
  assert.equal(notReadyFragment.structuredContent.completionState, "not_ready");
  assert.equal(notReadyFragment.structuredContent.observe.activeDocument.path, notReadyFragment.structuredContent.edited.outputPath);
  assert.equal(notReadyFragment.structuredContent.error.code, "WORKSPACE_DOCUMENT_NOT_READY");
  await rm(notReadyFragment.structuredContent.edited.outputPath, { force: true });

  assert.deepEqual([...coveredTools].sort(), [
    "act_molstar_scene",
    "burette.control_ketcher",
    "burette.control_viewer",
    "burette.get_context",
    "burette.observe_workspace",
    "burette.open_ketcher",
    "burette.open_workspace",
    "burette.render_panel",
    "edit_burette_fragment",
    "focus_burette_selection",
    "manage_burette_structure_component",
    "manage_burette_tabs",
    "observe_burette_workspace",
    "open_burette_docking_view",
    "open_burette_workspace",
    "set_burette_representation_style",
    "set_burette_trajectory",
    "summarize_burette_structure",
  ]);
}

async function testCliBridgeErrors(tempRoot) {
  const failureRoot = await copyPlugin(tempRoot, "failure-plugin");
  await writeFile(
    path.join(failureRoot, "scripts", "burette-agent.mjs"),
    [
      "#!/usr/bin/env node",
      'console.error(JSON.stringify({ ok: false, error: { code: "TEST_FAILURE", message: "synthetic failure" } }));',
      "process.exit(7);",
      "",
    ].join("\n"),
  );
  const failureBridge = await import(moduleUrl(failureRoot, "mcp", "lib", "cli-bridge.mjs"));
  const failure = await failureBridge.runBuretteAgent(["open", "--mode", "browser-preview", sampleMini]);
  assert.equal(failure.ok, false);
  assert.equal(failure.exitCode, 7);
  assert.equal(failure.error.code, "TEST_FAILURE");
  assert.equal(failure.error.message, "synthetic failure");

  const timeoutRoot = await copyPlugin(tempRoot, "timeout-plugin");
  await writeFile(
    path.join(timeoutRoot, "scripts", "burette-agent.mjs"),
    [
      "#!/usr/bin/env node",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  const timeoutBridge = await import(moduleUrl(timeoutRoot, "mcp", "lib", "cli-bridge.mjs"));
  const timeout = await timeoutBridge.runBuretteAgent(["observe"], { timeoutMs: 25 });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.exitCode, 124);
  assert.equal(timeout.signal, "TIMEOUT");
  assert.equal(timeout.error.code, "CLI_FAILED");
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "burette-agent-mcp-test-"));
try {
  assert.match(await readFile(path.join(sourcePluginRoot, ".codex-plugin", "plugin.json"), "utf8"), /"name": "burette"/);
  await testMcpRegistrations(tempRoot);
  await testValidationHandlers(tempRoot);
  await testFetchAndWorkspaceHandlers(tempRoot);
  await testMockedWorkspaceToolScenarios(tempRoot);
  await testCliBridgeErrors(tempRoot);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("burette-agent MCP tests passed");
