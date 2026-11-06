import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import type { ViewerDocument } from "../apps/desktop/src/types";
const controllers: WorkbenchAgentController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
const revision = `sha256-${"a".repeat(64)}`;
function request(kind: string, params?: unknown) { return { type: "workbench", operation: "submit", operationId: "energy", expectedSourceRevision: revision, job: { kind, params } }; }
test("energy contracts admit the three graph fields and Lennard-Jones, and preserve bounds", () => {
  for (const kind of ["energy", "energy_forces"]) {
    expect(validateWorkbenchRequest(request(kind))).toMatchObject({ ok: true, request: { job: { kind, params: { forceField: "MMFF94" } } } });
    for (const forceField of ["MMFF94", "MMFF94s", "UFF", "LJ"]) expect(validateWorkbenchRequest(request(kind, { forceField }))).toMatchObject({ ok: true, request: { job: { kind, params: { forceField } } } });
    for (const params of [{ forceField: "mmff94" }, { forceField: null }, { forceField: "GAFF" }, { forceField: "lj" }, { forceField: "xtb:gfn2" }, { addHydrogens: true }, { apply: true }, { method: "fire" }, { atomIndices: [0] }, []]) expect(validateWorkbenchRequest(request(kind, params))).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  }
  const contract = workbenchContractSummary();
  expect(contract.jobs.energy.artifacts).toEqual([]); expect(contract.jobs.energy_forces.artifacts).toEqual(["forces"]);
  expect(contract.limits).toMatchObject({ activeJobs: 2, queuedJobs: 8, retainedJobs: 32, requestBytes: 262144, responseBytes: 65536, artifactBytes: 16777216, jobTimeoutMs: 120000 });
});
function source(text: string, extension = "xyz") {
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `fixed.${extension}`, path: `/fixed.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document, readSource: async () => ({ text, origin: "draft" }) }); controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function finish(jobId: string) { for (let i = 0; i < 400; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(5); } throw new Error("Energy job did not finish"); }
  return { execute, ok, finish };
}
const waters = (count: number) => `${count * 3}\nSeparated explicit water fragments\n${Array.from({ length: count }, (_, i) => `O ${i * 6} 0 0\nH ${i * 6 + .95} 0 0\nH ${i * 6 - .23} .93 0`).join("\n")}\n`;
test("force jobs refuse large graphs before queueing while energy retains its larger bound", async () => {
  const exact = source(waters(21).replace(/^63/, "65") + "H 200 0 0\nH 200.74 0 0\n"), boundary = await exact.ok({ operation: "observe" });
  expect(boundary.jobs.energy.available).toBe(true); expect(boundary.jobs.energy_forces.available).toBe(false);
  expect(await exact.execute({ operation: "submit", operationId: "exact-65", expectedSourceRevision: boundary.sourceRevision, job: { kind: "energy_forces" } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  const f = source(waters(22)), observed = await f.ok({ operation: "observe" });
  expect(observed.jobs.energy).toEqual({ available: true }); expect(observed.jobs.energy_forces.available).toBe(false);
  expect(await f.execute({ operation: "submit", operationId: "force-limit", expectedSourceRevision: observed.sourceRevision, job: { kind: "energy_forces" } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  expect((await f.ok({ operation: "jobs" })).total).toBe(0);
  const accepted = await f.ok({ operation: "submit", operationId: "energy-large", expectedSourceRevision: observed.sourceRevision, job: { kind: "energy" } });
  const job = await f.finish(accepted.job.jobId);
  expect(job).toMatchObject({ status: "succeeded", binding: "current", summary: { forceField: "MMFF94", unit: "kcal/mol" }, artifacts: [] });
  expect(Number.isFinite(job.summary.energy)).toBe(true);
  expect((await f.ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
  const over = source(waters(86)), beyond = await over.ok({ operation: "observe" });
  for (const kind of ["energy", "energy_forces"]) {
    expect(beyond.jobs[kind].available).toBe(false);
    expect(await over.execute({ operation: "submit", operationId: kind, expectedSourceRevision: beyond.sourceRevision, job: { kind } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  }
  expect((await over.ok({ operation: "jobs" })).total).toBe(0);
});
test("incomplete graphs refuse the graph fields and collections refuse every field, without creating work", async () => {
  const sdf = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8");
  for (const [text, extension] of [["1\nunsaturated carbon\nC 0 0 0\n", "xyz"], [sdf + sdf, "sdf"]]) {
    const f = source(text, extension), observed = await f.ok({ operation: "observe" });
    for (const kind of ["energy", "energy_forces"]) {
      // Coordinates alone still admit Lennard-Jones.
      expect(observed.jobs[kind].available).toBe(extension === "xyz");
      for (const params of [undefined, { forceField: "UFF" }]) {
        const refused = await f.execute({ operation: "submit", operationId: kind, expectedSourceRevision: observed.sourceRevision, job: { kind, params } });
        expect(refused).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
      }
    }
    expect((await f.ok({ operation: "jobs" })).total).toBe(0);
  }
});

test("Lennard-Jones evaluates and relaxes an argon pair without a bond graph", async () => {
  const f = source("2\nargon pair\nAr 0 0 0\nAr 4.2 0 0\n"), observed = await f.ok({ operation: "observe" });
  const run = async (kind: string, params: Record<string, unknown> = {}) => {
    const accepted = await f.ok({ operation: "submit", operationId: `lj-${kind}`, expectedSourceRevision: observed.sourceRevision, job: { kind, params: { forceField: "LJ", ...params } } });
    const job = await f.finish(accepted.job.jobId);
    expect(job.status).toBe("succeeded");
    return job;
  };
  const energy = await run("energy");
  expect(energy.summary).toMatchObject({ forceField: "LJ", method: "Lennard-Jones (Avogadro parameters)", unit: "kcal/mol" });
  expect(energy.summary.energy).toBeLessThan(0);
  const forces = await run("energy_forces");
  expect(forces.summary.method).toBe("Lennard-Jones (Avogadro parameters), analytic");
  const optimized = await run("optimize");
  // Alvarez van der Waals radius of Ar: the pair settles at 2 × 1.83 Å, the well depth 100 kJ/mol.
  expect(optimized.summary).toMatchObject({ forceField: "LJ", method: "lbfgs", gradient: "analytic", converged: true });
  expect(optimized.summary.energy).toBeCloseTo(-100 / 4.184, 4);
  expect((await f.ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
});
test("implicit hydrogens fail every selected field without changing the source", async () => {
  const f = source(readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8"), "sdf"), observed = await f.ok({ operation: "observe" });
  for (const kind of ["energy", "energy_forces"]) for (const forceField of ["MMFF94", "MMFF94s", "UFF"]) {
    const submitted = await f.ok({ operation: "submit", operationId: `${kind}-${forceField}`, expectedSourceRevision: observed.sourceRevision, job: { kind, params: { forceField } } });
    const job = await f.finish(submitted.job.jobId);
    expect(job).toMatchObject({ status: "failed", summary: null, artifacts: [] });
    expect(job.error.message).toContain("explicit hydrogens");
    expect((await f.ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
  }
});

test("missing MMFF parameters fail rather than substituting UFF", async () => {
  const text = "Xenon\n  Burette           3D\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 Xe  0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n";
  const f = source(text, "mol"), observed = await f.ok({ operation: "observe" });
  for (const kind of ["energy", "energy_forces"]) {
    const submitted = await f.ok({ operation: "submit", operationId: kind, expectedSourceRevision: observed.sourceRevision, job: { kind, params: { forceField: "MMFF94" } } });
    expect(await f.finish(submitted.job.jobId)).toMatchObject({ status: "failed", summary: null, artifacts: [] });
    expect((await f.ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
  }
});
