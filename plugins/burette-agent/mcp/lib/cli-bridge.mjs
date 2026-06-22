import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { pluginPath, pluginRoot, repoPath, repoRoot, repoRootMetadataPath, repoRootSource } from "./plugin-root.mjs";

const pluginCliScript = pluginPath("scripts", "burrete-agent.mjs");
const repoCliScript = repoPath("scripts", "burrete-agent.mjs");
const cliScript = existsSync(pluginCliScript) ? pluginCliScript : repoCliScript;
const cliRoot = existsSync(pluginCliScript) ? pluginRoot : repoRoot;

export async function runBurreteAgent(args, { timeoutMs = 30000 } = {}) {
  if (!existsSync(cliScript)) {
    return {
      ok: false,
      exitCode: 127,
      signal: null,
      stdout: "",
      stderr: "",
      error: {
        code: "BURRETE_REPO_ROOT_UNAVAILABLE",
        message:
          `Burrete agent CLI was not found at ${pluginCliScript} or ${repoCliScript}. ` +
          `The plugin resolved repoRoot from ${repoRootSource}. ` +
          "Rebuild or reinstall the Burrete plugin so scripts/burrete-agent.mjs is bundled, or point BURRETE_AGENT_REPO_ROOT at a Burrete repository.",
        details: {
          pluginRoot,
          repoRoot,
          repoRootSource,
          metadataPath: repoRootMetadataPath,
          pluginCliScript,
          repoCliScript,
        },
      },
    };
  }

  const child = spawn(process.execPath, [cliScript, ...args], {
    cwd: cliRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", chunk => {
    stderr += chunk.toString("utf8");
  });

  const exit = await waitForChild(child, timeoutMs);
  const parsedStdout = parseJson(stdout);
  const parsedStderr = parseJson(stderr);
  if (exit.code !== 0) {
    return {
      ok: false,
      exitCode: exit.code,
      signal: exit.signal,
      stdout,
      stderr,
      error: parsedStderr?.error || parsedStdout?.error || {
        code: "CLI_FAILED",
        message: stderr.trim() || stdout.trim() || `burrete-agent exited with ${exit.code}`,
      },
    };
  }
  return {
    ok: true,
    exitCode: exit.code,
    signal: exit.signal,
    stdout,
    stderr,
    payload: parsedStdout,
  };
}

function waitForChild(child, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, signal: "TIMEOUT" });
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, signal });
    });
  });
}

function parseJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
