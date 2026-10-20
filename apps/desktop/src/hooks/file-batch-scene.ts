import { invoke } from "@tauri-apps/api/core";
import type { ViewerDocument } from "../types";
import { readStructureTextDocument } from "../lib/structure-text";
import { pathExtension } from "../lib/file-routing";
import { isTauriRuntime } from "../lib/tauri";
import { abortOpenDocumentClaims } from "../lib/open-document-claims";
import { useMoleculeStore } from "../stores/molecule-store";
import { useSettingsStore } from "../stores/settings-store";

/** A folder scene owns a snapshot, never the source file's existing tab/runtime. */
export async function createFileBatchScene(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const source = await readStructureTextDocument(path, undefined, { maxBytes: 24 * 1024 * 1024 });
  signal.throwIfAborted();
  if (source.truncated) throw new Error("Scene imports are limited to 24 MB at a time.");
  const extension = pathExtension(path);
  const title = `Scene: ${path.split("/").pop() ?? "Structures"}`;
  const preferences = { ...useSettingsStore.getState().preferences, rendererMode: "molstar" as const };
  const native = isTauriRuntime();
  const document = native
    ? await invoke<ViewerDocument>("open_text_structure", { request: { title, extension, text: source.content }, preferences })
    : await (await import("../lib/browser-dev-documents")).openBrowserDevTextDocument(
      `scene-${crypto.randomUUID()}.${extension}`, extension, source.content, preferences);
  try {
    signal.throwIfAborted();
    if (document.renderer !== "molstar") throw new Error("This file could not be opened in a 3D scene.");
    const scene: ViewerDocument = { ...document, title, virtual: true, sourcePath: path, sceneSourcePaths: [path], sceneUnsaved: false };
    useMoleculeStore.getState().addDocuments([scene]);
    return scene;
  } catch (error) {
    await abortOpenDocumentClaims([document]);
    throw error;
  }
}

export function confirmUnsavedSceneClose(documents: ViewerDocument[]) {
  const count = documents.filter(document => document.sceneUnsaved).length;
  return !count || window.confirm(count === 1
    ? "Close the unsaved scene? Choose Cancel and use Export → Scene to keep its structures and view."
    : `Close ${count} unsaved scenes? Choose Cancel and use Export → Scene to keep their structures and views.`);
}
