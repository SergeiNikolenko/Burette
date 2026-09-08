import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
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
  appIcons: Record<string, string | (() => Promise<string | undefined>)>,
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
      if (!/^[a-z0-9-]+$/u.test(id) || !Object.hasOwn(appIcons, id)) {
        sendJson(res, 404, { error: "Icon not found" });
        return;
      }
      const cacheDir = join(homedir(), process.platform === "darwin" ? "Library/Caches" : ".cache", "Burette", "app-icons");
      const outputPath = join(cacheDir, `${id}.png`);
      if (!existsSync(outputPath)) {
        const source = appIcons[id];
        const iconPath = typeof source === "function" ? await source() : source;
        if (!iconPath || !existsSync(iconPath)) {
          sendJson(res, 404, { error: "Icon not found" });
          return;
        }
        await mkdir(cacheDir, { recursive: true });
        const pendingPath = join(cacheDir, `${id}-${randomUUID()}.png`);
        try {
          await execFileAsync("/usr/bin/sips", ["-s", "format", "png", iconPath, "--out", pendingPath]);
          await rename(pendingPath, outputPath);
        } finally {
          await rm(pendingPath, { force: true });
        }
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
