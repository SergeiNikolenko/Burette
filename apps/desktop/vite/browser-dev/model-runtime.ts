import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ViteDevServer } from "vite";

import { sendJson } from "./http";

// Browser dev mirrors the desktop app's managed model runtime: same install
// location, same uv steps, same status shape, so the panel renders one install
// flow everywhere and a dev install benefits the packaged app too.

type InstallPhase = "idle" | "installing" | "completed" | "failed" | "cancelled";

const INSTALL_SIZE_HINT = "~1.5 GB";
const WEIGHTS_NOTE =
  "Model weights download on first use into Application Support/Burette/chemical-space-models.";
const STAMP_FILE = "burette-install.json";

const install: {
  phase: InstallPhase;
  line: string | null;
  error: string | null;
  child: ChildProcess | null;
  cancelled: boolean;
} = { phase: "idle", line: null, error: null, child: null, cancelled: false };

export function registerBrowserDevModelRuntimeRoutes(server: ViteDevServer, repoRoot: string) {
  server.middlewares.use("/__burette/chemical-space-model-runtime", (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const pathname = new URL(req.url || "", "http://127.0.0.1").pathname;
    if (method === "GET" && (pathname === "/" || pathname === "")) {
      sendJson(res, 200, statusPayload(repoRoot), "no-cache");
      return;
    }
    if (method === "POST" && pathname === "/install") {
      startInstall(repoRoot);
      sendJson(res, 200, { started: true }, "no-cache");
      return;
    }
    if (method === "POST" && pathname === "/cancel-install") {
      cancelInstall();
      sendJson(res, 200, { cancelled: true }, "no-cache");
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  });
}

function modelRuntimeDir() {
  const configured = process.env.BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR?.trim();
  if (configured) return configured;
  return join(homedir(), "Library", "Application Support", "Burette", "model-python");
}

function resolveModelPython(repoRoot: string): { path: string; source: string } | null {
  const configured = process.env.BURETTE_CHEMICAL_SPACE_MODEL_PYTHON?.trim();
  if (configured && existsSync(configured)) return { path: configured, source: "override" };
  for (const name of ["python3", "python"]) {
    const candidate = join(modelRuntimeDir(), "bin", name);
    if (existsSync(candidate)) return { path: candidate, source: "managed" };
  }
  const devVenv = join(repoRoot, ".venv-chemical-space", "bin", "python");
  if (existsSync(devVenv)) return { path: devVenv, source: "dev" };
  return null;
}

function resolveUv(): string | null {
  const candidates: string[] = [];
  const configured = process.env.BURETTE_UV?.trim();
  if (configured) candidates.push(configured);
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (dir) candidates.push(join(dir, "uv"));
  }
  candidates.push(
    join(homedir(), ".local/bin/uv"),
    join(homedir(), ".cargo/bin/uv"),
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function statusPayload(repoRoot: string) {
  const python = resolveModelPython(repoRoot);
  const installerAvailable = resolveUv() !== null;
  return {
    installed: python !== null,
    pythonPath: python?.path ?? null,
    source: python?.source ?? null,
    installerAvailable,
    installHint: installerAvailable
      ? "The runtime installs through uv into Application Support/Burette/model-python."
      : "Managed installation requires the uv package manager. Install uv (https://docs.astral.sh/uv) or set BURETTE_CHEMICAL_SPACE_MODEL_PYTHON to an existing environment.",
    installSizeHint: INSTALL_SIZE_HINT,
    weightsNote: WEIGHTS_NOTE,
    installPhase: install.phase,
    installLine: install.line,
    installError: install.error,
  };
}

function startInstall(repoRoot: string) {
  if (install.phase === "installing") return;
  install.phase = "installing";
  install.line = "Preparing the model runtime installation…";
  install.error = null;
  install.cancelled = false;
  void runInstall(repoRoot)
    .then(() => {
      install.phase = "completed";
      install.line = "Model runtime installed.";
      install.error = null;
    })
    .catch((error: unknown) => {
      install.phase = install.cancelled ? "cancelled" : "failed";
      install.line = null;
      install.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      install.child = null;
    });
}

function cancelInstall() {
  if (install.phase !== "installing") return;
  install.cancelled = true;
  install.child?.kill("SIGKILL");
}

async function runInstall(repoRoot: string) {
  const uv = resolveUv();
  if (!uv) {
    throw new Error("The uv package manager was not found. Install uv or set BURETTE_UV.");
  }
  const root = modelRuntimeDir();
  const parent = join(root, "..");
  await mkdir(parent, { recursive: true });
  const requirements = await readFile(
    join(repoRoot, "compute", "models", "requirements.txt"),
    "utf8",
  );
  if (await stampMatches(root, requirements)) return;
  const staging = join(parent, `model-python.staging-${randomUUID()}`);
  try {
    install.line = "Creating the Python 3.12 environment…";
    await runStep(uv, ["venv", "--python", "3.12", staging]);
    ensureNotCancelled();
    const python = join(staging, "bin", "python3");
    const requirementsPath = join(staging, "requirements.txt");
    await writeFile(requirementsPath, requirements, "utf8");
    install.line = "Downloading PyTorch, Transformers, and RDKit…";
    await runStep(uv, ["pip", "install", "--python", python, "-r", requirementsPath]);
    ensureNotCancelled();
    install.line = "Validating the installed runtime…";
    await runStep(python, ["-c", "import numpy, rdkit, torch, transformers; print('imports ok')"]);
    await writeFile(
      join(staging, STAMP_FILE),
      `${JSON.stringify({ requirements, validatedAtMs: Date.now() }, null, 2)}\n`,
      "utf8",
    );
    await promoteStaging(root, staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function stampMatches(root: string, requirements: string) {
  try {
    const stamp = JSON.parse(await readFile(join(root, STAMP_FILE), "utf8")) as {
      requirements?: unknown;
    };
    return stamp.requirements === requirements && existsSync(join(root, "bin", "python3"));
  } catch {
    return false;
  }
}

async function promoteStaging(root: string, staging: string) {
  let legacy: string | null = null;
  if (existsSync(root)) {
    legacy = `${root}.legacy-${randomUUID()}`;
    await rename(root, legacy);
  }
  try {
    await rename(staging, root);
  } catch (error) {
    if (legacy) await rename(legacy, root).catch(() => undefined);
    throw error;
  }
  if (legacy) await rm(legacy, { recursive: true, force: true }).catch(() => undefined);
}

function ensureNotCancelled() {
  if (install.cancelled) {
    throw new Error("The model runtime installation was cancelled.");
  }
}

function runStep(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    install.child = child;
    let tail = "";
    const consume = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        // uv colors its output even when piped; escape codes would show up
        // verbatim in the install status line.
        const trimmed = line.replace(/\[[0-9;]*[A-Za-z]/g, "").trim();
        if (!trimmed) continue;
        install.line = trimmed;
        if (tail.length < 16_384) tail += `${trimmed}\n`;
      }
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0] ?? ""} failed (status ${code}): ${tail.slice(-1_200)}`));
    });
  });
}
