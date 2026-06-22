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
    path.join(pluginRoot, "scripts", "burrete-agent.mjs"),
    [
      "#!/usr/bin/env node",
      `const activeFile = ${JSON.stringify(sampleMini)};`,
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
      "  ok({",
      "    mode: parsed.options.mode || 'browser-preview',",
      "    url: 'http://127.0.0.1:49000/index.html?token=mock-token',",
      "    sessionDir: parsed.options.sessionDir || '/tmp/burrete-mock-session',",
      "    launched: !parsed.options.noLaunch,",
      "    initialPaths: parsed.rest,",
      "    argv: args,",
      "  });",
      "} else if (command === 'observe') {",
      "  ok({",
      "    mode: 'browser-agent-shell',",
      "    activeTabId: 'tab-structure',",
      "    tabs: [{ id: 'tab-structure', title: 'mini.pdb', path: activeFile }],",
      "    activeDocument: { title: 'mini.pdb', path: activeFile, ready: true },",
      "    viewer: { ready: true, representationCount: 2 },",
      "    actions: { recent: [] },",
      "    argv: args,",
      "  });",
      "} else if (command === 'act') {",
      "  const actionText = parsed.rest[0] || '{}';",
      "  const action = JSON.parse(actionText);",
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
  assert.deepEqual([...server.resources.keys()].sort(), [
    "ui://widget/burette-agent/molecular-report-20260607.html",
    "ui://widget/burette-agent/molecule-table-20260607.html",
    "ui://widget/burette-agent/trajectory-review-20260607.html",
  ]);
  assert.deepEqual([...server.tools.keys()].sort(), [
    "act_molstar_scene",
    "burrete.control_viewer",
    "burrete.get_context",
    "burrete.observe_workspace",
    "burrete.open_workspace",
    "burrete.render_panel",
    "edit_burrete_fragment",
    "fetch",
    "focus_burrete_selection",
    "manage_burrete_structure_component",
    "manage_burrete_tabs",
    "observe_burrete_workspace",
    "open_burrete_docking_view",
    "open_burrete_workspace",
    "render_molecular_report_widget",
    "render_molecule_table_widget",
    "render_trajectory_review_widget",
    "set_burrete_representation_style",
    "set_burrete_trajectory",
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

async function testMockedWorkspaceToolScenarios(tempRoot) {
  const pluginRoot = await copyPlugin(tempRoot, "mocked-workspace-plugin");
  await installMockAgentCli(pluginRoot);
  const server = await registerAll(pluginRoot);
  const coveredTools = new Set();

  const opened = await server.tools.get("open_burrete_workspace").handler({
    file: sampleMini,
    mode: "browser-preview",
    noLaunch: true,
  });
  coveredTools.add("open_burrete_workspace");
  assert.equal(opened.structuredContent.ok, true);
  assert.equal(opened.structuredContent.result.mode, "browser-preview");
  assert.deepEqual(opened.structuredContent.result.initialPaths, [sampleMini]);
  assert.equal(opened.structuredContent.result.launched, false);

  const publicContext = await server.tools.get("burrete.get_context").handler({});
  coveredTools.add("burrete.get_context");
  assert.equal(publicContext.structuredContent.ok, true);
  assert.equal(publicContext.structuredContent.apiVersion, "burrete-external-agent/v1");
  assert.equal(publicContext.structuredContent.capabilities.canOpenWorkspace, true);

  const publicOpened = await server.tools.get("burrete.open_workspace").handler({
    file: sampleMini,
    mode: "browser-preview",
    noLaunch: true,
  });
  coveredTools.add("burrete.open_workspace");
  assert.equal(publicOpened.structuredContent.ok, true);
  assert.match(publicOpened.structuredContent.workspaceSessionId, /^bws_/);
  assert.equal(publicOpened.structuredContent.viewerSessionId, publicOpened.structuredContent.workspaceSessionId);
  assert.equal(publicOpened.structuredContent.modelContext.activeDocument.path, sampleMini);
  assert.equal(publicOpened.structuredContent.modelContext.structureSummary.counts.atoms, 9);

  const publicObserved = await server.tools.get("burrete.observe_workspace").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
  });
  coveredTools.add("burrete.observe_workspace");
  assert.equal(publicObserved.structuredContent.ok, true);
  assert.equal(publicObserved.structuredContent.modelContext.activeDocument.path, sampleMini);

  const publicAction = await server.tools.get("burrete.control_viewer").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
    action: { type: "reset_camera", label: "Reset camera" },
  });
  coveredTools.add("burrete.control_viewer");
  assert.equal(publicAction.structuredContent.ok, true);
  assert.equal(publicAction.structuredContent.result.action.payload.type, "reset_camera");
  assert.equal(publicAction.structuredContent.applied, true);

  const publicPanel = await server.tools.get("burrete.render_panel").handler({
    workspaceSessionId: publicOpened.structuredContent.workspaceSessionId,
    kind: "markdown",
    file: "/tmp/burrete-panel.md",
    area: "right",
  });
  coveredTools.add("burrete.render_panel");
  assert.equal(publicPanel.structuredContent.ok, true);
  assert.equal(publicPanel.structuredContent.result.action.payload.type, "render_panel");
  assert.equal(publicPanel.structuredContent.result.action.payload.kind, "markdown");

  const observed = await server.tools.get("observe_burrete_workspace").handler({
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("observe_burrete_workspace");
  assert.equal(observed.structuredContent.ok, true);
  assert.equal(observed.structuredContent.observe.activeDocument.path, sampleMini);
  assert.equal(observed._meta, undefined);

  const summarizedFromWorkspace = await server.tools.get("summarize_burrete_structure").handler({
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("summarize_burrete_structure");
  assert.equal(summarizedFromWorkspace.structuredContent.ok, true);
  assert.equal(summarizedFromWorkspace.structuredContent.summary.counts.atoms, 9);
  assert.equal(summarizedFromWorkspace.structuredContent.observe.activeDocument.path, sampleMini);

  const listedTabs = await server.tools.get("manage_burrete_tabs").handler({
    operation: "list",
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("manage_burrete_tabs");
  assert.equal(listedTabs.structuredContent.ok, true);
  assert.equal(listedTabs.structuredContent.activeTabId, "tab-structure");
  assert.equal(listedTabs.structuredContent.tabs[0].path, sampleMini);

  const focusedTab = await server.tools.get("manage_burrete_tabs").handler({
    operation: "focus",
    url: opened.structuredContent.result.url,
    tabId: "tab-structure",
  });
  assert.equal(focusedTab.structuredContent.ok, true);
  assert.equal(focusedTab.structuredContent.result.action.type, "manage_tabs");
  assert.equal(focusedTab.structuredContent.result.action.payload.operation, "focus");
  assert.equal(focusedTab.structuredContent.result.action.payload.tabId, "tab-structure");

  const clearedSelection = await server.tools.get("manage_burrete_structure_component").handler({
    operation: "clear",
    url: opened.structuredContent.result.url,
  });
  coveredTools.add("manage_burrete_structure_component");
  assert.equal(clearedSelection.structuredContent.ok, true);
  assert.equal(clearedSelection.structuredContent.result.action.payload.type, "clear_selection");

  const selectedChain = await server.tools.get("manage_burrete_structure_component").handler({
    operation: "select",
    file: sampleMini,
    url: opened.structuredContent.result.url,
    chain: "A",
  });
  assert.equal(selectedChain.structuredContent.ok, true);
  assert.equal(selectedChain.structuredContent.selector.auth_asym_id, "A");
  assert.equal(selectedChain.structuredContent.result.action.payload.type, "select_residues");

  const hidWater = await server.tools.get("manage_burrete_structure_component").handler({
    operation: "hide",
    file: sampleMini,
    url: opened.structuredContent.result.url,
    component: "water",
  });
  assert.equal(hidWater.structuredContent.ok, true);
  assert.equal(hidWater.structuredContent.result.action.payload.type, "hide_waters");

  const openedLigandTab = await server.tools.get("manage_burrete_structure_component").handler({
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

  const dockingView = await server.tools.get("open_burrete_docking_view").handler({
    receptorPath: sampleMini,
    ligandPaths: [sample1htb],
    url: opened.structuredContent.result.url,
    activePose: 0,
    sceneMode: "structurePoses",
  });
  coveredTools.add("open_burrete_docking_view");
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

  const trajectory = await server.tools.get("set_burrete_trajectory").handler({
    url: opened.structuredContent.result.url,
    index: 3,
    mode: "sdf-pose",
    poseMode: "single",
  });
  coveredTools.add("set_burrete_trajectory");
  assert.equal(trajectory.structuredContent.ok, true);
  assert.equal(trajectory.structuredContent.actionType, "set_sdf_pose_index");
  assert.equal(trajectory.structuredContent.result.action.payload.type, "set_sdf_pose_index");
  assert.equal(trajectory.structuredContent.result.action.payload.index, 3);
  assert.equal(trajectory.structuredContent.results[0].action.payload.type, "set_sdf_pose_mode");

  const style = await server.tools.get("set_burrete_representation_style").handler({
    url: opened.structuredContent.result.url,
    style: "ball-and-stick",
  });
  coveredTools.add("set_burrete_representation_style");
  assert.equal(style.structuredContent.ok, true);
  assert.equal(style.structuredContent.result.action.payload.type, "set_molstar_style");
  assert.equal(style.structuredContent.result.action.payload.style, "ball-and-stick");

  const focusedSelection = await server.tools.get("focus_burrete_selection").handler({
    operation: "focus",
    url: opened.structuredContent.result.url,
    selector: { auth_asym_id: "A", beg_auth_seq_id: 1, end_auth_seq_id: 3 },
    durationMs: 250,
    extraRadius: 2,
  });
  coveredTools.add("focus_burrete_selection");
  assert.equal(focusedSelection.structuredContent.ok, true);
  assert.equal(focusedSelection.structuredContent.action.type, "focus_selection");
  assert.equal(focusedSelection.structuredContent.action.args.selector.auth_asym_id, "A");

  const highlightedSelection = await server.tools.get("focus_burrete_selection").handler({
    operation: "highlight",
    url: opened.structuredContent.result.url,
    selector: { kind: "polymer" },
    label: "Protein",
    color: "#4f8cff",
  });
  assert.equal(highlightedSelection.structuredContent.ok, true);
  assert.equal(highlightedSelection.structuredContent.action.type, "apply_scene");
  assert.equal(highlightedSelection.structuredContent.action.components[0].selector.kind, "polymer");

  const editedFragment = await server.tools.get("edit_burrete_fragment").handler({
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
  coveredTools.add("edit_burrete_fragment");
  assert.equal(editedFragment.structuredContent.ok, true);
  assert.equal(editedFragment.structuredContent.edited.operation, "remove_to_new_file");
  assert.equal(editedFragment.structuredContent.edited.removedAtomCount, 44);
  assert.equal(editedFragment.structuredContent.edited.insertedAtomCount, 0);
  assert.equal(editedFragment.structuredContent.opened.action.payload.type, "open_files");
  assert.deepEqual(editedFragment.structuredContent.opened.action.payload.paths, [
    editedFragment.structuredContent.edited.outputPath,
  ]);
  await rm(editedFragment.structuredContent.edited.outputPath, { force: true });

  assert.deepEqual([...coveredTools].sort(), [
    "act_molstar_scene",
    "burrete.control_viewer",
    "burrete.get_context",
    "burrete.observe_workspace",
    "burrete.open_workspace",
    "burrete.render_panel",
    "edit_burrete_fragment",
    "focus_burrete_selection",
    "manage_burrete_structure_component",
    "manage_burrete_tabs",
    "observe_burrete_workspace",
    "open_burrete_docking_view",
    "open_burrete_workspace",
    "set_burrete_representation_style",
    "set_burrete_trajectory",
    "summarize_burrete_structure",
  ]);
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
  await testMockedWorkspaceToolScenarios(tempRoot);
  await testCliBridgeErrors(tempRoot);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("burette-agent MCP tests passed");
