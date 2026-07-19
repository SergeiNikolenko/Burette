import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

const REQUEST_LIMIT_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function registerBrowserDevNativeComputeRoute(server: ViteDevServer, repoRoot: string) {
  server.middlewares.use("/__burette/native-compute", async (req, res) => {
    if ((req.method || "GET").toUpperCase() === "GET") {
      const runtimeRoot = nativeComputeRuntimeRoot(repoRoot);
      sendJson(res, 200, {
        available: Boolean(runtimeRoot),
        provider: runtimeRoot ? "nativeMetalDevBridge" : null,
        operations: runtimeRoot ? ["semiempiricalRm1", "alignPoses"] : [],
      }, "no-cache");
      return;
    }
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const input = JSON.stringify(body);
      if (Buffer.byteLength(input, "utf8") > REQUEST_LIMIT_BYTES) {
        throw new Error("Native compute request exceeds 12 MiB");
      }
      sendJson(res, 200, await runNativeCompute(repoRoot, input), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

function nativeComputeRuntimeRoot(repoRoot: string) {
  const configured = process.env.BURRETE_DEV_COMPUTE_RUNTIME_ROOT?.trim();
  const candidates = [
    configured || null,
    join(repoRoot, "target", "debug", "ComputeMetal"),
    join(repoRoot, "target", "release", "ComputeMetal"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, "current.json"))) ?? null;
}

async function runNativeCompute(repoRoot: string, input: string) {
  const runtimeRoot = nativeComputeRuntimeRoot(repoRoot);
  if (!runtimeRoot) {
    throw new Error("Native Metal dev runtime is missing. Build the desktop compute runtime first.");
  }
  const manifestPath = join(repoRoot, "apps", "desktop", "src-tauri", "Cargo.toml");
  const output = await runWithStdin(
    process.env.CARGO?.trim() || "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      manifestPath,
      "--bin",
      "burrete-compute-dev-backend",
      "--",
      "--runtime-root",
      runtimeRoot,
    ],
    input,
    repoRoot,
  );
  const payload = JSON.parse(output) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("Native Metal dev backend returned an invalid response");
  }
  return payload;
}

function runWithStdin(command: string, args: string[], input: string, cwd: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("Native Metal dev backend timed out"));
    }, REQUEST_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        rejectPromise(new Error(stderr || `Native Metal dev backend exited with ${signal || code}`));
        return;
      }
      resolvePromise(stdout);
    });
    child.stdin.end(input);
  });
}
