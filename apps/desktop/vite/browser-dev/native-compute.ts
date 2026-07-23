import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

const REQUEST_LIMIT_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CHEMICAL_SPACE_KNN_CACHE_ENTRIES = 8;
const chemicalSpaceKnnCache = new Map<string, unknown>();

export function registerBrowserDevNativeComputeRoute(server: ViteDevServer, repoRoot: string) {
  server.middlewares.use("/__burette/native-compute", async (req, res) => {
    if ((req.method || "GET").toUpperCase() === "GET") {
      const runtimeRoot = nativeComputeRuntimeRoot(repoRoot);
      sendJson(res, 200, {
        available: Boolean(runtimeRoot),
        provider: runtimeRoot ? "nativeMetalDevBridge" : null,
        operations: runtimeRoot
          ? ["generate3d", "generateEnsemble", "optimizeGeometry", "semiempiricalRm1", "alignPoses", "chemicalSpace"]
          : [],
      }, "no-cache");
      return;
    }
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const originalInput = JSON.stringify(body);
      if (Buffer.byteLength(originalInput, "utf8") > REQUEST_LIMIT_BYTES) {
        throw new Error("Native compute request exceeds 12 MiB");
      }
      const cacheKey = chemicalSpaceCacheKey(body);
      if (cacheKey) {
        const cached = chemicalSpaceKnnCache.get(cacheKey);
        if (cached) {
          chemicalSpaceKnnCache.delete(cacheKey);
          chemicalSpaceKnnCache.set(cacheKey, cached);
          chemicalSpacePayload(body).knnCache = cached;
        }
      }
      const input = JSON.stringify(body);
      const response = await runNativeCompute(repoRoot, input);
      sendJson(res, 200, cacheChemicalSpaceKnn(response, cacheKey), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

function chemicalSpacePayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const chemicalSpace = (body as { chemicalSpace?: unknown }).chemicalSpace;
  return chemicalSpace && typeof chemicalSpace === "object"
    ? chemicalSpace as Record<string, unknown>
    : {};
}

function chemicalSpaceCacheKey(body: unknown) {
  if (!body || typeof body !== "object" || (body as { operation?: unknown }).operation !== "chemicalSpace") {
    return null;
  }
  const payload = chemicalSpacePayload(body);
  const options = payload.options && typeof payload.options === "object"
    ? payload.options as Record<string, unknown>
    : {};
  const records = Array.isArray(payload.records) ? payload.records : [];
  const neighbors = Number(options.neighbors);
  return records.length > 0 && Number.isSafeInteger(neighbors) && neighbors > 0
    ? `${createHash("sha256").update(JSON.stringify(records)).digest("hex")}:${neighbors}`
    : null;
}

function cacheChemicalSpaceKnn(response: unknown, cacheKey: string | null) {
  if (!cacheKey || !response || typeof response !== "object") return response;
  const envelope = response as { result?: unknown };
  if (!envelope.result || typeof envelope.result !== "object") return response;
  const result = envelope.result as { embedding?: unknown; knnCache?: unknown };
  if (result.embedding === undefined || result.knnCache === undefined) return response;
  chemicalSpaceKnnCache.set(cacheKey, result.knnCache);
  while (chemicalSpaceKnnCache.size > MAX_CHEMICAL_SPACE_KNN_CACHE_ENTRIES) {
    const oldestKey = chemicalSpaceKnnCache.keys().next().value;
    if (oldestKey === undefined) break;
    chemicalSpaceKnnCache.delete(oldestKey);
  }
  return { ...envelope, result: result.embedding };
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
