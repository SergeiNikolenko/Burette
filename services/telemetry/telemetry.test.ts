import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { batchSchema, CONSENT_VERSION, TelemetryStore } from "./store";
import { telemetryHandler } from "./server";

const identity = () => ({ installationId: crypto.randomUUID() });
const batch = () => ({
  ...identity(), batchId: crypto.randomUUID(), consentVersion: CONSENT_VERSION,
  appVersion: "2026.10.18", architecture: "arm64",
  events: [{ kind: "active", value: "day" }, { kind: "feature", value: "editor" }],
});
const request = (path: string, value: unknown, headers = {}) => new Request(`https://statistics.example${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value),
});

describe("optional statistics receiver", () => {
  test("validates the entire payload, rejecting arbitrary strings and extra data", () => {
    const valid = batch();
    expect(batchSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, filename: "/private/molecule.sdf" },
      { ...valid, consentVersion: "old" },
      { ...valid, appVersion: "my-private-machine" },
      { ...valid, events: [{ kind: "error", value: "parse", message: "private text" }] },
      { ...valid, events: [{ kind: "feature", value: "/private/path" }] },
      { ...valid, events: Array(65).fill(valid.events[0]) },
    ]) expect(batchSchema.safeParse(invalid).success).toBe(false);
  });

  test("deduplicates retries, aggregates activity, and isolates installation exports", async () => {
    const db = new Database(":memory:");
    const store = new TelemetryStore(db);
    const handle = telemetryHandler(store, "secret");
    const first = batch();
    expect((await handle(request("/events", first))).status).toBe(200);
    expect((await handle(request("/events", first))).status).toBe(200);
    await handle(request("/events", { ...first, batchId: crypto.randomUUID() }));
    const own = store.export(first.installationId);
    expect(own.dailyStatistics).toMatchObject([{ kind: "active", count: 1 }, { kind: "feature", count: 2 }]);
    expect(store.export(identity().installationId).dailyStatistics).toEqual([]);
    expect(JSON.stringify(store.summary())).not.toContain(first.installationId);
    expect((await handle(new Request("https://statistics.example/summary"))).status).toBe(401);
    db.close();
  });

  test("erasure removes events and consent and rejects late uploads", async () => {
    const db = new Database(":memory:");
    const store = new TelemetryStore(db);
    const handle = telemetryHandler(store, "secret");
    const first = batch();
    await handle(request("/events", first));
    const erase = request("/erase", { installationId: first.installationId });
    expect((await handle(erase)).status).toBe(200);
    expect(store.export(first.installationId)).toEqual({ consent: null, dailyStatistics: [], deletionPending: false });
    expect((await handle(request("/events", { ...first, batchId: crypto.randomUUID() }))).status).toBe(410);
    db.close();
  });

  test("expires statistics after 90 days even for a continuing installation", () => {
    const db = new Database(":memory:");
    let now = Date.UTC(2026, 0, 1);
    const store = new TelemetryStore(db, () => now);
    const first = batchSchema.parse(batch());
    store.ingest(first);
    now += 89 * 86_400_000;
    store.ingest({ ...first, batchId: crypto.randomUUID() });
    now += 86_400_000;
    store.prune();
    expect(store.export(first.installationId).dailyStatistics).toHaveLength(2);
    now += 90 * 86_400_000;
    store.prune();
    expect(store.export(first.installationId).consent).toBeNull();
    expect(store.export(first.installationId).dailyStatistics).toEqual([]);
    db.close();
  });

  test("rejects browser requests and oversized bodies before ingestion", async () => {
    const db = new Database(":memory:");
    const handle = telemetryHandler(new TelemetryStore(db), "secret");
    expect((await handle(request("/events", batch(), { origin: "https://other.example" }))).status).toBe(403);
    expect((await handle(request("/events", "x".repeat(20_000)))).status).toBe(400);
    expect((await handle(request("/events", { ...batch(), consentVersion: undefined }))).status).toBe(400);
    db.close();
  });
});
