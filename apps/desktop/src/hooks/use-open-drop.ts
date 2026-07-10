import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import type { DockingDocumentRequest, FepSetupRequest, OpenDocumentsMode, ViewerDocument } from "../types";
import { resolveDropActionChoices } from "../lib/drop-actions";
import type { DropSourceContext, DropTargetContext } from "../lib/drop-actions";
import type { DropAction, DropActionChoice } from "../lib/drop-actions";
import type { DockArea, DockDropInput, DockTabKind } from "../lib/dock";
import { hasStructureDrag, readStructureDragPayload, structureDragPayloadFromBrowserFiles, structureDragPayloadFromText, structureDragRecordsToFragments } from "../lib/structure-drag";
import type { StructureDragPayload, StructureDragRecord } from "../lib/structure-drag";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";

type OpenDocuments = (
  paths: string[],
  reloadOptions?: unknown,
  preferencesOverride?: unknown,
  options?: { mode?: OpenDocumentsMode },
) => void | Promise<void>;
type OpenTextDocuments = (paths: string[]) => unknown;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
  options?: { activePose?: number | null },
) => void | Promise<ViewerDocument | null>;
type OpenDockingStructureRecords = (receptorPath: string, ligandPaths: string[], records: StructureDragRecord[]) => void | Promise<void>;
type OpenStructureRecords = (records: StructureDragRecord[]) => void | Promise<void>;
type OpenKetcherWithStructures = (paths: string[], fragments?: Array<{ title: string; text: string }>) => void;
type OpenFepSetupWorkspace = (request: FepSetupRequest) => void;
type OpenDockPayload = (input: DockDropInput) => void | Promise<void>;
type AppendGridRecords = (targetDocumentId: string, payload: StructureDragPayload) => boolean;
type AddXyzrenderSheetItems = (payload: StructureDragPayload) => boolean;
type MergeMoleculeCollections = (paths: string[]) => boolean;
type AddProjectRoots = (paths: string[]) => void;
type ReportStatus = (status: string, kind?: "info" | "error") => void;
type DropPoint = { x: number; y: number };
type DockDropTargetContext = {
  kind: "dock";
  area: DockArea;
  tabKind: DockTabKind;
};
type OpenDropTargetContext = DropTargetContext | DockDropTargetContext;
type ChooseDropAction = (
  choices: DropActionChoice[],
  at: DropPoint | null | undefined,
  runChoice: (choice: DropActionChoice) => void,
) => boolean | Promise<boolean>;

type OpenDropOptions = {
  activeTabKind?: string | null;
  activeDocumentId?: string | null;
  activeDocumentPath?: string | null;
  activeDocumentRenderer?: string | null;
  activeDockingRequest?: DockingDocumentRequest | null;
  documents?: ViewerDocument[];
  fepSetupRequest?: FepSetupRequest | null;
  openDockingDocument?: OpenDockingDocument;
  openDockingStructureRecords?: OpenDockingStructureRecords;
  openStructureRecords?: OpenStructureRecords;
  openTextDocuments?: OpenTextDocuments;
  openKetcherWithStructures?: OpenKetcherWithStructures;
  openFepSetupWorkspace?: OpenFepSetupWorkspace;
  openDockPayload?: OpenDockPayload;
  appendGridRecords?: AppendGridRecords;
  addXyzrenderSheetItems?: AddXyzrenderSheetItems;
  mergeMoleculeCollections?: MergeMoleculeCollections;
  addProjectRoots?: AddProjectRoots;
  chooseDropAction?: ChooseDropAction;
};

type ClassifiedOpenPaths = {
  files: string[];
  directories: string[];
  errors: string[];
};

function browserDropPoint(event: React.DragEvent<HTMLElement>) {
  return { x: event.clientX, y: event.clientY };
}

function tauriDropPoint(position: { x: number; y: number } | null | undefined) {
  if (!position || typeof window === "undefined") return null;
  const scale = Math.max(1, window.devicePixelRatio || 1);
  return { x: position.x / scale, y: position.y / scale };
}

function elementFromTauriDropPosition(position: { x: number; y: number } | null | undefined) {
  if (!position || typeof document === "undefined") return null;
  const scaled = tauriDropPoint(position);
  const candidates = [
    scaled ? document.elementFromPoint(scaled.x, scaled.y) : null,
    document.elementFromPoint(position.x, position.y),
  ].filter((element): element is Element => Boolean(element));
  return candidates.find((element) => element.closest(".dock-panel")) ?? candidates[0] ?? null;
}

