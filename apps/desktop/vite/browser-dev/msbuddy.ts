import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type BrowserDevMsbuddyRoutes = {
  annotateSpectrum: (body: Record<string, unknown>) => Promise<unknown>;
  status: () => Promise<unknown>;
};

export function registerBrowserDevMsbuddyRoutes(server: ViteDevServer, routes: BrowserDevMsbuddyRoutes) {
  server.middlewares.use("/__burette/msbuddy", async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const endpoint = url.pathname
      .replace(/^\/+/, "")
      .replace(/^__burette\/msbuddy\/?/u, "")
      .replace(/\/+$/u, "")
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
      if (endpoint === "annotate") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
          return;
        }
        sendJson(res, 200, await routes.annotateSpectrum(await readJsonBody(req)), "no-cache");
        return;
      }
      sendJson(res, 404, { error: "Unknown msbuddy endpoint." }, "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}
