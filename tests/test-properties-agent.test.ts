import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import type { ViewerDocument } from "../apps/desktop/src/types";
const controllers: WorkbenchAgentController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
function source(text: string, extension = "xyz") {
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `source.${extension}`, path: `/source.${extension}`, extension,
    renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document,
    readSource: async () => ({ text, origin: "draft" }) }); controllers.push(controller);
  const execute = (request: Record<string, unknown>) => controller.execute({ type: "workbench", ...request });
  async function ok(request: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(request); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function finish(jobId: string) { for (let i = 0; i < 200; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(5); } throw new Error("Property job did not finish"); }
  return { execute, ok, finish };
}
test("properties follows the existing complete-graph XYZ policy with explicit source-order charges", async () => {
  const text = "3\nexplicit water\nO 0 0 0\nH 0.95 0 0\nH -0.23 0.93 0\n", f = source(text);
  const observed = await f.ok({ operation: "observe" }); expect(observed.jobs.properties).toEqual({ available: true });
  const submit = (operationId: string, params: object) => f.ok({ operation: "submit", operationId, expectedSourceRevision: observed.sourceRevision, job: { kind: "properties", params } });
  const ordinary = await f.finish((await submit("plain", {})).job.jobId);
  expect(ordinary).toMatchObject({ status: "succeeded", binding: "current", summary: { formula: "H2O", atomCount: 3, bondCount: 2, charge: 0 }, artifacts: [] });
  expect(ordinary.summary.partialCharges).toBeUndefined();
  const charged = await f.finish((await submit("charges", { chargeModel: "Gasteiger" })).job.jobId);
  expect(charged).toMatchObject({ status: "succeeded", summary: { partialCharges: { model: "Gasteiger", unit: "e", iterations: 12 } }, artifacts: [] });
  const reference = JSON.parse(readFileSync(new URL("./fixtures/forcefield/rdkit-reference.json", import.meta.url), "utf8")).records.find((item: { smiles: string }) => item.smiles === "O").charges;
  expect(charged.summary.partialCharges.charges).toHaveLength(reference.length);
  charged.summary.partialCharges.charges.forEach((value: number, index: number) => expect(Math.abs(value - reference[index])).toBeLessThan(1e-7));
  expect(Math.abs(charged.summary.partialCharges.charges.reduce((a: number, b: number) => a + b, 0))).toBeLessThan(1e-8);
  expect((await f.ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
});
test("incomplete XYZ and multiple SDF records remain unavailable rather than adding atoms or guessing a graph", async () => {
  const sdf = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8");
  for (const [text, extension] of [["1\nunsaturated carbon\nC 0 0 0\n", "xyz"], [sdf + sdf, "sdf"]]) {
    const f = source(text, extension), observed = await f.ok({ operation: "observe" });
    expect(observed.jobs.properties.available).toBe(false);
    expect(await f.execute({ operation: "submit", operationId: "refused", expectedSourceRevision: observed.sourceRevision, job: { kind: "properties", params: {} } }))
      .toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
    expect((await f.ok({ operation: "jobs" })).total).toBe(0);
  }
});
test("properties keeps desktop and widget computation disabled before source reads", async () => {
  for (const runtime of ["desktop-app", "plugin-widget"] as const) {
    const controller = createWorkbenchAgentController({ runtime, draftsVisible: false, documents: () => [], activeDocument: () => null,
      readSource: async () => { throw new Error("Unsupported surfaces must not read molecular data"); } }); controllers.push(controller);
    expect(await controller.execute({ type: "workbench", operation: "submit", operationId: "unsupported", expectedSourceRevision: `sha256-${"a".repeat(64)}`, job: { kind: "properties", params: {} } }))
      .toMatchObject({ ok: false, error: { code: "SURFACE_UNSUPPORTED" } });
  }
});
