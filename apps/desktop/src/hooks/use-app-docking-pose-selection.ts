import { useCallback } from "react";

export function useAppDockingPoseSelection() {
  const notifyGridPoseReviewSelection = useCallback((targetDocumentId: string, activePose: number) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === targetDocumentId,
    );
    iframe?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: {
        type: "poseReviewSelection",
        documentId: targetDocumentId,
        activePose,
      },
    }, "*");
  }, []);

  return { notifyGridPoseReviewSelection };
}
