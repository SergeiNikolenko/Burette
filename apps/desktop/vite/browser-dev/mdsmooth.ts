import { spawn } from "node:child_process";
import { extname } from "node:path";
import type { ViteDevServer } from "vite";

import { canonicalExistingPath } from "./file-discovery";
import { readJsonBody, sendJson, sendJsonError } from "./http";

const MDSMOOTH_DEPENDENCIES = ["numpy", "scipy", "MDAnalysis", "deeptime"];
// Must match PROGRESS_PREFIX in scripts/mdsmooth_runner.py.
const PROGRESS_PREFIX = "@burette-progress ";

export function registerBrowserDevMdsmoothRoute(
  server: ViteDevServer,
  runnerPath: string,
  options: { isDevFileReadAllowed: (path: string) => boolean | string },
) {
  server.middlewares.use("/__burette/mdsmooth", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
      return;
    }
    try {
      const request = await readJsonBody(req);
      if (!request.operation || request.operation === "analyze") {
        if (typeof request.trajectoryPath !== "string" || !request.trajectoryPath.trim()) {
          sendJson(res, 400, { error: "trajectoryPath is required" }, "no-cache");
          return;
        }
        const inputs = ["trajectoryPath", "topologyPath"] as const;
        for (const key of [...inputs, "outputPath"] as const) {
          const value = request[key];
          if (value === undefined || value === null || value === "") continue;
          if (typeof value !== "string") {
            sendJson(res, 400, { error: `${key} must be a path string` }, "no-cache");
            return;
          }
          const path = canonicalExistingPath(value.trim());
          if (!options.isDevFileReadAllowed(path)) {
            sendJson(res, 403, { error: "Forbidden" }, "no-cache");
            return;
          }
          request[key] = path;
        }
        const trajectory = request.trajectoryPath as string;
        // The runner picks its default extension after loading topology. Check
        // both possible names, including existing symlinks, before launching.
        const stem = trajectory.slice(0, trajectory.length - extname(trajectory).length);
        const outputs = request.outputPath ? [request.outputPath as string]
          : [`${stem}.mdsmooth.pdb`, `${stem}.mdsmooth.xyz`, `${stem}.mdsmooth.dcd`];
        for (const output of outputs) {
          if (!options.isDevFileReadAllowed(output)) {
            sendJson(res, 403, { error: "Forbidden" }, "no-cache");
            return;
          }
          if (inputs.some((key) => request[key] === canonicalExistingPath(output))) {
            sendJson(res, 400, { error: "Output must not replace an input file" }, "no-cache");
            return;
          }
        }
      } else if (request.operation !== "capabilities" && request.operation !== "installDeepTica") {
        sendJson(res, 400, { error: "Unsupported MDSmooth operation" }, "no-cache");
        return;
      }
      if (!String(req.headers?.accept || "").includes("application/x-ndjson")) {
        sendJson(res, 200, await runMdsmooth(runnerPath, request), "no-cache");
        return;
      }
      // Streamed form: one {progress} line per runner update, then {result}
      // or {error}. The status is already sent, so failures travel in-band.
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
      try {
        line({ result: await runMdsmooth(runnerPath, request, (progress) => line({ progress })) });
      } catch (error) {
        line({ error: error instanceof Error ? error.message : String(error) });
      }
      res.end();
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}

function runMdsmooth(runnerPath: string, request: Record<string, unknown>, onProgress?: (progress: unknown) => void) {
  return new Promise<unknown>((resolve, reject) => {
    const args = ["run"];
    for (const dependency of MDSMOOTH_DEPENDENCIES) args.push("--with", dependency);
    args.push("python", runnerPath);
    const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: string[] = [];
    let pending = "";
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const text of lines) {
        if (!text.startsWith(PROGRESS_PREFIX)) stderr.push(text);
        else if (onProgress) {
          try { onProgress(JSON.parse(text.slice(PROGRESS_PREFIX.length))); } catch { /* progress is advisory */ }
        }
      }
    });
    child.on("error", (error) => reject(new Error(`Could not start MDSmooth: ${error.message}`)));
    child.on("close", (code) => {
      const errorText = [...stderr, pending].join("\n").trim();
      if (code !== 0) {
        reject(new Error(`MDSmooth exited with ${code}: ${errorText}`));
        return;
      }
      try {
        const response = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (response?.ok !== true) throw new Error(response?.error || "MDSmooth analysis failed");
        resolve(response);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
