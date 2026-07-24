import { useCallback, useMemo, useRef } from "react";
import type { ViewerDocument } from "../../../types";
import { hasStructureDrag, readStructureDragPayload } from "../../../lib/structure-drag";
import type { StructureDragPayload } from "../../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../../drop-action-executor";
import type { ShellActions } from "../../types";
import { ViewerFrame } from "../viewer-frame";
import { showNativeContextMenu } from "../../native-context-menu";
import { definePageKind } from "./types";
import { SpectrumViewer } from "../../spectrum-viewer";
import { useSourceEditing } from "../../../lib/source-editing/context";

export type FileLocation = { kind: "file"; documentId?: string; path: string };

export const fileKind = definePageKind<"file", FileLocation>({
  kind: "file",
  title: (location, state) => {
    const document = findDocument(location, state.documents);
    return document?.title ?? "Structure";
  },
  description: "Open structure",
  Component: ({ location, state, actions }) => {
    const document = findDocument(location, state.documents);
    return document ? <ViewerSurface document={document} actions={actions} /> : null;
  },
  keepAlive: true,
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
  if (document.renderer === "spectrum") {
    return <SpectrumViewer document={document} />;
  }
  return <StructureViewerSurface document={document} actions={actions} />;
}

function StructureViewerSurface({
  document,
  actions,
}: {
  document: ViewerDocument;
  actions: ShellActions;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sourceEditing = useSourceEditing();
  const sourceSession = sourceEditing?.sessionForDocument(document) ?? null;
  const sheetDropTarget = document.renderer === "xyzrender-external";
  const collectionDropTarget = document.renderer === "grid2d";
  const dropTarget = useMemo(() => ({
    kind: "active-viewer" as const,
    documentId: document.id,
    documentPath: document.path,
    renderer: document.renderer,
    dockingRequest: document.dockingRequest ?? null,
  }), [document.dockingRequest, document.id, document.path, document.renderer]);

  const viewerDropActionChoices = useCallback((payload: StructureDragPayload) => (
    shellDropActionChoices(payload, dropTarget).filter((choice) => (
      choice.action.kind !== "open-documents" && choice.action.kind !== "open-structure-records"
    ))
  ), [dropTarget]);

  const postXyzrenderSheetItems = useCallback((payload: StructureDragPayload) => {
    if (!sheetDropTarget || (payload.paths.length === 0 && payload.records.length === 0)) return false;
    const iframeRect = iframeRef.current?.getBoundingClientRect();
    const point = payload.point && iframeRect && Number.isFinite(payload.point.x) && Number.isFinite(payload.point.y)
      ? { x: payload.point.x - iframeRect.left, y: payload.point.y - iframeRect.top }
      : null;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "burette-host",
        body: {
          type: "addXyzrenderSheetItems",
          documentId: document.id,
          paths: payload.paths,
          records: payload.records,
          point,
        },
      },
      "*",
    );
    return true;
  }, [document.id, sheetDropTarget]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    if (viewerDropActionChoices(payload).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [viewerDropActionChoices]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const droppedPayload = readStructureDragPayload(event.dataTransfer);
    droppedPayload.point = { x: event.clientX, y: event.clientY };
    const choices = viewerDropActionChoices(droppedPayload);
    if (choices.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    runShellDropActionChoices(actions, droppedPayload, choices, { x: event.clientX, y: event.clientY }, {
      addXyzrenderSheetItems: (targetDocumentId, payload) => (
        targetDocumentId === document.id && postXyzrenderSheetItems(payload)
      ),
    });
  }, [actions, document.id, postXyzrenderSheetItems, viewerDropActionChoices]);

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
      data-drop-document-path={document.path}
      data-drop-document-id={document.id}
      data-drop-document-renderer={document.renderer}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      <ViewerFrame
        document={document}
        iframeRef={iframeRef}
        sourcePreview={sourceSession?.sourcePreview ?? undefined}
        onStagingLoad={(identity, frame) => sourceEditing?.stagingLoaded(document, identity, frame)}
      />
    </div>
  );
}
