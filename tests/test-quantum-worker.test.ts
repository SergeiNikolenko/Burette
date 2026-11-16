import { afterAll, expect, test } from "bun:test";
import { parseMolden, evaluateDensityGrid } from "../apps/desktop/src/lib/molecular-workbench/gaussian";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { computeQuantumGrid } from "../apps/desktop/src/lib/molecular-workbench/quantum-client";
const hydrogenMolden = `[Molden Format]
[Atoms] AU
H 1 1 0 0 0
[GTO]
1 0
s 1 1.00
1.0D+00 1.0
[MO]
Sym= A
Ene= -0.5
Spin= Alpha
Occup= 1
1 1.0
Sym= B
Ene= 0.25
Spin= Beta
Occup= 0
1 -1.0
`;

test("Quantum worker returns numerical fields, propagates limits and aborts running work", async () => {
  const document = parseScientificFile("h.molden", hydrogenMolden);
  const options = { spacingAngstrom: 0.5, paddingAngstrom: 1 };
  const actual = await computeQuantumGrid(document, { kind: "density" }, options);
  expect(actual).toEqual(evaluateDensityGrid(document, options));
  await expect(computeQuantumGrid(document, { kind: "orbital", orbitalIndex: 50 }, options)).rejects.toThrow("orbital");
  await expect(computeQuantumGrid(document, { kind: "density" }, { spacingAngstrom: 0.1, paddingAngstrom: 10 })).rejects.toThrow("limit");
  const controller = new AbortController();
  const pending = computeQuantumGrid(document, { kind: "density" }, options, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(computeQuantumGrid(document, { kind: "density" }, options, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
const NativeWorker = Worker, workers: ObservedWorker[] = [];
class ObservedWorker extends NativeWorker {
  terminated = false;
  request?: import("../apps/desktop/src/lib/molecular-workbench/quantum-client").QuantumWorkerRequest;
  constructor(...args: ConstructorParameters<typeof NativeWorker>) { super(...args); workers.push(this); }
  override postMessage(message: unknown, transfer: Transferable[]): void;
  override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  override postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
    this.request = message as typeof this.request;
    return Array.isArray(options) ? super.postMessage(message, options) : super.postMessage(message, options);
  }
  override terminate() { this.terminated = true; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { ...workerDescriptor, value: ObservedWorker });
afterAll(() => { for (const worker of workers) worker.terminate(); Object.defineProperty(globalThis, "Worker", workerDescriptor); });

test("actual worker preserves signed amplitude, total density and alpha-minus-beta density on every grid point", async () => {
  const document = parseMolden(hydrogenMolden);
  document.orbitals[0].occupancy = 0.25;
  document.orbitals[1].occupancy = 0.75;
  const options = { spacingAngstrom: 0.5, paddingAngstrom: 1 };
  const n = (2 / Math.PI) ** 0.75, bohr = 0.529177210903;
  for (const field of [{ kind: "orbital", orbitalIndex: 1 }, { kind: "density" }, { kind: "spin-density" }] as const) {
    const grid = await computeQuantumGrid(document, field, options);
    const expected: number[] = [];
    for (let x = -1; x <= 1; x += 0.5) for (let y = -1; y <= 1; y += 0.5) for (let z = -1; z <= 1; z += 0.5) {
      const amplitude = n * Math.exp(-(x*x+y*y+z*z)/(bohr*bohr));
      expected.push(Math.fround(field.kind === "orbital" ? -amplitude : (field.kind === "density" ? 1 : -0.5) * amplitude**2));
    }
    expect({ dimensions: grid.dimensions, origin: grid.origin, axes: grid.axes }).toEqual({ dimensions: [5,5,5], origin: [-1,-1,-1], axes: [[0.5,0,0],[0,0.5,0],[0,0,0.5]] });
    expect(Array.from(grid.values)).toEqual(expected);
    expect(workers.at(-1)!.terminated).toBe(true);
  }
});

test("worker clone excludes prior fields and trajectories while selecting the requested orbital", async () => {
  const document = parseMolden(hydrogenMolden);
  Object.defineProperties(document, {
    frames: { get() { throw new Error("Trajectory must not be read or cloned"); } },
    modes: { get() { throw new Error("Modes must not be read or cloned"); } },
    grid: { get() { throw new Error("Prior grid must not be read or cloned"); } },
  });
  await computeQuantumGrid(document, { kind: "orbital", orbitalIndex: 1 }, { paddingAngstrom: 0 });
  const request = workers.at(-1)!.request!;
  expect(Object.keys(request.document).sort()).toEqual(["atoms", "basis", "format", "frames", "modes", "orbitals"]);
  expect([request.document.frames, request.document.modes, request.document.orbitals, request.field]).toEqual([[], [], [document.orbitals[1]], { kind: "orbital", orbitalIndex: 0 }]);
});

test("preflight bounds reject excessive basis and coefficients before spawning a worker", async () => {
  const document = parseMolden(hydrogenMolden), count = workers.length;
  const shell = document.basis![0];
  for (const input of [
    { ...document, basis: Array.from({ length: 2001 }, () => shell) },
    { ...document, basis: [{ ...shell, exponents: new Array(250001), coefficients: new Array(250001) }] },
    { ...document, orbitals: [{ ...document.orbitals[0], coefficients: new Array(2000001) }] },
  ]) await expect(computeQuantumGrid(input, { kind: "density" })).rejects.toThrow("limits");
  const aborted = new AbortController(); aborted.abort();
  await expect(computeQuantumGrid(document, { kind: "density" }, {}, aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(workers.length).toBe(count);
});

test("cancelled worker cannot publish a late result into a newer independent request", async () => {
  const source = parseMolden(hydrogenMolden), controller = new AbortController();
  const old = computeQuantumGrid(source, { kind: "orbital", orbitalIndex: 0 }, {}, controller.signal);
  const oldWorker = workers.at(-1)!;
  controller.abort();
  const next = computeQuantumGrid(source, { kind: "orbital", orbitalIndex: 1 }, { paddingAngstrom: 0 });
  oldWorker.dispatchEvent(new MessageEvent("message", { data: { type: "field-result", grid: { values: new Float32Array([123]) } } }));
  await expect(old).rejects.toMatchObject({ name: "AbortError" });
  const grid = await next;
  expect(grid.values[0]).toBe(Math.fround(-((2 / Math.PI) ** 0.75)));
  expect(oldWorker.terminated && workers.at(-1)!.terminated).toBe(true);
});
