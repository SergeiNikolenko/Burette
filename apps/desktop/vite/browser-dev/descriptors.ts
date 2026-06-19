import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type BrowserDevDescriptorJobStatus = {
  documentId: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  running: boolean;
  totalRows: number;
  processedRows: number;
  calculatedRows: number;
  failedRows: number;
  message: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  summary?: unknown;
  rows?: unknown[];
};

type BrowserDevDescriptorRoutes = {
  calculate: (body: Record<string, unknown>) => Promise<unknown>;
  calculateGrid: (body: Record<string, unknown>) => Promise<unknown>;
  gridJobs: Map<string, BrowserDevDescriptorJobStatus>;
  gridSummary: (documentId: string, path: string) => Promise<unknown>;
  install: () => Promise<unknown>;
  status: () => Promise<unknown>;
};

export function registerBrowserDevDescriptorRoutes(server: ViteDevServer, routes: BrowserDevDescriptorRoutes) {
  server.middlewares.use("/__burette/descriptors", async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const endpoint = url.pathname
      .replace(/^\/+/, "")
      .replace(/^__burette\/descriptors\/?/u, "")
      || "status";
    try {
      if (endpoint === "status") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        sendJson(res, 200, await routes.status(), "no-cache");
        return;
      }
      if (endpoint === "install") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        sendJson(res, 200, await routes.install(), "no-cache");
        return;
      }
      if (endpoint === "calculate") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        sendJson(res, 200, await routes.calculate(await readJsonBody(req)), "no-cache");
        return;
      }
      if (endpoint === "grid") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        sendJson(res, 200, await routes.calculateGrid(await readJsonBody(req)), "no-cache");
        return;
      }
      if (endpoint === "grid-summary") {
        const body = method === "POST" ? await readJsonBody(req) : {};
        const documentId = typeof body.documentId === "string" ? body.documentId : url.searchParams.get("documentId") || "browser-dev-grid";
        const path = typeof body.path === "string" ? body.path : url.searchParams.get("path") || "";
        sendJson(res, 200, await routes.gridSummary(documentId, path), "no-cache");
        return;
      }
      if (endpoint === "grid-job-status") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        const documentId = url.searchParams.get("documentId") || "browser-dev-grid";
        sendJson(res, 200, routes.gridJobs.get(documentId) ?? {
          documentId,
          status: "idle",
          running: false,
          totalRows: 0,
          processedRows: 0,
          calculatedRows: 0,
          failedRows: 0,
          message: "No descriptor job has run yet.",
          startedAtMs: Date.now(),
          finishedAtMs: Date.now(),
          summary: null,
          rows: [],
        }, "no-cache");
        return;
      }
      if (endpoint === "grid-cancel") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        const body = await readJsonBody(req);
        const documentId = typeof body.documentId === "string" ? body.documentId : "browser-dev-grid";
        const previous = routes.gridJobs.get(documentId);
        const cancelled = {
          ...(previous ?? {
            documentId,
            totalRows: 0,
            processedRows: 0,
            calculatedRows: 0,
            failedRows: 0,
            startedAtMs: Date.now(),
            summary: null,
            rows: [],
          }),
          documentId,
          status: "cancelled" as const,
          running: false,
          message: "Descriptor calculation cancelled.",
          finishedAtMs: Date.now(),
        };
        routes.gridJobs.set(documentId, cancelled);
        sendJson(res, 200, cancelled, "no-cache");
        return;
      }
      sendJson(res, 404, { error: "Descriptor endpoint not found" }, "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}
