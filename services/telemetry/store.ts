import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";

export const CONSENT_VERSION = "2026-10-20";
export const RETENTION_DAYS = 90;
const DAY = 86_400_000;
const uuid = z.uuid();
export const identitySchema = z.object({ installationId: uuid }).strict();
const eventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active"), value: z.literal("day") }).strict(),
  z.object({ kind: z.literal("feature"), value: z.enum([
    "structure", "table", "editor", "trajectory", "docking", "compute", "files", "export",
  ]) }).strict(),
  z.object({ kind: z.literal("error"), value: z.enum([
    "network", "parse", "render", "timeout", "permission", "unsupported", "unknown",
  ]) }).strict(),
]);
export const batchSchema = identitySchema.extend({
  consentVersion: z.literal(CONSENT_VERSION),
  batchId: uuid,
  appVersion: z.string().regex(/^\d{1,4}(?:\.\d{1,4}){2}$/),
  architecture: z.enum(["arm64", "x64"]),
  events: z.array(eventSchema).min(1).max(64),
}).strict();
type Batch = z.infer<typeof batchSchema>;

/** Only the digest of the random installation credential reaches disk.
 * No request metadata, raw errors, files, or arbitrary event properties are stored.
 */
export class TelemetryStore {
  constructor(private db: Database, private now = () => Date.now()) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS consent (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, received INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revoked (id TEXT PRIMARY KEY, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT NOT NULL, batch TEXT NOT NULL, received INTEGER NOT NULL,
        PRIMARY KEY (id, batch)
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT NOT NULL, day TEXT NOT NULL, version TEXT NOT NULL, arch TEXT NOT NULL,
        kind TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (id, day, version, arch, kind, value)
      );
    `);
    this.prune();
  }

  private digest(id: string) {
    return createHash("sha256").update(id).digest("hex");
  }

  prune() {
    const now = this.now();
    const oldestDay = new Date(now - RETENTION_DAYS * DAY).toISOString().slice(0, 10);
    this.db.transaction(() => {
      this.db.run("DELETE FROM events WHERE day <= ?", [oldestDay]);
      this.db.run("DELETE FROM batches WHERE received <= ?", [now - 2 * DAY]);
      this.db.run("DELETE FROM revoked WHERE until <= ?", [now]);
      this.db.run("DELETE FROM consent WHERE id NOT IN (SELECT DISTINCT id FROM events)");
    })();
  }

  ingest(batch: Batch): "accepted" | "revoked" | "limited" {
    const id = this.digest(batch.installationId);
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    return this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM revoked WHERE id = ? AND until > ?").get(id, now)) return "revoked";
      if (this.db.query("SELECT 1 FROM batches WHERE id = ? AND batch = ?").get(id, batch.batchId)) return "accepted";
      const total = this.db.query<{ n: number }, [string, string]>(
        "SELECT coalesce(sum(count), 0) AS n FROM events WHERE id = ? AND day = ?",
      ).get(id, day)!.n;
      if (total + batch.events.length > 1000) return "limited";
      this.db.run("INSERT OR IGNORE INTO consent VALUES (?, ?, ?)", [id, batch.consentVersion, now]);
      this.db.run("INSERT INTO batches VALUES (?, ?, ?)", [id, batch.batchId, now]);
      for (const event of batch.events) {
        this.db.run(`INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT DO UPDATE SET count = CASE WHEN excluded.kind = 'active' THEN 1 ELSE count + 1 END`,
        [id, day, batch.appVersion, batch.architecture, event.kind, event.value]);
      }
      return "accepted";
    })();
  }

  erase(installationId: string) {
    const id = this.digest(installationId);
    this.db.transaction(() => {
      this.db.run("DELETE FROM events WHERE id = ?", [id]);
      this.db.run("DELETE FROM consent WHERE id = ?", [id]);
      this.db.run("DELETE FROM batches WHERE id = ?", [id]);
      // A late in-flight request cannot recreate data after erasure.
      this.db.run("INSERT OR REPLACE INTO revoked VALUES (?, ?)", [id, this.now() + RETENTION_DAYS * DAY]);
    })();
  }

  export(installationId: string) {
    const id = this.digest(installationId);
    return {
      consent: this.db.query("SELECT version, received FROM consent WHERE id = ?").get(id),
      dailyStatistics: this.db.query(`SELECT day, version, arch, kind, value, count
        FROM events WHERE id = ? ORDER BY day, kind, value`).all(id),
      deletionPending: false,
    };
  }

  summary() {
    return {
      retentionDays: RETENTION_DAYS,
      dailyActiveInstallations: this.db.query(`SELECT day, count(DISTINCT id) AS installations
        FROM events WHERE kind = 'active' GROUP BY day ORDER BY day`).all(),
      featuresAndErrors: this.db.query(`SELECT kind, value, sum(count) AS events, count(DISTINCT id) AS installations
        FROM events WHERE kind != 'active' GROUP BY kind, value ORDER BY kind, value`).all(),
      versions: this.db.query(`SELECT version, arch, count(DISTINCT id) AS installations
        FROM events GROUP BY version, arch ORDER BY version`).all(),
    };
  }
}
