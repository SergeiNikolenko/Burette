import { spawn } from "node:child_process";
import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

const MDSMOOTH_DEPENDENCIES = ["numpy", "scipy", "MDAnalysis", "deeptime"];

export function registerBrowserDevMdsmoothRoute(server: ViteDevServer, runnerPath: string) {
  server.middlewares.use("/__burette/mdsmooth", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
      return;
    }
    try {
      sendJson(res, 200, await runMdsmooth(runnerPath, await readJsonBody(req)), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}

function runMdsmooth(runnerPath: string, request: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const args = ["run"];
    for (const dependency of MDSMOOTH_DEPENDENCIES) args.push("--with", dependency);
    args.push("python", runnerPath);
    const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => reject(new Error(`Could not start MDSmooth: ${error.message}`)));
    child.on("close", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
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
