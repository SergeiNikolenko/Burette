import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { runBuretteAgent } from "../../lib/cli-bridge.mjs";
import { resolveWorkspaceSession } from "../../lib/session-registry.mjs";
import { toolText } from "../../lib/tool-response.mjs";

const storyControlOperation = z.enum(["next", "previous", "goto", "play", "pause"]);
const STORY_OUTPUT_LIMIT = 256 * 1024;
const STORY_ARRAY_LIMIT = 256;
const STORY_STRING_LIMIT = 4096;
const STORY_TOTAL_STRING_LIMIT = 64 * 1024;
const STORY_NODE_LIMIT = 2000;

export function registerMvsStory(server) {
  registerAppTool(server, "burette.create_story", {
    title: "Create MolViewSpec Story",
    description: "Validate and write a multi-step MolViewSpec Story as MVSJ or a self-contained MVSX archive without overwriting an existing file by default.",
    inputSchema: {
      story: z.unknown(),
      outputPath: z.string().trim(),
      resources: z.record(z.string()).optional(),
      overwrite: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model"] } },
  }, async input => {
    const pathError = validateNativeStoryPaths(input.outputPath, input.resources || {});
    if (pathError) return storyFailure("burette.create_story", pathError);
    const temp = await mkdtemp(path.join(tmpdir(), "burette-story-mcp-"));
    try {
      const specPath = path.join(temp, "story.json");
      await writeFile(specPath, `${JSON.stringify(input.story, null, 2)}\n`);
      const args = ["story-create", "--spec", specPath, "--output", input.outputPath];
      for (const [archivePath, sourcePath] of Object.entries(input.resources || {})) args.push("--asset", `${archivePath}=${sourcePath}`);
      if (input.overwrite === true) args.push("--overwrite");
      return cliStoryResult("burette.create_story", await runBuretteAgent(args));
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  });

  registerAppTool(server, "burette.validate_story", {
    title: "Validate MolViewSpec Story",
    description: "Validate MVSJ or MVSX structure, snapshot metadata, unique keys, archive safety, and referenced resources.",
    inputSchema: { file: z.string().trim() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["model"] } },
  }, async input => {
    if (!path.isAbsolute(input.file)) return storyFailure("burette.validate_story", absolutePathError("file"));
    return cliStoryResult("burette.validate_story", await runBuretteAgent(["story-validate", "--file", input.file]));
  });

  registerAppTool(server, "burette.observe_story", {
    title: "Observe MolViewSpec Story",
    description: "Return the active MolViewSpec Story step, ordered step metadata, playback state, and navigation availability from Mol*.",
    inputSchema: workspaceLocatorSchema(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["model"] } },
  }, async input => runStoryAction("burette.observe_story", input, { type: "story_observe" }));

  registerAppTool(server, "burette.control_story", {
    title: "Control MolViewSpec Story",
    description: "Move to the next, previous, or selected MolViewSpec Story step, or start and pause Story playback.",
    inputSchema: {
      ...workspaceLocatorSchema(),
      operation: storyControlOperation,
      index: z.number().int().min(0).max(255).optional(),
      key: z.string().trim().optional(),
      id: z.string().trim().optional(),
      restart: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model"] } },
  }, async input => runStoryAction("burette.control_story", input, {
    type: "story_control",
    operation: input.operation,
    index: input.index,
    key: input.key,
    id: input.id,
    restart: input.restart,
  }));
}

function workspaceLocatorSchema() {
  return {
    workspaceSessionId: z.string().trim().optional(),
    viewerSessionId: z.string().trim().optional(),
    url: z.string().trim().optional(),
    sessionDir: z.string().trim().optional(),
    waitMs: z.number().int().min(0).max(60000).optional(),
  };
}

async function runStoryAction(tool, input, action) {
  const resolved = resolveWorkspaceSession(input);
  if (!resolved.ok) return storyFailure(tool, resolved.error);
  const args = ["act"];
  if (resolved.session.url) args.push("--url", resolved.session.url);
  if (resolved.session.sessionDir) args.push("--session-dir", resolved.session.sessionDir);
  args.push(JSON.stringify(action), "--wait-ms", String(input.waitMs ?? 12000));
  const result = await runBuretteAgent(args, { timeoutMs: Math.max(30000, (input.waitMs ?? 12000) + 5000) });
  return cliStoryResult(tool, result, { workspaceSessionId: resolved.session.workspaceSessionId, action });
}

function cliStoryResult(tool, result, extra = {}) {
  const payload = result.payload?.result || null;
  const nested = payload?.action?.result ?? payload?.result ?? payload;
  const ok = result.ok && payload?.ok !== false && nested?.ok !== false && payload?.action?.status !== "failed";
  const error = result.error || nested?.error || payload?.action?.result?.error || null;
  const structuredContent = boundedStoryOutput({
    ok,
    tool,
    ...extra,
    result: payload,
    error: ok ? null : error,
    exitCode: result.exitCode,
  });
  return {
    content: toolText(ok ? `${tool} completed.` : `${tool} failed: ${error?.message || "unknown error"}`),
    ...(ok ? {} : { isError: true }),
    structuredContent,
  };
}

function storyFailure(tool, error) {
  return {
    content: toolText(`${tool} failed: ${error?.message || "unknown error"}`),
    isError: true,
    structuredContent: boundedStoryOutput({ ok: false, tool, result: null, error }),
  };
}

function validateNativeStoryPaths(outputPath, resources) {
  if (!path.isAbsolute(outputPath)) return absolutePathError("outputPath");
  for (const sourcePath of Object.values(resources)) {
    if (!path.isAbsolute(sourcePath)) return absolutePathError("resources source path");
  }
  return null;
}

function absolutePathError(field) {
  return { code: "ABSOLUTE_PATH_REQUIRED", message: `${field} must be an absolute native filesystem path.` };
}

function boundedStoryOutput(value) {
  const budget = {
    nodesRemaining: STORY_NODE_LIMIT,
    stringsRemaining: STORY_TOTAL_STRING_LIMIT,
    truncated: {},
  };
  const output = boundStoryValue(value, budget, "root");
  if (Object.keys(budget.truncated).length > 0) output.bounds = budget.truncated;
  if (Buffer.byteLength(JSON.stringify(output), "utf8") <= STORY_OUTPUT_LIMIT) return output;
  return {
    ok: value?.ok === true,
    tool: value?.tool || null,
    result: null,
    error: boundStoryValue(value?.error || null, {
      nodesRemaining: 100,
      stringsRemaining: 16 * 1024,
      truncated: {},
    }, "error"),
    bounds: {
      output: { limit: STORY_OUTPUT_LIMIT, truncated: true },
    },
  };
}

function boundStoryValue(value, budget, path) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const allowed = Math.max(0, Math.min(STORY_STRING_LIMIT, budget.stringsRemaining));
    const result = value.length > allowed ? `${value.slice(0, Math.max(0, allowed - 1))}…` : value;
    budget.stringsRemaining -= Math.min(value.length, allowed);
    if (result !== value) budget.truncated[path] = { total: value.length, returned: result.length, truncated: true };
    return result;
  }
  if (typeof value !== "object") return String(value).slice(0, STORY_STRING_LIMIT);
  if (budget.nodesRemaining <= 0) {
    budget.truncated[path] = { truncated: true, reason: "node_limit" };
    return null;
  }
  budget.nodesRemaining -= 1;
  if (Array.isArray(value)) {
    const result = value.slice(0, STORY_ARRAY_LIMIT).map((item, index) => boundStoryValue(item, budget, `${path}[${index}]`));
    if (value.length > result.length) budget.truncated[path] = { total: value.length, returned: result.length, truncated: true };
    return result;
  }
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (key === "story") {
      budget.truncated[`${path}.story`] = { omitted: true };
      continue;
    }
    output[key.slice(0, 128)] = boundStoryValue(child, budget, `${path}.${key.slice(0, 128)}`);
  }
  if (Object.keys(value).length > 100) budget.truncated[path] = { totalKeys: Object.keys(value).length, returnedKeys: 100, truncated: true };
  return output;
}
