import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { downloadTextFile, exportDialogFilters, safeExportFileName } from "../lib/file-export";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type PostMessageToViewerSource = (source: MessageEventSource | null, payload: unknown) => void;
type GridFileMessageBody = Record<string, unknown> | null | undefined;

type UseAppGridFileActionsOptions = {
  documents: ViewerDocument[];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  postMessageToViewerSource: PostMessageToViewerSource;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
};

function bodyString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

export function useAppGridFileActions({
  documents,
  forgetDirtyGridDocument,
  postMessageToViewerSource,
  pushErrorStatus,
  pushStatus,
}: UseAppGridFileActionsOptions) {
  const replyGrid = useCallback((
    source: MessageEventSource | null,
    documentId: unknown,
    bodyPayload: Record<string, unknown>,
  ) => {
    postMessageToViewerSource(source, {
      source: "burrete-grid-host",
      body: {
        documentId,
        ...bodyPayload,
      },
    });
  }, [postMessageToViewerSource]);

  const handleGridFileMessage = useCallback((body: GridFileMessageBody, source: MessageEventSource | null) => {
    if (body?.type === "exportText") {
      const text = typeof body.text === "string" ? body.text : "";
      const name = safeExportFileName(bodyString(body.name, "grid-export.txt"));
      void (async () => {
        try {
          if (!isTauriRuntime()) {
            downloadTextFile(name, text);
            pushStatus(`Exported ${name}`);
            return;
          }
          const outputPath = await save({
            defaultPath: name,
            filters: exportDialogFilters(name, bodyString(body.mimeType, "")),
          });
          if (!outputPath) return;
          const savedPath = await invoke<string>("save_text_as", { text, outputPath });
          pushStatus(`Exported ${basename(savedPath)}`);
        } catch (error) {
          pushErrorStatus(error, "Grid export failed");
        }
      })();
      return true;
    }

    if (body?.type === "exportGridMolecule") {
      const text = typeof body.text === "string" ? body.text : "";
      const name = safeExportFileName(bodyString(body.name, "molecule.sdf"));
      void (async () => {
        try {
          if (!isTauriRuntime()) {
            downloadTextFile(name, text);
            pushStatus(`Exported ${name}`);
            replyGrid(source, body.documentId, { type: "gridMoleculeExported", name });
            return;
          }
          const outputPath = await save({
            defaultPath: name,
            filters: exportDialogFilters(name, bodyString(body.mimeType, "")),
          });
          if (!outputPath) return;
          const savedPath = await invoke<string>("save_text_as", { text, outputPath });
          const savedName = basename(savedPath);
          pushStatus(`Exported ${savedName}`);
          replyGrid(source, body.documentId, { type: "gridMoleculeExported", name: savedName });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          replyGrid(source, body.documentId, { type: "gridMoleculeExportError", error: message });
          pushErrorStatus(error, "Molecule export failed");
        }
      })();
      return true;
    }

    if (body?.type === "saveGrid") {
      const text = typeof body.text === "string" ? body.text : "";
      const targetDocument = body.documentId
        ? documents.find((document) => document.id === body.documentId)
        : null;
      void (async () => {
        try {
          if (!targetDocument?.path || targetDocument.virtual) {
            throw new Error("This grid document cannot be overwritten. Use Save As instead.");
          }
          if (!isTauriRuntime()) {
            const name = safeExportFileName(bodyString(body.name, basename(targetDocument.path)));
            downloadTextFile(name, text);
            pushStatus(`Saved ${name}`);
            replyGrid(source, body.documentId, { type: "gridSaved", name });
            return;
          }
          const savedPath = await invoke<string>("save_text_as", {
            text,
            outputPath: targetDocument.path,
          });
          const savedName = basename(savedPath);
          forgetDirtyGridDocument(typeof body.documentId === "string" ? body.documentId : null);
          pushStatus(`Saved ${savedName}`);
          replyGrid(source, body.documentId, { type: "gridSaved", name: savedName });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          replyGrid(source, body.documentId, { type: "gridSaveError", error: message });
          pushErrorStatus(error, "Grid Save failed");
        }
      })();
      return true;
    }

    if (body?.type === "saveGridAs") {
      const text = typeof body.text === "string" ? body.text : "";
      const name = safeExportFileName(bodyString(body.name, "grid-save-as.csv"));
      void (async () => {
        try {
          if (!isTauriRuntime()) {
            downloadTextFile(name, text);
            pushStatus(`Saved ${name}`);
            forgetDirtyGridDocument(typeof body.documentId === "string" ? body.documentId : null);
            replyGrid(source, body.documentId, { type: "gridSavedAs", name });
            return;
          }
          const outputPath = await save({
            defaultPath: name,
            filters: exportDialogFilters(name, bodyString(body.mimeType, "")),
          });
          if (!outputPath) return;
          const savedPath = await invoke<string>("save_text_as", { text, outputPath });
          const savedName = basename(savedPath);
          forgetDirtyGridDocument(typeof body.documentId === "string" ? body.documentId : null);
          pushStatus(`Saved ${savedName}`);
          replyGrid(source, body.documentId, { type: "gridSavedAs", name: savedName });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          replyGrid(source, body.documentId, { type: "gridSaveAsError", error: message });
          pushErrorStatus(error, "Grid Save As failed");
        }
      })();
      return true;
    }

    return false;
  }, [documents, forgetDirtyGridDocument, pushErrorStatus, pushStatus, replyGrid]);

  return { handleGridFileMessage };
}
