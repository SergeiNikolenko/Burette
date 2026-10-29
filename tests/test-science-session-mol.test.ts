import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import { Molecule } from "openchemlib";
import { Task } from "../node_modules/molstar/lib/mol-task/task.js";
import { parseMol } from "../node_modules/molstar/lib/mol-io/reader/mol/parser.js";
import { trajectoryFromMol } from "../node_modules/molstar/lib/mol-model-formats/structure/mol.js";
import { Structure } from "../node_modules/molstar/lib/mol-model/structure/structure/structure.js";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { openSceneArchive } from "./science-host-fixture";
import { fakeViewer, science, bindingOf, XYZ, waterScience } from "./science-session-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { readGraphSource } from "../apps/desktop/src/lib/science-session/graph-source";
import { encodeScienceSession, decodeScienceSession, sha256Hex, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession, type ScienceSessionContent } from "../apps/desktop/src/lib/science-session/codec";
import { prepareSceneScienceExport } from "../apps/desktop/src/lib/science-session/export";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { graphAtomIds, logicalSourceFor, sourceExtension, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
import type { requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";

// A genuine CTAB: no SDF data items or delimiter. Charge/bond bytes are intentional.
const mol = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8")
  .replace("$$$$\n", "").replace("  1  2  1  0", "  1  2  2  0").replace("M  END", "M  CHG  1   3  -1\nM  END");
const text = "\uFEFF" + mol.replaceAll("\n", "\r\n"), original = new TextEncoder().encode(text);
const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
const content: ScienceSessionContent = { documentUuid: crypto.randomUUID(), source: { extension: "mol", text },
  atomIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], binding, science: null,
  original: { name: "charged.mol", file: new Blob([original], { type: "chemical/x-mdl-molfile" }) } };
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
}
function manifestBytes(encoded: EncodedScienceSession) {
  encoded.assets.find(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID)!.bytes = strToU8(JSON.stringify(encoded.manifest));
}
async function replaceSource(encoded: EncodedScienceSession, changed: string) {
  const asset = encoded.assets.find(asset => asset.id === encoded.manifest.source.attachment)!;
  asset.bytes = new TextEncoder().encode(changed);
  const hash = await sha256Hex(asset.bytes);
  Object.assign(encoded.manifest.attachments.find(item => item.id === asset.id)!, { byteLength: asset.bytes.length, count: asset.bytes.length, sha256: hash });
  encoded.manifest.source.sha256 = hash;
  manifestBytes(encoded);
}

async function realMolViewer(source: string) {
  const parsed = await parseMol(source).run();
  if (parsed.isError) throw new Error(parsed.message);
  const trajectory = await trajectoryFromMol(parsed.result).run();
  const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
  const current = fakeViewer(serializeXyz(parseMolecule(source, "mol").atoms, "graph"));
  const cells = current.viewer.plugin.state.data.cells;
  Object.defineProperty(cells.get("s"), "obj", { value: { data: Structure.ofModel(model) } });
  cells.get("t").transform.transformer.id = "ms-plugin.trajectory-from-mol";
  cells.get("raw").obj = { data: source };
  return current;
}
function requestFor(current: Awaited<ReturnType<typeof realMolViewer>>): typeof requestViewerAction {
  return async (_id, action) => {
    if (action.type === "workspace_scene_state") return { ready: true };
    if (action.type === "scene_science_restore_ack") return { adopted: await science.adoptValidated(current.viewer, action) };
    if (action.type === "scene_science_binding") return science.graphBinding(current.viewer, action.sourceExtension);
    throw new Error(`Unexpected action ${String(action.type)}`);
  };
}
const path = "burette-ketcher://mol-source/charged.mol";
afterAll(() => { deleteBrowserDevVirtualTextDocument(path); releaseClosedScienceSessions(new Set()); });

test("genuine MOL codec v2 preserves exact source, BOM/CRLF Original, ordered ids, bonds and charges on repeated reopen", async () => {
  let encoded = await encodeScienceSession(content);
  for (let pass = 0; pass < 2; pass++) {
    expect(encoded.manifest.version).toBe(2);
    expect(encoded.manifest.source.sha256).toBe(await sha256Hex(original));
    const decoded = (await decodeScienceSession(archive(encoded)))!;
    expect(decoded.source).toEqual(content.source); expect(decoded.atomIds).toEqual(content.atomIds); expect(decoded.science).toBeNull();
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(original);
    const structure = parseMolecule(decoded.source.text, "mol"), parsed = Molecule.fromMolfile(structure.molfile);
    expect(structure.bonds).toEqual([{ a: 0, b: 1, order: 2 }, { a: 1, b: 2, order: 1 }]);
    expect(parsed.getAtomCharge(2)).toBe(-1);
    encoded = await encodeScienceSession(decoded);
  }
});

