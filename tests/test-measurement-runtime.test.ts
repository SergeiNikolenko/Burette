import { plugin } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { Window } from "happy-dom";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
plugin(molstarMolV3000Plugin); plugin(molstarV3000ChargesPlugin);
const browser = new Window(); Object.assign(browser, { setImmediate, clearImmediate });
Object.assign(globalThis, { window: browser, document: browser.document });
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
const { StateTransforms } = await import("molstar/lib/mol-plugin-state/transforms.js");
const { setCanvasModule } = await import("molstar/lib/mol-geo/geometry/text/font-atlas.js");
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) } as never);
// Literal source-order fixture: H precedes heavy atoms; non-contiguous IDs are not row indices.
const mol = ["Runtime identity", "Burette", "", "  0  0  0     0  0            999 V3000",
  "M  V30 BEGIN CTAB", "M  V30 COUNTS 4 3 0 0 0", "M  V30 BEGIN ATOM",
  "M  V30 20 H 0 0 0 0", "M  V30 7 N 1 0 0 0 CHG=1", "M  V30 90 C 1 1 0 0", "M  V30 4 O 1 1 1 0 CHG=-1",
  "M  V30 END ATOM", "M  V30 BEGIN BOND", "M  V30 2 1 20 7", "M  V30 8 1 7 90", "M  V30 3 2 90 4",
  "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\n");
const digest = text => createHash("sha256").update(text).digest("hex");
let duringDigest: (() => void) | undefined;
const scope: Record<string, any> = { molstar: { lib: { structure: { StructureElement } } } };
for (const file of ["scene-file-actions", "measurement-coordinate"]) vm.runInNewContext(
  readFileSync(new URL(`../PreviewExtension/Web/${file}.js`, import.meta.url), "utf8"),
  { window: scope, TextEncoder, Uint8Array, Float64Array, File, crypto: { subtle: { digest: async (...args) => {
    const callback = duringDigest; duringDigest = undefined; callback?.(); return crypto.subtle.digest(...args as Parameters<typeof crypto.subtle.digest>);
  } } } });
const science = scope.BuretteSceneFiles.science, runtime = scope.BuretteMeasurementCoordinate;
async function viewer(text = mol, format = "mol") {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  const root = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const loci = (sources: number[]) => StructureElement.Loci(root, root.units.map(unit => ({ unit,
    indices: Int32Array.from(Array.from(unit.elements, (element, index) => sources.includes(unit.model.atomicHierarchy.atomSourceIndex.value(element)) ? index : -1).filter(index => index >= 0)) as never,
  })).filter(group => group.indices.length));
  return { plugin, raw, trajectory, root, loci };
}
const measurements = viewer => [...viewer.plugin.state.data.cells.values()].filter(cell => String(cell.transform.transformer?.id).includes("structure-selections-") && ["Distance", "Angle", "Dihedral", "Label", "Orientation", "Plane"].includes(cell.obj?.label));
const transfer = capture => ({ version: 1, sourceFormat: capture.sourceFormat, targetSourceSha256: capture.sourceSha256, atomCount: capture.atomCount, items: capture.items, group: capture.group });

