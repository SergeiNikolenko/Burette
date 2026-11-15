import { afterEach, expect, test } from "bun:test";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { addDocumentInternalCoordinates, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { WORKBENCH_LIMITS } from "../scripts/workbench-agent-contract.mjs";
import type { ViewerDocument } from "../apps/desktop/src/types";
const text = `[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1 1\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1\n`;
const controllers: WorkbenchAgentController[] = [];
function fixture() {
  let source = text;
  const doc: ViewerDocument = { id: crypto.randomUUID(), path: "/h.molden", title: "h.molden", extension: "molden", renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  let docs = [doc];
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => docs, activeDocument: () => docs[0], readSource: async () => ({ text: source, origin: "draft" }) }); controllers.push(controller);
  const action = (request: Record<string, unknown>) => controller.execute({ type: "workbench", ...request });
  async function ok(request: Record<string, unknown>): Promise<any> { const result = await action(request); if (!result.ok) throw new Error(JSON.stringify(result)); return result.result; }
  const job = { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 0, paddingAngstrom: 0 } };
  return { doc, controller, action, ok, job, text: (value: string) => source = value,
    replace() { docs = [{ ...doc, runtimePath: "replacement" }]; }, close() { docs = []; controller.documentsChanged(new Set()); },
    async submit(id: string, revision?: string) { return ok({ operation: "submit", operationId: id, expectedSourceRevision: revision ?? (await ok({ operation: "observe" })).sourceRevision, job }); },
    async finish(id: string) { for (let i = 0; i < 200; i++) { const { job } = await ok({ operation: "status", jobId: id }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(5); } throw new Error("job timeout"); },
  };
}
const NativeWorker = Worker, descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
let hold = false;
const held: HeldWorker[] = [];
class HeldWorker extends NativeWorker {
  pending?: unknown; stopped = false;
  constructor(...args: ConstructorParameters<typeof NativeWorker>) { super(...args); held.push(this); }
  override postMessage(message: unknown, transfer: Transferable[]): void;
  override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  override postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
    if (hold && (message as { type?: string }).type === "evaluate-field") { this.pending = structuredClone(message); return; }
    if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options);
  }
  release() { if (this.pending && !this.stopped) { super.postMessage(this.pending); this.pending = undefined; } }
  override terminate() { this.stopped = true; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { ...descriptor, value: HeldWorker });
afterEach(() => { hold = false; for (const controller of controllers.splice(0)) controller.dispose(); for (const worker of held.splice(0)) worker.terminate(); releaseClosedImports(new Set()); });
// Restore once all test callbacks have run.
import { afterAll } from "bun:test";
afterAll(() => Object.defineProperty(globalThis, "Worker", descriptor));



test("existing two-worker/eight-queued registry enforces bounds and cancellation terminates workers without late publication", async () => {
  const f = fixture(), revision = (await f.ok({ operation: "observe" })).sourceRevision;
  hold = true;
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push((await f.submit(`queue-${i}`, revision)).job);
  expect(jobs.map(job => job.status)).toEqual(["running", "running", ...Array(8).fill("queued")]);
  expect(await f.action({ operation: "submit", operationId: "overflow", expectedSourceRevision: revision, job: f.job })).toMatchObject({ ok: false, error: { code: "JOB_QUEUE_FULL" } });
  expect((await f.submit("queue-2", revision)).deduplicated).toBe(true);
  expect(await f.action({ operation: "submit", operationId: "queue-2", expectedSourceRevision: revision, job: { ...f.job, params: { ...f.job.params, paddingAngstrom: 1 } } })).toMatchObject({ ok: false, error: { code: "OPERATION_ID_CONFLICT" } });
  const firstWorker = held.find(worker => worker.pending)!;
  expect((await f.ok({ operation: "cancel", jobId: jobs[0].jobId })).cancelled).toBe(true);
  expect(firstWorker.stopped).toBe(true);
  expect((await f.ok({ operation: "cancel", jobId: jobs[0].jobId })).cancelled).toBe(false);
  hold = false; for (const worker of held) worker.release();
  expect((await f.finish(jobs[9].jobId)).status).toBe("succeeded");
  expect((await f.ok({ operation: "status", jobId: jobs[0].jobId })).job).toMatchObject({ status: "cancelled", artifacts: [], summary: null });
  expect(await f.action({ operation: "export", jobId: jobs[0].jobId, artifact: "cube" })).toMatchObject({ ok: false, error: { code: "JOB_NOT_SUCCEEDED" } });
});

