import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import { ligandDropPathsForTarget } from "../lib/docking-documents";
import { hasStructureDrag, readStructureDrag } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;
type OpenDockingDocument = (receptorPath: string, ligandPaths: string[]) => void | Promise<void>;
type AddXyzrenderSheetItems = (paths: string[]) => boolean;
type MergeMoleculeCollections = (paths: string[]) => boolean;
type ReportStatus = (status: string, kind?: "info" | "error") => void;

type OpenDropOptions = {
  activeDocumentPath?: string | null;
  openDockingDocument?: OpenDockingDocument;
  addXyzrenderSheetItems?: AddXyzrenderSheetItems;
  mergeMoleculeCollections?: MergeMoleculeCollections;
};

export function useOpenDrop(openDocuments: OpenDocuments, pushStatus: ReportStatus, options: OpenDropOptions = {}) {
  const [dropActive, setDropActive] = useState(false);
  const { activeDocumentPath = null, openDockingDocument, addXyzrenderSheetItems, mergeMoleculeCollections } = options;

  const openAsDocking = useCallback((paths: string[]) => {
    if (!activeDocumentPath || !openDockingDocument) return false;
    const ligandPaths = ligandDropPathsForTarget(activeDocumentPath, paths);
    if (ligandPaths.length === 0) return false;
    void openDockingDocument(activeDocumentPath, ligandPaths);
    return true;
  }, [activeDocumentPath, openDockingDocument]);

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
        if (isOverActiveViewer(event.position) && mergeMoleculeCollections?.(event.paths)) return;
        if (isOverActiveViewer(event.position) && addXyzrenderSheetItems?.(event.paths)) return;
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
      const paths = structureDrop
        ? readStructureDrag(event.dataTransfer)
        : Array.from(event.dataTransfer.files)
            .map((file) => (file as File & { path?: string }).path)
            .filter((path): path is string => Boolean(path));
      if (paths.length > 0) {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".molecule-stage, .main-stage")) {
          if (mergeMoleculeCollections?.(paths)) return;
          if (addXyzrenderSheetItems?.(paths)) return;
          if (openAsDocking(paths)) return;
        }
        void openDocuments(paths);
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
