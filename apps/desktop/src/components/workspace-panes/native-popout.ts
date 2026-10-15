import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/tauri";
import { requestViewerAction } from "../../lib/viewer-bridge";
import { focusSceneDocument } from "../../hooks/workspace-scene-import";
import type { MoleculeTab } from "../../stores/molecule-store";
import type { ShellActions, ShellViewState } from "../types";
import { toast } from "../ui/toast";

const opening = new Set<string>();

export function canOpenNativePopout(tab: MoleculeTab) {
  return isTauriRuntime() && (tab.location.kind === "file" || tab.location.kind === "text-file");
}

// A native window owns its own viewer; copy the live Mol* session rather than
// re-reading the source and losing the current camera, representations or added structures.
export async function openNativePopout(tab: MoleculeTab, state: ShellViewState, actions: ShellActions) {
  if (!canOpenNativePopout(tab) || opening.has(tab.id)) return false;
  const location = tab.location;
  if (location.kind !== "file" && location.kind !== "text-file") return false;
  opening.add(tab.id);
  try {
    const document = location.kind === "file" ? state.documents.find(item => item.id === location.documentId) : undefined;
    if (document?.renderer === "molstar") {
      await focusSceneDocument(document, actions.selectDocument);
      const result = await requestViewerAction(document.id, { type: "export_session", args: { type: "molj", maxBytes: 24 * 1024 * 1024 } });
      if (typeof result.dataBase64 !== "string") throw new Error("The scene could not be opened in a new window.");
      const title = (tab.title ?? document.title).replace(/\.[^.]+$/u, "").replace(/[\u0000-\u001f/\\:]/gu, "-").slice(0, 60) || "Scene";
      await invoke("open_new_workspace_window", { presentation: "preview", scene: { title, dataBase64: result.dataBase64 } });
    } else {
      await invoke("open_new_workspace_window", { presentation: "preview", paths: [location.path] });
    }
    return true;
  } catch (error) {
    toast.add({ title: "Could not open preview window", description: String(error), type: "error" });
    return false;
  } finally {
    opening.delete(tab.id);
  }
}
