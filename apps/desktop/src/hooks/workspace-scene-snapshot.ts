import type { ViewerDocument } from "../types";
import type { SourceEditingContextValue } from "../lib/source-editing/context";
import { useMoleculeStore } from "../stores/molecule-store";
import { useSettingsStore } from "../stores/settings-store";
import { prepareDeferredViewerRuntime } from "./use-deferred-viewer-runtime";
import { focusSceneDocument } from "./workspace-scene-import";
import { prepareSceneScienceExport } from "../lib/science-session/export";
import { sameSceneSource, waitForSceneScienceRestore } from "../lib/science-session/restore";
import { requestViewerAction } from "../lib/viewer-bridge";

type SnapshotOptions = {
  sourceEditing: SourceEditingContextValue | null;
  sceneFileCount: number;
  scientificData: "require" | "allow-omission";
};
type SnapshotResult = { kind: "molx"; dataBase64: string } | { kind: "sheet"; sheet: unknown };

/** Captures one acknowledged source revision; every writer confirms again after its own awaits. */
export async function captureWorkspaceSceneSnapshot(document: ViewerDocument, options: SnapshotOptions) {
  if (document.runtimeDeferred) document = await prepareDeferredViewerRuntime(document, useSettingsStore.getState().preferences);
  const currentSource = () => useMoleculeStore.getState().documents.some(candidate => candidate.id === document.id && sameSceneSource(candidate, document));
  const confirmCurrent = () => {
    if (!currentSource()) throw new Error("The scene source closed or changed while it was being saved. Save the scene again.");
  };
  confirmCurrent();
  await focusSceneDocument(document, useMoleculeStore.getState().setActiveDocument);
  confirmCurrent();
  const confirmRestore = await waitForSceneScienceRestore(document);
  const science = await prepareSceneScienceExport(document, {
    sourceEditing: options.sourceEditing,
    sceneFileCount: options.sceneFileCount,
    isOpen: id => id === document.id && currentSource(),
  });
  if (science?.kind === "unsupported" && options.scientificData === "require") throw new Error(science.reason);
  const response = await requestViewerAction(document.id, science?.kind === "science" ? science.action : { type: "workspace_scene_snapshot" });
  let result: SnapshotResult;
  if (response.sheet) result = { kind: "sheet", sheet: response.sheet };
  else if (typeof response.dataBase64 === "string") result = { kind: "molx", dataBase64: response.dataBase64 };
  else throw new Error("The scene could not be captured.");
  const confirm = async () => {
    confirmCurrent();
    confirmRestore?.();
    if (science?.kind === "science") await science.confirm();
    confirmCurrent();
    confirmRestore?.();
  };
  await confirm();
  return { document, result, confirm, omissionReason: science?.kind === "unsupported" ? science.reason : null };
}
