import { PluginStateSnapshotManager } from "../node_modules/molstar/lib/mol-plugin-state/manager/snapshots.js";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { expect, mock, test } from "bun:test";
import { unzipSync } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { fakeViewer, realXyzViewer, science, waterScience, XYZ } from "./science-session-fixture";

mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
const { writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { claimImportedSource, recordImportedRevision, registerImportedScientificSource, scientificStateFor } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
const { logicalSourceFor, releaseClosedScienceSessions, sourceExtension } = await import("../apps/desktop/src/lib/science-session/state");
const { decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");

type Viewer = ReturnType<typeof fakeViewer>;
export const ORIGINAL = new Uint8Array([0xef, 0xbb, 0xbf, 0x31, 0x0d, 0x0a, 0x1f, 0x8b]);
let opened = 0;
// An imported output as the workbench opens it: generated XYZ carrying its import token.
export function importedDocument(text = XYZ.replace("water restored", "water import-0a1b2c3d"), token = "import-0a1b2c3d", data = waterScience()) {
  const id = `imported-${++opened}`;
  const path = `burette-ketcher://${id}/water.xyz`;
  writeBrowserDevVirtualTextDocument(path, text);
  registerImportedScientificSource(token, text, data, { name: "water.out", file: new Blob([ORIGINAL]) });
  claimImportedSource(token, id);
  return { document: { id, path, title: "water.xyz", extension: "xyz", renderer: "molstar", virtual: true, byteCount: text.length } as ViewerDocument, text };
}
export const sceneDocument = (path: string) => ({ id: `scene-${++opened}`, path, title: path.split("/").pop(), extension: "molx", renderer: "molstar", viewerProfile: "structure", byteCount: 1000 }) as ViewerDocument;
export const request = (viewer: Viewer) => async (_id: string, action: Record<string, unknown>) => {
  if (action.type === "workspace_scene_state") return { ready: true };
  if (action.type === "scene_science_binding") return science.binding(viewer.viewer);
  if (action.type === "scene_science_restore_ack") return { adopted: await science.adoptValidated(viewer.viewer, action) };
  throw new Error(`unexpected ${String(action.type)}`);
};
export const options = (viewer: Viewer, extra: Record<string, unknown> = {}) => ({ sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request: request(viewer) as never, ...extra });

export async function exportArchive(document: { id: string }, text: string, viewer = fakeViewer(text), extra: Record<string, unknown> = {}) {
  const prepared = await prepareSceneScienceExport(document as never, options(viewer, extra) as never);
  if (prepared?.kind !== "science") throw new Error(`expected science export, got ${prepared?.kind}`);
  const blob: Blob = await science.serialize(viewer.viewer, prepared.action.science, { type: "molx" });
  await prepared.confirm();
  return new Uint8Array(await blob.arrayBuffer());
}
export async function openSceneArchive(viewer: Viewer, bytes: Uint8Array) {
  const plugin = viewer.viewer.plugin;
  Object.assign(plugin, { runTask: (task: { run: () => Promise<unknown> }) => task.run(), log: { error() {} } });
  const token = science.beginImport(plugin);
  await (PluginStateSnapshotManager.prototype.open as any).call({ plugin, setStateSnapshot: async () => {}, events: { opened: { next() {} } } }, new File([bytes as BlobPart], "scene.molx"));
  if (!science.completeImport(plugin, token)) throw new Error("Test scene import was superseded");
}
export async function restore(bytes: Uint8Array, path: string, viewer: Viewer, isOpen = () => true) {
  await openSceneArchive(viewer, bytes);
  const document = sceneDocument(path);
  const outcome = await restoreScienceSession(document, { readBytes: async () => bytes, request: request(viewer) as never, isOpen, pollMs: 1 });
  return { document: document as { id: string }, outcome };
}
