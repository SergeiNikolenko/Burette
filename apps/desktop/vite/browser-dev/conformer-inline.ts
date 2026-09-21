import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

export function registerBrowserDevInlineConformerRoute(
  server: ViteDevServer,
  generate3DConformerForBrowserDev: (body: Record<string, unknown>) => Promise<unknown>,
) {
  server.middlewares.use("/__burette/generate-3d-conformer", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      sendJson(res, 200, await generate3DConformerForBrowserDev(await readJsonBody(req)));
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
