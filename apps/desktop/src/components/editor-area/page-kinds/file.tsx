import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type { ViewerDocument } from "../../../types";
import { isMoleculeCollectionPath } from "../../../lib/collection-documents";
import { ligandDropPathsForTarget } from "../../../lib/docking-documents";
import { hasStructureDrag, readStructureDrag } from "../../../lib/structure-drag";
import { isTauriRuntime } from "../../../lib/tauri";
import type { ShellActions } from "../../types";
import { showNativeContextMenu } from "../../native-context-menu";
import { definePageKind } from "./types";

export type FileLocation = { kind: "file"; documentId?: string; path: string };

export const fileKind = definePageKind<"file", FileLocation>({
  kind: "file",
  title: (location, state) => {
    const document = findDocument(location, state.documents) ?? state.activeDocument;
    return document?.title ?? "Structure";
  },
  description: "Open structure",
  Component: ({ location, state, actions }) => {
    const document = findDocument(location, state.documents) ?? state.activeDocument;
    return document ? <ViewerSurface document={document} actions={actions} /> : null;
  },
  keepAlive: false,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "file", documentId: typeof data.documentId === "string" ? data.documentId : undefined, path: data.path } : null),
  serialize: (location) => ({ documentId: location.documentId, path: location.path }),
});

function findDocument(location: FileLocation, documents: ViewerDocument[]) {
  return (
    documents.find((document) => document.id === location.documentId) ??
    documents.find((document) => document.path === location.path) ??
    null
  );
}

function ViewerSurface({
  document,
  actions,
}: {
  document: ViewerDocument;
  actions: ShellActions;
}) {
  const tauriRuntime = isTauriRuntime();
  const sandbox = tauriRuntime ? "allow-scripts allow-downloads" : "allow-scripts allow-downloads allow-same-origin";
  const [dockingDropActive, setDockingDropActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sheetDropTarget = document.renderer === "xyzrender-external";
  const collectionDropTarget = document.renderer === "grid2d";

  const postXyzrenderSheetItems = useCallback((paths: string[]) => {
    if (!sheetDropTarget || paths.length === 0) return false;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "burrete-host",
        body: {
          type: "addXyzrenderSheetItems",
          documentId: document.id,
          paths,
        },
      },
      "*",
    );
    return true;
  }, [document.id, sheetDropTarget]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDockingDropActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDockingDropActive(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDockingDropActive(false);
    actions.setStructureDragActive(false);
    const droppedPaths = readStructureDrag(event.dataTransfer);
    if (collectionDropTarget && droppedPaths.some(isMoleculeCollectionPath)) {
      void actions.mergeMoleculeCollections(document.path, droppedPaths);
      return;
    }
    if (postXyzrenderSheetItems(droppedPaths)) return;
    const paths = ligandDropPathsForTarget(document.path, droppedPaths);
    if (paths.length > 0) void actions.openDockingDocument(document.path, paths);
  }, [actions, collectionDropTarget, document.path, postXyzrenderSheetItems]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!collectionDropTarget) return;
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu([
      {
        kind: "item",
        id: "save-collection-as",
        text: "Save Collection As...",
        action: () => {
          void actions.saveMoleculeCollectionAs(document.id);
        },
      },
    ], { x: event.clientX, y: event.clientY });
  }, [actions, collectionDropTarget, document.id]);

  return (
    <div
      className="molecule-stage"
      data-docking-drop-active={dockingDropActive || undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      {tauriRuntime ? (
        <iframe ref={iframeRef} title={document.title} src={convertFileSrc(document.runtimePath)} className="viewer-iframe" sandbox={sandbox} referrerPolicy="no-referrer" data-document-id={document.id} />
      ) : (
        <iframe ref={iframeRef} title={document.title} srcDoc={document.runtimePath} className="viewer-iframe" sandbox={sandbox} referrerPolicy="no-referrer" data-document-id={document.id} />
      )}
      {dockingDropActive && (
        <div className="docking-drop-overlay">
          <div>{collectionDropTarget ? "Merge molecule collections" : sheetDropTarget ? "Add to xyzrender sheet" : "Add to Mol* docking view"}</div>
        </div>
      )}
    </div>
  );
}
