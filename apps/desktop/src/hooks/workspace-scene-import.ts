import { invoke } from "@tauri-apps/api/core";
import type { DockingDocumentRequest, DockingSceneMode, ViewerDocument } from "../types";
import type { StructureDragPayload } from "../lib/structure-drag";
import { readStructureTextDocument } from "../lib/structure-text";
import { activeViewerIframeForDocument, requestViewerAction } from "../lib/viewer-bridge";
import { pathExtension } from "../lib/file-routing";
import { isMolstarSceneImportSource, isStructureComparisonSource } from "../lib/docking-documents";
import { isTauriRuntime } from "../lib/tauri";
import { useSettingsStore } from "../stores/settings-store";

export async function focusSceneDocument(document: ViewerDocument, select: (id: string) => void) {
  select(document.id);
  return waitForSceneDocument(document);
}

async function waitForSceneDocument(document: ViewerDocument, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 50; attempt++) {
    signal?.throwIfAborted();
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

// Serialize drops per document. Other scenes remain independent, and failures
// release the queue so the next drop can still run.
const pendingSceneDrops = new Map<string, Promise<unknown>>();

export function appendSceneDrop(documentId: string, payload: StructureDragPayload) {
  const previous = pendingSceneDrops.get(documentId) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => appendScenePayload(documentId, payload, { preserveScene: true }));
  pendingSceneDrops.set(documentId, operation);
  void operation.finally(() => {
    if (pendingSceneDrops.get(documentId) === operation) pendingSceneDrops.delete(documentId);
  }).catch(() => {});
  return operation;
}

export async function expandSceneDropFolders(paths: string[], directories: string[]) {
  const scans = await invoke<Array<{ files: Array<{ path: string }>; truncated: boolean; error?: string | null }>>(
    "list_project_structure_files", { paths: directories, maxEntries: 20000 },
  );
  if (scans.some(scan => scan.truncated)) throw new Error("The folder is too large. Drop a smaller subfolder.");
  const errors = scans.flatMap(scan => scan.error ? [scan.error] : []);
  if (errors.length) throw new Error(errors.join("; "));
  const files = [...new Set([...paths, ...scans.flatMap(scan => scan.files.map(file => file.path).filter(isMolstarSceneImportSource))])];
  if (files.length > 200) throw new Error("Choose up to 200 structures.");
  if (!files.length) throw new Error("This folder contains no supported structures.");
  return files;
}

export async function appendScenePayload(
  documentId: string,
  payload: StructureDragPayload,
  options: { incremental?: boolean; signal?: AbortSignal; preserveScene?: boolean } = {},
) {
  const preserveScene = options.preserveScene === true;
  const { useMoleculeStore } = await import("../stores/molecule-store");
  const store = useMoleculeStore.getState();
  const document = store.documents.find(candidate => candidate.id === documentId);
  if (!document || document.renderer !== "molstar") throw new Error("The target scene is no longer open.");
  options.signal?.throwIfAborted();
  const scenePaths = preserveScene || options.incremental || document.sceneSourcePaths ? null : structureScenePaths(document, payload);
  if (scenePaths) return rebuildStructureScene(document, scenePaths, payload.paths.length);
  const sources = payload.records.map(record => ({
    path: record.path, label: record.path.split('/').pop(), format: record.inputExtension, data: record.text,
  }));
  if (sources.length + payload.paths.length > 200) throw new Error("Choose up to 200 structures.");
  let total = sources.reduce((size, source) => size + new TextEncoder().encode(source.data).byteLength, 0);
  for (const path of new Set(payload.paths)) {
    if (total >= 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB at a time.");
    const source = await readStructureTextDocument(path, undefined, { maxBytes: 24 * 1024 * 1024 - total });
    total += new TextEncoder().encode(source.content).byteLength;
    if (source.truncated) throw new Error("Scene imports are limited to 24 MB at a time.");
    sources.push({ path, label: path.split('/').pop(), format: pathExtension(path), data: source.content });
  }
  if (total > 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB at a time.");
  if (options.incremental) await waitForSceneDocument(document, options.signal);
  else await focusSceneDocument(document, id => {
    // A visible floating scene already owns its iframe. Do not switch the
    // user's active tab while this scene's import is waiting in the queue.
    if (!preserveScene || !activeViewerIframeForDocument(id, "molstar")) store.setActiveDocument(id);
  });
  options.signal?.throwIfAborted();
  const current = useMoleculeStore.getState().documents.find(candidate => candidate.id === document.id);
  if (!current) throw new Error("The target scene is no longer open.");
  const existingPaths = current.sceneSourcePaths ?? (current.dockingRequest
    ? [current.dockingRequest.receptorPath, ...current.dockingRequest.ligandPaths] : [current.path]);
  if (!preserveScene && sources.some(source => existingPaths.includes(source.path))) throw new Error("A selected file is already in this scene.");
  const added = sources.filter(source => !existingPaths.includes(source.path)).map(source => source.path);
  if (existingPaths.length + added.length > 200) throw new Error("A scene supports up to 200 source files.");
  const result = await requestViewerAction(document.id, { type: "append_scene_files", sources, existingPaths, skipExisting: preserveScene });
  useMoleculeStore.setState(state => ({ documents: state.documents.map(candidate => candidate.id === document.id
    ? { ...candidate, sceneSourcePaths: [...existingPaths, ...added], sceneUnsaved: true }
    : candidate) }));
  return result;
}
