import { plugin } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { molstarCubeUnitsPlugin } from "../scripts/molstar-cube-units.mjs";
import { molstarCubeDatasetsPlugin, patchMolstarCubeDatasets } from "../scripts/molstar-cube-datasets.mjs";
import { volumeFromCube as volumeFromUpstream } from "@molstar/model/formats/volume/cube";

const browser = new Window();
Object.assign(browser, { setImmediate, clearImmediate });
Object.assign(globalThis, { window: browser, document: browser.document });
plugin(molstarCubeUnitsPlugin);
plugin(molstarCubeDatasetsPlugin);
const { parseCube } = await import("@molstar/io/reader/cube/parser");
const { volumeFromCube } = await import("@molstar/model/formats/volume/cube");
const { trajectoryFromCube } = await import("@molstar/model/formats/structure/cube");
const { PluginContext } = await import("@molstar/plugin");
const { DefaultPluginSpec } = await import("@molstar/plugin/default-spec");
const { StateTransforms } = await import("@molstar/viewer/state-transforms");

const nval = ["Three fields", "Known interleaved samples", "1 1.25 -2.5 3.75 3",
  "-2 0.5 0.125 0", "-1 0 0.75 -0.125", "-1 0.25 0 1.5", "8 8 2 3 4",
  "-4 40 400 -3 30 300", ""].join("\n");
const orbitals = nval.replace("1 1.25 -2.5 3.75 3", "-1 1.25 -2.5 3.75")
  .replace("-4 40 400 -3 30 300", "3 7 11 17\n-4 40 400 -3 30 300");
const fields = [[-4, -3], [40, 30], [400, 300]];
const matrix = [0.5, 0.125, 0, 0, 0, 0.75, -0.125, 0, 0.25, 0, 1.5, 0, 1.25, -2.5, 3.75, 1];

test("every native Cube dataset uses its tuple offset and shared stride without changing atoms or axes", async () => {
  for (const text of [nval, orbitals]) {
    const parsed = await parseCube(text, "fields.cube").run();
    if (parsed.isError) throw new Error(parsed.message);
    expect(parsed.result.header.dataSetIds).toEqual(text === nval ? [0, 1, 2] : [7, 11, 17]);
    for (let dataIndex = 0; dataIndex < 3; dataIndex++) {
      const volume = await volumeFromCube(parsed.result, { dataIndex }).run();
      if (volume.grid.transform.kind !== "matrix") throw new Error("Expected matrix transform");
      expect({ values: Array.from(volume.grid.cells.data), matrix: Array.from(volume.grid.transform.matrix),
        dimensions: volume.grid.cells.space.dimensions }).toEqual({ values: fields[dataIndex], matrix, dimensions: [2, 1, 1] });
      const model = (await trajectoryFromCube(parsed.result).run()).representative;
      expect({ x: Array.from(model.atomicConformation.x), y: Array.from(model.atomicConformation.y), z: Array.from(model.atomicConformation.z) })
        .toEqual({ x: [2], y: [3], z: [4] });
    }
    expect(Array.from(parsed.result.values)).toEqual([-4, 40, 400, -3, 30, 300]);
    expect(() => parseScientificFile("fields.cube", text)).toThrow(/Multi-/);
  }
});

test("actual native state transform changes and undoes the selected dataset while retaining source bytes", async () => {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  try {
    const raw = await plugin.builders.data.rawData({ data: orbitals, label: "fields.cube" });
    const format = await plugin.build().to(raw).apply(StateTransforms.Data.ParseCube).commit();
    const volume = await plugin.build().to(format).apply(StateTransforms.Volume.VolumeFromCube, { dataIndex: 1 }).commit();
    expect(Array.from(volume.data!.grid.cells.data)).toEqual([40, 30]);
    await plugin.build().to(volume).update({ dataIndex: 2, entryId: "" }).commit({ canUndo: "Select Cube dataset" });
    expect(Array.from(volume.cell!.obj!.data.grid.cells.data)).toEqual([400, 300]);
    await plugin.runTask(plugin.state.data.undo());
    expect({ values: Array.from(volume.cell!.obj!.data.grid.cells.data), dataIndex: volume.cell!.params!.values.dataIndex,
      source: raw.data }).toEqual({ values: [40, 30], dataIndex: 1, source: orbitals });
  } finally { plugin.dispose(); }
});

test("ordinary single-field native Cube output remains identical for both supported coordinate units", async () => {
  const single = nval.replace("1 1.25 -2.5 3.75 3", "1 1.25 -2.5 3.75")
    .replace("-4 40 400 -3 30 300", "-4 -3");
  const bohr = single.split("\n").map((line, i) => i >= 3 && i <= 5 ? line.slice(1) : line).join("\n");
  for (const text of [single, bohr]) {
    const parsed = await parseCube(text, "single.cube").run();
    if (parsed.isError) throw new Error(parsed.message);
    const fixed = await volumeFromCube(parsed.result, {}).run();
    // The pinned ESM/CJS builds duplicate nominal Column enum types; runtime fields are identical.
    const original = await volumeFromUpstream(parsed.result as unknown as Parameters<typeof volumeFromUpstream>[0], {}).run();
    expect({ values: fixed.grid.cells.data, transform: fixed.grid.transform, stats: fixed.grid.stats })
      .toEqual({ values: original.grid.cells.data, transform: original.grid.transform, stats: original.grid.stats });
    expect(parseScientificFile("single.cube", text).grid!.values).toEqual(new Float32Array([-4, -3]));
  }
});

test("out-of-range or nonintegral dataset choices reject instead of publishing another field", async () => {
  const parsed = await parseCube(orbitals, "fields.cube").run();
  if (parsed.isError) throw new Error(parsed.message);
  for (const dataIndex of [-1, 0.5, 3, 7, NaN, Infinity]) {
    await expect(volumeFromCube(parsed.result, { dataIndex }).run()).rejects.toThrow("Cube dataset index");
  }
});

test("dataset adapter refuses a changed or already patched upstream source", () => {
  const source = readFileSync(new URL("../node_modules/molstar/lib/mol-model-formats/volume/cube.js", import.meta.url), "utf8");
  expect(() => patchMolstarCubeDatasets("unexpected source")).toThrow("review dataset selection");
  expect(() => patchMolstarCubeDatasets(patchMolstarCubeDatasets(source))).toThrow("review dataset selection");
});
