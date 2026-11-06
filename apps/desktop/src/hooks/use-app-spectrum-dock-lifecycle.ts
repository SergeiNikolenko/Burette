import { useEffect } from "react";
import { dockMediaPath, type DockTab } from "../lib/dock";
import type { ViewerDocument } from "../types";

type UseAppSpectrumDockLifecycleOptions = {
  activeDocument: ViewerDocument | null | undefined;
  bottomDockActiveTab: string;
  bottomDockDocumentId: string | null;
  bottomDockTabs: DockTab[];
  closeDockTab: (area: "bottom", tabId: string) => void;
  documents: ViewerDocument[];
  setDockActiveTab: (area: "right" | "bottom", kind: "files" | "inspector") => void;
  setDockDocument: (area: "right" | "bottom", documentId: string | null) => void;
  setDockOpen: (area: "right" | "bottom", open: boolean) => void;
  textDocuments: ReadonlyArray<{ id: string }>;
};

export function useAppSpectrumDockLifecycle({
  activeDocument,
  bottomDockActiveTab,
  bottomDockDocumentId,
  bottomDockTabs,
  closeDockTab,
  documents,
  setDockActiveTab,
  setDockDocument,
  setDockOpen,
  textDocuments,
}: UseAppSpectrumDockLifecycleOptions) {
  useEffect(() => {
    if (activeDocument?.renderer === "spectrum"
      || bottomDockDocumentId?.startsWith("missing:")
      || documents.some(document => document.id === bottomDockDocumentId && document.renderer === "spectrum")) return;

    const spectrumTab = bottomDockTabs.find((tab) => tab.kind === "spectrum");
    if (spectrumTab) closeDockTab("bottom", spectrumTab.id);
    if (bottomDockActiveTab === "spectrum") setDockActiveTab("bottom", "files");

    // Text documents (agent render_panel markdown/table/chart panels) live outside `documents`;
    // only a bottom-dock id that matches neither store is stale.
    if (
      bottomDockDocumentId
      && !dockMediaPath(bottomDockDocumentId)
      && !documents.some((document) => document.id === bottomDockDocumentId)
      && !textDocuments.some((document) => document.id === bottomDockDocumentId)
    ) {
      setDockDocument("bottom", null);
      setDockOpen("bottom", false);
    }

  }, [
    activeDocument,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTabs,
    closeDockTab,
    documents,
    setDockActiveTab,
    setDockDocument,
    setDockOpen,
    textDocuments,
  ]);
}
