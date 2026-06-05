import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import type { DockingDocumentRequest, FepSetupRequest, ViewerDocument } from "../types";
import { resolveDropActionChoices } from "../lib/drop-actions";
import type { DropSourceContext, DropTargetContext } from "../lib/drop-actions";
import type { DropAction, DropActionChoice } from "../lib/drop-actions";
import { hasStructureDrag, readStructureDragPayload, structureDragPayloadFromText, structureDragRecordsToFragments } from "../lib/structure-drag";
import type { StructureDragPayload, StructureDragRecord } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
  options?: { activePose?: number | null },
) => void | Promise<ViewerDocument | null>;
type OpenDockingStructureRecords = (receptorPath: string, ligandPaths: string[], records: StructureDragRecord[]) => void | Promise<void>;
type OpenStructureRecords = (records: StructureDragRecord[]) => void | Promise<void>;
type OpenKetcherWithStructures = (paths: string[], fragments?: Array<{ title: string; text: string }>) => void;
type OpenFepSetupWorkspace = (request: FepSetupRequest) => void;
type AppendGridRecords = (targetDocumentId: string, payload: StructureDragPayload) => boolean;
type AddXyzrenderSheetItems = (payload: StructureDragPayload) => boolean;
type MergeMoleculeCollections = (paths: string[]) => boolean;
type AddProjectRoots = (paths: string[]) => void;
type ReportStatus = (status: string, kind?: "info" | "error") => void;
type DropPoint = { x: number; y: number };
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
  fepSetupRequest?: FepSetupRequest | null;
  openDockingDocument?: OpenDockingDocument;
  openDockingStructureRecords?: OpenDockingStructureRecords;
  openStructureRecords?: OpenStructureRecords;
  openKetcherWithStructures?: OpenKetcherWithStructures;
  openFepSetupWorkspace?: OpenFepSetupWorkspace;
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

export function useOpenDrop(openDocuments: OpenDocuments, pushStatus: ReportStatus, options: OpenDropOptions = {}) {
  const [dropActive, setDropActive] = useState(false);
  const {
    activeTabKind = null,
    activeDocumentId = null,
    activeDocumentPath = null,
    activeDocumentRenderer = null,
    activeDockingRequest = null,
    fepSetupRequest = null,
    openDockingDocument,
    openDockingStructureRecords,
    openStructureRecords,
    openKetcherWithStructures,
    openFepSetupWorkspace,
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

  const dropTargetForElement = useCallback((element: Element | null): DropTargetContext => {
    if (fepSetupRequest && element?.closest(".pose-review-workspace, .fep-setup-workspace")) {
      return { kind: "fep-setup", request: fepSetupRequest };
    }
    if (element?.closest(".ketcher-page")) return { kind: "ketcher" };
    if (element?.closest(".molecule-stage, .main-stage")) {
      if (activeTabKind === "ketcher") return { kind: "ketcher" };
      return activeViewerTarget() ?? { kind: "workspace" };
    }
    if (activeTabKind === "ketcher") return { kind: "ketcher" };
    return { kind: "workspace" };
  }, [activeTabKind, activeViewerTarget, fepSetupRequest]);

  const dropTargetForPosition = useCallback((position: { x: number; y: number } | null = null): DropTargetContext => {
    if (typeof document === "undefined") return activeTabKind === "ketcher" ? { kind: "ketcher" } : { kind: "workspace" };
    const element = position
      ? document.elementFromPoint(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio)
      : document.activeElement;
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
    openFepSetupWorkspace,
    openKetcherWithStructures,
    openStructureRecords,
    pushStatus,
  ]);

  const runDropAction = useCallback((
    payload: StructureDragPayload,
    target: DropTargetContext,
    source: DropSourceContext = { kind: "unknown" },
  ) => {
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
  ]);

  const runFinderDropAction = useCallback(async (
    payload: StructureDragPayload,
    target: DropTargetContext,
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
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (event.type === "drop") {
        const payload: StructureDragPayload = { paths: event.paths, records: [], point: tauriDropPoint(event.position) };
        void runFinderDropAction(payload, dropTargetForPosition(event.position));
      }
    },
    [dropTargetForPosition, runFinderDropAction],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        handleFileDrop(event.payload);
      })
      .then((next) => {
        unlisten = next;
      })
      .catch((error) => {
        pushStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)), "error");
      });

    return () => {
      unlisten?.();
    };
  }, [handleFileDrop, pushStatus]);

  const handleBrowserDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    const fileDrop = Array.from(event.dataTransfer.types).includes("Files");
    const structureDrop = hasStructureDrag(event.dataTransfer);
    if (!fileDrop && !structureDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!structureDrop) setDropActive(true);
  }, []);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleBrowserDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const structureDrop = hasStructureDrag(event.dataTransfer);
      const fileDrop = Array.from(event.dataTransfer.types).includes("Files");
      if (!fileDrop && !structureDrop) return;
      event.preventDefault();
      setDropActive(false);
      const payload = structureDrop
        ? readStructureDragPayload(event.dataTransfer)
        : {
            paths: Array.from(event.dataTransfer.files)
              .map((file) => (file as File & { path?: string }).path)
              .filter((path): path is string => Boolean(path)),
            records: [],
          };
      payload.point = browserDropPoint(event);
      if (payload.paths.length > 0 || payload.records.length > 0) {
        const target = event.target instanceof Element ? event.target : null;
        if (fileDrop) {
          void runFinderDropAction(payload, dropTargetForElement(target));
        } else {
          runDropAction(payload, dropTargetForElement(target), { kind: "unknown" });
        }
      } else if (!isTauriRuntime()) {
        pushStatus("Drop files into the installed app window to open them.");
      }
    },
    [dropTargetForElement, pushStatus, runDropAction, runFinderDropAction],
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
