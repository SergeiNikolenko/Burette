import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

type BrowserDevFileRoutesOptions = {
  collectDefaultDevFiles: () => Promise<string[]>;
  collectDevFiles: (path: string, files: string[]) => Promise<void>;
  devFileExtensions: Set<string>;
  devFileSizeLimit: number;
  fileExtension: (path: string) => string;
  fileTitle: (path: string) => string;
  isDevFileReadAllowed: (path: string) => boolean | string;
  languageForTextExtension: (extension: string) => string;
  looksBinary: (bytes: Buffer) => boolean;
  molecularBinaryArtifactSummary: (path: string, byteCount: number) => string;
  molecularBinaryMetadataExtensions: Set<string>;
  readableTextBytes: (bytes: Buffer, extension: string) => Buffer;
  resolveStructureFileBundle: (path: string) => unknown;
  textFileReadLimit: (value: string | null) => number;
};

export function registerBrowserDevFileDiscoveryRoute(server: ViteDevServer, options: BrowserDevFileRoutesOptions) {
  server.middlewares.use("/__burette/dev-files", async (req, res) => {
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const root = url.searchParams.get("root");
      let files: string[];
      if (root) {
        const rootPath = resolve(root);
        if (!options.isDevFileReadAllowed(rootPath)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        files = [];
        await options.collectDevFiles(rootPath, files);
        files = Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
      } else {
        files = await options.collectDefaultDevFiles();
      }
      sendJson(res, 200, { files });
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

export function registerBrowserDevFileContentRoutes(server: ViteDevServer, options: BrowserDevFileRoutesOptions) {
  server.middlewares.use("/__burette/read-file", async (req, res) => {
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
      const info = await stat(filePath);
      if (!info.isFile() || info.size > options.devFileSizeLimit || !options.devFileExtensions.has(options.fileExtension(filePath))) {
        sendJson(res, 400, { error: "Unsupported file" });
        return;
      }
      const bytes = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(bytes);
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/read-text-file", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const path = url.searchParams.get("path");
      const maxBytes = options.textFileReadLimit(url.searchParams.get("maxBytes"));
      if (!path) {
        sendJson(res, 400, { error: "Missing path" });
        return;
      }
      const filePath = resolve(path);
      if (!options.isDevFileReadAllowed(filePath)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile() || info.size > options.devFileSizeLimit) {
        sendJson(res, 400, { error: "Unsupported file" });
        return;
      }
      const bytes = await readFile(filePath);
      const extension = options.fileExtension(filePath);
      const textBytes = options.readableTextBytes(bytes, extension);
      if (options.looksBinary(textBytes)) {
        if (options.molecularBinaryMetadataExtensions.has(extension)) {
          sendJson(res, 200, {
            id: `browser-dev-${filePath}-${info.mtimeMs}`,
            path: filePath,
            title: options.fileTitle(filePath),
            extension,
            language: "text",
            byteCount: info.size,
            content: options.molecularBinaryArtifactSummary(filePath, info.size),
            truncated: false,
            modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
          }, "no-cache");
          return;
        }
        sendJson(res, 400, { error: `${filePath} is not a text file` });
        return;
      }
      const truncated = textBytes.length > maxBytes;
      const readableBytes = truncated ? textBytes.subarray(0, maxBytes) : textBytes;
      sendJson(res, 200, {
        id: `browser-dev-${filePath}-${info.mtimeMs}`,
        path: filePath,
        title: options.fileTitle(filePath),
        extension,
        language: options.languageForTextExtension(extension),
        byteCount: info.size,
        content: readableBytes.toString("utf8"),
        truncated,
        modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
      }, "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/file-bundle", async (req, res) => {
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
      sendJson(res, 200, options.resolveStructureFileBundle(filePath), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
