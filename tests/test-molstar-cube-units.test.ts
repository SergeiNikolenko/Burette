import { plugin } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { molstarCubeUnitsPlugin, patchMolstarCubeUnits } from "../scripts/molstar-cube-units.mjs";
import { parseCube as parseUpstream } from "molstar/lib/commonjs/mol-io/reader/cube/parser.js";

plugin(molstarCubeUnitsPlugin);
const { parseCube } = await import("molstar/lib/mol-io/reader/cube/parser.js");
const { volumeFromCube } = await import("molstar/lib/mol-model-formats/volume/cube.js");
const { trajectoryFromCube } = await import("molstar/lib/mol-model-formats/structure/cube.js");

const angstrom = ["Oblique units fixture", "Known Cartesian coordinates, signed scalar samples",
  "2 1.25 -2.5 3.75", "-2 0.5 0.125 0", "-2 0 0.75 -0.125", "-2 0.25 0 1.5",
  "1 1 2 3 4", "8 8 -1 0.5 2.5", "-4 -3 -2 -1 0 1 2 3", ""].join("\n");
const bohr = angstrom.split("\n").map((line, index) => index >= 3 && index <= 5 ? line.slice(1) : line).join("\n");
const matrixAngstrom = [0.5, 0.125, 0, 0, 0, 0.75, -0.125, 0, 0.25, 0, 1.5, 0, 1.25, -2.5, 3.75, 1];

test("negative voxel counts preserve Angstrom atom coordinates and oblique volume transform", async () => {
  const parsed = await parseCube(angstrom, "angstrom.cube").run();
  if (parsed.isError) throw new Error(parsed.message);
  const data = parsed.result;
  expect({ origin: Array.from(data.header.origin), axes: [data.header.basisX, data.header.basisY, data.header.basisZ].map(axis => Array.from(axis)),
    dimensions: Array.from(data.header.dim), values: Array.from(data.values) }).toEqual({
    origin: [1.25, -2.5, 3.75], axes: [[0.5, 0.125, 0], [0, 0.75, -0.125], [0.25, 0, 1.5]],
    dimensions: [2, 2, 2], values: [-4, -3, -2, -1, 0, 1, 2, 3],
  });
  const volume = await volumeFromCube(data, {}).run();
  if (volume.grid.transform.kind !== "matrix") throw new Error("Expected matrix transform");
  expect(Array.from(volume.grid.transform.matrix)).toEqual(matrixAngstrom);
  const model = (await trajectoryFromCube(data).run()).representative;
  expect({ x: Array.from(model.atomicConformation.x), y: Array.from(model.atomicConformation.y),
    z: Array.from(model.atomicConformation.z) }).toEqual({ x: [2, -1], y: [3, 0.5], z: [4, 2.5] });
  const science = parseScientificFile("angstrom.cube", angstrom);
  expect({ ...science.grid, origin: Array.from(science.grid!.origin), axes: science.grid!.axes.map(axis => Array.from(axis)) }).toEqual({
    dimensions: [2, 2, 2], origin: Array.from(data.header.origin),
    axes: [data.header.basisX, data.header.basisY, data.header.basisZ].map(axis => Array.from(axis)), values: new Float32Array(data.values) });
});

test("positive voxel counts retain pinned native Bohr behavior and agree with scientific coordinates", async () => {
  const parsed = await parseCube(bohr, "bohr.cube").run(), upstream = await parseUpstream(bohr, "bohr.cube").run();
  if (parsed.isError || upstream.isError) throw new Error("Cube parsing failed");
  expect(parsed.result.header).toEqual(upstream.result.header);
  expect(parsed.result.values).toEqual(upstream.result.values);
  const model = (await trajectoryFromCube(parsed.result).run()).representative;
  const science = parseScientificFile("bohr.cube", bohr);
  for (const axis of ["x", "y", "z"] as const) {
    expect(Array.from(parsed.result.atoms[axis].toArray())).toEqual(Array.from(upstream.result.atoms[axis].toArray()));
    science.atoms.forEach((atom, index) => expect(model.atomicConformation[axis][index]).toBeCloseTo(atom[axis], 6));
  }
  const volume = await volumeFromCube(parsed.result, {}).run();
  expect(volume.grid.transform.kind).toBe("matrix");
  if (volume.grid.transform.kind !== "matrix") throw new Error("Expected matrix transform");
  const matrix = volume.grid.transform.matrix;
  matrixAngstrom.forEach((value, i) => expect(matrix[i]).toBeCloseTo(i === 15 ? 1 : value * 0.529177210859, 12));
});

test("atom-count orbital flag remains separate from units and multi-field parser values retain their order", async () => {
  for (const single of [angstrom, bohr]) {
    const orbital = single.replace("2 1.25 -2.5 3.75", "-2 1.25 -2.5 3.75")
      .replace("-4 -3 -2 -1 0 1 2 3", "2 7 11\n-4 40 -3 30 -2 20 -1 10 0 0 1 -10 2 -20 3 -30");
    const nval = orbital.replace("-2 1.25 -2.5 3.75", "2 1.25 -2.5 3.75 2").replace("2 7 11\n", "");
    for (const text of [orbital, nval]) {
      const parsed = await parseCube(text, "multi.cube").run();
      if (parsed.isError) throw new Error(parsed.message);
      expect({ orbitals: parsed.result.header.orbitals, ids: parsed.result.header.dataSetIds,
        values: Array.from(parsed.result.values), origin: Array.from(parsed.result.header.origin) }).toEqual({
        orbitals: text === orbital, ids: text === orbital ? [7, 11] : [0, 1],
        values: [-4, 40, -3, 30, -2, 20, -1, 10, 0, 0, 1, -10, 2, -20, 3, -30],
        origin: single === angstrom ? [1.25, -2.5, 3.75] : [1.25, -2.5, 3.75].map(n => n * 0.529177210859),
      });
      const science = parseScientificFile("multi.cube", text);
      expect(science.gridDatasets!.map(dataset => [dataset.orbitalNumber, Array.from(dataset.grid.values)])).toEqual(parsed.result.header.dataSetIds.map((id: number, k: number) =>
        [text === orbital ? id : undefined, Array.from(parsed.result.values).filter((_, i) => i % 2 === k)]));
      expect(Array.from(science.grid!.origin)).toEqual(Array.from(parsed.result.header.origin).map(value => expect.closeTo(value, 9))); // Mol* uses an older bohr constant
    }
  }
});

test("mixed or nonintegral voxel-unit declarations fail before a native field is produced", async () => {
  for (const text of [angstrom.replace("-2 0.5", "2 0.5"), angstrom.replace("-2 0.5", "0 0.5"),
    angstrom.replace("-2 0.5", "-2.5 0.5")]) {
    await expect(parseCube(text, "invalid.cube").run()).rejects.toThrow(/Cube axis counts|Mixed cube axis units/);
    expect(() => parseScientificFile("invalid.cube", text)).toThrow();
  }
});

test("the version-owned adapter refuses drift or double application", () => {
  const source = readFileSync(new URL("../node_modules/molstar/lib/mol-io/reader/cube/parser.js", import.meta.url), "utf8");
  expect(() => patchMolstarCubeUnits("unexpected source")).toThrow("review units");
  expect(() => patchMolstarCubeUnits(patchMolstarCubeUnits(source))).toThrow("review units");
});
