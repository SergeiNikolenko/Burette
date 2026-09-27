import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { pluginPath, pluginRoot, repoPath, repoRoot, repoRootMetadataPath, repoRootSource } from "./plugin-root.mjs";

const pluginCliScript = pluginPath("scripts", "burette-agent.mjs");
const repoCliScript = repoPath("scripts", "burette-agent.mjs");
const cliScript = existsSync(pluginCliScript) ? pluginCliScript : repoCliScript;
const cliRoot = existsSync(pluginCliScript) ? pluginRoot : repoRoot;

export async function runBuretteAgent(args, { timeoutMs = 30000 } = {}) {
  if (!existsSync(cliScript)) {
    return {
      ok: false,
      exitCode: 127,
      signal: null,
      stdout: "",
      stderr: "",
      error: {
        code: "BURETTE_REPO_ROOT_UNAVAILABLE",
        message:
          `Burette agent CLI was not found at ${pluginCliScript} or ${repoCliScript}. ` +
          `The plugin resolved repoRoot from ${repoRootSource}. ` +
          "Rebuild or reinstall the Burette plugin so scripts/burette-agent.mjs is bundled, or point BURETTE_AGENT_REPO_ROOT at a Burette repository.",
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

  const outputByteLimit = 4 * 1024 * 1024;
  let outputBytes = 0;
  let outputLimitExceeded = false;
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", chunk => {
    outputBytes += chunk.length;
    if (outputBytes > outputByteLimit) {
      outputLimitExceeded = true;
      child.kill("SIGKILL");
      return;
    }
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", chunk => {
    outputBytes += chunk.length;
    if (outputBytes > outputByteLimit) {
      outputLimitExceeded = true;
      child.kill("SIGKILL");
      return;
    }
    stderrChunks.push(chunk);
  });

  const exit = await waitForChild(child, timeoutMs);
  if (outputLimitExceeded) {
    return {
      ok: false, exitCode: exit.code, signal: exit.signal, stdout: "", stderr: "",
      error: { code: "CLI_OUTPUT_LIMIT", message: `Burette CLI output exceeds ${outputByteLimit} bytes; request a smaller result or a file artifact.` },
    };
  }
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
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
        message: exit.error?.message || stderr.trim() || stdout.trim() || `burette-agent exited with ${exit.code}`,
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
    let timedOut = false;
    let killTimer;
    const finish = result => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Keep ownership until exit; a stuck CLI may ignore graceful termination.
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);
    child.once("error", error => finish({ code: 127, signal: null, error }));
    child.once("close", (code, signal) => {
      finish(timedOut ? { code: 124, signal: "TIMEOUT" } : { code: code ?? 1, signal });
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
