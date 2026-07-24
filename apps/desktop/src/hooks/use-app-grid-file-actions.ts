import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { downloadTextFile, exportDialogFilters, safeExportFileName } from "../lib/file-export";
import { pathExtension } from "../lib/file-routing";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import { runWindowMutation } from "../lib/window-mutation-barrier";
import {
  isReadOnlyViewerMessageSource,
  type PostMessageToViewerSource,
} from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type GridFileMessageBody = Record<string, unknown> | null | undefined;

type UseAppGridFileActionsOptions = {
  closeGridRuntime: (documentId: string | null | undefined) => void;
  documents: ViewerDocument[];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  postMessageToViewerSource: PostMessageToViewerSource;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rebindSavedGridDocument: (documentId: string, path: string) => Promise<ViewerDocument>;
};

function bodyString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function gridFormatsMatch(documentExtension: string, snapshotName: string) {
  const formatFamily = (extension: string) => {
    const normalized = extension.trim().toLowerCase().replace(/^\./u, "");
    if (normalized === "sd" || normalized === "sdf") return "sdf";
    if (normalized === "smi" || normalized === "smiles") return "smiles";
    return normalized;
  };
  return formatFamily(documentExtension) === formatFamily(pathExtension(snapshotName));
}

export function useAppGridFileActions({
  closeGridRuntime,
  documents,
  forgetDirtyGridDocument,
  postMessageToViewerSource,
  pushErrorStatus,
  pushStatus,
  rebindSavedGridDocument,
}: UseAppGridFileActionsOptions) {
  const replyGrid = useCallback((
    source: MessageEventSource | null,
    documentId: unknown,
    bodyPayload: Record<string, unknown>,
  ) => {
    postMessageToViewerSource(source, {
      source: "burette-grid-host",
      body: {
        documentId,
        ...bodyPayload,
      },
    });
  }, [postMessageToViewerSource]);

  const handleGridFileMessage = useCallback((body: GridFileMessageBody, source: MessageEventSource | null) => {
    if (isReadOnlyViewerMessageSource(source)
      && (body?.type === "saveGrid" || body?.type === "saveGridAs")) {
      replyGrid(source, body.documentId, {
        type: body.type === "saveGrid" ? "gridSaveError" : "gridSaveAsError",
        error: "This embedded collection preview is read-only.",
      });
      return true;
    }

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
          const savedPath = await invoke<string>("save_text_as", {
            text,
            outputPath,
            sourcePath: null,
          });
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
          const savedPath = await invoke<string>("save_text_as", {
            text,
            outputPath,
            sourcePath: null,
          });
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
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      const targetDocument = documentId
        ? documents.find((document) => document.id === documentId)
        : null;
      const snapshotName = safeExportFileName(bodyString(
        body.name,
        targetDocument?.path ? basename(targetDocument.path) : "grid-save.csv",
      ));
      void (async () => {
        try {
          if (!documentId) throw new Error("Grid Save requires a document ID.");
          await runWindowMutation(documentId, async () => {
            if (!targetDocument?.path || targetDocument.virtual) {
              throw new Error("This grid document cannot be overwritten. Use Save As instead.");
            }
            if (!gridFormatsMatch(targetDocument.extension, snapshotName)) {
              throw new Error(
                `The edited collection can no longer be saved as ${targetDocument.extension.toUpperCase()}. Use Save As instead.`,
              );
            }
            if (!isTauriRuntime()) {
              downloadTextFile(snapshotName, text);
              pushStatus(`Saved ${snapshotName}`);
              replyGrid(source, body.documentId, { type: "gridSaved", name: snapshotName });
              return;
            }
            const savedPath = await invoke<string>("save_text_as", {
              text,
              outputPath: targetDocument.path,
              sourcePath: targetDocument.path,
            });
            const savedName = basename(savedPath);
            forgetDirtyGridDocument(documentId);
            pushStatus(`Saved ${savedName}`);
            replyGrid(source, body.documentId, { type: "gridSaved", name: savedName });
          });
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
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      const targetDocument = documentId
        ? documents.find((document) => document.id === documentId)
        : null;
      void (async () => {
        try {
          if (!documentId) throw new Error("Grid Save As requires a document ID.");
          await runWindowMutation(documentId, async () => {
            if (!targetDocument) throw new Error("The grid document is no longer open.");
            if (!isTauriRuntime()) {
              downloadTextFile(name, text);
              pushStatus(`Saved ${name}`);
              forgetDirtyGridDocument(documentId);
              replyGrid(source, body.documentId, { type: "gridSavedAs", name });
              return;
            }
            const outputPath = await save({
              defaultPath: name,
              filters: exportDialogFilters(name, bodyString(body.mimeType, "")),
            });
            if (!outputPath) return;
            if (documents.some((document) => (
              document.id !== documentId && document.path === outputPath
            ))) {
              throw new Error("Close the destination document before replacing it.");
            }
            const savedPath = await invoke<string>("save_text_as", {
              text,
              outputPath,
              sourcePath: targetDocument.path,
            });
            const replacement = await rebindSavedGridDocument(documentId, savedPath)
              .catch(async (error) => {
                await invoke("release_save_as_reservation", {
                  outputPath: savedPath,
                  sourcePath: targetDocument.path,
                }).catch(() => undefined);
                const details = error instanceof Error ? error.message : String(error);
                throw new Error(`Saved ${basename(savedPath)}, but could not switch the active document: ${details}`);
              });
            if (replacement.id !== documentId) closeGridRuntime(documentId);
            forgetDirtyGridDocument(documentId);
            pushStatus(`Saved ${replacement.title}`);
            replyGrid(source, body.documentId, { type: "gridSavedAs", name: replacement.title });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          replyGrid(source, body.documentId, { type: "gridSaveAsError", error: message });
          pushErrorStatus(error, "Grid Save As failed");
        }
      })();
      return true;
    }

    return false;
  }, [closeGridRuntime, documents, forgetDirtyGridDocument, pushErrorStatus, pushStatus, rebindSavedGridDocument, replyGrid]);

  return { handleGridFileMessage };
}
