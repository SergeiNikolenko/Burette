import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

const REQUEST_LIMIT_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const MODEL_REQUEST_LIMIT_BYTES = 36 * 1024 * 1024;
const MAX_CHEMICAL_SPACE_KNN_CACHE_ENTRIES = 8;
const chemicalSpaceKnnCache = new Map<string, unknown>();

export function registerBrowserDevNativeComputeRoute(server: ViteDevServer, repoRoot: string) {
  server.middlewares.use("/__burette/chemical-space-representation", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abortOnClose);
    try {
      const body = await readJsonBody(req);
      const input = JSON.stringify(body);
      if (Buffer.byteLength(input, "utf8") > MODEL_REQUEST_LIMIT_BYTES) {
        throw new Error("Molecular representation request exceeds 36 MiB");
      }
      sendJson(
        res,
        200,
        await runMolecularRepresentation(repoRoot, input, controller.signal),
        "no-cache",
      );
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed && !res.writableEnded) {
        sendJsonError(res, 500, error, "no-cache");
      }
    } finally {
      req.off("aborted", abort);
      res.off("close", abortOnClose);
    }
  });
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

function molecularRepresentationPython(repoRoot: string) {
  const configured = process.env.BURRETE_CHEMICAL_SPACE_MODEL_PYTHON?.trim();
  const candidates = [
    configured || null,
    join(homedir(), "Library", "Application Support", "Burrete", "model-python", "bin", "python"),
    join(repoRoot, ".venv-chemical-space", "bin", "python"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function runMolecularRepresentation(repoRoot: string, input: string, signal: AbortSignal) {
  const python = molecularRepresentationPython(repoRoot);
  if (!python) {
    throw new Error(
      "Metal model runtime is not installed. Configure BURRETE_CHEMICAL_SPACE_MODEL_PYTHON.",
    );
  }
  const script = join(repoRoot, "compute", "models", "chemical_space_representations.py");
  const modelRoot = join(
    homedir(),
    "Library",
    "Application Support",
    "Burrete",
    "chemical-space-models",
  );
  const output = await runWithStdin(
    python,
    [script],
    input,
    repoRoot,
    MODEL_REQUEST_TIMEOUT_MS,
    {
      HF_HOME: process.env.HF_HOME?.trim() || join(modelRoot, "huggingface"),
      PYTORCH_ENABLE_MPS_FALLBACK: "0",
      UNIMOL_WEIGHT_DIR: process.env.UNIMOL_WEIGHT_DIR?.trim() || join(modelRoot, "unimol"),
    },
    signal,
  );
  const payload = JSON.parse(output) as { ok?: unknown; result?: unknown; error?: unknown };
  if (payload.ok !== true || !payload.result) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Metal model worker failed");
  }
  return payload.result;
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
  const suppliedKnn = payload.knnCache && typeof payload.knnCache === "object"
    ? createHash("sha256").update(JSON.stringify(payload.knnCache)).digest("hex")
    : "compute";
  return records.length > 0 && Number.isSafeInteger(neighbors) && neighbors > 0
    ? `${createHash("sha256").update(JSON.stringify(records)).digest("hex")}:${neighbors}:${suppliedKnn}`
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
  const packagedBackend = join(dirname(dirname(runtimeRoot)), "MacOS", "burrete-compute-dev-backend");
  const configuredBackend = process.env.BURRETE_DEV_COMPUTE_BACKEND?.trim();
  const directBackend = [configuredBackend || null, packagedBackend]
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => existsSync(candidate));
  if (directBackend) {
    const output = await runWithStdin(
      directBackend,
      ["--runtime-root", runtimeRoot],
      input,
      repoRoot,
      REQUEST_TIMEOUT_MS,
    );
    const payload = JSON.parse(output) as unknown;
    if (!payload || typeof payload !== "object") {
      throw new Error("Native Metal dev backend returned an invalid response");
    }
    return payload;
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
    REQUEST_TIMEOUT_MS,
  );
  const payload = JSON.parse(output) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("Native Metal dev backend returned an invalid response");
  }
  return payload;
}

function runWithStdin(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  environment: Record<string, string> = {},
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (abortSignal?.aborted) {
      rejectPromise(abortError());
      return;
    }
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let terminationError: Error | null = null;
    let forceKillTimeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const terminate = (error: Error) => {
      if (terminationError || child.exitCode !== null) return;
      terminationError = error;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      forceKillTimeout.unref();
    };
    const onAbort = () => terminate(abortError());
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      abortSignal?.removeEventListener("abort", onAbort);
    };
    const timeout = setTimeout(() => {
      terminate(new Error("Native Metal dev backend timed out"));
    }, timeoutMs);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationError) {
        rejectPromise(terminationError);
        return;
      }
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

function abortError() {
  const error = new Error("Metal model calculation was cancelled");
  error.name = "AbortError";
  return error;
}
