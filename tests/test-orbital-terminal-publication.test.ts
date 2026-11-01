import { afterEach, expect, test } from "bun:test";
import { createWorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import type { ViewerDocument } from "../apps/desktop/src/types";

const text = `[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1 1\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1\n`;
const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

for (const outcome of ["complete", "cancel", "close"] as const) {
  test(`terminal publication waits for the actual source read; ${outcome} during completion`, async () => {
    const document: ViewerDocument = { id: crypto.randomUUID(), path: "/hydrogen.molden", title: "hydrogen.molden", extension: "molden", renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
    let documents = [document], holdRead = false, entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true,
      documents: () => documents, activeDocument: () => documents[0], readSource: async () => {
        if (holdRead) { entered(); await barrier; }
        return { text, origin: "draft" };
      } });
    disposers.push(() => { release(); controller.dispose(); });
    async function ok(request: Record<string, unknown>): Promise<any> {
      const result = await controller.execute({ type: "workbench", ...request });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.result;
    }
    const observed = await ok({ operation: "observe" });
    const { job: submitted } = await ok({ operation: "submit", operationId: outcome, expectedSourceRevision: observed.sourceRevision,
      job: { kind: "orbital_cube", params: { field: "orbital", orbitalIndex: 0, paddingAngstrom: 0 } } });
    // The reader/quantum/Cube workers are real. Only the environment's source read
    // at final binding refresh is delayed; jobs lists do not perform source reads.
    holdRead = true;
    await Promise.race([entering, Bun.sleep(5000).then(() => { throw new Error("completion read was not reached"); })]);
    const pending = (await ok({ operation: "jobs" })).items[0];
    expect([pending.status, pending.summary, pending.artifacts, pending.finishedAt]).toEqual(["running", null, [], null]);
    if (outcome === "cancel") expect((await ok({ operation: "cancel", jobId: submitted.jobId })).job.status).toBe("cancelled");
    if (outcome === "close") { documents = []; controller.documentsChanged(new Set()); }
    holdRead = false; release();
    let final = pending;
    for (let i = 0; i < 200; i++) {
      final = (await ok({ operation: "status", jobId: submitted.jobId })).job;
      if (final.status !== "running") break;
      await Bun.sleep(5);
    }
    expect(final.status).toBe(outcome === "complete" ? "succeeded" : outcome === "cancel" ? "cancelled" : "source_closed");
    expect(final.finishedAt).not.toBeNull();
    if (outcome === "complete") {
      expect(final.summary).toMatchObject({ field: "orbital", pointCount: 8 });
      expect(final.artifacts.map((artifact: { name: string }) => artifact.name)).toEqual(["cube"]);
    } else {
      expect([final.summary, final.artifacts]).toEqual([null, []]);
      const exported = await controller.execute({ type: "workbench", operation: "export", jobId: submitted.jobId, artifact: "cube" });
      expect(exported).toMatchObject({ ok: false, error: { code: outcome === "cancel" ? "JOB_NOT_SUCCEEDED" : "SOURCE_CLOSED" } });
    }
  }, 10000);
}
