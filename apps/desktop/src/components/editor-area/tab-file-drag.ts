import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import type { ShellViewState } from "../types";
import type { MoleculeTab } from "../../stores/molecule-store";
import type { StructureDragPayload } from "../../lib/structure-drag";
import type { SourceEditingContextValue } from "../../lib/source-editing/context";
import { requestViewerAction } from "../../lib/viewer-bridge";
import { safeExportFileName } from "../../lib/file-export";

const MAX_DRAG_FILES = 200;
const MAX_DRAG_BYTES = 24 * 1024 * 1024;

export function isFileDragTab(tab: MoleculeTab) {
  return ["file", "text-file", "document", "ketcher"].includes(tab.location.kind);
}

// The AppKit session needs filesystem URLs. Inline documents are exported into
// the normal preview cache; their originals and current editors are untouched.
export async function tabFileDragPayload(tabs: MoleculeTab[], state: Pick<ShellViewState, "documents" | "textDocuments" | "dirtyGridDocuments">,
  sourceEditing: SourceEditingContextValue | null): Promise<StructureDragPayload> {
  if (!tabs.length || tabs.length > MAX_DRAG_FILES) throw new Error("Drag up to 200 files at once.");
  const paths: string[] = [];
  let bytes = 0;
  const materialize = async (title: string, extension: string, contents: string, encoding: "utf8" | "base64" = "utf8") => {
    bytes += encoding === "base64"
      ? contents.length / 4 * 3 - (contents.endsWith("==") ? 2 : contents.endsWith("=") ? 1 : 0)
      : new TextEncoder().encode(contents).byteLength;
    if (bytes > MAX_DRAG_BYTES) throw new Error("Save this document before dragging it.");
    const name = safeExportFileName(title);
    const filename = name.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? name : `${name}.${extension}`;
    const outputPath = await join(await appCacheDir(), "viewer", "file-drags", crypto.randomUUID(), filename);
    return encoding === "base64"
      ? invoke<string>("write_base64_file", { request: { outputPath, contentsBase64: contents } })
      : invoke<string>("write_text_file", { request: { outputPath, contents } });
  };
  for (const tab of tabs) {
    const location = tab.location;
    if (location.kind === "document") {
      if (!location.path.startsWith("/")) throw new Error("Save this document before dragging it.");
      paths.push(location.path);
    } else if (location.kind === "text-file") {
      const document = state.textDocuments.find(document => document.path === location.path);
      if (location.path.startsWith("/")) paths.push(location.path);
      else if (document && !document.truncated && document.language !== "image") {
        paths.push(await materialize(tab.title ?? document.title, document.extension || "txt", document.content));
      } else throw new Error("Save this document before dragging it.");
    } else if (location.kind === "file") {
      const document = state.documents.find(document => document.id === location.documentId || document.path === location.path);
      if (document && state.dirtyGridDocuments.has(document.id)) throw new Error("Save the collection changes before dragging it.");
      const draft = document ? sourceEditing?.sessionForDocument(document) : null;
      if (document && draft?.dirty) paths.push(await materialize(tab.title ?? document.title, document.extension, draft.content));
      else if (document?.renderer === "molstar" && (document.dockingRequest || document.sceneUnsaved
        || document.sceneSourcePaths?.length || document.virtual || !location.path.startsWith("/"))) {
        const result = await requestViewerAction(document.id, { type: "workspace_scene_snapshot" });
        if (typeof result.dataBase64 !== "string") throw new Error("The scene could not be exported.");
        paths.push(await materialize(tab.title ?? document.title, "molx", result.dataBase64, "base64"));
      } else if (location.path.startsWith("/")) paths.push(location.path);
      else throw new Error("Save this document before dragging it.");
    } else if (location.kind === "ketcher") {
      const { getKetcherAgentController } = await import("../../lib/ketcher-agent");
      const controller = getKetcherAgentController(tab.id);
      let text = location.draftKet || location.draftMolfile;
      let extension = location.draftKet ? "ket" : "mol";
      if (controller) {
        const snapshot = controller.snapshot();
        const result = await controller.execute({ type: "control_ketcher", apiVersion: snapshot.apiVersion, surfaceId: snapshot.surfaceId,
          expectedRevision: snapshot.structureRevision, command: "get_structure", formats: ["ket"] });
        const formats = result.result?.formats as Record<string, unknown> | undefined;
        if (!result.ok || typeof formats?.ket !== "string") throw new Error("The sketch could not be exported.");
        text = formats.ket; extension = "ket";
      }
      if (!text?.trim()) throw new Error("Draw a molecule before dragging this tab.");
      paths.push(await materialize(tab.title ?? "Molecule", extension, text));
    }
  }
  if (!paths.length) throw new Error("This tab has no file to drag.");
  return { paths: Array.from(new Set(paths)), records: [] };
}
