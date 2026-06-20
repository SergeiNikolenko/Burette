import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isProteinLikeDockingSource } from "../lib/docking-documents";
import { openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { isTauriRuntime } from "../lib/tauri";
import type { OpenDocumentsMode, ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type SdfViewerMessageBody = Record<string, unknown> | null | undefined;
type SetPoseReviewSelections = (updater: (previous: Record<string, number>) => Record<string, number>) => void;

type UseAppSdfViewerMessagesOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  openBrowserDevTextDocument: typeof openBrowserDevTextDocument;
  openDockingDocument: (receptorPath: string, ligandPaths: string[]) => Promise<unknown> | void;
  openDocuments: (
    paths: string[],
    reloadOptions?: ViewerReloadOptions,
    preferences?: Partial<ViewerPreferences>,
    options?: { replace?: boolean; inActiveTab?: boolean; mode?: OpenDocumentsMode },
  ) => Promise<unknown> | void;
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openPoseReviewWorkspace: (
    receptorDocument: ViewerDocument,
    poseDocument: ViewerDocument,
    activePose: number,
  ) => Promise<unknown> | void;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setPoseReviewSelections: SetPoseReviewSelections;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useAppSdfViewerMessages({
  activeDocument,
  documents,
  openBrowserDevTextDocument,
  openDockingDocument,
  openDocuments,
  openDocumentsInActiveTab,
  openPoseReviewWorkspace,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  setPoseReviewSelections,
}: UseAppSdfViewerMessagesOptions) {
  const handleSdfViewerMessage = useCallback(async (body: SdfViewerMessageBody) => {
    if (body?.type === "openSdfMolstarDocument") {
      const title = bodyString(body.title).trim() || "selected-molecules.sdf";
      const textBase64 = bodyString(body.textBase64).trim();
      if (!textBase64) {
        pushErrorStatus("Select one or more molecules before opening Molstar.", "Molstar view failed");
        return true;
      }
      const requestedReceptorPath = bodyString(body.receptorPath).trim();
      const controlLabel = bodyString(body.controlLabel).trim() || "Molecule";
      const receptorDocument = requestedReceptorPath
        ? documents.find((document) => (
          document.path === requestedReceptorPath &&
          isProteinLikeDockingSource(document.path)
        ))
        : null;
      if (requestedReceptorPath && !receptorDocument) {
        pushErrorStatus("Selected receptor is not available for Molstar.", "Molstar view failed");
        return true;
      }
      try {
        const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (!text.trim()) {
          pushErrorStatus("Selected molecules do not have structure data for Molstar.", "Molstar view failed");
          return true;
        }
        const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title,
                extension: "sdf",
                text,
              },
              preferences: molstarPreferences,
              reloadOptions: { sdfPoseControlLabel: controlLabel },
            })
          : await openBrowserDevTextDocument(
              title,
              "sdf",
              text,
              molstarPreferences,
              { sdfPoseControlLabel: controlLabel },
            );
        if (receptorDocument && document.path) {
          pushStatus("Opening selected molecules in Molstar docking view...");
          void openDockingDocument(receptorDocument.path, [document.path]);
          return true;
        }
        openDocumentsInActiveTab([document]);
        rememberRecentStructures([document]);
        pushStatus("Opened selected molecules in Molstar");
      } catch (error) {
        pushErrorStatus(error, "Molstar view failed");
      }
      return true;
    }

    if (body?.type === "openSdfPoseDocument") {
      const requestedPath = bodyString(body.path).trim();
      const pathDocument = requestedPath.length > 0
        ? documents.find((document) => document.path === requestedPath) ?? null
        : null;
      const documentId = bodyString(body.documentId);
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null)
        ?? pathDocument
        ?? activeDocument;
      const targetPath = requestedPath.length > 0
        ? requestedPath
        : targetDocument?.path;
      if (targetPath) {
        const poseTargetDocument = targetDocument?.path === targetPath ? targetDocument : pathDocument;
        const activePose = Math.max(0, Math.trunc(Number(body.activePose) || 0));
        if (poseTargetDocument) {
          setPoseReviewSelections((previous) => ({ ...previous, [poseTargetDocument.id]: activePose }));
        }
        const requestedReceptorPath = bodyString(body.receptorPath).trim();
        const receptorDocument = requestedReceptorPath
          ? documents.find((document) => (
            document.path === requestedReceptorPath &&
            document.path !== targetPath &&
            isProteinLikeDockingSource(document.path)
          ))
          : documents.find((document) => (
            document.path !== targetPath && isProteinLikeDockingSource(document.path)
          ));
        if (requestedReceptorPath && !receptorDocument) {
          pushErrorStatus("Selected receptor is not available for SDF poses.", "SDF poses failed");
          return true;
        }
        if (receptorDocument && poseTargetDocument) {
          pushStatus("Opening pose-review workspace...");
          void openPoseReviewWorkspace(receptorDocument, poseTargetDocument, activePose);
        } else if (receptorDocument) {
          pushStatus("Opening SDF poses in Molstar docking view...");
          void openDockingDocument(receptorDocument.path, [targetPath]);
        } else {
          pushStatus("Opening SDF poses in Molstar...");
          void openDocuments([targetPath], {}, { rendererMode: "molstar" }, { inActiveTab: true });
        }
      }
      return true;
    }

    if (body?.type === "openSdfGridDocument") {
      const documentId = bodyString(body.documentId);
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null) ?? activeDocument;
      const targetPath = bodyString(body.path).trim() || targetDocument?.path;
      if (targetPath) {
        pushStatus("Opening SDF grid...");
        void openDocuments([targetPath], undefined, { rendererMode: "grid2d" }, { inActiveTab: true });
      }
      return true;
    }

    return false;
  }, [activeDocument, documents, openBrowserDevTextDocument, openDockingDocument, openDocuments, openDocumentsInActiveTab, openPoseReviewWorkspace, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setPoseReviewSelections]);

  return { handleSdfViewerMessage };
}