test("actual MOL/SDF providers bind raw bytes and filtered ordered loci, rejecting asynchronous source substitution", async () => {
  for (const format of ["mol", "sdf"]) {
    const text = format === "mol" ? mol : mol + "$$$$\n", v = await viewer(text, format);
    try {
      const binding = await science.graphBinding(v);
      expect({ format: binding.sourceFormat, sha: binding.sourceSha256, elements: binding.elements, positions: Array.from(binding.positions) })
        .toEqual({ format, sha: digest(text), elements: ["H", "N", "C", "O"], positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1] });
      const unit = v.root.units[0], rootCell = v.plugin.managers.structure.hierarchy.current.structures[0].cell;
      const component = await v.plugin.builders.structure.tryCreateComponent(rootCell.transform.ref, {
        type: { name: "bundle", params: StructureElement.Bundle.fromLoci(v.loci([0, 2])) }, nullIfEmpty: true, label: "Filtered atoms",
      }, "measurement-subset");
      const pick = index => StructureElement.Loci(component!.data!, [{ unit: component!.data!.units[0], indices: Int32Array.of(index) as never }]);
      const selection = v.plugin.managers.structure.measurement.getGroup().apply(StateTransforms.Model.MultiStructureSelectionFromBundle, {
        selections: [1, 0].map((index, position) => ({ key: String(position), groupId: String(position), ref: component!.ref, bundle: StructureElement.Bundle.fromLoci(pick(index)) })),
        isTransitive: false, label: "Distance",
      }, { dependsOn: [component!.ref] });
      const representation = selection.apply(StateTransforms.Representation.StructureSelectionsDistance3D, {});
      await representation.commit(); const distance = { selection: selection.selector, representation: representation.selector };
      const describe = () => runtime.describe(v, [distance!.representation.cell], science);
      expect((await describe()).atoms).toEqual([2, 0]);
      const roots = v.plugin.managers.structure.hierarchy.current.structures; roots.push(roots[0]);
      await expect(science.graphBinding(v)).rejects.toThrow("exactly one structure"); roots.pop();
      const trajectory = v.trajectory.cell!, original = trajectory.transform.transformer;
      duringDigest = () => { trajectory.transform = { ...trajectory.transform, transformer: { ...original, id: format === "mol" ? "ms-plugin.trajectory-from-sdf" : "ms-plugin.trajectory-from-mol" } as never }; };
      await expect(science.graphBinding(v)).rejects.toThrow("changed"); trajectory.transform = { ...trajectory.transform, transformer: original };
      duringDigest = () => { v.raw.cell!.obj!.data = text + "\n"; };
      await expect(science.graphBinding(v)).rejects.toThrow("changed"); v.raw.cell!.obj!.data = text;
      const rawCell = v.raw.cell!, rawCells = v.plugin.state.data.cells;
      duringDigest = () => { rawCells.set(rawCell.transform.ref, { ...rawCell }); };
      await expect(science.graphBinding(v)).rejects.toThrow("changed"); rawCells.set(rawCell.transform.ref, rawCell);
      const modelCell = v.plugin.state.data.cells.get(binding.modelRef)!;
      duringDigest = () => { modelCell.transform = { ...modelCell.transform, params: { ...modelCell.transform.params, modelIndex: 1 } }; };
      await expect(science.graphBinding(v)).rejects.toThrow("changed"); modelCell.transform = { ...modelCell.transform, params: { ...modelCell.transform.params, modelIndex: 0 } };
      const cell = distance!.representation.cell!, cells = v.plugin.state.data.cells;
      duringDigest = () => { cells.set(cell.transform.ref, { ...cell }); };
      await expect(describe()).rejects.toThrow("measurement changed"); cells.set(cell.transform.ref, cell);
      const operator = unit.conformation.operator; Object.defineProperty(operator, "isIdentity", { configurable: true, value: false });
      await expect(describe()).rejects.toThrow("transformed"); Object.defineProperty(operator, "isIdentity", { value: true });
      Object.defineProperty(v.root, "models", { configurable: true, value: [v.root.models[0], v.root.models[0]] });
      await expect(describe()).rejects.toThrow("across models"); delete (v.root as any).models;
      const trajectoryData = v.trajectory.cell!.obj!.data; Object.defineProperty(trajectoryData, "frameCount", { configurable: true, value: 2 });
      await expect(describe()).rejects.toThrow("one MOL or SDF record");
    } finally { duringDigest = undefined; v.plugin.dispose(); }
  }
});

