#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sourcePluginRoot = path.resolve(process.env.BURRETE_PLUGIN_ROOT || "plugins/burette-agent");
const tempRoot = await mkdtemp(path.join(tmpdir(), "burrete-bundled-mcp-"));
const cleanPluginRoot = path.join(tempRoot, "burrete");

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
    clientInfo: { name: "burrete-bundled-mcp-test", version: "1.0.0" },
  });
  assert.equal(initialized.serverInfo.name, "burrete");
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const listed = await request("tools/list");
  const toolNames = listed.tools.map(tool => tool.name).sort();
  for (const required of [
    "burrete.get_context",
    "burrete.open_workspace",
    "burrete.observe_workspace",
    "burrete.control_viewer",
    "burrete.render_panel",
  ]) {
    assert.equal(toolNames.includes(required), true, `Missing ${required}`);
  }

  const context = await request("tools/call", {
    name: "burrete.get_context",
    arguments: {},
  });
  assert.equal(context.isError, undefined);
  assert.equal(context.structuredContent.ok, true);
  const capabilities = context.structuredContent.context?.capabilities || context.structuredContent.capabilities;
  assert.equal(capabilities.canOpenWorkspace, true);
  console.log("burette-agent bundled MCP tests passed");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
