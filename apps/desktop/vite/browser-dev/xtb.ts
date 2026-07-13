import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type BrowserDevXtbRoutes = {
  cancel: (kind: "xtb", jobId: unknown) => unknown;
  install: () => Promise<unknown>;
  run: (body: Record<string, unknown>) => Promise<unknown>;
  select: (executablePath: unknown) => Promise<unknown>;
  status: () => Promise<unknown>;
};

export function registerBrowserDevXtbRoutes(server: ViteDevServer, routes: BrowserDevXtbRoutes) {
  server.middlewares.use("/__burette/xtb-status", async (req, res) => {
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

  server.middlewares.use("/__burette/select-xtb-executable", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await routes.select(body?.executablePath));
    } catch (error) {
      sendJsonError(res, 400, error);
    }
  });

  server.middlewares.use("/__burette/install-xtb", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await routes.install());
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/run-xtb-job", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await routes.run(await readJsonBody(req)));
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/cancel-xtb-job", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, routes.cancel("xtb", body?.jobId), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