test("queued jobs retain immutable input when attached science changes, and document replacement releases results", async () => {
  const f = fixture(), science = parseScientificFile("h.molden", text); addDocumentInternalCoordinates(f.doc.id, text, science);
  const revision = (await f.ok({ operation: "observe" })).sourceRevision; hold = true;
  await f.submit("hold-1", revision); await f.submit("hold-2", revision);
  const { job } = await f.submit("queued-original", revision);
  science.orbitals[0].coefficients[0] = -1;
  hold = false; for (const worker of held) worker.release();
  const done = await f.finish(job.jobId); expect([done.status, done.summary.max]).toEqual(["stale", Math.fround((2 / Math.PI) ** 0.75)]); expect(done.summary.min).toBeGreaterThan(0);
  f.replace(); expect((await f.ok({ operation: "status", jobId: job.jobId })).job).toMatchObject({ status: "source_closed", artifacts: [], summary: null });
});

test("real evaluator limits become bounded failed jobs; closing and disposal revoke work", async () => {
  const f = fixture(), revision = (await f.ok({ operation: "observe" })).sourceRevision;
  const failed = await f.ok({ operation: "submit", operationId: "expensive-grid", expectedSourceRevision: revision,
    job: { kind: "orbital_cube", params: { field: "density", spacingAngstrom: 0.1, paddingAngstrom: 10 } } });
  expect(await f.finish(failed.job.jobId)).toMatchObject({ status: "failed", error: { code: "JOB_FAILED" }, artifacts: [] });
  expect(await f.action({ operation: "submit", operationId: "invalid-index", expectedSourceRevision: revision,
    job: { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 99 } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  hold = true; const { job } = await f.submit("closing"); f.close();
  expect((await f.ok({ operation: "status", jobId: job.jobId })).job.status).toBe("source_closed");
  f.controller.dispose(); expect(await f.action({ operation: "capabilities" })).toMatchObject({ ok: false, error: { code: "WORKBENCH_CLOSED" } });
});

test("retention evicts the oldest terminal operation and source size limits reject drafts before parsing", async () => {
  const f = fixture(); let oldest = "";
  for (let i = 0; i < WORKBENCH_LIMITS.retainedJobs + 1; i++) { const { job } = await f.submit(`retention-${i}`); oldest ||= job.jobId; await f.finish(job.jobId); }
  expect(await f.action({ operation: "status", jobId: oldest })).toMatchObject({ ok: false, error: { code: "JOB_NOT_FOUND" } });
  expect((await f.ok({ operation: "jobs" })).total).toBe(WORKBENCH_LIMITS.retainedJobs);
  f.text(" ".repeat(12 * 1024 * 1024 + 1));
  expect(await f.action({ operation: "observe" })).toMatchObject({ ok: false, error: { code: "SOURCE_TOO_LARGE" } });
});

test("an explicit oblique grid reaches the evaluator and its geometry is reported", async () => {
  const f = fixture(), revision = (await f.ok({ operation: "observe" })).sourceRevision;
  const grid = { origin: [-0.5, -0.4, -0.3], axes: [[0.25, 0.05, 0], [0, 0.2, 0.04], [0.03, 0, 0.3]], dimensions: [3, 4, 2] };
  const { job } = await f.ok({ operation: "submit", operationId: "oblique", expectedSourceRevision: revision, job: { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 0, grid } } });
  const done = await f.finish(job.jobId);
  expect(done.summary).toMatchObject({ dimensions: grid.dimensions, origin: grid.origin, axes: grid.axes, pointCount: 24 });
  // The single unit-exponent s function on the atom at the origin, at every point origin + i·a + j·b + k·c (bohr⁻³ᐟ²).
  const values = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 2; k++) {
    const r2 = [0, 1, 2].reduce((sum, d) => sum + ((grid.origin[d] + i * grid.axes[0][d] + j * grid.axes[1][d] + k * grid.axes[2][d]) / 0.529177210903) ** 2, 0);
    values.push((2 / Math.PI) ** 0.75 * Math.exp(-r2));
  }
  expect(done.summary.max).toBeCloseTo(Math.max(...values), 6);
  expect(done.summary.min).toBeCloseTo(Math.min(...values), 6);
});
