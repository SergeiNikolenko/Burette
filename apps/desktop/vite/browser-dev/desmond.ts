import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

type StructureFileBundle = {
  kind: string;
  inputPath: string;
};

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<unknown>;

type BrowserDevDesmondRouteOptions = {
  desmondPreviewExtractor: string;
  execFileAsync: ExecFileAsync;
  isDevFileReadAllowed: (path: string) => boolean | string;
  resolveStructureFileBundle: (path: string) => StructureFileBundle;
  schrodingerRun: string;
  targetMb: number;
};

export function registerBrowserDevDesmondPreviewRoute(server: ViteDevServer, options: BrowserDevDesmondRouteOptions) {
  server.middlewares.use("/__burette/desmond-preview", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const path = url.searchParams.get("path");
      if (!path) {
        sendJson(res, 400, { error: "Missing path" });
        return;
      }
      const filePath = resolve(path);
      if (!options.isDevFileReadAllowed(filePath)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      const bundle = options.resolveStructureFileBundle(filePath);
      if (bundle.kind !== "desmond") {
        sendJson(res, 404, { error: "No Desmond trajectory candidate found." });
        return;
      }
      if (!existsSync(options.schrodingerRun) || !existsSync(options.desmondPreviewExtractor)) {
        sendJson(res, 404, { error: "Schrodinger Desmond preview extractor is unavailable." });
        return;
      }
      const tempDirectory = await mkdtemp(join(tmpdir(), "burrete-desmond-preview-"));
      const outputPath = join(tempDirectory, "desmond-preview.pdb");
      try {
        await options.execFileAsync(
          options.schrodingerRun,
          [
            "python3",
            options.desmondPreviewExtractor,
            bundle.inputPath,
            "--frames",
            "0",
            "--atoms",
            "0",
            "--target-mb",
            String(options.targetMb),
            "--output",
            outputPath,
          ],
          { timeout: 0, maxBuffer: 16 * 1024 * 1024 },
        );
        const bytes = await readFile(outputPath);
        if (!bytes.length) {
          sendJson(res, 500, { error: "Desmond preview extractor produced an empty PDB file." });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(bytes.length));
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Burrete-Preview-Extension", "pdb");
        res.end(bytes);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
