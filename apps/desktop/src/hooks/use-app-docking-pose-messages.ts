import { useCallback } from "react";
import type { ViewerDocument } from "../types";

type DockingPoseMessageBody = Record<string, unknown> | null | undefined;
type SetPoseReviewSelections = (updater: (previous: Record<string, number>) => Record<string, number>) => void;

type UseAppDockingPoseMessagesOptions = {
  activeDocument: ViewerDocument | null;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  documents: ViewerDocument[];
  notifyGridPoseReviewSelection: (documentId: string, activePose: number) => void;
  setPoseReviewSelections: SetPoseReviewSelections;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useAppDockingPoseMessages({
  activeDocument,
  addBackgroundDocuments,
  documents,
  notifyGridPoseReviewSelection,
  setPoseReviewSelections,
}: UseAppDockingPoseMessagesOptions) {
  const handleDockingPoseMessage = useCallback((sourceName: unknown, body: DockingPoseMessageBody) => {
    if (sourceName !== "burrete-viewer" || body?.type !== "dockingPoseChanged") {
      return false;
    }
    const documentId = bodyString(body.documentId);
    const dockingDocument = documentId
      ? documents.find((document) => document.id === documentId)
      : activeDocument;
    const sourcePath = bodyString(body.sourcePath).trim() || dockingDocument?.dockingRequest?.ligandPaths[0];
    const gridDocument = sourcePath
      ? documents.find((document) => document.path === sourcePath && document.renderer === "grid2d")
      : null;
    const activePose = Math.max(0, Math.trunc(Number(body.activePose) || 0));
    const poseMode = body.poseMode === "all" ? "all" : "single";
    if (dockingDocument?.dockingRequest && dockingDocument.dockingRequest.poseMode !== poseMode) {
      addBackgroundDocuments([{
        ...dockingDocument,
        dockingRequest: {
          ...dockingDocument.dockingRequest,
          poseMode,
        },
      }]);
    }
    if (gridDocument) {
      setPoseReviewSelections((previous) => ({ ...previous, [gridDocument.id]: activePose }));
      notifyGridPoseReviewSelection(gridDocument.id, activePose);
    }
    return true;
  }, [activeDocument, addBackgroundDocuments, documents, notifyGridPoseReviewSelection, setPoseReviewSelections]);

  return { handleDockingPoseMessage };
}
