import type { ViewerDocument } from "../types";
import type { StructureDragPayload } from "../lib/structure-drag";
import { readStructureTextDocument } from "../lib/structure-text";
import { activeViewerIframeForDocument, requestViewerAction } from "../lib/viewer-bridge";
import { pathExtension } from "../lib/file-routing";

export async function focusSceneDocument(document: ViewerDocument, select: (id: string) => void) {
  select(document.id);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (activeViewerIframeForDocument(document.id, document.renderer)?.contentWindow) {
      if (document.renderer !== "molstar") return;
      try {
        const state = await requestViewerAction(document.id, { type: "workspace_scene_state" }, 1200);
        if (state.ready) return;
      } catch { /* The iframe can mount before its message listener. */ }
    }
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  throw new Error("Open the document and wait for its viewer to load.");
}

export async function appendScenePayload(documentId: string, payload: StructureDragPayload) {
  const { useMoleculeStore } = await import("../stores/molecule-store");
  const store = useMoleculeStore.getState();
  const document = store.documents.find(candidate => candidate.id === documentId);
  if (!document || document.renderer !== "molstar") throw new Error("The target scene is no longer open.");
  const sources = payload.records.map(record => ({
    path: record.path, label: record.path.split('/').pop(), format: record.inputExtension, data: record.text,
  }));
  if (sources.length + payload.paths.length > 200) throw new Error("Choose up to 200 structures.");
  let total = sources.reduce((size, source) => size + new TextEncoder().encode(source.data).byteLength, 0);
  for (const path of payload.paths) {
    if (total >= 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB at a time.");
    const source = await readStructureTextDocument(path, undefined, { maxBytes: 24 * 1024 * 1024 - total });
    total += new TextEncoder().encode(source.content).byteLength;
    if (source.truncated) throw new Error("Scene imports are limited to 24 MB at a time.");
    sources.push({ path, label: path.split('/').pop(), format: pathExtension(path), data: source.content });
  }
  if (total > 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB at a time.");
  await focusSceneDocument(document, store.setActiveDocument);
  const existingPaths = document.dockingRequest
    ? [document.dockingRequest.receptorPath, ...document.dockingRequest.ligandPaths] : [document.path];
  return requestViewerAction(document.id, { type: "append_scene_files", sources, existingPaths });
}
