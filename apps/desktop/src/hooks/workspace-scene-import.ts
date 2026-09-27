import { invoke } from "@tauri-apps/api/core";
import type { DockingDocumentRequest, DockingSceneMode, ViewerDocument } from "../types";
import type { StructureDragPayload } from "../lib/structure-drag";
import { readStructureTextDocument } from "../lib/structure-text";
import { activeViewerIframeForDocument, requestViewerAction } from "../lib/viewer-bridge";
import { pathExtension } from "../lib/file-routing";
import { isStructureComparisonSource } from "../lib/docking-documents";
import { isTauriRuntime } from "../lib/tauri";
import { useSettingsStore } from "../stores/settings-store";

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

// Structure files join as a real comparison scene, the same one "Open → Together"
// builds, so the pose picker and alignment (toolbar and right click) cover them.
// Loading them straight into Mol* would leave both unaware of the new structures.
function structureScenePaths(document: ViewerDocument, payload: StructureDragPayload) {
  if (payload.records.length || !payload.paths.length) return null;
  const request = document.dockingRequest;
  if (request ? !request.sceneMode : document.virtual) return null;
  const existing = request ? [request.receptorPath, ...request.ligandPaths] : [document.path];
  const paths = [...existing, ...payload.paths];
  if (!paths.every(isStructureComparisonSource)) return null;
  if (new Set(paths).size !== paths.length) throw new Error("A selected file is already in this scene.");
  return paths;
}

async function rebuildStructureScene(document: ViewerDocument, paths: string[], added: number) {
  if (paths.length > 200) throw new Error("A scene supports up to 200 source files.");
  const sceneMode: DockingSceneMode = document.dockingRequest?.sceneMode ?? "structureAll";
  const request: DockingDocumentRequest = {
    receptorPath: paths[0],
    ligandPaths: paths.slice(1),
    sceneMode,
    poseMode: sceneMode === "structureAll" ? "all" : "single",
  };
  const preferences = useSettingsStore.getState().preferences;
  const replacement = isTauriRuntime()
    ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
    : await (await import("../lib/browser-dev-documents"))
      .openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences, { sceneMode });
  const { useMoleculeStore } = await import("../stores/molecule-store");
  const store = useMoleculeStore.getState();
  store.replaceDocument(document.id, replacement);
  // Scenes open on one structure, but these were all on screen a moment ago.
  // The scene is already built, so a slow viewer only skips this last step.
  try {
    await focusSceneDocument(replacement, store.setActiveDocument);
    if (sceneMode === "structureAll") await requestViewerAction(replacement.id, { type: "set_sdf_pose_mode", mode: "all" });
  } catch { /* The combined scene is open either way. */ }
  return { ok: true, command: "append_scene_files", result: { added, paths } };
}

export async function appendScenePayload(documentId: string, payload: StructureDragPayload) {
  const { useMoleculeStore } = await import("../stores/molecule-store");
  const store = useMoleculeStore.getState();
  const document = store.documents.find(candidate => candidate.id === documentId);
  if (!document || document.renderer !== "molstar") throw new Error("The target scene is no longer open.");
  const scenePaths = structureScenePaths(document, payload);
  if (scenePaths) return rebuildStructureScene(document, scenePaths, payload.paths.length);
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
