#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sourcePluginRoot = path.resolve(process.env.BURETTE_PLUGIN_ROOT || "plugins/burette-agent");
const tempRoot = await mkdtemp(path.join(tmpdir(), "burette-bundled-mcp-"));
const cleanPluginRoot = path.join(tempRoot, "burette");

await cp(sourcePluginRoot, cleanPluginRoot, {
  recursive: true,
  filter(source) {
    return !source.split(path.sep).includes("node_modules");
  },
});

const child = spawn(process.execPath, ["mcp/lib/server-bundle.mjs", "--stdio"], {
  cwd: cleanPluginRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
let stdoutBuffer = "";
let nextId = 1;
const pending = new Map();
let inlineSessionId;

child.stderr.on("data", chunk => {
  stderr += chunk.toString("utf8");
});
child.stdout.on("data", chunk => {
  stdoutBuffer += chunk.toString("utf8");
  while (stdoutBuffer.includes("\n")) {
    const newline = stdoutBuffer.indexOf("\n");
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
});
child.on("exit", (code, signal) => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(`Bundled MCP server exited with ${signal || code}: ${stderr}`));
  }
  pending.clear();
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}: ${stderr}`));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "burette-bundled-mcp-test", version: "1.0.0" },
  });
  assert.equal(initialized.serverInfo.name, "burette");
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const listed = await request("tools/list");
  const workspaceTool = listed.tools.find(tool => tool.name === 'burette.open_viewer');
  const compactTool = listed.tools.find(tool => tool.name === 'burette.open_inline_viewer');
  assert.equal(workspaceTool._meta.ui.resourceUri, 'ui://burette/native-workspace-v1.html');
  assert.equal(compactTool._meta.ui.resourceUri, 'ui://burette/local-viewer.html');
  const workspaceResource = await request('resources/read', { uri: workspaceTool._meta.ui.resourceUri });
  assert.match(workspaceResource.contents[0].text, /BuretteMcpWorkspace/u);
  assert.deepEqual(workspaceResource.contents[0]._meta.ui.csp.frameDomains, ['blob:']);
  const toolNames = listed.tools.map(tool => tool.name).sort();
  for (const required of [
    "burette.get_context",
    "burette.open_workspace",
    "burette.observe_workspace",
    "burette.control_viewer",
    "burette.get_mvs_authoring_reference",
    "burette.list_story_templates",
    "burette.create_story_from_template",
    "burette.create_story",
    "burette.validate_story",
    "burette.observe_story",
    "burette.control_story",
    "burette.render_panel",
    "burette.open_inline_viewer",
    "burette.open_viewer",
    "burette.observe_inline_viewer",
    "burette.control_inline_viewer",
  ]) {
    assert.equal(toolNames.includes(required), true, `Missing ${required}`);
  }

  const context = await request("tools/call", {
    name: "burette.get_context",
    arguments: {},
  });
  assert.equal(context.isError, undefined);
  assert.equal(context.structuredContent.ok, true);
  const capabilities = context.structuredContent.context?.capabilities || context.structuredContent.capabilities;
  assert.equal(capabilities.canOpenWorkspace, true);

  const templates = await request("tools/call", {
    name: "burette.list_story_templates",
    arguments: {},
  });
  assert.equal(templates.isError, undefined);
  assert.equal(templates.structuredContent.ok, true);
  assert.equal(templates.structuredContent.result.count, 4);

  const authoringReference = await request("tools/call", {
    name: "burette.get_mvs_authoring_reference",
    arguments: { schema: "scene", nodeKind: "component" },
  });
  assert.equal(authoringReference.isError, undefined);
  assert.equal(authoringReference.structuredContent.ok, true);
  assert.equal(authoringReference.structuredContent.result.nodeKind, "component");
  assert.match(authoringReference.structuredContent.result.markdown, /Parent: `structure`/);
  const resource = await request('resources/read', { uri: 'ui://burette/local-viewer.html' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource.contents[0]._meta.ui.csp, { connectDomains: ['blob:'], resourceDomains: ['blob:', 'data:'], frameDomains: ['blob:'] });
  assert.match(resource.contents[0].text, /BuretteMcpWorkspace/u);
  assert.ok(Buffer.byteLength(resource.contents[0].text) < 4 * 1024 * 1024);
  const opened = await request('tools/call', { name: 'burette.open_viewer', arguments: {
    file: path.resolve('samples/structures/proteins/1htb.pdb'), additionalFiles: [path.resolve('samples/mvs/docking_story.mvsx')],
  } });
  assert.equal(opened.isError, undefined);
  assert.equal(opened.structuredContent.ready, false);
  assert.equal(opened.structuredContent.requestedDisplayMode, 'inline');
  assert.equal(opened.structuredContent.workspace, true);
  inlineSessionId = opened.structuredContent.sessionId;
  assert.equal(opened.structuredContent.token, undefined);
  assert.ok(opened._meta.session.token);
  assert.equal(opened.content[0].text.includes(opened._meta.session.token), false);
  const privateTool = listed.tools.find(tool => tool.name === 'burette.inline_viewer_exchange');
  assert.deepEqual(privateTool._meta.ui.visibility, ['app']);
  const source = await request('tools/call', { name: 'burette.inline_viewer_exchange', arguments: { ...opened._meta.session, source: true } });
  assert.deepEqual(source.content, []);
  assert.equal(source.structuredContent, undefined);
  assert.ok(source._meta.payload.dataBase64.length <= 256 * 1024);
  assert.equal(source._meta.payload.config.binary, false);
  const archive = await request('tools/call', { name: 'burette.inline_viewer_exchange', arguments: {
    ...opened._meta.session, source: true, documentId: opened.structuredContent.documents[1].id,
  } });
  assert.deepEqual(archive.content, []);
  assert.equal(archive._meta.payload.config.binary, true);
  assert.equal(archive._meta.payload.config.format, 'mvsx');
  assert.equal(Buffer.from(archive._meta.payload.dataBase64, 'base64').readUInt32LE(), 0x04034b50);
  const denied = await request('tools/call', { name: 'burette.control_inline_viewer', arguments: { sessionId: inlineSessionId, action: { type: 'reset_camera' } } });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /not mounted/u);
  const controls = listed.tools.find(tool => tool.name === 'burette.control_inline_viewer');
  assert.equal(controls._meta?.ui?.resourceUri, undefined, 'Adding files must not attach a new MCP App');
  await request('tools/call', { name: 'burette.inline_viewer_exchange', arguments: {
    ...opened._meta.session, state: { ready: true, capabilities: { addFiles: true }, tabs: [{ id: 'tab-1', kind: 'file' }] },
  } });
  const added = await request('tools/call', { name: 'burette.control_inline_viewer', arguments: {
    sessionId: inlineSessionId, action: { type: 'open_files', paths: [path.resolve('samples/mini.pdb')] }, waitMs: 0,
  } });
  assert.equal(added.isError, undefined);
  assert.equal(added.structuredContent.sessionId, inlineSessionId);
  assert.equal(added._meta?.session, undefined, 'Control must not initialize another viewer');
  const updated = await request('tools/call', { name: 'burette.inline_viewer_exchange', arguments: opened._meta.session });
  assert.equal(updated._meta.payload.documents.length, 3);
  assert.equal(updated._meta.payload.actions[0].action.type, 'open_files');
  console.log("burette-agent bundled MCP tests passed");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
  if (inlineSessionId) await rm(path.join(tmpdir(), 'burette-mcp-app', inlineSessionId), { recursive: true, force: true });
}
