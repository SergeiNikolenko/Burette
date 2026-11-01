import { readFileSync } from "node:fs";
import { Task } from "@molstar/core/task/task";
import vm from "node:vm";
import { PluginStateSnapshotManager } from "@molstar/plugin/state/manager/snapshots";
import { parseSdf } from "@molstar/io/reader/sdf/parser";
import { trajectoryFromSdf } from "@molstar/model/formats/structure/sdf";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { parseXyz } from "@molstar/io/reader/xyz/parser";
import { trajectoryFromXyz } from "@molstar/model/formats/structure/xyz";
import { Structure } from "@molstar/model/model/structure/structure/structure";
import { AssetManager } from "@molstar/core/util/assets";
import { readXyzFrames, type ScienceSceneBinding } from "../apps/desktop/src/lib/science-session/codec";
import { XYZ } from "./scientific-data-fixture";
export { XYZ, waterScience } from "./scientific-data-fixture";

// The viewer adapter runs as shipped, in its own realm like the iframe; arrays cross into it
// as they would through postMessage.
const window: Record<string, any> = {};
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window, crypto, TextEncoder, TextDecoder, Set, WeakMap, File, Uint8Array, Float64Array });
export const science = window.BuretteSceneFiles.science;

const STATE = { entries: [{ snapshot: { id: "s1", data: { tree: { transforms: [{ ref: "s", transformer: "ms-plugin.structure-from-model" }] } }, camera: { current: { radius: 7 } } } }], current: "s1" };

/** A Mol* plugin with one XYZ structure whose coordinates the test moves. */
export function fakeViewer(text: string, refs = { structure: "s", model: "m", trajectory: "t" }) {
  let frame = readXyzFrames(text)[0];
  const assets = new AssetManager();
  const runTask = (task: { run: () => Promise<unknown> }) => task.run();
  const manager = { plugin: { managers: { asset: assets }, runTask }, getStateSnapshot: async () => STATE };
  const unit = {
    kind: 0,
    get elements() { return frame.elements.map((_, index) => index); },
    model: { atomicHierarchy: { atomSourceIndex: { value: (index: number) => index }, atoms: { type_symbol: { value: (index: number) => frame.elements[index].toUpperCase() } } } },
    conformation: { x: (index: number) => Math.fround(frame.positions[index * 3]), y: (index: number) => Math.fround(frame.positions[index * 3 + 1]), z: (index: number) => Math.fround(frame.positions[index * 3 + 2]) },
  };
  const cells = new Map<string, any>([
    [refs.structure, { transform: { ref: refs.structure, parent: refs.model, transformer: { id: "ms-plugin.structure-from-model" } }, get obj() { return { data: { elementCount: frame.elements.length, units: [unit] } }; } }],
    [refs.model, { transform: { ref: refs.model, parent: refs.trajectory, params: { modelIndex: 0 }, transformer: { id: "ms-plugin.model-from-trajectory" } } }],
    [refs.trajectory, { transform: { ref: refs.trajectory, parent: "raw", transformer: { id: "ms-plugin.trajectory-from-xyz" } }, obj: { data: { frameCount: 1 } } }],
    ["raw", { transform: { ref: "raw", parent: "root", transformer: { id: "ms-plugin.raw-data" } } }],
  ]);
  const plugin = {
    managers: {
      asset: assets,
      structure: { hierarchy: { current: { get structures() { return [{ cell: cells.get(refs.structure) }]; } } } },
      snapshot: { serialize: (options: unknown) => (PluginStateSnapshotManager.prototype.serialize as any).call(manager, options) },
    },
    state: { data: { cells } },
  };
  return { viewer: { plugin }, assets, move: (next: string) => { frame = readXyzFrames(next)[0]; } };
}

export const bindingOf = (report: any): ScienceSceneBinding => ({
  structureRef: report.structureRef, modelRef: report.modelRef, trajectoryRef: report.trajectoryRef,
  frameIndex: report.frameIndex, frameCount: report.frameCount, atomCount: report.atomCount,
});

/** The production Mol* XYZ pipeline, including uppercase two-letter element symbols. */
export async function realXyzViewer(text: string, frame = 0) {
  const parsed = await parseXyz(text).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromXyz(parsed.result).run();
  const model = await Task.resolveInContext(trajectory.getFrameAtIndex(frame));
  const current = fakeViewer(text);
  const cells = current.viewer.plugin.state.data.cells;
  Object.defineProperty(cells.get("s"), "obj", { value: { data: Structure.ofModel(model) } });
  cells.get("m").transform.params.modelIndex = frame;
  cells.get("t").obj.data.frameCount = trajectory.frameCount;
  return current;
}

export async function realSdfViewer(source: string) {
  const parsed = await parseSdf(source).run();
  if (parsed.isError || parsed.result.compounds.length !== 1) throw new Error("bad fixture");
  const trajectory = await trajectoryFromSdf(parsed.result.compounds[0]).run();
  const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
  const atoms = parseMolecule(source, "sdf").atoms;
  const viewer = fakeViewer(serializeXyz(atoms, "graph"));
  const cells = viewer.viewer.plugin.state.data.cells;
  Object.defineProperty(cells.get("s"), "obj", { value: { data: Structure.ofModel(model) } });
  cells.get("t").transform.transformer.id = "ms-plugin.trajectory-from-sdf";
  cells.get("raw").obj = { data: source };
  return viewer;
}
