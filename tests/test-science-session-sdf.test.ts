import { afterAll, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openSceneArchive } from "./science-host-fixture";
import { readFileSync } from "node:fs";
import { realSdfViewer, science, bindingOf } from "./science-session-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { gzipSync } from "node:zlib";
import { registerCompressedSource } from "../apps/desktop/src/lib/compressed-files/sources";
import { supportedCompressedName } from "../apps/desktop/src/lib/compressed-files/formats";
import { editGraph } from "../apps/desktop/src/lib/molecular-workbench/graph-edit";
import { graphDraftText, structureEditAvailable } from "../apps/desktop/src/lib/workbench/graph-draft";
import { readGraphMetadata, patchGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";
import { readSdfSource } from "../apps/desktop/src/lib/science-session/sdf-source";
import { encodeScienceSession, decodeScienceSession, sha256Hex } from "../apps/desktop/src/lib/science-session/codec";
import { prepareSceneScienceExport } from "../apps/desktop/src/lib/science-session/export";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { logicalSourceFor, sourceExtension, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { saveBrowserImport } from "../apps/desktop/src/lib/browser-import-storage";

const previousDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"), factory = new IDBFactory();
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
afterAll(() => {
  if (previousDatabase) Object.defineProperty(globalThis, "indexedDB", previousDatabase); else Reflect.deleteProperty(globalThis, "indexedDB");
});
async function retainOriginal(path: string, file: Blob) {
  await saveBrowserImport({ path, name: path.split("/").pop()!, kind: "text", file });
}
// Model external storage replacement directly; the production import API never overwrites.
async function replaceOriginal(path: string, file: Blob) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("burette-browser-imports", 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ path, name: path.split("/").pop()!, kind: "text", file });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const original = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url));
const graph = parseMolecule(original.toString(), "sdf");
const normalized = editGraph(graph, { kind: "reorder-atoms", order: [0, 1, 2] });
const metadata = patchGraphMetadata(readGraphMetadata("", 3), { conformerLabel: "Ethanol", atoms: [] });
const text = graphDraftText(original.toString(), "sdf", normalized.molfile, metadata);

function request(viewer: Awaited<ReturnType<typeof realSdfViewer>>) {
  return async (_id: string, action: Record<string, unknown>) => action.type === "workspace_scene_state" ? { ready: true }
    : action.type === "scene_science_restore_ack" ? { adopted: await science.adoptValidated(viewer.viewer, action) }
    : action.sourceExtension === "sdf" ? science.sdfBinding(viewer.viewer) : science.binding(viewer.viewer);
}

test("SDF scene source binds the actual parser text and refuses same-position graph changes", async () => {
  const viewer = await realSdfViewer(text);
  const report = await science.sdfBinding(viewer.viewer);
  expect(report.sourceSha256).toBe(await sha256Hex(text));
  expect(report.elements).toEqual(readSdfSource(text).elements.map(value => value.toUpperCase()));
  const changed = text.replace("M  V30 1 1 1 2", "M  V30 1 2 1 2");
  expect(changed).not.toBe(text);
  viewer.viewer.plugin.state.data.cells.get("raw").obj.data = changed;
  expect((await science.sdfBinding(viewer.viewer)).sourceSha256).not.toBe(report.sourceSha256);
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "sdf", text },
    atomIds: metadata.atoms.map(atom => atom.id), binding: bindingOf(report), science: null, original: null });
  await expect(science.serialize(viewer.viewer, { binding: bindingOf(report), positions: report.positions,
    sourceSha256: report.sourceSha256, assets: encoded.assets }, { type: "molx" })).rejects.toThrow(/scene changed/);
  await expect(encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "sdf", text },
    atomIds: null, binding: bindingOf(report), science: null, original: null })).rejects.toThrow(/Graph atom ids/);
});

test("SDF metadata and exact Original survive scene restore and resave with a logical graph source", async () => {
  const path = "/OpenedFiles/ethanol.sdf";
  await retainOriginal(path, new Blob([original]));
  const document = { id: "graph-source", path, title: "ethanol.sdf", extension: "sdf", renderer: "molstar", byteCount: original.length } as never;
  const viewer = await realSdfViewer(text);
  const session = { documentId: "graph-source", content: text, baseContent: original.toString(), previewState: "current" };
  const options = { sourceEditing: { sessionForDocument: () => session }, sceneFileCount: 1, isOpen: () => true, request: request(viewer) } as never;
  const prepared = await prepareSceneScienceExport(document, options);
  expect(prepared?.kind).toBe("science");
  if (prepared?.kind !== "science") throw new Error("missing graph export");
  const blob: Blob = await science.serialize(viewer.viewer, prepared.action.science, { type: "molx" });
  await prepared.confirm();
  const bytes = new Uint8Array(await blob.arrayBuffer()), decoded = (await decodeScienceSession(bytes))!;
  expect(decoded.source).toEqual({ extension: "sdf", text });
  expect(decoded.atomIds).toEqual(metadata.atoms.map(atom => atom.id));
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(original));
  const scene = { id: "graph-restored", path: "/Scenes/ethanol.molx", title: "ethanol.molx", extension: "molx", renderer: "molstar", byteCount: bytes.length } as never;
  await openSceneArchive(viewer, bytes);
  expect(await restoreScienceSession(scene, { readBytes: async () => bytes, request: request(viewer) as never, isOpen: () => true })).toBe("restored");
  expect(logicalSourceFor("graph-restored")).toEqual({ documentId: "graph-restored", extension: "sdf", text });
  expect(sourceExtension(scene)).toBe("sdf");
  expect(structureEditAvailable(scene)).toBe(true);
  const again = await prepareSceneScienceExport(scene, { sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request: request(viewer) } as never);
  if (again?.kind !== "science") throw new Error("missing restored graph export");
  const saved = (await decodeScienceSession(new Uint8Array(await (await science.serialize(viewer.viewer, again.action.science, { type: "molx" })).arrayBuffer())))!;
  await again.confirm();
  expect([saved.documentUuid, saved.atomIds, saved.source]).toEqual([decoded.documentUuid, decoded.atomIds, decoded.source]);
  expect(new Uint8Array(await scientificStateFor("graph-restored", text).original!.file.arrayBuffer())).toEqual(new Uint8Array(original));
  releaseClosedScienceSessions(new Set());
});

