import { afterEach, expect, test } from "bun:test";
import { validateWorkbenchRequest, workbenchContractSummary } from "../scripts/workbench-agent-contract.mjs";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { readCrystalDocument } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { analyzePointGroup } from "../apps/desktop/src/lib/molecular-workbench/symmetry/point-group";
import { instantiateStandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { fixtureText, reference } from "./crystal-reference";

// Crystal and molecular-symmetry jobs of the `workbench` agent contract, run through
// the real controller and workers, checked against pymatgen/spglib/ASE references.
const controllers: WorkbenchAgentController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
const revision = `sha256-${"a".repeat(64)}`;
const submit = (kind: string, params?: unknown) => ({ type: "workbench", operation: "submit", operationId: "crystal", expectedSourceRevision: revision, job: { kind, params } });

test("the contract lists all job kinds and validates crystal parameters before queueing", () => {
  expect(Object.keys(workbenchContractSummary().jobs)).toEqual([
    "properties", "energy", "energy_forces", "frame_energy_forces", "optimize",
    "prepare_3d", "conformers", "metadata_edit", "measurement_set", "coordinate_align",
    "spectrum", "vibrational_spectrum", "pair_distribution", "point_group", "space_group", "powder_xrd", "crystal_transform",
    "biological_assembly", "orbital_cube", "insert_fragment", "hydrogens", "polymer", "smiles",
    "nucleic_acid", "metal_complex", "peptide",
  ]);
  const accepted = (kind: string, params?: unknown) => {
    const result = validateWorkbenchRequest(submit(kind, params));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return (result.request as { job: { params: unknown } }).job.params;
  };
  expect(accepted("point_group")).toEqual({ tolerance: "normal" });
  expect(accepted("space_group")).toEqual({ toleranceAngstrom: 0.01 });
  expect(accepted("powder_xrd")).toEqual({ wavelengthAngstrom: 1.5405929, twoThetaMinDegrees: 10, twoThetaMaxDegrees: 90, profile: null });
  expect(accepted("powder_xrd", { profile: "lorentzian" })).toMatchObject({ profile: "lorentzian", fwhmDegrees: 0.1 });
  expect(accepted("biological_assembly", { modelNumber: "2" })).toEqual({ modelNumber: "2" });
  expect(accepted("crystal_transform", { operation: "supercell", repeats: [2, 2, 1] })).toEqual({ operation: "supercell", repeats: [2, 2, 1] });
  expect(accepted("crystal_transform", { operation: "primitive" })).toEqual({ operation: "primitive", toleranceAngstrom: 0.01 });
  expect(accepted("crystal_transform", { operation: "set_cell", cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]] })).toEqual({ operation: "set_cell", cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], keep: "fractional" });
  for (const [kind, params] of [
    ["point_group", { tolerance: "huge" }], ["space_group", { toleranceAngstrom: 1 }], ["powder_xrd", { twoThetaMinDegrees: 50, twoThetaMaxDegrees: 40 }],
    ["powder_xrd", { fwhmDegrees: 0.2 }], ["powder_xrd", { profile: "voigt" }], ["powder_xrd", { profile: "gaussian", fwhmDegrees: 6 }],
    ["biological_assembly", { assemblyId: 1 }], ["biological_assembly", { modelNumber: "" }],
    ["crystal_transform", {}], ["crystal_transform", { operation: "supercell", repeats: [2, 2] }],
    ["crystal_transform", { operation: "supercell", repeats: [21, 1, 1] }], ["crystal_transform", { operation: "fill", hallNumber: 531 }],
    ["crystal_transform", { operation: "wrap", repeats: [2, 2, 2] }], ["crystal_transform", { operation: "set_cell", cell: [[1, 0], [0, 1, 0], [0, 0, 1]] }],
  ] as const) expect(validateWorkbenchRequest(submit(kind, params))).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
});

