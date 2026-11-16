import { afterEach, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule as RDKitModule } from "@rdkit/rdkit";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/chemistry";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { readGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";
import type { ViewerDocument } from "../apps/desktop/src/types";
import reference from "./fixtures/optimization/rdkit-optimization-reference.json";

// Expected numbers come from Python RDKit (fixtures/optimization) and RDKit's own UFF fixture.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/automation/${name}`, import.meta.url), "utf8");
const water = JSON.parse(readFileSync(new URL("../compute/rdkit-conformer/fixtures/uff-rdkit-2025.03.4.json", import.meta.url), "utf8")).cases.find((item: { name: string }) => item.name === "water");
const ethanol = reference.records.find(item => item.smiles === "CCO")!;
const revision = `sha256-${"a".repeat(64)}`;
const controllers: WorkbenchAgentController[] = [];
let rdkit: RDKitModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

function workspace(text: string, extension: string) {
  let draft: string | null = null;
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `fixture.${extension}`, path: `/fixture.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  let documents = [document];
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => documents, activeDocument: () => documents[0], readSource: async () => ({ text: draft ?? text, origin: draft ? "draft" : "file" }) });
  controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function finish(jobId: string) { for (let i = 0; i < 6000; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["queued", "running"].includes(job.status)) return job; await Bun.sleep(10); } throw new Error("job did not finish"); }
  async function submit(kind: string, params: Record<string, unknown>, operationId = `${kind}-${crypto.randomUUID()}`) {
    const observed = await ok({ operation: "observe" });
    return (await ok({ operation: "submit", operationId, expectedSourceRevision: observed.sourceRevision, job: { kind, params } })).job;
  }
  async function exported(jobId: string, artifact: string, allowStale = false) { return (await ok({ operation: "export", jobId, artifact, allowStale })).artifact; }
  return { execute, ok, finish, submit, exported, setDraft(value: string | null) { draft = value; }, close() { documents = []; controller.documentsChanged(new Set()); } };
}
const submitRequest = (kind: string, params?: unknown) => ({ type: "workbench", operation: "submit", operationId: "a", expectedSourceRevision: revision, job: { kind, params } });

test("the contract resolves explicit optimizer defaults and rejects malformed typed parameters before queueing", () => {
  const params = (kind: string, value?: unknown) => { const result = validateWorkbenchRequest(submitRequest(kind, value)); return result.ok ? result.request.job.params : result.error.code; };
  expect(params("optimize")).toEqual({ forceField: "MMFF94", method: "bfgs", maxIterations: 250, constraints: [] });
  expect(params("optimize", { forceField: "UFF" })).toMatchObject({ method: "lbfgs" });
  expect(params("optimize", { constraints: [{ kind: "freeze", atoms: [2] }] })).toMatchObject({ method: "lbfgs", constraints: [{ kind: "freeze", atoms: [2] }] });
  expect(params("prepare_3d")).toEqual({ forceField: "MMFF94", method: "bfgs", seed: 1, maxIterations: 250 });
  expect(params("conformers", { count: 32 })).toEqual({ forceField: "MMFF94", count: 32, seed: 1 });
  expect(params("frame_energy_forces", { offset: 3 })).toEqual({ forceField: "MMFF94", offset: 3 });
  for (const [kind, value] of [
    ["optimize", { method: "steepest" }], ["optimize", { maxIterations: 1001 }], ["optimize", { constraints: [{ kind: "angle", atoms: [0, 1] }] }],
    ["optimize", { constraints: [{ kind: "angle", atoms: [0, 1, 2], target: 180 }] }], ["optimize", { constraints: [{ kind: "freeze", atoms: [0], target: 1 }] }],
    ["optimize", { constraints: Array.from({ length: 65 }, (_, i) => ({ kind: "freeze", atoms: [i] })) }], ["optimize", { apply: true }],
    ["prepare_3d", { seed: 2_147_483_640 }], ["conformers", { count: 33 }], ["frame_energy_forces", { count: 65 }], ["frame_energy_forces", { offset: -1 }],
    ["metadata_edit", {}], ["metadata_edit", { atoms: [{ index: 0 }] }], ["pair_distribution", { rMax: 100, binWidth: 0.001 }],
  ] as const) expect(params(kind, value)).toBe("INVALID_ARGS");
  expect(validateWorkbenchRequest(submitRequest("molecular_dynamics"))).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_WORKBENCH_JOB" } });
  expect(Object.keys(workbenchContractSummary().jobs)).toEqual(["properties", "energy", "energy_forces", "frame_energy_forces", "optimize", "prepare_3d", "conformers", "metadata_edit", "measurement_set", "coordinate_align", "spectrum", "vibrational_spectrum", "pair_distribution", "point_group", "space_group", "powder_xrd", "crystal_transform", "biological_assembly", "orbital_cube", "insert_fragment", "hydrogens", "polymer", "graph_edit", "structure_export", "quantum_input", "smiles", "nucleic_acid", "metal_complex", "peptide"]);
});

test("optimize jobs reach the RDKit minimum, export source-ordered artifacts and an energy-per-step trajectory", async () => {
  const f = workspace(fixture("ethanol.sdf"), "sdf"), source = parseMolecule(fixture("ethanol.sdf"), "sdf");
  const bfgs = await f.finish((await f.submit("optimize", {})).jobId);
  expect(bfgs).toMatchObject({ status: "succeeded", binding: "current", params: { method: "bfgs" }, summary: { method: "bfgs", gradient: "analytic", frameSampling: "steps", converged: true } });
  expect(Math.abs(bfgs.summary.energy - ethanol.models.MMFF94.minimum.energy)).toBeLessThan(1e-4);
  expect(bfgs.artifacts.map((item: any) => item.name)).toEqual(["structure", "xyz", "trajectory"]);
  // A harmonic restraint pulled far from the force-field minimum leaves a residual above tolerance: not converged.
  const strained = await f.finish((await f.submit("optimize", { forceField: "UFF", constraints: [{ kind: "distance", atoms: [1, 2], target: 1.6 }], maxIterations: 1000 })).jobId);
  expect(strained.summary).toMatchObject({ stopReason: "converged", converged: false });
  expect(Math.abs(strained.summary.constraintResiduals[0].error)).toBeGreaterThan(0.01);
  const constraints = [{ kind: "freeze", atoms: [0] }, { kind: "distance", atoms: [1, 2], target: 1.5 }];
  const lbfgs = await f.finish((await f.submit("optimize", { forceField: "UFF", constraints, maxIterations: 1000 })).jobId);
  expect(lbfgs.summary).toMatchObject({ method: "lbfgs", forceField: "UFF", gradient: "analytic", frameSampling: "steps", converged: true, frozenAtoms: [0] });
  expect(lbfgs.summary.constraintResiduals).toHaveLength(1);
  expect(Math.abs(lbfgs.summary.constraintResiduals[0].error)).toBeLessThan(0.01);
  const sdf = parseMolecule((await f.exported(lbfgs.jobId, "structure")).content, "sdf"), xyz = parseScientificFile("result.xyz", (await f.exported(lbfgs.jobId, "xyz")).content);
  expect(sdf.atoms.map(atom => atom.element)).toEqual(source.atoms.map(atom => atom.element));
  expect(sdf.bonds).toEqual(source.bonds);
  expect(sdf.atoms[0]).toEqual(source.atoms[0]);
  sdf.atoms.forEach((atom, i) => expect(Math.hypot(atom.x - xyz.atoms[i].x, atom.y - xyz.atoms[i].y, atom.z - xyz.atoms[i].z)).toBeLessThan(1e-4));
  const steps = parseScientificFile("steps.xyz", (await f.exported(lbfgs.jobId, "trajectory")).content);
  expect(steps.frames).toHaveLength(lbfgs.summary.frameCount);
  expect(steps.frames[0].energyHartree! * 627.5094740631).toBeCloseTo(lbfgs.summary.initialEnergy, 6);
  expect(steps.frames.at(-1)!.energyHartree! * 627.5094740631).toBeCloseTo(lbfgs.summary.energy, 6);
  expect(parseScientificFile("bfgs.xyz", (await f.exported(bfgs.jobId, "trajectory")).content).frames).toHaveLength(bfgs.summary.frameCount);
}, 60_000);

test("undefined constraints are refused before queueing and oversized numerical runs fail with their reason", async () => {
  const nitrile = workspace(fixture("acetonitrile.sdf"), "sdf"), observed = await nitrile.ok({ operation: "observe" });
  const refuse = async (params: Record<string, unknown>, message: RegExp) => {
    const result = await nitrile.execute({ operation: "submit", operationId: crypto.randomUUID(), expectedSourceRevision: observed.sourceRevision, job: { kind: "optimize", params } });
    expect(result).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
    expect(JSON.stringify(result)).toMatch(message);
  };
  await refuse({ constraints: [{ kind: "angle", atoms: [0, 1, 2] }] }, /angle is linear/);
  await refuse({ constraints: [{ kind: "dihedral", atoms: [3, 0, 1, 2] }] }, /collinear/);
  await refuse({ constraints: [{ kind: "freeze", atoms: [6] }] }, /invalid atom indices/);
  expect((await nitrile.ok({ operation: "jobs" })).total).toBe(0);
  const waters = workspace(`66\nwaters\n${Array.from({ length: 22 }, (_, i) => `O ${i * 6} 0 0\nH ${i * 6 + .95} 0 0\nH ${i * 6 - .23} .93 0`).join("\n")}\n`, "xyz");
  // Separate waters have no analytic MMFF surface; differencing 66 atoms is refused by the worker, and UFF runs analytically.
  const differenced = await waters.finish((await waters.submit("optimize", { method: "lbfgs" })).jobId);
  expect([differenced.status, JSON.stringify(differenced)]).toEqual(["failed", expect.stringMatching(/separate fragments interact.*up to 64 atoms and it has 66/)]);
  expect(await waters.finish((await waters.submit("optimize", { method: "bfgs", forceField: "UFF", maxIterations: 20 })).jobId)).toMatchObject({ status: "succeeded", summary: { method: "bfgs", gradient: "analytic" } });
});

test("prepare_3d embeds a flat depiction with its stereochemistry and conformer jobs export reopenable energy-ordered records", async () => {
  const flat = workspace(fixture("butan-2-ol-2d.mol"), "mol"), expected = reference.flatInputs.find(item => item.smiles === "CC[C@@H](C)O")!;
  expect((await flat.ok({ operation: "observe" })).jobs.prepare_3d).toEqual({ available: true });
  const prepared = await flat.finish((await flat.submit("prepare_3d", { seed: 2 })).jobId);
  expect(prepared.summary).toMatchObject({ method: "bfgs", converged: true, atomCount: 15, preparation: { addedHydrogens: 10, seed: 2, attempts: 1 } });
  const structure = (await flat.exported(prepared.jobId, "structure")).content, reread = rdkit.get_mol(structure, JSON.stringify({ removeHs: true }))!;
  try { expect(reread.get_smiles()).toBe(expected.smiles); } finally { reread.delete(); }
  const deep = workspace(fixture("ethanol.sdf"), "sdf");
  expect((await deep.ok({ operation: "observe" })).jobs.prepare_3d).toEqual({ available: false, reason: "This structure already has 3D coordinates; use optimize." });
  const butane = workspace(structure.replace(/^[^\n]*/u, "butan-2-ol"), "sdf");
  const search = await butane.finish((await butane.submit("conformers", { count: 16, seed: 4 })).jobId);
  expect(search).toMatchObject({ status: "succeeded", summary: { forceField: "MMFF94", seed: 4, atomCount: 15 } });
  const records = (await butane.exported(search.jobId, "conformers")).content.split("$$$$\n").filter(Boolean);
  expect(records).toHaveLength(search.summary.count);
  records.forEach((record: string, i: number) => {
    const reopened = rdkit.get_mol(record, JSON.stringify({ removeHs: true }))!;
    try { expect(reopened.get_smiles()).toBe(expected.smiles); } finally { reopened.delete(); }
    expect(Number(/MMFF94 energy \(kcal\/mol\)>\n([^\n]+)/u.exec(record)![1])).toBe(search.summary.energies[i]);
  });
  expect(search.summary.energies).toEqual([...search.summary.energies].sort((a: number, b: number) => a - b));
}, 60_000);

test("frame batches return RDKit energies and forces for SDF ensembles and covariant UFF forces for XYZ frames", async () => {
  const ensemble = workspace(fixture("ethanol-ensemble.sdf"), "sdf"), observed = await ensemble.ok({ operation: "observe" });
  expect([observed.frames, observed.jobs.frame_energy_forces, observed.jobs.energy.available]).toEqual([{ count: 2, source: "sdf-records" }, { available: true }, false]);
  const batch = await ensemble.finish((await ensemble.submit("frame_energy_forces", {})).jobId);
  expect(batch.summary).toMatchObject({ source: "sdf-records", totalFrames: 2, offset: 0, frameCount: 2, nextOffset: null, method: "central-difference", energyUnit: "kcal/mol" });
  expect(Math.abs(batch.summary.energies[0] - ethanol.models.MMFF94.energy)).toBeLessThan(1e-6);
  expect(Math.abs(batch.summary.energies[1] - ethanol.models.MMFF94.minimum.energy)).toBeLessThan(1e-6);
  const forces = JSON.parse((await ensemble.exported(batch.jobId, "forces")).content);
  forces.frames[0].forces.flat().forEach((value: number, i: number) => expect(Math.abs(value + ethanol.models.MMFF94.gradient[i])).toBeLessThan(2e-4));
  const reopened = parseScientificFile("forces.xyz", (await ensemble.exported(batch.jobId, "extxyz")).content);
  expect(reopened.frames.map(frame => frame.energyHartree! * 627.5094740631)).toEqual(batch.summary.energies.map((value: number) => expect.closeTo(value, 6)));
  expect(reopened.frames[1].forcesKcalMolAngstrom).toEqual(forces.frames[1].forces.map((force: number[]) => force.map(value => expect.closeTo(value, 6))));
  const second = await ensemble.finish((await ensemble.submit("frame_energy_forces", { offset: 1, count: 1 })).jobId);
  expect(second.summary).toMatchObject({ offset: 1, frameCount: 1, energies: [batch.summary.energies[1]] });
  expect(await ensemble.execute({ operation: "submit", operationId: "beyond", expectedSourceRevision: observed.sourceRevision, job: { kind: "frame_energy_forces", params: { offset: 2 } } })).toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
  const mixed = workspace(fixture("ethanol.sdf") + fixture("acetonitrile.sdf"), "sdf");
  expect(await mixed.finish((await mixed.submit("frame_energy_forces", {})).jobId)).toMatchObject({ status: "failed", artifacts: [], error: { message: expect.stringContaining("SDF record 2 has a different graph") } });

  const trajectory = workspace(fixture("water-trajectory.xyz"), "xyz");
  const frames = await trajectory.finish((await trajectory.submit("frame_energy_forces", { forceField: "UFF" })).jobId);
  expect(frames.summary).toMatchObject({ source: "frames", totalFrames: 3, frameCount: 3, method: "analytic" });
  frames.summary.energies.forEach((energy: number) => expect(Math.abs(energy - water.expectedEnergyKcalMol)).toBeLessThan(1e-6));
  const [base, rotated, moved] = JSON.parse((await trajectory.exported(frames.jobId, "forces")).content).frames.map((frame: any) => frame.forces);
  base.flat().forEach((value: number, i: number) => expect(Math.abs(value + water.expectedGradientKcalMolAngstrom[i])).toBeLessThan(1e-4));
  base.forEach((force: number[], i: number) => {
    [-force[1], force[0], force[2]].forEach((value, axis) => expect(Math.abs(value - rotated[i][axis])).toBeLessThan(1e-4));
    force.forEach((value, axis) => expect(Math.abs(value - moved[i][axis])).toBeLessThan(1e-6));
  });
}, 60_000);

test("metadata edits export a separate SDF with stable identities and never apply to the source", async () => {
  const text = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8");
  const sdf = workspace(text, "sdf");
  expect((await sdf.ok({ operation: "observe" })).jobs.metadata_edit).toEqual({ available: true });
  const job = await sdf.finish((await sdf.submit("metadata_edit", { atoms: [{ index: 2, atomName: "O1" }], conformerLabel: "agent" })).jobId);
  const result = (await sdf.exported(job.jobId, "structure")).content;
  const data = result.split(/^M {2}END$/mu)[1];
  const metadata = readGraphMetadata(data, 3);
  expect([metadata.atoms[2].atomName, metadata.conformer.label, job.summary.identitiesCreated]).toEqual(["O1", "agent", true]);
  expect(result.split(/^M {2}END$/mu)[0]).toBe(text.split(/^M {2}END$/mu)[0]);
  const mol = workspace(fixture("butan-2-ol-2d.mol"), "mol"), collection = workspace(fixture("ethanol-ensemble.sdf"), "sdf");
  expect((await mol.ok({ operation: "observe" })).jobs.metadata_edit.available).toBe(false);
  expect((await collection.ok({ operation: "observe" })).jobs.metadata_edit.reason).toContain("collections");
});

test("optimize jobs follow the shared replay, stale, cancel and close semantics", async () => {
  const amide = fixture("n-methylacetamide.sdf"), f = workspace(amide, "sdf"), observed = await f.ok({ operation: "observe" });
  const request = { operation: "submit", operationId: "replayed", expectedSourceRevision: observed.sourceRevision, job: { kind: "optimize", params: { method: "fire", maxIterations: 20 } } };
  const first = (await f.ok(request)).job;
  expect(await f.ok(request)).toMatchObject({ deduplicated: true, job: { jobId: first.jobId } });
  expect(await f.execute({ ...request, job: { kind: "optimize", params: { method: "lbfgs", maxIterations: 20 } } })).toMatchObject({ ok: false, error: { code: "OPERATION_ID_CONFLICT" } });
  f.setDraft(amide + "\n");
  const stale = await f.finish(first.jobId);
  expect([stale.status, stale.binding]).toEqual(["stale", "stale"]);
  expect(await f.execute({ operation: "export", jobId: first.jobId, artifact: "structure" })).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
  expect((await f.exported(first.jobId, "structure", true)).content).toContain("M  END");
  expect(await f.execute({ ...request, operationId: "old" })).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  f.setDraft(null);
  const running = await f.submit("optimize", { method: "lbfgs", maxIterations: 1000 });
  expect((await f.ok({ operation: "cancel", jobId: running.jobId })).job).toMatchObject({ status: "cancelled", summary: null, artifacts: [] });
  const closing = await f.submit("optimize", { method: "lbfgs", maxIterations: 1000 });
  f.close();
  expect((await f.ok({ operation: "status", jobId: closing.jobId })).job).toMatchObject({ status: "source_closed", binding: "source_closed", summary: null, artifacts: [] });
}, 60_000);

test("pair distribution of a simple cubic cell has its six nearest neighbours at the lattice constant", async () => {
  const cubic = workspace(fixture("simple-cubic.xyz"), "xyz");
  expect((await cubic.ok({ operation: "observe" })).jobs.pair_distribution).toEqual({ available: true });
  const job = await cubic.finish((await cubic.submit("pair_distribution", { rMax: 3.5, binWidth: 0.05 })).jobId);
  expect(job.summary).toMatchObject({ boundary: "periodic", atomCount: 1, distanceUnit: "angstrom", minDistance: expect.closeTo(3, 9), coordination: expect.closeTo(6, 9) });
  const isolated = workspace(fixture("acetonitrile.sdf"), "sdf");
  expect((await isolated.ok({ operation: "observe" })).jobs.pair_distribution).toEqual({ available: false, reason: "Open a structure with a unit cell to calculate g(r)." });
});

test("graph edits turn ethanol into acetonitrile in order, and structure export writes the source as MOL, XYZ and CJSON", async () => {
  const code = (kind: string, value: unknown) => { const result = validateWorkbenchRequest(submitRequest(kind, value)); return result.ok ? null : result.error.code; };
  for (const [kind, value] of [
    ["graph_edit", {}], ["graph_edit", { edits: [] }], ["graph_edit", { edits: [{ kind: "set_bond", a: 1, b: 1, order: 1 }] }],
    ["graph_edit", { edits: [{ kind: "set_bond", a: 0, b: 1, order: 4 }] }], ["graph_edit", { edits: [{ kind: "update_atom", index: 0 }] }],
    ["graph_edit", { edits: [{ kind: "add_atom", element: "cl", position: [0, 0, 0] }] }], ["structure_export", {}], ["structure_export", { format: "pdb" }],
  ] as const) expect(code(kind, value)).toBe("INVALID_ARGS");
  const f = workspace(fixture("ethanol.sdf"), "sdf");
  // The methylene and hydroxyl hydrogens go first, so the oxygen keeps index 2.
  const edited = await f.finish((await f.submit("graph_edit", { edits: [
    { kind: "delete_atoms", indices: [6, 7, 8] }, { kind: "update_atom", index: 2, element: "N" }, { kind: "set_bond", a: 1, b: 2, order: 3 },
  ] })).jobId);
  expect(edited).toMatchObject({ status: "succeeded", summary: { atomCount: 6, bondCount: 5, sourceAtomCount: 9, sourceAtomIndices: [0, 1, 2, 3, 4, 5], editCount: 3 } });
  const nitrile = rdkit.get_mol((await f.exported(edited.jobId, "structure")).content, JSON.stringify({ removeHs: true }))!;
  try { expect(nitrile.get_smiles()).toBe("CC#N"); } finally { nitrile.delete(); }
  const exported = async (format: string) => {
    const job = await f.finish((await f.submit("structure_export", { format })).jobId);
    expect(job).toMatchObject({ status: "succeeded", summary: { format } });
    return (await f.exported(job.jobId, "structure")).content as string;
  };
  const mol = await exported("mol");
  expect(mol).toBe(fixture("ethanol.sdf").split(/^M {2}END$/mu)[0] + "M  END\n");
  const xyz = (await exported("xyz")).trim().split("\n");
  expect([xyz[0], xyz.slice(2).map(line => line.trim().split(/\s+/u)[0]).join("")]).toEqual(["9", "CCOHHHHHH"]);
  const cjson = JSON.parse(await exported("cjson"));
  expect([cjson.atoms.elements.number, cjson.bonds.order.length]).toEqual([[6, 6, 8, 1, 1, 1, 1, 1, 1], 8]);
});

test("quantum input jobs write the Export input file text with the dialog's defaults, a Z-matrix and the source cell", async () => {
  const code = (value: unknown) => { const result = validateWorkbenchRequest(submitRequest("quantum_input", value)); return result.ok ? null : result.error.code; };
  for (const value of [{}, { program: "nwchem" }, { program: "cp2k", coordinates: "zmatrix" }, { program: "orca", constraints: [{ kind: "freeze", atoms: [0] }] },
    { program: "orca", task: "optimize", constraints: [{ kind: "distance", atoms: [0, 1], target: 1.5 }] }, { program: "orca", method: "B3LYP def2-SVP" }]) expect(code(value)).toBe("INVALID_ARGS");
  const f = workspace(fixture("ethanol.sdf"), "sdf");
  const write = async (params: Record<string, unknown>) => {
    const job = await f.finish((await f.submit("quantum_input", params)).jobId);
    expect(job.status).toBe("succeeded");
    return { summary: job.summary, text: (await f.exported(job.jobId, "input")).content as string };
  };
  const orca = await write({ program: "orca" });
  expect(orca.summary).toMatchObject({ program: "orca", method: "B3LYP", basis: "def2-SVP", task: "energy", atomCount: 9, periodic: false });
  expect(orca.text.split("\n").slice(0, 3)).toEqual(["! B3LYP def2-SVP SP", "", "* xyz 0 1"]);
  const gaussian = await write({ program: "gaussian", task: "optimize", coordinates: "zmatrix", constraints: [{ kind: "freeze", atoms: [0] }] });
  expect(gaussian.text.startsWith("#p B3LYP/6-31G(d) Opt=ModRedundant\n")).toBe(true);
  expect(gaussian.text.split("\n").slice(5, 8).map(line => line.split(" ").length)).toEqual([1, 3, 5]);
  expect(gaussian.text).toContain("\nX 1 F\n");
  const cubic = workspace(fixture("simple-cubic.xyz"), "xyz");
  // One copper atom has 29 electrons, so a singlet is refused as in the dialog.
  expect(await cubic.finish((await cubic.submit("quantum_input", { program: "cp2k" })).jobId)).toMatchObject({ status: "failed", error: { message: expect.stringContaining("multiplicity") } });
  const job = await cubic.finish((await cubic.submit("quantum_input", { program: "cp2k", multiplicity: 2 })).jobId);
  expect([job.summary.periodic, (await cubic.exported(job.jobId, "input")).content.includes("PERIODIC XYZ")]).toEqual([true, true]);
});
