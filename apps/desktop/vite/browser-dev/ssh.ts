import { spawn } from "node:child_process";
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
  const children = new Set<() => void>();
  server.httpServer?.once("close", () => {
    for (const stop of children) stop();
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
      const payload = JSON.stringify({ operation: action === "/list" ? "list" : "read", root, path });
      if (Buffer.byteLength(payload) > 8192) throw new Error("Remote path request is too large");
      if (active >= 2) { sendJson(res, 429, { error: "Two SSH requests are running. Try again when they finish." }); return; }
      active++; acquired = true;
      if (action === "/preview") {
        if (filesCached + downloads >= 256 || bytesCached + (downloads + 1) * MAX_BYTES > 512 * 1024 * 1024) throw new Error("SSH preview cache is full. Restart the preview server to clear it.");
        downloads++; downloading = true;
      }
      const started = performance.now();
      const worker = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/commands/ssh/reader.py"), "utf8");
      const data = await new Promise<Buffer>((resolve, reject) => {
        const child = spawn("/usr/bin/ssh", ["-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes", "-oConnectTimeout=10", "-oServerAliveInterval=5", "-oServerAliveCountMax=2", "-oForwardAgent=no", "-oClearAllForwardings=yes", "--", host, `python3 -c '${worker.replaceAll("'", "'\\''")}'`], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
        let failure: Error | undefined;
        const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } } };
        children.add(stop);
        const abort = () => { if (!res.writableEnded) { failure = new Error("SSH request cancelled"); stop(); } };
        res.once("close", abort);
        const timer = setTimeout(() => { failure = new Error("SSH request timed out after 45 seconds"); stop(); }, 45000);
        const chunks: Buffer[] = [];
        let size = 0;
        let errors = "";
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > (action === "/list" ? 2 * 1024 * 1024 : MAX_BYTES)) { failure = new Error("SSH response exceeds the preview limit"); stop(); }
          else chunks.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(0, 8192); });
        child.on("error", error => { failure = error; });
        child.stdin.on("error", error => { failure = error; stop(); });
        child.on("close", code => {
          clearTimeout(timer); children.delete(stop); res.off("close", abort);
          if (failure || code !== 0) reject(failure ?? new Error(errors.trim() || `SSH exited with status ${code}`));
          else resolve(Buffer.concat(chunks));
        });
        child.stdin.end(payload);
      });
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