function session(name: string, text = fixtureText(name)) {
  const extension = name.endsWith(".cif") ? "cif" : name.endsWith(".xyz") ? "xyz" : "vasp";
  const document: ViewerDocument = { id: crypto.randomUUID(), title: name.split("/").at(-1)!, path: `/${name}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document, readSource: async () => ({ text, origin: "file" }) });
  controllers.push(controller);
  const execute = (value: Record<string, unknown>) => controller.execute({ type: "workbench", ...value });
  async function ok(value: Record<string, unknown>): Promise<Record<string, any>> { const result = await execute(value); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result; }
  async function run(kind: string, params?: unknown) {
    const observed = await ok({ operation: "observe" });
    const { job } = await ok({ operation: "submit", operationId: `${kind}-${crypto.randomUUID()}`, expectedSourceRevision: observed.sourceRevision, job: { kind, params } });
    for (let i = 0; i < 2000; i++) {
      const { job: current } = await ok({ operation: "status", jobId: job.jobId });
      if (!["queued", "running"].includes(current.status)) {
        if (current.status !== "succeeded") throw new Error(JSON.stringify(current.error));
        const artifacts: Record<string, string> = {};
        for (const { name: artifact } of current.artifacts) artifacts[artifact] = (await ok({ operation: "export", jobId: job.jobId, artifact })).artifact.content;
        return { summary: current.summary, artifacts };
      }
      await Bun.sleep(5);
    }
    throw new Error(`${kind} did not finish`);
  }
  return { execute, ok, run };
}

test("observe reports the cell and which jobs a crystal or a molecule can run", async () => {
  const crystal = await session("rutile.cif").ok({ operation: "observe" });
  expect(crystal.crystal).toMatchObject({ format: "cif", atomCount: reference.fixtures["rutile.cif"].atomCount });
  expect(crystal.jobs).toMatchObject({ space_group: { available: true }, powder_xrd: { available: true }, pair_distribution: { available: true }, crystal_transform: { available: true }, point_group: { available: false } });
  const molecule = session(reference.molecules.water.file);
  const observed = await molecule.ok({ operation: "observe" });
  expect(observed.crystal).toBeNull();
  expect(observed.jobs).toMatchObject({ point_group: { available: true }, space_group: { available: false }, crystal_transform: { available: false } });
  expect(await molecule.execute({ operation: "submit", operationId: "no-cell", expectedSourceRevision: observed.sourceRevision, job: { kind: "powder_xrd" } }))
    .toMatchObject({ ok: false, error: { code: "JOB_UNAVAILABLE" } });
});

test("space_group, powder_xrd and pair_distribution match spglib, pymatgen and ASE", async () => {
  const rutile = reference.fixtures["rutile.cif"], quartz = reference.fixtures["quartz.cif"];
  const group = await session("rutile.cif").run("space_group", { toleranceAngstrom: 0.01 });
  expect([group.summary.number, group.summary.hallNumber]).toEqual([rutile.spglib["0.01"].number, rutile.spglib["0.01"].hallNumber]);
  const xrd = await session("rutile.cif").run("powder_xrd");
  const peaks = xrd.artifacts.peaks.split("\n").filter(line => /^\d/u.test(line)).map(line => line.split(",").map(Number)).filter(([, , intensity]) => intensity > 1e-3);
  // The CSV rounds 2θ to 1e-5°.
  expect(peaks).toHaveLength(rutile.xrd!.length);
  peaks.forEach(([twoTheta, , , , , multiplicity], index) => { expect(Math.abs(twoTheta - rutile.xrd![index].twoTheta)).toBeLessThan(1e-5); expect(multiplicity).toBe(rutile.xrd![index].multiplicity); });
  expect(JSON.parse(xrd.artifacts.pattern).format).toBe("burette-powder-xrd");
  // A broadened profile peaks at the strongest reflection and is scaled to 100 there.
  const broadened = await session("rutile.cif").run("powder_xrd", { profile: "gaussian", fwhmDegrees: 0.2 });
  const profile = JSON.parse(broadened.artifacts.pattern).profile as { shape: string; fwhmDegrees: number; twoTheta: number[]; intensity: number[] };
  const top = profile.intensity.indexOf(Math.max(...profile.intensity));
  expect([profile.shape, profile.fwhmDegrees, broadened.summary.profile, Math.round(profile.intensity[top])]).toEqual(["gaussian", 0.2, "gaussian", 100]);
  expect(Math.abs(profile.twoTheta[top] - broadened.summary.strongestPeaks[0].twoTheta)).toBeLessThan(0.05);
  const pairs = await session("quartz.cif").run("pair_distribution", { rMax: quartz.pairDistribution!.rMax, binWidth: quartz.pairDistribution!.binWidth });
  const histograms = JSON.parse(pairs.artifacts.distribution).histograms as { counts: number[] }[];
  expect(histograms[0].counts.map((_, bin) => histograms.reduce((sum, item) => sum + item.counts[bin], 0))).toEqual(quartz.pairDistribution!.total);
});

test("biological_assembly exports the chosen model of a deposited assembly as mmCIF", async () => {
  const text = await Bun.file(new URL("fixtures/assemblies/two-model.cif", import.meta.url)).text();
  const assembly = session("two-model.cif", text);
  await expect(assembly.run("biological_assembly")).rejects.toThrow("defines 2 models; set job.params.modelNumber to one of 1, 2");
  const built = await assembly.run("biological_assembly", { modelNumber: "2" });
  expect(built.summary).toMatchObject({ assemblyId: "1", modelNumber: "2", copies: 2, atomCount: 2, chainCount: 2, assemblyCount: 1, modelCount: 2 });
  expect(built.artifacts.structure).toContain("_atom_site.Cartn_x");
  const observed = await session("rutile.cif").ok({ operation: "observe" });
  expect(observed.jobs.biological_assembly).toEqual({ available: false, reason: "Open a PDB or mmCIF file with a biological assembly." });
});

test("point_group symmetrizes a distorted molecule; the artifact keeps the group at the tight tolerance", async () => {
  const msym = await instantiateStandaloneWasm(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-msym.wasm", import.meta.url));
  const lines = fixtureText(reference.molecules.methane.file).trimEnd().split("\n");
  const distorted = lines.map((line, index) => index < 2 ? line : line.replace(/-?\d+\.\d+/u, value => String(Number(value) + 0.01 * index))).join("\n") + "\n";
  const result = await session("methane.xyz", distorted).run("point_group", { tolerance: "loose" });
  expect(result.summary.pointGroup).toBe(reference.molecules.methane.schoenflies);
  expect(result.summary.maxDisplacementAngstrom).toBeGreaterThan(0);
  expect(analyzePointGroup(msym, { atoms: parseXyz(result.artifacts.symmetrized).atoms, tolerance: "tight" }, "detect").pointGroup).toBe("Td");
});

test("crystal_transform writes each result in the source format, or a CIF for an asymmetric unit", async () => {
  const si = reference.fixtures["si.poscar"];
  const supercell = await session("si.poscar").run("crystal_transform", { operation: "supercell", repeats: [2, 2, 1] });
  expect(supercell.summary).toMatchObject({ operation: "supercell", format: "vasp", atomCount: si.supercell_2x2x1.atomCount });
  const reread = await readCrystalDocument({ format: "vasp", text: supercell.artifacts.structure });
  expect(reread.atoms).toHaveLength(si.supercell_2x2x1.atomCount);
  const asymmetric = await session("triclinic-molecule.xyz").run("crystal_transform", { operation: "asymmetric_unit" });
  expect(asymmetric.summary.format).toBe("cif");
  expect((await readCrystalDocument({ format: "cif", text: asymmetric.artifacts.structure })).atoms).toHaveLength(reference.fixtures["triclinic-molecule.xyz"].atomCount);
});
