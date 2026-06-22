import { useCallback, useMemo } from "react";
import type { MoleculeTab } from "../stores/molecule-store";
import type { FepSetupRequest, ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type OpenFepSetupTab = (location: { kind: "fep-setup" } & FepSetupRequest) => void;
type OpenFepNetworkTab = (location: {
  kind: "fep-network";
  title?: string;
  graphmlText?: string;
}) => void;

type UseAppFepWorkflowsOptions = {
  activeTab: MoleculeTab | null | undefined;
  documents: ViewerDocument[];
  openFepNetworkTab: OpenFepNetworkTab;
  openFepSetupTab: OpenFepSetupTab;
  poseReviewSelections: Record<string, number>;
  pushStatus: PushStatus;
};

export function useAppFepWorkflows({
  activeTab,
  documents,
  openFepNetworkTab,
  openFepSetupTab,
  poseReviewSelections,
  pushStatus,
}: UseAppFepWorkflowsOptions) {
  const openFepSetupWorkspace = useCallback((request: FepSetupRequest) => {
    openFepSetupTab({
      kind: "fep-setup",
      ...request,
    });
    pushStatus("Opened FEP setup workspace");
  }, [openFepSetupTab, pushStatus]);

  const openFepNetworkPreview = useCallback((request?: { title?: string; graphmlText?: string }) => {
    openFepNetworkTab({ kind: "fep-network", ...request });
    pushStatus("Opened FEP network preview");
  }, [openFepNetworkTab, pushStatus]);

  const currentFepSetupRequest = useMemo<FepSetupRequest | null>(() => {
    const location = activeTab?.location;
    if (!location) return null;
    if (location.kind === "fep-setup") {
      return {
        receptorPath: location.receptorPath,
        gridDocumentId: location.gridDocumentId,
        gridPath: location.gridPath,
        dockingDocumentId: location.dockingDocumentId,
        dockingPath: location.dockingPath,
        referencePose: location.referencePose,
      };
    }
    if (location.kind !== "pose-review") return null;
    const grid = documents.find((document) => document.id === location.gridDocumentId || document.path === location.gridPath);
    const docking = documents.find((document) => document.id === location.dockingDocumentId || document.path === location.dockingPath);
    if (!grid || !docking) return null;
    return {
      receptorPath: location.receptorPath,
      gridDocumentId: grid.id,
      gridPath: grid.path,
      dockingDocumentId: docking.id,
      dockingPath: docking.path,
      referencePose: poseReviewSelections[grid.id] ?? 0,
    };
  }, [activeTab?.location, documents, poseReviewSelections]);

  return {
    currentFepSetupRequest,
    openFepNetworkPreview,
    openFepSetupWorkspace,
  };
}
