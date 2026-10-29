import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec.js";
import { StructureElement } from "molstar/lib/mol-model/structure.js";
import { IndexPairBonds } from "molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js";
import { setCanvasModule } from "molstar/lib/mol-geo/geometry/text/font-atlas.js";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { graphDraftText, graphSourceMetadata } from "../apps/desktop/src/lib/workbench/graph-draft";
import { readGraphMetadata, patchGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) } as never);
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const source = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
const viewerText = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const extract = (text: string, name: string) => text.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, "u"))![0];
function prepare(text: string, config: Record<string, unknown>, script = viewerText) {
  const scope = { BuretteDataBase64: Buffer.from(text).toString("base64"), location: { pathname: "/", search: "" } };
  const start = script.indexOf("  function prepareSdfStructure("), end = script.indexOf("  function molstarCurrentStructures(", start);
  const functions = ["normalizeFormat", "isMolViewSpecFormat", "structureSceneEntriesFromConfig", "rawStructureData", "base64ToBytes", "base64ToText", "readTrajectoryControlIndex", "trajectoryControlStorageKey", "pdbAtomLine", "cleanElement", "structureDataForMolstar"];
  const context = vm.createContext({ window: scope, TextDecoder, Uint8Array, atob,
    sessionStorage: browser.sessionStorage });
  vm.runInContext(`let decodedStructureCache=null;const trajectoryControlIndices=new Map();\n${script.match(/  const MAX_SDF_GRID_[^\n]+/gu)!.join("\n")}\n${script.match(/  const SDF_GRID_PADDING[^\n]+/u)![0]}\n${script.slice(start, end)}\n${functions.map(name => extract(script, name)).join("\n")}\nglobalThis.prepare=structureDataForMolstar;`, context);
  return context.prepare(config);
}
async function opened(text: string, extension = "sdf") {
  const doc = await openBrowserDevTextDocument(`single.${extension}`, extension, text, { ...defaultPreferences, rendererMode: "molstar" }, undefined, "single-graph");
  const config = JSON.parse(doc.runtimePath.match(/window\.BuretteConfig = (\{[\s\S]*?\});/u)![1]);
  const embedded = Buffer.from(doc.runtimePath.match(/window\.BuretteDataBase64 = "([^"]+)"/u)![1], "base64");
  return { doc, config, embedded, prepared: prepare(embedded.toString(), config) };
}
const runtimeScope: Record<string, any> = { molstar: { lib: { structure: { StructureElement } } } };
for (const name of ["scene-file-actions", "measurement-coordinate"]) vm.runInNewContext(
  readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"),
  { window: runtimeScope, crypto, TextEncoder, Uint8Array, Float64Array, File });
const science = runtimeScope.BuretteSceneFiles.science, measurement = runtimeScope.BuretteMeasurementCoordinate;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function loaded(prepared: ReturnType<typeof prepare>) {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: prepared.data, label: prepared.label });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, prepared.format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  const root = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const loci = (source: number) => StructureElement.Loci(root, root.units.flatMap(unit => {
    const indices = Int32Array.from(Array.from(unit.elements, (element, index) => unit.model.atomicHierarchy.atomSourceIndex.value(element) === source ? index : -1).filter(index => index >= 0));
    return indices.length ? [{ unit, indices: indices as never }] : [];
  }));
  return { plugin, raw, root, loci, trajectory, close: () => plugin.dispose() };
}

test("actual browser SDF config reaches a real graph trajectory with exact parser source and retained pose controls", async () => {
  const input = await opened(source), scene = await loaded(input.prepared);
  try {
    expect(input.config.sdfPosePager).toBe(true);
    expect({ format: input.prepared.format, poseCount: input.prepared.poseCount, controlLabel: input.prepared.controlLabel,
      mode: input.prepared.sdfPoseMode, native: input.prepared.nativeTrajectoryControls }).toEqual({ format: "sdf", poseCount: 1, controlLabel: "Pose", mode: "single", native: false });
    expect(input.prepared.data).toBe(source); expect(scene.raw.obj!.data).toBe(source);
    const report = await science.graphBinding(scene);
    expect(String(scene.plugin.state.data.cells.get(report.trajectoryRef)!.transform.transformer.id)).toBe("ms-plugin.trajectory-from-sdf");
    expect({ atomCount: report.atomCount, sourceSha256: report.sourceSha256, sourceFormat: report.sourceFormat }).toEqual({ atomCount: 3, sourceSha256: hash(source), sourceFormat: "sdf" });
  } finally { scene.close(); deleteBrowserDevVirtualTextDocument(input.doc.path); }
});