test("MOL codec rejects checksum-valid SDF tails, second tables, absent terminators, oversized graphs and scientific arrays", async () => {
  for (const changed of [text + "$$$$\r\n", text + "> <foreign>\r\nvalue\r\n", text + mol, text.replace("M  END", "M  STOP"), text + "\0"]) {
    const encoded = await encodeScienceSession(content); await replaceSource(encoded, changed);
    await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "source" });
  }
  const large = new Molecule(257, 0); for (let i = 0; i < 257; i++) large.addAtom(6);
  expect(() => readGraphSource(large.toMolfile(), "mol")).toThrow(/256/);
  await expect(encodeScienceSession({ ...content, science: waterScience() })).rejects.toMatchObject({ code: "science" });
  await expect(encodeScienceSession({ ...content, binding: { ...binding, frameCount: 2 } })).rejects.toMatchObject({ code: "binding" });
});

test("legacy XYZ/SDF writes stay v1; MOL requires v2 and unknown versions remain rejected", async () => {
  for (const source of [{ extension: "xyz", text: XYZ }, { extension: "sdf", text: mol + "$$$$\n" }] as const) {
    const encoded = await encodeScienceSession({ ...content, source });
    expect(encoded.manifest.version).toBe(1); expect((await decodeScienceSession(archive(encoded)))!.source).toEqual(source);
  }
  const encoded = await encodeScienceSession(content); encoded.manifest.version = 1; manifestBytes(encoded);
  await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "version" });
  const files = Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes]));
  files[`assets/${SCIENCE_MANIFEST_ASSET_ID}`] = strToU8(JSON.stringify({ ...encoded.manifest, version: 3 }));
  await expect(decodeScienceSession(zipSync({ "state.json": strToU8("{}"), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id }]))), ...files }))).rejects.toMatchObject({ code: "version" });
});

test("real MOL parser binding refuses wrong formats and same-position bond-only source substitutions", async () => {
  const current = await realMolViewer(text), report = await science.graphBinding(current.viewer, "mol");
  expect(report.sourceFormat).toBe("mol"); expect(report.sourceSha256).toBe(await sha256Hex(text));
  await expect(science.sdfBinding(current.viewer)).rejects.toThrow(/format changed|SDF/);
  const encoded = await encodeScienceSession(content);
  const request = { binding: bindingOf(report), positions: report.positions, sourceExtension: "mol", sourceSha256: report.sourceSha256, assets: encoded.assets };
  await expect(science.serialize(current.viewer, { ...request, sourceExtension: "sdf" }, { type: "molx" })).rejects.toThrow(/format changed/);
  current.viewer.plugin.state.data.cells.get("raw").obj.data = text.replace("  1  2  2  0", "  1  2  1  0");
  await expect(science.serialize(current.viewer, request, { type: "molx" })).rejects.toThrow(/scene changed/);
  expect(current.assets.assets).toEqual([]);
});

test("host MOL export, actual MolStar serialization, logical restore and reexport keep MOL and exact Original", async () => {
  writeBrowserDevVirtualTextDocument(path, text);
  const document: ViewerDocument = { id: "mol-source", path, title: "charged.mol", extension: "mol", renderer: "molstar", runtimePath: path, byteCount: original.length, virtual: true };
  const current = await realMolViewer(text), request = requestFor(current);
  const prepared = await prepareSceneScienceExport(document, { sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request });
  if (prepared?.kind !== "science") throw new Error("Expected MOL export");
  const blob: Blob = await science.serialize(current.viewer, prepared.action.science, { type: "molx" }); await prepared.confirm();
  const bytes = new Uint8Array(await blob.arrayBuffer()), saved = (await decodeScienceSession(bytes))!;
  expect(saved.atomIds).toHaveLength(3);
  const scene: ViewerDocument = { ...document, id: "mol-restored", path: "/Scenes/charged.molx", title: "charged.molx", extension: "molx", byteCount: bytes.length };
  await openSceneArchive(current, bytes);
  expect(await restoreScienceSession(scene, { readBytes: async () => bytes, request, isOpen: () => true })).toBe("restored");
  expect(logicalSourceFor(scene.id)).toEqual({ documentId: scene.id, extension: "mol", text }); expect(sourceExtension(scene)).toBe("mol");
  const again = await prepareSceneScienceExport(scene, { sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request });
  if (again?.kind !== "science") throw new Error("Expected restored MOL export");
  const resaved: Blob = await science.serialize(current.viewer, again.action.science, { type: "molx" }); await again.confirm();
  const decoded = (await decodeScienceSession(new Uint8Array(await resaved.arrayBuffer())))!;
  expect(decoded.source).toEqual({ extension: "mol", text }); expect(decoded.atomIds).toEqual(saved.atomIds);
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(original);
});


test("MOL baseline identities require exact source text and never infer same-element edit mappings", () => {
  const ids = graphAtomIds("mol-identity", text, 3);
  expect(ids).toHaveLength(3); expect(graphAtomIds("mol-identity", text, 3)).toEqual(ids);
  expect(graphAtomIds("mol-identity", text.replace("  1  2  2  0", "  1  2  1  0"), 3)).toBeNull();
  expect(graphAtomIds("mol-identity", text, 3)).toEqual(ids);
  releaseClosedScienceSessions(new Set());
  expect(graphAtomIds("mol-identity", text, 3)).not.toEqual(ids);
});
