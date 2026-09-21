import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type BrowserDevConformerJobRoutes = {
  cancel: (kind: "conformer", jobId: unknown) => unknown;
  prepare: (body: Record<string, unknown>) => Promise<unknown>;
  run: (body: Record<string, unknown>) => Promise<unknown>;
  status: () => Promise<unknown>;
};

export function registerBrowserDevConformerJobRoutes(server: ViteDevServer, routes: BrowserDevConformerJobRoutes) {
  server.middlewares.use("/__burette/conformer-status", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await routes.status(), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/prepare-conformer-job", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await routes.prepare(await readJsonBody(req)), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/run-conformer-job", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await routes.run(await readJsonBody(req)), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/cancel-conformer-job", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, routes.cancel("conformer", body?.jobId), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
