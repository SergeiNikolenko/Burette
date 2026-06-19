import { existsSync, watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

export function registerBrowserDevAgentSessionRoute(server: ViteDevServer) {
  server.middlewares.use("/__burette/agent-session/", async (req, res) => {
    const sessionDir = process.env.BURRETE_AGENT_SHELL_SESSION_DIR
      ? resolve(process.env.BURRETE_AGENT_SHELL_SESSION_DIR)
      : null;
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "", "http://127.0.0.1");
    const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!sessionDir || !["actions.json", "observe.json", "session.json", "events"].includes(fileName)) {
      sendJson(res, sessionDir ? 404 : 403, { error: sessionDir ? "Not found" : "Agent shell session is not enabled" });
      return;
    }
    if (fileName === "events") {
      if (method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const sendActionsEvent = () => {
        res.write(`event: actions\ndata: ${JSON.stringify({ file: "actions.json", at: new Date().toISOString() })}\n\n`);
      };
      sendActionsEvent();
      const watcher = watch(sessionDir, (_eventType, changedFileName) => {
        if (changedFileName === "actions.json") sendActionsEvent();
      });
      req.on("close", () => watcher.close());
      return;
    }
    const filePath = resolve(sessionDir, fileName);
    if (!filePath.startsWith(`${sessionDir}/`)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    try {
      if (method === "GET") {
        const fallback = fileName === "actions.json"
          ? { apiVersion: "burette-agent-control/v1", actions: [] }
          : {};
        let value = fallback;
        if (existsSync(filePath)) value = JSON.parse(await readFile(filePath, "utf8"));
        sendJson(res, 200, value, "no-cache");
        return;
      }
      if (method === "PUT") {
        if (fileName === "session.json") {
          sendJson(res, 405, { error: "session.json is read-only" });
          return;
        }
        const body = await readJsonBody(req);
        await mkdir(sessionDir, { recursive: true });
        await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 405, { error: "Method not allowed" });
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
