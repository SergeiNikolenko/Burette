import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

// A stand-in for the native energy_models commands: a harmonic well at the origin
// (E = Σ|r|², ∇E = 2r), energies already in kcal/mol as the native module returns them.
type Args = Record<string, any>;
let calls: [string, Args | undefined][] = [];
let finite = true;
const sessions = new Map<string, Args>();
const listed = [
  { id: "xtb:gfn2", name: "GFN2-xTB", description: "", source: "xtb", inputFormat: null, gradients: true, ions: true, radicals: true, unitCell: false,
    elements: Array.from({ length: 86 }, (_, i) => i + 1), unavailable: null },
  { id: "avogadro:pending/model", name: "Pending", description: "", source: "pending", inputFormat: "xyz", gradients: true, ions: true, radicals: true, unitCell: false,
    elements: [1, 6, 8], unavailable: "Set up pending in Settings › Extensions first" },
];
async function native(command: string, args?: Args): Promise<unknown> {
  calls.push([command, args]);
  if (command === "energy_models_list") return listed;
  if (command === "energy_model_open") { const id = `session-${calls.length}`; sessions.set(id, args!.request); return id; }
  if (command === "energy_model_close") { sessions.delete(args!.session); return null; }
  const x: number[] = args!.coordinates;
  return finite ? { energy: x.reduce((sum, v) => sum + v * v, 0), gradient: x.map(v => 2 * v) } : { energy: null, gradient: null };
}
const tauri = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauri, invoke: native }));
const models = await import("../apps/desktop/src/lib/molecular-workbench/external-energy-models");
const { createWorkbenchAgentController } = await import("../apps/desktop/src/lib/workbench/agent-controller");
type Controller = ReturnType<typeof createWorkbenchAgentController>;

const controllers: Controller[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); calls = []; finite = true; });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/automation/${name}`, import.meta.url), "utf8");
const commands = () => calls.map(([command]) => command);
const well = (atoms: { x: number; y: number; z: number }[]) => atoms.reduce((sum, atom) => sum + atom.x ** 2 + atom.y ** 2 + atom.z ** 2, 0);

function workspace(text: string, extension: string) {
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `fixture.${extension}`, path: `/fixture.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document, readSource: async () => ({ text, origin: "file" }) });
  controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function submit(kind: string, params: Record<string, unknown>) {
    const { sourceRevision } = await ok({ operation: "observe" });
    return execute({ operation: "submit", operationId: `${kind}-${crypto.randomUUID()}`, expectedSourceRevision: sourceRevision, job: { kind, params } });
  }
  async function run(kind: string, params: Record<string, unknown>) {
    const submitted = await submit(kind, params);
    if (!submitted.ok) throw new Error(JSON.stringify(submitted.error));
    for (let i = 0; i < 2000; i++) {
      const { job } = await ok({ operation: "status", jobId: submitted.result.job.jobId });
      if (!["queued", "running"].includes(job.status)) return job;
      await Bun.sleep(5);
    }
    throw new Error("job did not finish");
  }
  const exported = async (jobId: string, artifact: string) => (await ok({ operation: "export", jobId, artifact })).artifact.content as string;
  return { submit, run, exported };
}
const water = () => workspace(fixture("water-trajectory.xyz").split("3\nwater frame 1")[0], "xyz");

test("the browser shell lists no external models and refuses them without opening a session", async () => {
  const job = await water().run("energy", { forceField: "xtb:gfn2" });
  expect(job).toMatchObject({ status: "failed", summary: null, error: { message: "External energy models run only in the Burette desktop app." } });
  expect(commands()).not.toContain("energy_model_open");
});

test("energy and forces evaluate once over their own session; forces are the negated gradient", async () => {
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  const f = water(), atoms = fixture("water-trajectory.xyz").split("\n").slice(2, 5).map(row => { const [element, x, y, z] = row.split(" "); return { element, x: +x, y: +y, z: +z }; });
  const energy = await f.run("energy", { forceField: "xtb:gfn2" });
  expect(energy).toMatchObject({ status: "succeeded", summary: { forceField: "xtb:gfn2", method: "GFN2-xTB", unit: "kcal/mol" } });
  expect(energy.summary.energy).toBeCloseTo(well(atoms), 9);
  expect(commands()).toEqual(["energy_model_open", "energy_model_evaluate", "energy_model_close"]);
  expect(calls[0][1]!.request).toMatchObject({ model: "xtb:gfn2", elements: ["O", "H", "H"], charge: 0, multiplicity: 1 });

  calls = [];
  const forces = await f.run("energy_forces", { forceField: "xtb:gfn2" });
  expect(forces.summary).toMatchObject({ forceField: "xtb:gfn2", method: "GFN2-xTB, analytic", energyUnit: "kcal/mol", forceUnit: "kcal/(mol·Å)", atomCount: 3 });
  const vectors = JSON.parse(await f.exported(forces.jobId, "forces")).atoms.map((atom: { force: number[] }) => atom.force);
  expect(vectors).toEqual(atoms.map(atom => [atom.x, atom.y, atom.z].map(value => expect.closeTo(-2 * value, 9))));
  expect(commands()).toEqual(["energy_model_open", "energy_model_evaluate", "energy_model_close"]);
  expect(sessions.size).toBe(0);
});

