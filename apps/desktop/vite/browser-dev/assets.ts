import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

type ExecFileAsync = (file: string, args: string[]) => Promise<unknown>;

export function registerBrowserDevRdkitWasmRoute(server: ViteDevServer, rdkitWasmPath: string) {
  server.middlewares.use("/__burette/rdkit-wasm", async (_req, res) => {
    try {
      const bytes = await readFile(rdkitWasmPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/wasm");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(bytes);
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

export function registerBrowserDevAppIconRoute(
  server: ViteDevServer,
  appIcons: Record<string, string>,
  execFileAsync: ExecFileAsync,
) {
  server.middlewares.use("/__burette/app-icon/", async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, "")).replace(/\.png$/u, "");
      const iconPath = appIcons[id];
      if (!iconPath || !existsSync(iconPath)) {
        sendJson(res, 404, { error: "Icon not found" });
        return;
      }
      const cacheDir = join(tmpdir(), "burrete-app-icons");
      const outputPath = join(cacheDir, `${id}.png`);
      if (!existsSync(outputPath)) {
        await mkdir(cacheDir, { recursive: true });
        await execFileAsync("/usr/bin/sips", ["-s", "format", "png", iconPath, "--out", outputPath]);
      }
      const bytes = await readFile(outputPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