test("all six actual representations retain ordered/centroid loci, nested styles, flags and tags", async () => {
  const edited = mol.replace("90 C 1 1 0", "90 C 1 2 0");
  const before = await viewer(), after = await viewer(edited);
  try {
    const manager = before.plugin.managers.structure.measurement, l = before.loci;
    const results = [await manager.addDistance(l([2]), l([0]), { visualParams: { customText: "Расстояние 漢字", visuals: ["lines"], lineSizeAttenuation: false }, reprTags: ["measurement-order-label"] }),
      await manager.addAngle(l([0]), l([1]), l([2]), { visualParams: { arcScale: .45, sectorOpacity: .35 } }),
      await manager.addDihedral(l([0]), l([1]), l([2]), l([3]), { visualParams: { dashLength: .07 } }),
      await manager.addLabel(l([0, 2]), { visualParams: { tooltip: "Centroid", attachment: "top-left", tether: true } }),
      await manager.addOrientation([l([0, 1, 2, 3])]), await manager.addPlane([l([0, 1, 2, 3])])];
    const clip = { variant: "instance", objects: [{ type: "sphere", invert: true, position: [.2, .3, .4], rotation: { axis: [0, 1, 0], angle: 25 }, scale: [1, 2, 1], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] };
    await before.plugin.state.data.build().to(results[4]!.representation).update({ visuals: ["axes"], radiusScale: .6, scaleFactor: 1.3 }).commit();
    await before.plugin.state.data.build().to(results[5]!.representation).update({ variant: "circle", radialSegments: 24, material: { metalness: .8, roughness: .15, bumpiness: 0 }, clip, lod: [2, 20, .5],
      animation: { wiggleMode: "group", wiggleSpeed: 7, wiggleAmplitude: .3, wiggleFrequency: .2, tumbleSpeed: 1, tumbleAmplitude: 0, tumbleFrequency: .2 },
      interior: { color: 0x223344, colorStrength: .4, substance: { metalness: .2, roughness: .7, bumpiness: .1 }, substanceStrength: .5 } } as never).commit();
    results.forEach((result, index) => { before.plugin.state.data.updateCellState(result!.selection.ref, { isCollapsed: index % 2 === 0 }); before.plugin.state.data.updateCellState(result!.representation.ref, { isHidden: index % 2 === 1 }); });
    before.plugin.state.data.updateCellState(manager.getGroup().ref, { isHidden: true, isCollapsed: true });
    const capture = await runtime.capture(before, science), value = { ...transfer(capture), targetSourceSha256: digest(edited) };
    expect(capture.items.map(item => [item.kind, item.points])).toEqual([["Distance", [[2], [0]]], ["Angle", [[0], [1], [2]]], ["Dihedral", [[0], [1], [2], [3]]], ["Label", [[0, 2]]], ["Orientation", [[0, 1, 2, 3]]], ["Plane", [[0, 1, 2, 3]]]]);
    await runtime.restore(after, value, science);
    expect(Array.from((await science.graphBinding(after)).positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 2, 0, 1, 1, 1]);
    expect(transfer(await runtime.capture(after, science))).toEqual(value);
    expect(measurements(after).map(cell => [cell.obj.label, cell.transform.params])).toEqual(measurements(before).map(cell => [cell.obj.label, cell.transform.params]));
    await expect(runtime.restore(after, value, science)).rejects.toThrow("already has measurements");
  } finally { before.plugin.dispose(); after.plugin.dispose(); }
}, 15_000);

test("foreign identities and invalid later items fail before any representation is restored", async () => {
  const before = await viewer(), after = await viewer();
  try {
    await before.plugin.managers.structure.measurement.addDistance(before.loci([0, 2]), before.loci([1]));
    const capture = await runtime.capture(before, science), valid = transfer(capture);
    await expect(runtime.describe(before, [measurements(before)[0]], science)).rejects.toThrow("one atom");
    const first = valid.items[0], bad = params => ({ ...valid, items: [first, { ...first, params }] });
    for (const value of [{ ...valid, sourceFormat: "sdf" }, { ...valid, targetSourceSha256: "0".repeat(64) }, { ...valid, atomCount: 3 },
      bad({ material: { roughness: NaN } }), bad({ clip: { objects: Array(9).fill({}) } }), bad({ lod: [1, 2] }), bad({ customText: "x", foreign: true }),
      { ...valid, items: [first, { ...first, points: [[0, 0], [1]] }] },
      { ...valid, items: Array.from({ length: 3 }, () => ({ ...first, params: { customText: "漢".repeat(1024) } })) }]) {
      await expect(runtime.restore(after, value, science)).rejects.toThrow(); expect(measurements(after)).toHaveLength(0);
    }
    const foreign = await viewer(mol.replace("Runtime identity", "Foreign raw input"));
    try { await expect(runtime.restore(foreign, valid, science)).rejects.toThrow("source changed"); } finally { foreign.plugin.dispose(); }
    await runtime.restore(after, valid, science); expect(measurements(after)).toHaveLength(1);
  } finally { before.plugin.dispose(); after.plugin.dispose(); }
});

test("measurement runtime is delivered through each explicit browser asset allowlist", () => {
  for (const file of ["scripts/agent-shell-server.mjs", "scripts/build-agent-shell-plugin.mjs", "apps/burette-public-plugin/scripts/build-hosted-viewer.mjs"]) {
    expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).toMatch(/["']measurement-coordinate\.js["']/u);
  }
});
