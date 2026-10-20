import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { batchSchema, identitySchema, TelemetryStore } from "./store";

const MAX_BODY = 16_384;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

async function body(request: Request): Promise<unknown> {
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/json")) throw new Error("body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) throw new Error("size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Behind a TLS reverse proxy with access logs disabled. No cookies or CORS.
 * The native client sends a random credential in the body, never in the URL.
 */
export function telemetryHandler(store: TelemetryStore, adminToken: string) {
  let windowStart = Date.now();
  let requests = 0;
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return json({ ok: true });
    if (request.headers.has("origin")) return json({ error: "native_only" }, 403);
    if (path === "/summary" && request.method === "GET") {
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      const expected = Buffer.from(`Bearer ${adminToken}`);
      if (!adminToken || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ error: "unauthorized" }, 401);
      store.prune();
      return json(store.summary());
    }
    if (!["/events", "/erase", "/export"].includes(path) || request.method !== "POST") return json({ error: "not_found" }, 404);
    // Bound public ingestion without retaining IPs, user agents or other metadata.
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (path === "/events" && ++requests > 1200) return json({ error: "rate_limit" }, 429);
    try {
      const data = await body(request);
      store.prune();
      if (path === "/events") {
        const parsed = batchSchema.safeParse(data);
        if (!parsed.success) return json({ error: "invalid_batch" }, 400);
        const result = store.ingest(parsed.data);
        return json({ result }, result === "revoked" ? 410 : result === "limited" ? 429 : 200);
      }
      const parsed = identitySchema.safeParse(data);
      if (!parsed.success) return json({ error: "invalid_identity" }, 400);
      if (path === "/erase") {
        store.erase(parsed.data.installationId);
        return json({ erased: true });
      }
      return json(store.export(parsed.data.installationId));
    } catch {
      return json({ error: "request_failed" }, 400);
    }
  };
}

if (import.meta.main) {
  const path = process.env.BURETTE_TELEMETRY_DB;
  const adminToken = process.env.BURETTE_TELEMETRY_ADMIN_TOKEN;
  if (!path || !adminToken || adminToken.length < 32) throw new Error("Set a private database path and an admin token of at least 32 characters.");
  process.umask(0o077);
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  const store = new TelemetryStore(db);
  const pruneTimer = setInterval(() => store.prune(), 3_600_000);
  const server = Bun.serve({
    hostname: "127.0.0.1", port: Number(process.env.PORT ?? 43180),
    maxRequestBodySize: MAX_BODY, idleTimeout: 10,
    fetch: telemetryHandler(store, adminToken),
  });
  const stop = () => { clearInterval(pruneTimer); server.stop(); db.close(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