test("a graph's Original changed during export rejects the archive without adopting a different original", async () => {
  const path = "/OpenedFiles/changing-ethanol.sdf";
  await retainOriginal(path, new Blob([original]));
  const document = { id: "changing-graph", path, title: "ethanol.sdf", extension: "sdf", renderer: "molstar", byteCount: original.length } as never;
  const viewer = await realSdfViewer(text);
  const prepared = await prepareSceneScienceExport(document, { sourceEditing: { sessionForDocument: () => ({ documentId: "changing-graph", content: text, baseContent: original.toString(), previewState: "current" }) },
    sceneFileCount: 1, isOpen: () => true, request: request(viewer) } as never);
  if (prepared?.kind !== "science") throw new Error("missing graph export");
  await replaceOriginal(path, new Blob([original.toString().replace("ethanol", "changed")]));
  await expect(prepared.confirm()).rejects.toThrow(/source changed/);
});


test("a graph file replaced before export cannot be labelled as the session's Original", async () => {
  const path = "/OpenedFiles/replaced-ethanol.sdf";
  await retainOriginal(path, new Blob([original.toString().replace("ethanol", "replaced")]));
  const document = { id: "replaced-graph", path, title: "ethanol.sdf", extension: "sdf", renderer: "molstar", byteCount: original.length } as never;
  const viewer = await realSdfViewer(text);
  await expect(prepareSceneScienceExport(document, { sourceEditing: { sessionForDocument: () => ({ documentId: "replaced-graph", content: text, baseContent: original.toString(), previewState: "current" }) },
    sceneFileCount: 1, isOpen: () => true, request: request(viewer) } as never)).rejects.toThrow(/original graph file changed/);
});


test("compressed graph Original keeps the uploaded bytes while its decoded source is verified", async () => {
  const path = "/OpenedFiles/compressed-ethanol.sdf.gz", compressed = gzipSync(original);
  registerCompressedSource(path, "ethanol.sdf.gz", new Blob([compressed]), supportedCompressedName(path));
  const document = { id: "compressed-graph", path, title: "ethanol.sdf.gz", extension: "sdf", renderer: "molstar", byteCount: compressed.length } as never;
  const viewer = await realSdfViewer(text);
  const prepared = await prepareSceneScienceExport(document, { sourceEditing: { sessionForDocument: () => ({ documentId: "compressed-graph", content: text, baseContent: original.toString(), previewState: "current" }) },
    sceneFileCount: 1, isOpen: () => true, request: request(viewer) } as never);
  if (prepared?.kind !== "science") throw new Error("missing compressed graph export");
  const blob: Blob = await science.serialize(viewer.viewer, prepared.action.science, { type: "molx" });
  await prepared.confirm();
  const decoded = (await decodeScienceSession(new Uint8Array(await blob.arrayBuffer())))!;
  expect(decoded.original!.name).toBe("compressed-ethanol.sdf.gz");
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(compressed));
});


test("graph export stays exclusive during hashing and rejects topology changed during snapshot serialization", async () => {
  const current = await realSdfViewer(text), report = await science.sdfBinding(current.viewer);
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "sdf", text },
    atomIds: metadata.atoms.map(atom => atom.id), binding: bindingOf(report), science: null, original: null });
  const serialize = current.viewer.plugin.managers.snapshot.serialize;
  current.viewer.plugin.managers.snapshot.serialize = async options => {
    const archive = await serialize(options);
    current.viewer.plugin.state.data.cells.get("raw").obj.data = text.replace("M  V30 1 1 1 2", "M  V30 1 2 1 2");
    return archive;
  };
  const action = { binding: bindingOf(report), positions: report.positions, sourceSha256: report.sourceSha256, assets: encoded.assets };
  const running = science.serialize(current.viewer, action, { type: "molx" });
  await expect(science.serialize(current.viewer, action, { type: "molx" })).rejects.toThrow(/already being saved/);
  await expect(running).rejects.toThrow(/scene changed/);
  expect(current.assets.assets).toHaveLength(0);
});
