import { useEffect } from "react";
import type { DockTab } from "../lib/dock";
import type { ViewerDocument } from "../types";

type UseAppSpectrumDockLifecycleOptions = {
  activeDocument: ViewerDocument | null | undefined;
  bottomDockActiveTab: string;
  bottomDockDocumentId: string | null;
  bottomDockTabs: DockTab[];
  closeDockTab: (area: "bottom", tabId: string) => void;
  documents: ViewerDocument[];
  rightDockActiveTab: string;
  rightDockDocumentId: string | null;
  setDockActiveTab: (area: "right" | "bottom", kind: "files" | "inspector") => void;
  setDockDocument: (area: "right" | "bottom", documentId: string | null) => void;
  setDockOpen: (area: "right" | "bottom", open: boolean) => void;
};

export function useAppSpectrumDockLifecycle({
  activeDocument,
  bottomDockActiveTab,
  bottomDockDocumentId,
  bottomDockTabs,
  closeDockTab,
  documents,
  rightDockActiveTab,
  rightDockDocumentId,
  setDockActiveTab,
  setDockDocument,
  setDockOpen,
}: UseAppSpectrumDockLifecycleOptions) {
  useEffect(() => {
    if (activeDocument?.renderer === "spectrum") return;

    const spectrumTab = bottomDockTabs.find((tab) => tab.kind === "spectrum");
    if (spectrumTab) closeDockTab("bottom", spectrumTab.id);
    if (bottomDockActiveTab === "spectrum") setDockActiveTab("bottom", "files");

    if (bottomDockDocumentId && !documents.some((document) => document.id === bottomDockDocumentId)) {
      setDockDocument("bottom", null);
      setDockOpen("bottom", false);
    }

    const rightDockDocument = rightDockDocumentId
      ? documents.find((document) => document.id === rightDockDocumentId) ?? null
      : null;
    if (rightDockDocument?.renderer !== "spectrum") return;

    setDockDocument("right", activeDocument?.id ?? null);
    if (!activeDocument && rightDockActiveTab === "inspector") setDockOpen("right", false);
  }, [
    activeDocument,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTabs,
    closeDockTab,
    documents,
    rightDockActiveTab,
    rightDockDocumentId,
    setDockActiveTab,
    setDockDocument,
    setDockOpen,
  ]);
}
