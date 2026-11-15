import { afterAll, expect, test } from "bun:test";
import { runReaderTask } from "../apps/desktop/src/lib/workbench/reader-task";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
const NativeWorker = Worker, workers: ObservedWorker[] = [];
class ObservedWorker extends NativeWorker {
  terminated = false;
  constructor(...args: ConstructorParameters<typeof NativeWorker>) { super(...args); workers.push(this); }
  override terminate() { this.terminated = true; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { ...originalWorker, value: ObservedWorker });
afterAll(() => { for (const worker of workers) worker.terminate(); Object.defineProperty(globalThis, "Worker", originalWorker); });
const xyz = "2\nEnergy=-1 Hartree\nH 0 0 0\nF 0 0 1\n";
const cif = `data_oblique
_cell_length_a 4
_cell_length_b 5
_cell_length_c 6
_cell_angle_alpha 75
_cell_angle_beta 85
_cell_angle_gamma 60
_space_group_IT_number 2
loop_
_space_group_symop_operation_xyz
'x,y,z'
'-x,-y,-z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C .1 .2 .3
O1 O 0 0 0
`;

test("isolated reader workers return complete scientific and symmetry-expanded CIF results", async () => {
  const trajectory = xyz + xyz.replace("Energy=-1", "Energy=-2").replace("F 0 0 1", "F 0 0 2");
  const [science, crystal] = await Promise.all([runReaderTask({ action: "parse", name: "trajectory.xyz", text: trajectory }), runReaderTask({ action: "cif", text: cif })]);
  expect(science).toEqual(parseScientificFile("trajectory.xyz", trajectory));
  expect(crystal).toEqual(await readCifCrystal(cif));
  expect(science.frames.map(frame => frame.atoms[1].z)).toEqual([1, 2]);
  expect(crystal.sourceAtomIndices).toEqual([0, 0, 1]);
  expect(workers.slice(-2).map(worker => worker.terminated)).toEqual([true, true]);
});

test("worker cloning preserves a real FCHK Hessian, mode values and shared source/frame identity", async () => {
  const text = await Bun.file(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url)).text();
  const parsed = await runReaderTask({ action: "parse", name: "water.fchk", text });
  expect(parsed).toEqual(parseScientificFile("water.fchk", text)); expect(parsed.frames[0].atoms).toBe(parsed.atoms);
  expect(parsed.frames[0].hessian!.values).toBeInstanceOf(Float64Array); expect(parsed.frames[0].modes).toBe(parsed.modes);
});

test("worker failures retain reader validation and input/resource bounds", async () => {
  for (const text of ["x".repeat(16 * 1024 * 1024 + 1), "#" + "界".repeat(6 * 1024 * 1024)]) {
    await expect(runReaderTask({ action: "parse", name: "invalid.xyz", text })).rejects.toThrow("16 MiB");
  }
  await expect(runReaderTask({ action: "parse", name: "invalid.xyz", text: xyz.replace("F 0 0 1", "F NaN 0 1") })).rejects.toThrow();
  await expect(runReaderTask({ action: "cif", text: "x".repeat(20_000_001) })).rejects.toThrow("20 MB");
  await expect(runReaderTask({ action: "cif", text: cif.replace("'-x,-y,-z'", "'2*x,y,z'") })).rejects.toThrow();
  expect(workers.every(worker => worker.terminated)).toBe(true);
});

test("pre-abort starts no worker; abort and timeout terminate pending synchronous reader work", async () => {
  const request = { action: "parse" as const, name: "water.xyz", text: xyz }, before = workers.length;
  const cancelled = new AbortController(); cancelled.abort();
  await expect(runReaderTask(request, { signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(workers).toHaveLength(before);
  const controller = new AbortController(), pending = runReaderTask(request, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(workers.at(-1)!.terminated).toBe(true);
  await expect(runReaderTask(request, { timeoutMs: 0 })).rejects.toThrow("time limit");
  expect(workers.at(-1)!.terminated).toBe(true);
  expect(await runReaderTask(request)).toEqual(parseScientificFile(request.name, request.text));
});

test("browser reader dependency closure retains parsers without builders, assemblies or general workers", async () => {
  const loaded: string[] = [], result = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/reader-worker.ts", import.meta.url).pathname], target: "browser", plugins: [{ name: "reader-closure", setup(build) { build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, ({ path }) => { loaded.push(path); }); } }] });
  expect(result.success).toBe(true);
  for (const owner of ["quantum", "cif-crystal", "fchk", "gaussian", "qcschema", "gaussian-log"]) expect(loaded.some(path => path.endsWith(`/${owner}.ts`))).toBe(true);
  expect(loaded.filter(path => /\/(?:builders|biological-assembly|nucleic|science-worker|science-task|open|quantum-client)\.tsx?$/u.test(path))).toEqual([]);
});
