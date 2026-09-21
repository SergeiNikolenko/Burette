import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// One sequential worker per host. No SSH multiplexing or user-config changes.
// Idle sessions expire; each response is length framed and bounded before buffering.
export class SshSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private chunks: Buffer[] = [];
  private received = 0;
  private header: { ok: boolean; length: number } | null = null;
  private errors = "";
  private idle?: ReturnType<typeof setTimeout>;
  private pending?: { resolve: (data: Buffer) => void; reject: (error: Error) => void; limit: number; timer: ReturnType<typeof setTimeout> };
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(host: string, worker: string, private onClose: () => void) {
    this.child = spawn("/usr/bin/ssh", ["-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes", "-oConnectTimeout=10", "-oServerAliveInterval=5", "-oServerAliveCountMax=2", "-oForwardAgent=no", "-oClearAllForwardings=yes", "--", host, `python3 -u -c '${worker.replaceAll("'", "'\\''")}' --session`], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => { this.errors = (this.errors + chunk.toString()).slice(0, 8192); });
    this.child.on("error", error => this.close(error));
    this.child.stdin.on("error", error => this.close(error));
    this.child.on("close", () => this.close(new Error(this.errors.trim() || "SSH connection closed. Try again.")));
  }
  get busy() { return this.queued > 0; }
  run(payload: string, limit: number, signal: AbortSignal): Promise<Buffer> {
    if (this.queued >= 2) return Promise.reject(new Error("SSH connection is busy. Try again when loading finishes."));
    this.queued++;
    if (this.idle) clearTimeout(this.idle);
    const result = this.tail.catch(() => {}).then(() => new Promise<Buffer>((resolve, reject) => {
      if (this.closed || signal.aborted) { reject(new Error("SSH connection closed or request cancelled. Try again.")); return; }
      const abort = () => this.close(new Error("SSH request cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      const finish = (error?: Error, data?: Buffer) => {
        signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(data!);
      };
      this.pending = {
        resolve: data => finish(undefined, data), reject: error => finish(error), limit,
        timer: setTimeout(() => this.close(new Error("SSH request timed out after 45 seconds")), 45000),
      };
      this.child.stdin.write(payload + "\n");
    })).finally(() => {
      this.queued--;
      if (!this.closed && this.queued === 0) this.idle = setTimeout(() => this.close(), 60000);
    });
    this.tail = result;
    return result;
  }
  private receive(chunk: Buffer) {
    const pending = this.pending;
    if (!pending) { this.close(new Error("Unexpected SSH response")); return; }
    if (!this.header) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const end = this.buffer.indexOf(10);
      if (end < 0) { if (this.buffer.length > 1024) this.close(new Error("Invalid SSH response header")); return; }
      if (end > 1024) { this.close(new Error("Invalid SSH response header")); return; }
      try {
        const value = JSON.parse(this.buffer.subarray(0, end).toString());
        if (typeof value.ok !== "boolean" || !Number.isSafeInteger(value.length) || value.length < 0 || value.length > (value.ok ? pending.limit : 8192)) throw new Error();
        this.header = value;
        chunk = this.buffer.subarray(end + 1);
        this.buffer = Buffer.alloc(0);
      } catch { this.close(new Error("Invalid SSH response header")); return; }
    }
    const header = this.header!;
    this.received += chunk.length;
    if (this.received > header.length) { this.close(new Error("Unexpected trailing SSH response")); return; }
    if (chunk.length) this.chunks.push(chunk);
    if (this.received < header.length) return;
    const data = Buffer.concat(this.chunks, this.received);
    this.chunks = []; this.received = 0; this.header = null; this.pending = undefined;
    clearTimeout(pending.timer);
    if (header.ok) pending.resolve(data); else pending.reject(new Error(data.toString()));
  }
  close(error = new Error("SSH session closed")) {
    if (this.closed) return;
    this.closed = true;
    if (this.idle) clearTimeout(this.idle);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.buffer = Buffer.alloc(0); this.chunks = []; this.received = 0;
    if (this.child.pid) { try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* Already exited. */ } }
    this.onClose();
  }
}