test("metadata preview capture and restore retain actual measurement refs, style and source atom endpoints", async () => {
  const initial = await opened(source), before = await loaded(initial.prepared);
  const metadata = patchGraphMetadata(readGraphMetadata("", 3), { conformerLabel: "Closed source acceptance" });
  const edited = graphDraftText(source, "sdf", parseMolecule(source, "sdf").molfile, metadata);
  const next = await opened(edited), after = await loaded(next.prepared);
  try {
    const distance = await before.plugin.managers.structure.measurement.addDistance(before.loci(0), before.loci(1), { visualParams: { customText: "Kept distance", visuals: ["lines"], lineSizeAttenuation: false } });
    const capture = await measurement.capture(before, science);
    expect(capture.sourceSha256).toBe(hash(source)); expect(capture.items[0].points).toEqual([[0], [1]]);
    const binding = await science.graphBinding(after);
    await measurement.restore(after, { version: 1, sourceFormat: "sdf", targetSourceSha256: binding.sourceSha256, atomCount: 3, items: capture.items, group: capture.group }, science);
    const restored = await measurement.capture(after, science);
    expect(restored.items).toEqual(capture.items); expect(restored.sourceSha256).toBe(hash(edited));
    expect(after.raw.obj!.data).toBe(edited); expect(edited).toContain("Closed source acceptance");
    expect(graphSourceMetadata(edited, "sdf", 3)!.atoms.map(atom => atom.id)).toEqual(metadata.atoms.map(atom => atom.id));
    expect(capture.items[0].params.customText).toBe("Kept distance");
    expect(before.plugin.state.data.cells.has(distance!.representation.ref)).toBe(true);
    expect(after.root.units.flatMap(unit => Array.from(unit.elements, element => unit.model.atomicHierarchy.atomSourceIndex.value(element))).sort()).toEqual([0, 1, 2]);
  } finally { before.close(); after.close(); for (const input of [initial, next]) deleteBrowserDevVirtualTextDocument(input.doc.path); }
});

test("single SDF/SD preserves decoded BOM policy, CRLF, headers and all data fields; bare MOL stays bare", async () => {
  const special = "\ufeff" + source.replace("ethanol", "Exact title").replace("  1  2  1", "  1  2  2").replace("M  END\n", "M  CHG  1   3  -1\nM  END\n>  <EXACT_DATA>\nkept value\n\n").replaceAll("\n", "\r\n");
  for (const extension of ["sdf", "sd", "mol"]) {
    const text = extension === "mol" ? source.replace("$$$$\n", "") : special;
    const input = await opened(text, extension), expected = new TextDecoder().decode(new TextEncoder().encode(text));
    try {
      expect(input.embedded).toEqual(Buffer.from(text));
      expect(input.prepared.data).toBe(expected);
      expect(input.prepared.format).toBe(extension === "mol" ? "mol" : "sdf");
      if (extension !== "mol") {
        expect(input.prepared.data).toContain("\r\n"); expect(input.prepared.data).toContain("EXACT_DATA");
        const scene = await loaded(input.prepared);
        try {
          const model = scene.root.models[0];
          expect(Array.from(model.atomicHierarchy.atoms.pdbx_formal_charge.toArray())).toEqual([0, 0, -1]);
          expect(Array.from(IndexPairBonds.Provider.get(model)!.bonds.edgeProps.order)).toEqual([2, 2, 1, 1]);
        } finally { scene.close(); }
      }
    } finally { deleteBrowserDevVirtualTextDocument(input.doc.path); }
  }
});

test("multi-record collection and active-pose controls keep their existing PDB collection path", async () => {
  const prepared = prepare(source + source, { format: "sdf", label: "poses", sdfPosePager: true, documentId: "multi", activeModel: 1 });
  expect({ kind: prepared.kind, format: prepared.format, poseCount: prepared.poseCount, activePose: prepared.activePose,
    mode: prepared.sdfPoseMode, overlay: prepared.sdfPoseOverlayAvailable }).toEqual({ kind: "sdf-collection", format: "pdb", poseCount: 2, activePose: 1, mode: "collection", overlay: true });
  const all = await loaded(prepared), selected = await loaded({ ...prepared, data: prepared.collectionSinglePdbs[prepared.activePose] });
  try { expect(all.root.elementCount).toBe(6); expect(selected.root.elementCount).toBe(3); }
  finally { all.close(); selected.close(); }
  const sourceMode = prepare(source + source, { format: "sdf", label: "poses", sdfPosePager: false, sdfGrid: false });
  expect({ data: sourceMode.data, format: sourceMode.format, preset: sourceMode.loadPreset }).toEqual({ data: source + source, format: "sdf", preset: "all-models" });
});
