import { afterEach, expect, test } from "bun:test";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import type { ViewerDocument } from "../apps/desktop/src/types";
import reference from "./fixtures/coordinate-editing/rdkit-reference.json";

// Expected coordinates are RDKit rdMolTransforms and SciPy results (fixtures/coordinate-editing).
const controllers: WorkbenchAgentController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
const revision = `sha256-${"a".repeat(64)}`;
const VARIANTS = [["v2000", "mol"], ["v3000", "mol"], ["sdf", "sdf"]] as const;

function workspace(text: string, extension: string) {
  let draft: string | null = null;
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `fixture.${extension}`, path: `/fixture.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  let documents = [document];
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => documents, activeDocument: () => documents[0], readSource: async () => ({ text: draft ?? text, origin: draft ? "draft" : "file" }) });
  controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function finish(jobId: string) { for (let i = 0; i < 3000; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(10); } throw new Error("job did not finish"); }
  async function submit(kind: string, params: Record<string, unknown>, operationId = `${kind}-${crypto.randomUUID()}`) {
    const observed = await ok({ operation: "observe" });
    return (await ok({ operation: "submit", operationId, expectedSourceRevision: observed.sourceRevision, job: { kind, params } })).job;
  }
  async function run(kind: string, params: Record<string, unknown>) {
    const job = await finish((await submit(kind, params)).jobId);
    return { job, artifact: job.status === "succeeded" ? (await ok({ operation: "export", jobId: job.jobId, artifact: "structure" })).artifact : null };
  }
  return { execute, ok, finish, submit, run, setDraft(value: string | null) { draft = value; }, close() { documents = []; controller.documentsChanged(new Set()); } };
}
const worst = (actual: { x: number; y: number; z: number }[], expected: number[][]) =>
  Math.max(...actual.flatMap((atom, index) => [atom.x, atom.y, atom.z].map((value, axis) => Math.abs(value - expected[index][axis]))));
const measurementParams = (item: (typeof reference.measurements)[number]) => ({ measurement: item.measurement, atoms: item.atoms,
  [item.measurement === "distance" ? "valueAngstrom" : "valueDegrees"]: item.value, ...(item.side === "smaller" ? {} : { fragment: item.side }) });
const submitRequest = (kind: string, params?: unknown) => ({ type: "workbench", operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind, params } });

test("editing contracts carry units in field names, resolve defaults and reject ambiguous parameters before queueing", () => {
  const params = (kind: string, value?: unknown) => { const result = validateWorkbenchRequest(submitRequest(kind, value)); return result.ok ? result.request.job.params : result.error.code; };
  expect(params("measurement_set", { measurement: "distance", atoms: [0, 1], valueAngstrom: 1.5 })).toEqual({ measurement: "distance", atoms: [0, 1], valueAngstrom: 1.5, fragment: "smaller" });
  expect(params("measurement_set", { measurement: "dihedral", atoms: [0, 1, 2, 3], valueDegrees: -180, fragment: "last" })).toEqual({ measurement: "dihedral", atoms: [0, 1, 2, 3], valueDegrees: -180, fragment: "last" });
  expect(params("coordinate_align", { originAtom: 2 })).toEqual({ originAtom: 2 });
  expect(params("coordinate_align", { originAtom: 2, axisAtom: 0 })).toEqual({ originAtom: 2, axisAtom: 0, axis: "x" });
  for (const [kind, value] of [
    ["measurement_set", { measurement: "distance", atoms: [0, 1], valueDegrees: 1.5 }], ["measurement_set", { measurement: "distance", atoms: [0, 1], valueAngstrom: 0 }],
    ["measurement_set", { measurement: "angle", atoms: [0, 1, 2], valueDegrees: 180 }], ["measurement_set", { measurement: "dihedral", atoms: [0, 1, 2, 3], valueDegrees: 181 }],
    ["measurement_set", { measurement: "angle", atoms: [0, 1, 1], valueDegrees: 90 }], ["measurement_set", { measurement: "angle", atoms: [0, 1], valueDegrees: 90 }],
    ["measurement_set", { measurement: "distance", atoms: [0, 256], valueAngstrom: 1 }], ["measurement_set", { measurement: "torsion", atoms: [0, 1, 2, 3], valueDegrees: 9 }],
    ["measurement_set", { measurement: "distance", atoms: [0, 1], valueAngstrom: 1, fragment: "both" }], ["measurement_set", { measurement: "distance", atoms: [0, 1], valueAngstrom: 1, apply: true }],
    ["measurement_set", { measurement: "distance", atoms: [0, 1] }], ["coordinate_align", {}], ["coordinate_align", { originAtom: 1, axis: "y" }],
    ["coordinate_align", { originAtom: 1, axisAtom: 1 }], ["coordinate_align", { originAtom: 1, axisAtom: 2, axis: "w" }], ["coordinate_align", { originAtom: 0.5 }],
  ] as const) expect(params(kind, value), JSON.stringify(value)).toBe("INVALID_ARGS");
  const jobs = workbenchContractSummary().jobs;
  expect([jobs.measurement_set.artifacts, jobs.coordinate_align.artifacts]).toEqual([["structure"], ["structure"]]);
});

test("measurement_set exports RDKit's coordinates from MOL V2000/V3000 and SDF without touching the document", async () => {
  let largest = 0;
  for (const item of reference.measurements.filter(item => item.molecule === "butanol" || item.refused)) {
    for (const [variant, extension] of VARIANTS) {
      const source = reference.molecules[item.molecule as "butanol"][variant], w = workspace(source, extension);
      const before = (await w.ok({ operation: "observe" })).sourceRevision;
      const { job, artifact } = await w.run("measurement_set", measurementParams(item));
      const label = `${item.molecule} ${item.measurement} ${item.atoms} ${variant}`;
      if (item.refused) {
        expect(job, label).toMatchObject({ status: "failed", artifacts: [] });
        expect(job.error.message).toMatch(/ring|separated|nonbonded/u);
      } else {
        expect(job, label).toMatchObject({ status: "succeeded", binding: "current", summary: { measurement: item.measurement, format: extension, atomCount: 15 } });
        expect(Math.abs(job.summary.value - item.measured!)).toBeLessThan(1e-9);
        const exported = parseMolecule(artifact.content, extension);
        largest = Math.max(largest, worst(exported.atoms, item.expected!));
        expect(exported.atoms.map(atom => atom.element)).toEqual(reference.molecules.butanol.elements);
        expect(artifact.content.split("\n")[0]).toBe("(R)-butan-2-ol");
        expect(artifact.content.includes("$$$$")).toBe(extension === "sdf");
        if (extension === "sdf") expect(artifact.content).toContain(">  <SOURCE_NOTE>\nkept verbatim\n");
        expect(artifact.content).not.toContain("BURETTE_METADATA_V1");
      }
      expect((await w.ok({ operation: "observe" })).sourceRevision).toBe(before);
    }
  }
  expect(largest).toBeLessThan(1e-9);
}, 60_000);

test("coordinate_align exports the SciPy-aligned structure and keeps exact stereo records", async () => {
  let largest = 0;
  for (const item of reference.aligns) {
    for (const [variant, extension] of VARIANTS) {
      const molecule = reference.molecules[item.molecule as "butanol" | "halomethane"];
      const w = workspace(molecule[variant], extension);
      const { job, artifact } = await w.run("coordinate_align", { originAtom: item.origin, ...(item.target === undefined ? {} : { axisAtom: item.target, axis: item.axis }) });
      expect(job, `${item.molecule} ${variant}`).toMatchObject({ status: "succeeded", summary: { originAtom: item.origin, axisAtom: item.target ?? null } });
      const exported = parseMolecule(artifact.content, extension);
      largest = Math.max(largest, worst(exported.atoms, item.expected));
      // Atom stereo parity and bonds are rewritten from the same source rows, never inferred.
      const source = parseMolecule(molecule[variant], extension);
      expect(exported.bonds).toEqual(source.bonds);
    }
  }
  expect(largest).toBeLessThan(1e-9);
}, 60_000);

test("editing jobs refuse XYZ, collections and out-of-range atoms before queueing; stale, cancelled and closed jobs never export", async () => {
  const butanol = reference.molecules.butanol;
  for (const [text, extension] of [[`2\nxyz\nC 0 0 0\nO 1.4 0 0\n`, "xyz"], [butanol.sdf + butanol.sdf, "sdf"]]) {
    const w = workspace(text, extension), observed = await w.ok({ operation: "observe" });
    for (const kind of ["measurement_set", "coordinate_align"]) {
      expect(observed.jobs[kind].available, `${kind} ${extension}`).toBe(false);
      expect(await w.execute({ operation: "submit", operationId: kind, expectedSourceRevision: observed.sourceRevision, job: { kind, params: kind === "coordinate_align" ? { originAtom: 0 } : { measurement: "distance", atoms: [0, 1], valueAngstrom: 1.2 } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
    }
    expect((await w.ok({ operation: "jobs" })).total).toBe(0);
  }
  const w = workspace(butanol.v3000, "mol"), observed = await w.ok({ operation: "observe" });
  expect(await w.execute({ operation: "submit", operationId: "range", expectedSourceRevision: observed.sourceRevision, job: { kind: "coordinate_align", params: { originAtom: 0, axisAtom: 15 } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  const request = { operation: "submit", operationId: "once", expectedSourceRevision: observed.sourceRevision, job: { kind: "coordinate_align", params: { originAtom: 1, axisAtom: 3 } } };
  const first = await w.ok(request);
  expect((await w.ok(request)).job.jobId).toBe(first.job.jobId);
  expect(await w.execute({ ...request, job: { kind: "coordinate_align", params: { originAtom: 2 } } })).toMatchObject({ ok: false, error: { code: "OPERATION_ID_CONFLICT" } });
  expect(await w.finish(first.job.jobId)).toMatchObject({ status: "succeeded" });
  w.setDraft(butanol.v2000);
  expect(await w.execute({ operation: "export", jobId: first.job.jobId, artifact: "structure" })).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
  expect(await w.execute(request)).toMatchObject({ ok: true });
  expect(await w.execute({ ...request, operationId: "old-revision" })).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  const cancelled = await w.submit("measurement_set", { measurement: "distance", atoms: [1, 3], valueAngstrom: 1.6 });
  expect(await w.ok({ operation: "cancel", jobId: cancelled.jobId })).toMatchObject({ cancelled: true, job: { status: "cancelled", artifacts: [] } });
  expect(await w.execute({ operation: "export", jobId: cancelled.jobId, artifact: "structure" })).toMatchObject({ ok: false, error: { code: "JOB_NOT_SUCCEEDED" } });
  const closed = await w.submit("measurement_set", { measurement: "distance", atoms: [1, 3], valueAngstrom: 1.6 });
  w.close();
  expect(await w.execute({ operation: "export", jobId: closed.jobId, artifact: "structure" })).toMatchObject({ ok: false, error: { code: "SOURCE_CLOSED" } });
}, 60_000);
