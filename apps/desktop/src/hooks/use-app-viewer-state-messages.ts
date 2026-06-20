import { useCallback } from "react";
import type { StructureOverlayMode, ViewerLigandSelection } from "../components/types";
import type { ViewerDocument } from "../types";

type ViewerStateMessageBody = Record<string, unknown> | null | undefined;
type SetViewerLigandSelections = (
  updater: (
    previous: Record<string, ViewerLigandSelection | null>,
  ) => Record<string, ViewerLigandSelection | null>,
) => void;
type SetStructureOverlayModes = (
  updater: (
    previous: Record<string, StructureOverlayMode>,
  ) => Record<string, StructureOverlayMode>,
) => void;

type UseAppViewerStateMessagesOptions = {
  activeDocument: ViewerDocument | null;
  addDocuments: (documents: ViewerDocument[]) => void;
  documents: ViewerDocument[];
  openCommandPalette: () => void;
  setViewerLigandSelections: SetViewerLigandSelections;
  setStructureOverlayModes: SetStructureOverlayModes;
  toggleSidebar: () => void;
};

type XyzrenderPresetOption = {
  value: string;
  label: string;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useAppViewerStateMessages({
  activeDocument,
  addDocuments,
  documents,
  openCommandPalette,
  setViewerLigandSelections,
  setStructureOverlayModes,
  toggleSidebar,
}: UseAppViewerStateMessagesOptions) {
  const handleViewerStateMessage = useCallback((sourceName: unknown, body: ViewerStateMessageBody) => {
    if ((sourceName === "burrete-viewer" || sourceName === "burrete-grid") && body?.type === "openCommandPalette") {
      openCommandPalette();
      return true;
    }

    if ((sourceName === "burrete-viewer" || sourceName === "burrete-grid") && body?.type === "toggleSidebar") {
      toggleSidebar();
      return true;
    }

    if (sourceName === "burrete-viewer" && body?.type === "selectionChanged") {
      const documentId = bodyString(body.documentId);
      if (!documentId) return true;
      const selection = body.selection && typeof body.selection === "object"
        ? body.selection as Record<string, unknown>
        : null;
      setViewerLigandSelections((previous) => ({
        ...previous,
        [documentId]: selection?.selector ? {
          documentId,
          label: String(selection.label || "Selected ligand"),
          value: String(selection.value || ""),
          selector: selection.selector as ViewerLigandSelection["selector"],
          atoms: Math.max(0, Math.trunc(Number(selection.atoms) || 0)),
        } : null,
      }));
      return true;
    }

    if (sourceName === "burrete-viewer" && body?.type === "structureOverlayModeChanged") {
      const documentId = bodyString(body.documentId);
      if (!documentId) return true;
      const mode: StructureOverlayMode = body.mode === "all" ? "all" : "single";
      setStructureOverlayModes((previous) => ({ ...previous, [documentId]: mode }));
      return true;
    }

    if (sourceName === "burrete-viewer" && body?.type === "rendererChanged") {
      const documentId = bodyString(body.documentId);
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null) ?? activeDocument;
      const renderer = body.renderer === "xyzrender-external" ? "xyzrender-external" : body.renderer === "molstar" ? "molstar" : null;
      if (targetDocument && renderer) {
        const presetOptions = body.presetOptions as XyzrenderPresetOption[] | null | undefined;
        addDocuments([{
          ...targetDocument,
          renderer,
          xyzrenderControls: body.controls ?? targetDocument.xyzrenderControls ?? null,
          xyzrenderPreset: typeof body.preset === "string" ? body.preset : targetDocument.xyzrenderPreset ?? null,
          xyzrenderPresetOptions: presetOptions
            ?.filter((option): option is XyzrenderPresetOption => Boolean(option?.value && option?.label))
            ?? targetDocument.xyzrenderPresetOptions
            ?? null,
        }]);
      }
      return true;
    }

    return false;
  }, [activeDocument, addDocuments, documents, openCommandPalette, setStructureOverlayModes, setViewerLigandSelections, toggleSidebar]);

  return { handleViewerStateMessage };
}
