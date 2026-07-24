import { useCallback } from "react";
import type { StructureOverlayMode, ViewerLigandSelection } from "../components/types";
import type { ViewerDocument, ViewerPreferences } from "../types";
import type { DockTabKind } from "../lib/dock";
import { updateHostedMcpSelectionContext } from "../lib/hosted-mcp-widget";
import { structureStoryFromViewerMessage, type StructureStory } from "../lib/structure-story";

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
type SetStructureStories = (
  updater: (
    previous: Record<string, StructureStory | null>,
  ) => Record<string, StructureStory | null>,
) => void;

type UseAppViewerStateMessagesOptions = {
  activeDocument: ViewerDocument | null;
  addDocuments: (documents: ViewerDocument[]) => void;
  documents: ViewerDocument[];
  openCommandPalette: () => void;
  openDockTab: (area: "right", kind: DockTabKind) => void;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  setViewerLigandSelections: SetViewerLigandSelections;
  setStructureOverlayModes: SetStructureOverlayModes;
  setStructureStories: SetStructureStories;
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
  openDockTab,
  setPreference,
  setViewerLigandSelections,
  setStructureOverlayModes,
  setStructureStories,
  toggleSidebar,
}: UseAppViewerStateMessagesOptions) {
  const handleViewerStateMessage = useCallback((sourceName: unknown, body: ViewerStateMessageBody) => {
    if ((sourceName === "burette-viewer" || sourceName === "burette-grid") && body?.type === "openCommandPalette") {
      openCommandPalette();
      return true;
    }

    if ((sourceName === "burette-viewer" || sourceName === "burette-grid") && body?.type === "toggleSidebar") {
      toggleSidebar();
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "setTheme") {
      const theme = body.value === "light" || body.value === "dark" ? body.value : null;
      if (theme) setPreference("theme", theme);
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "openTrajectorySmoothing") {
      openDockTab("right", "inspector");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("burette:trajectory-smoothing-toggle-requested", { detail: body }));
      }, 0);
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "trajectorySmoothingChanged") {
      window.dispatchEvent(new CustomEvent("burette:trajectory-smoothing-changed", { detail: body }));
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "trajectoryFrameChanged") {
      window.dispatchEvent(new CustomEvent("burette:trajectory-frame-changed", { detail: body }));
      return true;
    }

    if (
      sourceName === "burette-viewer"
      && (body?.type === "structureStoryChanged" || body?.type === "openStructureStory")
    ) {
      const story = structureStoryFromViewerMessage(body);
      if (!story) return true;
      setStructureStories((previous) => ({ ...previous, [story.documentId]: story }));
      if (body.type === "openStructureStory") openDockTab("right", "story");
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "selectionChanged") {
      const documentId = bodyString(body.documentId);
      if (!documentId) return true;
      const selection = body.selection && typeof body.selection === "object"
        ? body.selection as Record<string, unknown>
        : null;
      updateHostedMcpSelectionContext(selection, documentId);
      const atomCount = selection?.atoms == null ? null : Number(selection.atoms);
      setViewerLigandSelections((previous) => ({
        ...previous,
        [documentId]: selection?.selector ? {
          documentId,
          label: String(selection.label || "Selected ligand"),
          value: String(selection.value || ""),
          selector: selection.selector as ViewerLigandSelection["selector"],
          atoms: atomCount !== null && Number.isFinite(atomCount) && atomCount > 0
            ? Math.min(1_000_000, Math.trunc(atomCount))
            : null,
        } : null,
      }));
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "sceneActionsApplied") {
      void window.BuretteHostedAppBridge?.updateScene(body.report);
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "structureOverlayModeChanged") {
      const documentId = bodyString(body.documentId);
      if (!documentId) return true;
      const mode: StructureOverlayMode = body.mode === "all" ? "all" : "single";
      setStructureOverlayModes((previous) => ({ ...previous, [documentId]: mode }));
      return true;
    }

    if (sourceName === "burette-viewer" && body?.type === "rendererChanged") {
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
  }, [activeDocument, addDocuments, documents, openCommandPalette, openDockTab, setPreference, setStructureOverlayModes, setStructureStories, setViewerLigandSelections, toggleSidebar]);

  return { handleViewerStateMessage };
}
