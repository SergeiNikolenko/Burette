import { SshSession } from "./ssh-session";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ViteDevServer } from "vite";
import { readJsonBody, sendJson, sendJsonError } from "./http";

const MAX_BYTES = 64 * 1024 * 1024;
const validHost = (host: unknown): host is string => typeof host === "string" && /^[a-zA-Z0-9._@:][a-zA-Z0-9._@:-]{0,254}$/.test(host);

// The browser never gets SSH credentials. This opt-in, loopback-only transport
// runs the same read-only Python worker as the native app, through system SSH.
export function registerBrowserDevSshRoutes(server: ViteDevServer, repoRoot: string) {
  let active = 0;
  let bytesCached = 0;
  let filesCached = 0;
  let downloads = 0;
  let cache: Promise<string> | undefined;
  const cacheRoot = () => cache ??= mkdir(join(repoRoot, "node_modules/.cache"), { recursive: true }).then(() => mkdtemp(join(repoRoot, "node_modules/.cache/burette-ssh-")));
  const sessions = new Map<string, SshSession>();
  server.httpServer?.once("close", () => {
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
    let acquired = false;
    let downloading = false;
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
      if (action !== "/list" && action !== "/preview") { sendJson(res, 404, { error: "Unknown SSH operation" }); return; }
      const { host, root, path } = request;
      if (!validHost(host) || typeof root !== "string" || typeof path !== "string" || (root + path).includes("\0")) throw new Error("Invalid SSH host or remote path");
      const chemical = action === "/list" && request.chemical === true;
      const registry = chemical ? JSON.parse(await readFile(join(repoRoot, "config/preview-formats.json"), "utf8")) : null;
      const extensions = registry?.formats.filter((format: { preview?: { strategy?: string } }) => format.preview?.strategy !== "text").flatMap((format: { extensions: string[] }) => format.extensions);
      const payload = JSON.stringify({ operation: chemical ? "discover" : action === "/list" ? "list" : "read", root, path, ...(chemical ? { extensions } : {}) });
      if (Buffer.byteLength(payload) > 8192) throw new Error("Remote path request is too large");
      if (active >= 2) { sendJson(res, 429, { error: "Two SSH requests are running. Try again when they finish." }); return; }
      active++; acquired = true;
      if (action === "/preview") {
        if (filesCached + downloads >= 256 || bytesCached + (downloads + 1) * MAX_BYTES > 512 * 1024 * 1024) throw new Error("SSH preview cache is full. Restart the preview server to clear it.");
        downloads++; downloading = true;
      }
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
      const controller = new AbortController();
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      res.once("close", abort);
      let data: Buffer;
      try { data = await session.run(payload, action === "/list" ? 2 * 1024 * 1024 : MAX_BYTES, controller.signal); }
      finally { res.off("close", abort); }
      res.setHeader("Server-Timing", `ssh;dur=${(performance.now() - started).toFixed(1)}`);
      if (action === "/list") sendJson(res, 200, JSON.parse(data.toString()), "no-store");
      else {
        const parent = join(await cacheRoot(), "ssh-previews");
        await mkdir(parent, { recursive: true, mode: 0o700 });
        const folder = await mkdtemp(join(parent, "file-"));
        const destination = join(folder, basename(path));
        await writeFile(destination, data, { mode: 0o600, flag: "wx" });
        bytesCached += data.length; filesCached++;
        sendJson(res, 200, destination, "no-store");
      }
    } catch (error) { if (!res.destroyed) sendJsonError(res, 400, error, "no-store"); }
    finally { if (acquired) active--; if (downloading) downloads--; }
  });
}
