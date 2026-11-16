import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson } from "./http";

// The browser-dev twin of the desktop interaction_diagram command: the same
// engine script, the same checks and limits, a small cache of drawn diagrams.
const MAPPED_EXTENSIONS = new Set([".pdb", ".ent", ".cif", ".mmcif"]);
const STRUCTURE_LIMIT_BYTES = 256 * 1024 * 1024;
const RULES_LIMIT_BYTES = 1024;
const RUN_TIMEOUT_MS = 120_000;
const CACHED_DIAGRAMS = 16;

type InteractionDiagramRouteOptions = {
  runnerPath: string;
  // Chemical Component Dictionary entries the engine downloads and keeps.
  componentsDir: string;
  isDevFileReadAllowed: (path: string) => boolean;
  // The xyzrender runtime first, then the descriptor interpreters, as in the app.
  resolveXyzrenderExecutable: () => string | null;
  pythonCandidates: () => string[];
};

async function interpreter(options: InteractionDiagramRouteOptions) {
  const executable = options.resolveXyzrenderExecutable();
  if (executable) {
    const shebang = (await readFile(executable, "utf8")).split("\n", 1)[0].match(/^#!(\/[^\r\n]+\/python[\d.]*)$/)?.[1];
    if (shebang && existsSync(shebang)) return shebang;
  }
  return options.pythonCandidates()[0] ?? null;
}

function runEngine(python: string, runnerPath: string, payload: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(python, [runnerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONNOUSERSITE: "1", OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MKL_NUM_THREADS: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        reject(new Error(/ModuleNotFoundError/.test(stderr)
          ? "Interaction maps need the Python runtime that comes with Burette"
          : stderr.trim().split("\n").pop() || "The interaction map could not be drawn"));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function registerBrowserDevInteractionDiagramRoute(server: ViteDevServer, options: InteractionDiagramRouteOptions) {
  const diagrams = new Map<string, Record<string, unknown>>();
  server.middlewares.use("/__burette/interaction-diagram", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
      return;
    }
    try {
      const body = await readJsonBody(req, 64 * 1024);
      const path = typeof body.path === "string" ? body.path : "";
      const ligand = typeof body.ligand === "string" ? body.ligand : null;
      const rules = body.rules && typeof body.rules === "object" && !Array.isArray(body.rules) ? body.rules : {};
      if (!MAPPED_EXTENSIONS.has(extname(path).toLowerCase())) {
        sendJson(res, 400, { error: "Interaction maps need a PDB or mmCIF structure" }, "no-cache");
        return;
      }
      if (!options.isDevFileReadAllowed(path)) {
        sendJson(res, 403, { error: "The structure is outside the folders browser-dev can read" }, "no-cache");
        return;
      }
      const file = await stat(path);
      if (!file.isFile() || file.size > STRUCTURE_LIMIT_BYTES || JSON.stringify(rules).length > RULES_LIMIT_BYTES) {
        sendJson(res, 400, { error: "The structure cannot be mapped" }, "no-cache");
        return;
      }
      const key = JSON.stringify([path, file.mtimeMs, file.size, ligand, rules]);
      let result = diagrams.get(key);
      if (!result) {
        const python = await interpreter(options);
        if (!python) {
          sendJson(res, 503, { error: "Interaction maps need the Python runtime that comes with Burette" }, "no-cache");
          return;
        }
        result = await runEngine(python, options.runnerPath, { path, ccdCache: options.componentsDir, ligand, rules });
        if (result.ok !== true) {
          sendJson(res, 422, { error: typeof result.error === "string" ? result.error : "The interaction map could not be drawn" }, "no-cache");
          return;
        }
        if (diagrams.size >= CACHED_DIAGRAMS) diagrams.delete(diagrams.keys().next().value!);
        diagrams.set(key, result);
      }
      sendJson(res, 200, result, "no-cache");
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }, "no-cache");
    }
  });
}
