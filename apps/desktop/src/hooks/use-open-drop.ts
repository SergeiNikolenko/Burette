import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import type { DockingDocumentRequest } from "../types";
import { dockingRequestForDrop } from "../lib/docking-documents";
import { hasStructureDrag, readStructureDragPayload } from "../lib/structure-drag";
import type { StructureDragPayload } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;
type OpenDockingDocument = (receptorPath: string, ligandPaths: string[]) => void | Promise<void>;
type AddXyzrenderSheetItems = (payload: StructureDragPayload) => boolean;
type MergeMoleculeCollections = (paths: string[]) => boolean;
type ReportStatus = (status: string, kind?: "info" | "error") => void;

type OpenDropOptions = {
  activeDocumentPath?: string | null;
  activeDockingRequest?: DockingDocumentRequest | null;
  openDockingDocument?: OpenDockingDocument;
  addXyzrenderSheetItems?: AddXyzrenderSheetItems;
  mergeMoleculeCollections?: MergeMoleculeCollections;
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
  const { activeDocumentPath = null, activeDockingRequest = null, openDockingDocument, addXyzrenderSheetItems, mergeMoleculeCollections } = options;

  const openAsDocking = useCallback((paths: string[]) => {
    if (!activeDocumentPath || !openDockingDocument) return false;
    const request = dockingRequestForDrop(activeDocumentPath, paths, activeDockingRequest);
    if (!request) return false;
    void openDockingDocument(request.receptorPath, request.ligandPaths);
    return true;
  }, [activeDockingRequest, activeDocumentPath, openDockingDocument]);

  const isOverActiveViewer = useCallback((position: { x: number; y: number } | null = null) => {
    if (!activeDocumentPath || typeof document === "undefined") return false;
    const element = position
      ? document.elementFromPoint(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio)
      : document.activeElement;
    return Boolean(element?.closest(".molecule-stage, .main-stage"));
  }, [activeDocumentPath]);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (event.type === "drop") {
        const payload: StructureDragPayload = { paths: event.paths, records: [], point: tauriDropPoint(event.position) };
        if (isOverActiveViewer(event.position) && mergeMoleculeCollections?.(event.paths)) return;
        if (isOverActiveViewer(event.position) && addXyzrenderSheetItems?.(payload)) return;
        if (isOverActiveViewer(event.position) && openAsDocking(event.paths)) return;
        void openDocuments(event.paths);
      }
    },
    [addXyzrenderSheetItems, isOverActiveViewer, mergeMoleculeCollections, openAsDocking, openDocuments],
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
        if (target?.closest(".molecule-stage, .main-stage")) {
          if (mergeMoleculeCollections?.(payload.paths)) return;
          if (addXyzrenderSheetItems?.(payload)) return;
          if (openAsDocking(payload.paths)) return;
        }
        if (payload.paths.length > 0) void openDocuments(payload.paths);
        else if (!isTauriRuntime()) pushStatus("Drop this molecule onto an xyzrender sheet to add it.");
      } else if (!isTauriRuntime()) {
        pushStatus("Drop files into the installed app window to open them.");
      }
    },
    [addXyzrenderSheetItems, mergeMoleculeCollections, openAsDocking, openDocuments, pushStatus],
  );

  return {
    dropActive,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
  };
}
