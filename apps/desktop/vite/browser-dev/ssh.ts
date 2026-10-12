import { SshPreviewCache } from "./ssh-preview-cache";
import { SshRequestQueue } from "./ssh-request-queue";
import { SshSession } from "./ssh-session";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { readJsonBody, sendJson, sendJsonError } from "./http";

const MAX_BYTES = 64 * 1024 * 1024;
const validHost = (host: unknown): host is string => typeof host === "string" && /^[a-zA-Z0-9._@:][a-zA-Z0-9._@:-]{0,254}$/.test(host);

// The browser never gets SSH credentials. This opt-in, loopback-only transport
// runs the same Python file worker as the native app, through system SSH.
export function registerBrowserDevSshRoutes(server: ViteDevServer, repoRoot: string) {
  const requests = new SshRequestQueue();
  let cache: Promise<string> | undefined;
  const cacheRoot = () => cache ??= mkdir(join(repoRoot, "node_modules/.cache"), { recursive: true }).then(() => mkdtemp(join(repoRoot, "node_modules/.cache/burette-ssh-")));
  const previews = new SshPreviewCache(cacheRoot);
  const sessions = new Map<string, SshSession>();
  server.httpServer?.once("close", () => {
    requests.close();
    for (const session of sessions.values()) session.close();
    if (cache) void cache.then(path => rm(path, { recursive: true, force: true }));
  });
  server.middlewares.use("/__burette/ssh", async (req, res) => {
    const address = server.httpServer?.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const expected = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
    const remote = req.socket.remoteAddress;
    if (process.env.BURETTE_DEV_SSH !== "1" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "") || !expected.has(`http://${req.headers.host}`) || !expected.has(req.headers.origin ?? "") || req.headers["x-burette-ssh"] !== "1") {
      sendJson(res, 403, { error: "SSH requires an enabled local Burette server and a same-origin browser request." });
      return;
    }
    if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); return; }
    let release: (() => void) | undefined;
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", abort);
    try {
      const request = await readJsonBody(req, 8192);
      const action = req.url?.split("?")[0];
      if (action === "/hosts") {
        const file = await open(join(homedir(), ".ssh/config"), "r").catch(() => null);
        if (!file) { sendJson(res, 200, []); return; }
        let config: string;
        try {
          const buffer = Buffer.alloc(512 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          config = buffer.subarray(0, bytesRead).toString();
        } finally { await file.close(); }
        const aliases = config.split(/\r?\n/).slice(0, 10000).flatMap(line => /^\s*Host\s+(.+)$/i.exec(line)?.[1].split("#")[0].trim().split(/\s+/) ?? []).filter(validHost);
        sendJson(res, 200, [...new Set(aliases)].slice(0, 256).map(alias => ({ alias })), "no-store");
        return;
      }
      if (action !== "/list" && action !== "/preview" && action !== "/delete-folder") { sendJson(res, 404, { error: "Unknown SSH operation" }); return; }
      const { host, root, path } = request;
      if (!validHost(host) || typeof root !== "string" || typeof path !== "string" || (root + path).includes("\0")) throw new Error("Invalid SSH host or remote path");
      const chemical = action === "/list" && request.chemical === true;
      const registry = chemical ? JSON.parse(await readFile(join(repoRoot, "config/preview-formats.json"), "utf8")) : null;
      const extensions = registry?.formats.filter((format: { preview?: { strategy?: string } }) => format.preview?.strategy !== "text").flatMap((format: { extensions: string[] }) => format.extensions);
      const cacheKey = JSON.stringify([host, root, path]);
      const known = action === "/preview" ? await previews.known(cacheKey) : undefined;
      const payload = JSON.stringify({ known, operation: chemical ? "discover" : action === "/delete-folder" ? "delete-folder" : action === "/list" ? "list" : "preview", root, path, ...(chemical ? { extensions } : {}) });
      if (Buffer.byteLength(payload) > 8192) throw new Error("Remote path request is too large");
      release = await requests.acquire(controller.signal);
      controller.signal.throwIfAborted();
      const started = performance.now();
      const worker = (await Promise.all(["chemistry.py", "reader.py"].map(file => readFile(join(repoRoot, "apps/desktop/src-tauri/src/commands/ssh", file), "utf8")))).join("\n");
      let session = sessions.get(host);
      if (!session) {
        if (sessions.size >= 4) {
          const idle = [...sessions.values()].find(item => !item.busy);
          if (!idle) throw new Error("SSH connections are busy. Try again shortly.");
          idle.close();
        }
        session = new SshSession(host, worker, () => { if (sessions.get(host) === session) sessions.delete(host); });
        sessions.set(host, session);
      }
      const data = await session.run(payload, action === "/preview" ? MAX_BYTES + 1024 : 2 * 1024 * 1024, controller.signal);
      res.setHeader("Server-Timing", `ssh;dur=${(performance.now() - started).toFixed(1)}`);
      if (action !== "/preview") sendJson(res, 200, JSON.parse(data.toString()), "no-store");
      else {
        sendJson(res, 200, await previews.store(cacheKey, path, data), "no-store");
      }
    } catch (error) { if (!res.destroyed) sendJsonError(res, 400, error, "no-store"); }
    finally { res.off("close", abort); release?.(); }
  });
}
