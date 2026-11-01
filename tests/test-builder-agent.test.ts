import { afterEach, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import type { ViewerDocument } from "../apps/desktop/src/types";

const controllers: WorkbenchAgentController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const canonical = (text: string) => { const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: true })); if (!mol) throw new Error("RDKit could not read the artifact."); try { return mol.get_smiles(); } finally { mol.delete(); } };
const revision = `sha256-${"a".repeat(64)}`;
const ethanol = readFileSync(new URL("./fixtures/fragments/ethanol-cid702.sdf", import.meta.url), "utf8");
const propylene = JSON.parse(readFileSync(new URL("./fixtures/polymer/propylene-reference.json", import.meta.url), "utf8"));
const isotactic = JSON.parse(readFileSync(new URL("./fixtures/polymer/tacticity-references.json", import.meta.url), "utf8")).references.find((item: { name: string }) => item.name === "isotactic");

function workspace(text: string, extension: string) {
  let open = true;
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `fixture.${extension}`, path: `/fixture.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => open ? [document] : [], activeDocument: () => open ? document : null, readSource: async () => ({ text, origin: "draft" }) });
  controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function finish(jobId: string) { for (let i = 0; i < 2000; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(5); } throw new Error("Job did not finish"); }
  async function run(operationId: string, job: Record<string, unknown>) {
    const { sourceRevision } = await ok({ operation: "observe" });
    const submitted = await ok({ operation: "submit", operationId, expectedSourceRevision: sourceRevision, job });
    const finished = await finish(submitted.job.jobId);
    expect(finished.status).toBe("succeeded");
    const exported = await ok({ operation: "export", jobId: finished.jobId, artifact: "structure" });
    expect((await ok({ operation: "observe" })).sourceRevision).toBe(sourceRevision);
    return { job: finished, artifact: exported.artifact };
  }
  return { execute, ok, finish, run, close() { open = false; controller.documentsChanged(new Set()); } };
}

test("structure job contracts admit only their typed parameters; build kinds need no document", () => {
  const submit = (kind: string, params: unknown) => ({ type: "workbench", operation: "submit", operationId: "s", expectedSourceRevision: revision, job: { kind, params } });
  expect(validateWorkbenchRequest(submit("insert_fragment", { library: "alkanes/ethyl", atomIndex: 3 }))).toMatchObject({ ok: true, request: { job: { params: { library: "alkanes/ethyl", atomIndex: 3 } } } });
  expect(validateWorkbenchRequest(submit("polymer", { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 6 }))).toMatchObject({ ok: true, request: { job: { params: { bondLengthAngstrom: 1.54, headEnd: "hydrogen", tailEnd: "hydrogen", relax: false } } } });
  for (const [kind, params] of [["insert_fragment", {}], ["insert_fragment", { library: "alkanes/ethyl", smiles: "C" }], ["insert_fragment", { smiles: "C C" }], ["insert_fragment", { library: "../etc" }],
    ["insert_fragment", { smiles: "C", atomIndex: 256 }], ["hydrogens", {}], ["hydrogens", { mode: "ph" }], ["polymer", { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 501 }],
    ["polymer", { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 2, headEnd: "acetyl" }], ["polymer", { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 2, apply: true }], ["peptide", { sequence: "AG" }]] as const) {
    expect(validateWorkbenchRequest(submit(kind, params))).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  }
  const build = (params: unknown) => ({ type: "workbench", operation: "build", operationId: "b", job: { kind: "peptide", params } });
  expect(validateWorkbenchRequest(build({ sequence: "AGS" }))).toMatchObject({ ok: true, request: { job: { params: { codes: "one", chirality: "L", phiDegrees: 180, psiDegrees: 180, nTerminus: "amine", cTerminus: "acid", chain: "A" } } } });
  for (const params of [{}, { sequence: "AGS", chain: "AB" }, { sequence: "AGS", phiDegrees: 200 }, { sequence: "AGS", nTerminus: "acetyl" }]) expect(validateWorkbenchRequest(build(params))).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  expect(validateWorkbenchRequest({ ...build({ sequence: "AGS" }), expectedSourceRevision: revision })).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  expect(validateWorkbenchRequest({ type: "workbench", operation: "build", operationId: "b", job: { kind: "energy" } })).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  const { jobs, operations } = workbenchContractSummary();
  expect(operations).toContain("build");
  expect(Object.fromEntries(Object.entries(jobs).map(([kind, value]) => [kind, [value.operation, value.artifacts]]))).toMatchObject({ insert_fragment: ["submit", ["structure"]], hydrogens: ["submit", ["structure"]], polymer: ["submit", ["structure"]], peptide: ["build", ["structure"]] });
});

test("insert_fragment and hydrogens export new structures that RDKit reads as the independent products", async () => {
  const f = workspace(ethanol, "sdf"), observed = await f.ok({ operation: "observe" });
  for (const kind of ["insert_fragment", "hydrogens", "polymer"]) expect(observed.jobs[kind]).toEqual({ available: true });
  const hydroxyl = 8; // PubChem CID 702 row 9 is the O-H hydrogen.
  const ether = await f.run("ether", { kind: "insert_fragment", params: { library: "alkanes/ethyl", atomIndex: hydroxyl } });
  expect(canonical(ether.artifact.content)).toBe(canonical("CCOCC"));
  expect(ether.job.summary).toMatchObject({ formula: "C4H10O", formalCharge: 0, atomCount: 15, addedAtoms: 7, replacedAtom: hydroxyl, anchorAtom: 0 });
  expect(ether.artifact).toMatchObject({ name: "structure", fileName: "fixture-fragment.sdf", mimeType: "chemical/x-mdl-sdfile" });
  expect(ether.artifact.content.endsWith("$$$$\n")).toBe(true);
  const separate = await f.run("water", { kind: "insert_fragment", params: { smiles: "O" } });
  expect(canonical(separate.artifact.content)).toBe(canonical("CCO.O"));
  const bare = await f.run("no-h", { kind: "hydrogens", params: { mode: "remove" } });
  expect(bare.job.summary).toMatchObject({ formula: "C2O", atomCount: 3, changedAtoms: 6 });
  const g = workspace(bare.artifact.content, "sdf");
  const added = await g.run("with-h", { kind: "hydrogens", params: { mode: "add" } });
  expect(added.job.summary).toMatchObject({ formula: "C2H6O", atomCount: 9, sourceAtomIndices: [0, 1, 2, -1, -1, -1, -1, -1, -1] });
  expect(canonical(added.artifact.content)).toBe("CCO");
  const mol = rdkit.get_mol(added.artifact.content, JSON.stringify({ removeHs: false }))!;
  expect(JSON.parse(mol.get_descriptors()).NumHeavyAtoms).toBe(3); expect(mol.get_num_atoms()).toBe(9); mol.delete();
});

test("graph jobs refuse sources without explicit connection tables and out-of-range atoms before queueing", async () => {
  const xyz = workspace("3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n", "xyz"), observed = await xyz.ok({ operation: "observe" });
  expect(observed.jobs.insert_fragment.available).toBe(false);
  expect(await xyz.execute({ operation: "submit", operationId: "xyz", expectedSourceRevision: observed.sourceRevision, job: { kind: "insert_fragment", params: { smiles: "C" } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  const f = workspace(ethanol, "sdf"), current = await f.ok({ operation: "observe" });
  expect(await f.execute({ operation: "submit", operationId: "far", expectedSourceRevision: current.sourceRevision, job: { kind: "insert_fragment", params: { smiles: "C", atomIndex: 9 } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  const failed = await f.ok({ operation: "submit", operationId: "two-stars", expectedSourceRevision: current.sourceRevision, job: { kind: "insert_fragment", params: { smiles: "*C*", atomIndex: 0 } } });
  expect(await f.finish(failed.job.jobId)).toMatchObject({ status: "failed", artifacts: [], error: { message: "Mark at most one attachment point with *." } });
  expect((await f.ok({ operation: "jobs" })).total).toBe(1);
});

test("polymer jobs reproduce the frozen isotactic reference; peptide builds need no document and survive document closure", async () => {
  const f = workspace(sdfFromGraph(propylene.atoms, propylene.bonds, "Propylene"), "sdf");
  const chain = await f.run("pp", { kind: "polymer", params: { ...propylene.roles, count: 6, tacticity: "isotactic" } });
  expect(canonical(chain.artifact.content)).toBe(canonical(isotactic.smiles));
  expect(chain.job.summary).toMatchObject({ atomCount: 56, bondCount: 55, repeatCount: 6, repeatAlternatives: [0, 0, 0, 0, 0, 0], relaxation: null });
  const built = await f.ok({ operation: "build", operationId: "ags", job: { kind: "peptide", params: { sequence: "AGS" } } });
  expect(built.job).toMatchObject({ documentId: null, sourceRevision: null, binding: "none" });
  expect((await f.ok({ operation: "build", operationId: "ags", job: { kind: "peptide", params: { sequence: "AGS" } } })).deduplicated).toBe(true);
  expect(await f.execute({ operation: "build", operationId: "ags", job: { kind: "peptide", params: { sequence: "AG" } } })).toMatchObject({ ok: false, error: { code: "OPERATION_ID_CONFLICT" } });
  f.close();
  const job = await f.finish(built.job.jobId);
  expect(job).toMatchObject({ status: "succeeded", binding: "none", summary: { sequence: "AGS", residueCount: 3, atomCount: 31, formalCharge: 0 } });
  const exported = await f.ok({ operation: "export", jobId: job.jobId, artifact: "structure" });
  // Ala-Gly-Ser, neutral termini: C8H15N3O5, 31 explicit atoms.
  const elements = exported.artifact.content.split("\n").filter((line: string) => line.startsWith("ATOM ") || line.startsWith("HETATM")).map((line: string) => line.split(/\s+/u)[2]);
  expect(Object.fromEntries(["C", "H", "N", "O"].map(element => [element, elements.filter((value: string) => value === element).length]))).toEqual({ C: 8, H: 15, N: 3, O: 5 });
  expect(exported.artifact).toMatchObject({ fileName: "Peptide AGS.cif", mimeType: "chemical/x-mmcif" });
});

test("smiles builds export an explicit-hydrogen 3D structure; unreadable input fails as a job", async () => {
  const f = workspace(ethanol, "sdf");
  const built = await f.ok({ operation: "build", operationId: "acetic", job: { kind: "smiles", params: { smiles: "CC(=O)O" } } });
  const job = await f.finish(built.job.jobId);
  expect(job).toMatchObject({ status: "succeeded", summary: { formula: "C2H4O2", atomCount: 8, formalCharge: 0 } });
  const { artifact } = await f.ok({ operation: "export", jobId: job.jobId, artifact: "structure" });
  expect(canonical(artifact.content)).toBe("CC(=O)O");
  const mol = rdkit.get_mol(artifact.content, JSON.stringify({ removeHs: false }))!;
  const block = mol.get_molblock(); mol.delete();
  expect(block.split("\n")[1]).toContain("3D");
  // Requested stereo survives embedding and relaxation; RDKit perceives it from the exported 3D coordinates.
  for (const [index, smiles] of ["C/C=C\\C", "C[C@H](N)C(=O)O", "C[C@@H](N)C(=O)O"].entries()) {
    const stereo = await f.finish((await f.ok({ operation: "build", operationId: `stereo-${index}`, job: { kind: "smiles", params: { smiles } } })).job.jobId);
    expect(stereo).toMatchObject({ status: "succeeded", summary: { method: "bfgs", forceField: "MMFF94", converged: true } });
    expect(canonical((await f.ok({ operation: "export", jobId: stereo.jobId, artifact: "structure" })).artifact.content)).toBe(canonical(smiles));
  }
  const bad = await f.ok({ operation: "build", operationId: "bad", job: { kind: "smiles", params: { smiles: "C1CC" } } });
  expect(await f.finish(bad.job.jobId)).toMatchObject({ status: "failed", artifacts: [] });
}, 60_000);