export function useOpenDrop(openDocuments: OpenDocuments, pushStatus: ReportStatus, options: OpenDropOptions = {}) {
  const [dropActive, setDropActive] = useState(false);
  const dropResetTimerRef = useRef<number | undefined>(undefined);
  const clearDropResetTimer = useCallback(() => {
    if (dropResetTimerRef.current === undefined) return;
    window.clearTimeout(dropResetTimerRef.current);
    dropResetTimerRef.current = undefined;
  }, []);
  const hideDropOverlay = useCallback(() => {
    clearDropResetTimer();
    setDropActive(false);
  }, [clearDropResetTimer]);
  const showDropOverlay = useCallback(() => {
    setDropActive(true);
    clearDropResetTimer();
    dropResetTimerRef.current = window.setTimeout(() => {
      dropResetTimerRef.current = undefined;
      setDropActive(false);
    }, 1200);
  }, [clearDropResetTimer]);
  const {
    activeTabKind = null,
    activeDocumentId = null,
    activeDocumentPath = null,
    activeDocumentRenderer = null,
    activeDockingRequest = null,
    documents = [],
    fepSetupRequest = null,
    openDockingDocument,
    openDockingStructureRecords,
    openStructureRecords,
    openTextDocuments = openDocuments,
    openKetcherWithStructures,
    openFepSetupWorkspace,
    openDockPayload,
    appendGridRecords,
    addXyzrenderSheetItems,
    mergeMoleculeCollections,
    addProjectRoots,
    chooseDropAction,
  } = options;

  const activeViewerTarget = useCallback((): DropTargetContext | null => {
    if (!activeDocumentPath) return null;
    return {
      kind: "active-viewer",
      documentId: activeDocumentId,
      documentPath: activeDocumentPath,
      renderer: activeDocumentRenderer,
      dockingRequest: activeDockingRequest,
    };
  }, [activeDockingRequest, activeDocumentId, activeDocumentPath, activeDocumentRenderer]);

  const dropTargetForElement = useCallback((element: Element | null): OpenDropTargetContext => {
    const dockTarget = element?.closest<HTMLElement>(".dock-panel[data-area][data-active-tab]");
    if (dockTarget) {
      const area = dockTarget.dataset.area;
      const tabKind = dockTarget.dataset.activeTab;
      if ((area === "right" || area === "bottom") && tabKind) {
        return { kind: "dock", area, tabKind: tabKind as DockTabKind };
      }
    }
    if (fepSetupRequest && element?.closest(".pose-review-workspace, .fep-setup-workspace")) {
      return { kind: "fep-setup", request: fepSetupRequest };
    }
    const sidebarTarget = element?.closest<HTMLElement>("[data-sidebar-structure-path]");
    if (sidebarTarget) {
      const documentPath = sidebarTarget.dataset.sidebarStructurePath ?? "";
      const documentId = sidebarTarget.dataset.sidebarStructureDocumentId ?? null;
      const document = documents.find((candidate) => (
        (documentId !== null && candidate.id === documentId) || candidate.path === documentPath
      ));
      return {
        kind: "active-viewer",
        documentId: document?.id ?? documentId,
        documentPath: document?.path ?? documentPath,
        renderer: sidebarTarget.dataset.sidebarStructureRenderer ?? document?.renderer ?? null,
        dockingRequest: document?.dockingRequest ?? null,
      };
    }
    if (element?.closest(".ketcher-page")) return { kind: "ketcher" };
    if (element?.closest(".molecule-stage, .main-stage")) {
      if (activeTabKind === "ketcher") return { kind: "ketcher" };
      return activeViewerTarget() ?? { kind: "workspace" };
    }
    if (activeTabKind === "ketcher") return { kind: "ketcher" };
    return { kind: "workspace" };
  }, [activeTabKind, activeViewerTarget, documents, fepSetupRequest]);

  const dropTargetForPosition = useCallback((position: { x: number; y: number } | null = null): OpenDropTargetContext => {
    if (typeof document === "undefined") return activeTabKind === "ketcher" ? { kind: "ketcher" } : { kind: "workspace" };
    const element = position ? elementFromTauriDropPosition(position) : document.activeElement;
    return dropTargetForElement(element);
  }, [activeTabKind, dropTargetForElement]);

  const dropTargetForClipboard = useCallback((): DropTargetContext => {
    if (activeTabKind === "ketcher") return { kind: "ketcher" };
    return activeViewerTarget() ?? { kind: "workspace" };
  }, [activeTabKind, activeViewerTarget]);

  const executeDropAction = useCallback((action: DropAction, payload: StructureDragPayload) => {
    if (action.kind === "merge-collection") {
      if (mergeMoleculeCollections?.(action.paths)) return;
      void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "append-grid-records") {
      if (appendGridRecords?.(action.targetDocumentId, action.payload)) return;
      if (mergeMoleculeCollections?.(action.payload.paths)) return;
      if (action.payload.paths.length > 0) void openDocuments(action.payload.paths);
      return;
    }
    if (action.kind === "add-xyzrender-sheet-items") {
      if (addXyzrenderSheetItems?.(action.payload)) return;
      if (payload.paths.length > 0) void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "open-docking") {
      if (openDockingDocument) {
        void openDockingDocument(action.request.receptorPath, action.request.ligandPaths);
        return;
      }
      void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "open-docking-with-records") {
      if (openDockingStructureRecords) {
        void openDockingStructureRecords(action.receptorPath, action.ligandPaths, action.records);
        return;
      }
      if (openDockingDocument && action.ligandPaths.length > 0) {
        void openDockingDocument(action.receptorPath, action.ligandPaths);
        return;
      }
      if (action.records.length > 0 && openStructureRecords) {
        void openStructureRecords(action.records);
        return;
      }
      void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "import-ketcher-structures") {
      if (openKetcherWithStructures) {
        openKetcherWithStructures(action.payload.paths, structureDragRecordsToFragments(action.payload.records));
        return;
      }
      void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "prepare-fep-setup") {
      if (openFepSetupWorkspace) {
        openFepSetupWorkspace(action.request);
        return;
      }
      void openDocuments(payload.paths);
      return;
    }
    if (action.kind === "open-documents") {
      void openDocuments(action.paths);
      return;
    }
    if (action.kind === "open-documents-combined-poses") {
      void openDocuments(action.paths, undefined, undefined, { mode: "combinePoses" });
      return;
    }
    if (action.kind === "open-documents-combined-grid") {
      void openDocuments(action.paths, undefined, undefined, { mode: "combineGrid" });
      return;
    }
    if (action.kind === "open-text-files") {
      void openTextDocuments(action.paths);
      return;
    }
    if (action.kind === "open-structure-records") {
      if (action.paths.length > 0) void openDocuments(action.paths);
      if (action.records.length > 0 && openStructureRecords) {
        void openStructureRecords(action.records);
        return;
      }
      if (!isTauriRuntime()) pushStatus("Drop this molecule onto an xyzrender sheet to add it.");
      return;
    }
    if (!isTauriRuntime()) pushStatus("Drop this molecule onto an xyzrender sheet to add it.");
  }, [
    addXyzrenderSheetItems,
    appendGridRecords,
    mergeMoleculeCollections,
    openDockingDocument,
    openDockingStructureRecords,
    openDocuments,
    openTextDocuments,
    openFepSetupWorkspace,
    openKetcherWithStructures,
    openStructureRecords,
    pushStatus,
  ]);

  const runDropAction = useCallback((
    payload: StructureDragPayload,
    target: OpenDropTargetContext,
    source: DropSourceContext = { kind: "unknown" },
  ) => {
    if (target.kind === "dock") {
      void openDockPayload?.({ area: target.area, tabKind: target.tabKind, payload });
      return;
    }
    const choices = resolveDropActionChoices(
      payload,
      target,
      source,
    );
    if (choices.length === 0) return;
    const runChoice = (choice: DropActionChoice) => executeDropAction(choice.action, payload);
    if (choices.length > 1 && chooseDropAction) {
      void Promise.resolve(chooseDropAction(choices, payload.point, runChoice))
        .then((handled) => {
          if (!handled) runChoice(choices[0]);
        })
        .catch(() => runChoice(choices[0]));
      return;
    }
    runChoice(choices[0]);
  }, [
    chooseDropAction,
    executeDropAction,
    openDockPayload,
  ]);

  const runFinderDropAction = useCallback(async (
    payload: StructureDragPayload,
    target: OpenDropTargetContext,
  ) => {
    if (payload.paths.length === 0 || !isTauriRuntime()) {
      runDropAction(payload, target, { kind: "finder" });
      return;
    }
    try {
      const classified = await invoke<ClassifiedOpenPaths>("classify_open_paths", { paths: payload.paths });
      if (classified.directories.length > 0) {
        addProjectRoots?.(classified.directories);
      }
      if (classified.errors.length > 0) {
        pushStatus(classified.errors.join("; "), "error");
      }
      const nextPayload: StructureDragPayload = {
        ...payload,
        paths: classified.files,
      };
      if (nextPayload.paths.length > 0 || nextPayload.records.length > 0) {
        runDropAction(nextPayload, target, { kind: "finder" });
      }
    } catch (error) {
      pushStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [addProjectRoots, pushStatus, runDropAction]);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        showDropOverlay();
        return;
      }
      hideDropOverlay();
      if (event.type === "drop") {
        const payload: StructureDragPayload = { paths: event.paths, records: [], point: tauriDropPoint(event.position) };
        void runFinderDropAction(payload, dropTargetForPosition(event.position));
      }
    },
    [dropTargetForPosition, hideDropOverlay, runFinderDropAction, showDropOverlay],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    const cleanup = trackTauriListener(
      getCurrentWindow()
        .onDragDropEvent((event) => {
          handleFileDrop(event.payload);
        })
        .catch((error) => {
          pushStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)), "error");
          throw error;
        }),
      "window drag-drop",
    );

    return () => {
      cleanup();
    };
  }, [handleFileDrop, pushStatus]);

  useEffect(() => {
    const resetDropState = () => hideDropOverlay();
    const resetWhenHidden = () => {
      if (document.visibilityState === "hidden") hideDropOverlay();
    };

    window.addEventListener("blur", resetDropState);
    window.addEventListener("dragend", resetDropState);
    document.addEventListener("visibilitychange", resetWhenHidden);
    return () => {
      clearDropResetTimer();
      window.removeEventListener("blur", resetDropState);
      window.removeEventListener("dragend", resetDropState);
      document.removeEventListener("visibilitychange", resetWhenHidden);
    };
  }, [clearDropResetTimer, hideDropOverlay]);

  const handleBrowserDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    const fileDrop = Array.from(event.dataTransfer.types).includes("Files");
    const structureDrop = hasStructureDrag(event.dataTransfer);
    if (!fileDrop && !structureDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!structureDrop) showDropOverlay();
  }, [showDropOverlay]);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    hideDropOverlay();
  }, [hideDropOverlay]);

  const handleBrowserDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const structureDrop = hasStructureDrag(event.dataTransfer);
      const fileDrop = Array.from(event.dataTransfer.types).includes("Files");
      if (!fileDrop && !structureDrop) return;
      event.preventDefault();
      hideDropOverlay();
      const point = browserDropPoint(event);
      const payload: StructureDragPayload = structureDrop
        ? readStructureDragPayload(event.dataTransfer)
        : {
            paths: Array.from(event.dataTransfer.files)
              .map((file) => (file as File & { path?: string }).path)
              .filter((path): path is string => Boolean(path)),
            records: [],
          };
      payload.point = point;
      const target = event.target instanceof Element ? event.target : null;
      if (payload.paths.length > 0 || payload.records.length > 0) {
        if (fileDrop) {
          void runFinderDropAction(payload, dropTargetForElement(target));
        } else {
          runDropAction(payload, dropTargetForElement(target), { kind: "unknown" });
        }
      } else if (fileDrop && !isTauriRuntime() && event.dataTransfer.files.length > 0) {
        const files = Array.from(event.dataTransfer.files);
        void structureDragPayloadFromBrowserFiles(files).then((result) => {
          const nextPayload: StructureDragPayload = { ...result.payload, point };
          if (nextPayload.records.length > 0) {
            runDropAction(nextPayload, dropTargetForElement(target), { kind: "finder" });
          }
          if (result.errors.length > 0) pushStatus(result.errors.join("; "), "error");
        }).catch((error) => {
          pushStatus("Browser file drop failed: " + (error instanceof Error ? error.message : String(error)), "error");
        });
      } else if (!isTauriRuntime()) {
        pushStatus("Drop files into the installed app window to open them.");
      }
    },
    [dropTargetForElement, hideDropOverlay, pushStatus, runDropAction, runFinderDropAction],
  );

  const handleBrowserPaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    if (isEditablePasteTarget(event.target)) return;
    const hasPlainText = Array.from(event.clipboardData.types).includes("text/plain");
    if (!hasStructureDrag(event.clipboardData)) {
      if (hasPlainText) pushStatus("Clipboard text is not a supported molecular structure or path list.", "error");
      return;
    }
    const payload = readStructureDragPayload(event.clipboardData);
    if (payload.paths.length === 0 && payload.records.length === 0) {
      if (hasPlainText) pushStatus("Clipboard text is not a supported molecular structure or path list.", "error");
      return;
    }
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    runDropAction(payload, dropTargetForElement(target), { kind: "clipboard" });
  }, [dropTargetForElement, pushStatus, runDropAction]);

  const openClipboardText = useCallback((text: string) => {
    const payload = structureDragPayloadFromText(text);
    if (payload.paths.length === 0 && payload.records.length === 0) return false;
    runDropAction(payload, dropTargetForClipboard(), { kind: "clipboard" });
    return true;
  }, [dropTargetForClipboard, runDropAction]);

  return {
    dropActive,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
    handleBrowserPaste,
    openClipboardText,
  };
}

function isEditablePasteTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[contenteditable="true"]')) return true;
  const element = target.closest("input, textarea, select");
  return Boolean(element);
}