test("a frame page runs in one session that is closed after success and after a failed evaluation", async () => {
  await models.refreshExternalEnergyModels(native as never);
  for (const [text, extension, count] of [[fixture("water-trajectory.xyz"), "xyz", 3], [fixture("ethanol-ensemble.sdf"), "sdf", 2]] as const) {
    calls = [];
    const f = workspace(text, extension), job = await f.run("frame_energy_forces", { forceField: "xtb:gfn2" });
    expect(job.summary).toMatchObject({ forceField: "xtb:gfn2", model: "GFN2-xTB", method: "analytic", frameCount: count, nextOffset: null });
    expect(commands()).toEqual(["energy_model_open", ...Array(count).fill("energy_model_evaluate"), "energy_model_close"]);
    // The extended XYZ pairs every frame's positions with its forces: −2r in the harmonic well.
    const rows = (await f.exported(job.jobId, "extxyz")).split("\n").filter(row => /^[A-Z][a-z]? /u.test(row)).map(row => row.split(" ").slice(1).map(Number));
    expect(rows).toHaveLength(count * job.summary.atomCount);
    for (const row of rows) expect(row.slice(3)).toEqual(row.slice(0, 3).map(value => expect.closeTo(-2 * value, 9)));
    expect(job.summary.energies).toHaveLength(count);
  }
  calls = [];
  finite = false;
  const failed = await water().run("frame_energy_forces", { forceField: "xtb:gfn2" });
  expect(failed).toMatchObject({ status: "failed", artifacts: [], error: { message: "GFN2-xTB returned no finite energy and gradient." } });
  expect(commands().filter(command => command === "energy_model_close")).toHaveLength(1);
  expect(sessions.size).toBe(0);
  calls = [];
  finite = true;
  const mixed = await workspace(fixture("ethanol.sdf") + fixture("acetonitrile.sdf"), "sdf").run("frame_energy_forces", { forceField: "xtb:gfn2" });
  expect(mixed).toMatchObject({ status: "failed", error: { message: expect.stringContaining("SDF record 2 has different atoms than record 1") } });
  expect(commands()).not.toContain("energy_model_open");
});

test("optimize relaxes into the model's minimum with constraints, over one closed session", async () => {
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  const job = await water().run("optimize", { forceField: "xtb:gfn2", constraints: [{ kind: "freeze", atoms: [0] }] });
  expect(job.summary).toMatchObject({ forceField: "xtb:gfn2", model: "GFN2-xTB", method: "lbfgs", gradient: "analytic", converged: true, frozenAtoms: [0] });
  expect(job.summary.energy).toBeLessThan(job.summary.initialEnergy);
  // Both hydrogens fall into the well; the frozen oxygen keeps its share of the energy.
  expect(job.summary.energy).toBeCloseTo(0.0406 ** 2 + 0.3504 ** 2 + 0.013 ** 2, 6);
  expect(job.artifacts.map((item: { name: string }) => item.name)).toContain("structure");
  expect(commands().filter(command => command !== "energy_model_evaluate")).toEqual(["energy_model_open", "energy_model_close"]);
  expect(sessions.size).toBe(0);
});

test("missing, unavailable and flat inputs are refused with their reason", async () => {
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  const f = water();
  expect(await f.run("energy", { forceField: "xtb:gfn1" })).toMatchObject({ status: "failed", error: { message: "xtb:gfn1 is not available in this Burette." } });
  expect(await f.run("optimize", { forceField: "avogadro:pending/model" })).toMatchObject({ status: "failed", error: { message: "Set up pending in Settings › Extensions first" } });
  expect(await workspace(fixture("butan-2-ol-2d.mol"), "mol").submit("energy", { forceField: "xtb:gfn2" }))
    .toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE", message: "energy cannot run on fixture.mol: External energy models need 3D coordinates; run prepare_3d first." } });
  expect(commands()).not.toContain("energy_model_open");
});
