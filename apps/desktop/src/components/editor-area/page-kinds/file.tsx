import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { isMesoscaleViewerDocument } from "../../../lib/mesoscale-documents";
import { bindMesoscaleFrame, releaseMesoscaleFrame, setMesoscaleSceneOpen, useMesoscaleStore } from "../../../stores/mesoscale-store";
import { MesoscaleToolbar } from "../../mesoscale/mesoscale-toolbar";
import { MesoscaleSceneOverlay, MesoscaleSceneToggle } from "../../mesoscale/mesoscale-scene-overlay";

export type FileLocation = { kind: "file"; documentId?: string; path: string };

export const fileKind = definePageKind<"file", FileLocation>({
  kind: "file",
  title: (location, state) => {
    const document = findDocument(location, state.documents);
    return document?.title ?? "Structure";
  },
  description: "Open structure",
  Component: ({ location, state, actions, isActive }) => {
    const document = findDocument(location, state.documents);
    return document ? <ViewerSurface document={document} actions={actions} preferences={state.preferences} isActive={isActive} /> : null;
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
  preferences,
  isActive,
}: {
  document: ViewerDocument;
  actions: ShellActions;
  preferences: Parameters<typeof MesoscaleToolbar>[0]["preferences"];
  isActive: boolean;
}) {
  if (document.renderer === "spectrum") {
    return <SpectrumViewer document={document} />;
  }
  return <StructureViewerSurface document={document} actions={actions} preferences={preferences} isActive={isActive} />;
}

function StructureViewerSurface({
  document,
  actions,
  preferences,
  isActive,
}: {
  document: ViewerDocument;
  actions: ShellActions;
  preferences: Parameters<typeof MesoscaleToolbar>[0]["preferences"];
  isActive: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stagingIframeRef = useRef<HTMLIFrameElement>(null);
  const sourceEditing = useSourceEditing();
  const sourceSession = sourceEditing?.sessionForDocument(document) ?? null;
  const mesoscale = isMesoscaleViewerDocument(document);
  const mesoscaleSceneOpen = useMesoscaleStore((store) => store.sessions[document.id]?.sceneOpen ?? false);
  const mesoscaleLeftPanelOpen = useMesoscaleStore((store) => store.sessions[document.id]?.summary?.layout.left ?? false);
  const mesoscaleRightPanelOpen = useMesoscaleStore((store) => store.sessions[document.id]?.summary?.layout.right ?? false);
  const sheetDropTarget = document.renderer === "xyzrender-external";
  const collectionDropTarget = document.renderer === "grid2d";
  const postViewerVisibility = useCallback((frame = iframeRef.current, frameActive = true) => {
    frame?.contentWindow?.postMessage({
      source: "burette-host",
      body: {
        type: "viewerVisibilityChanged",
        documentId: document.id,
        visible: isActive && frameActive,
      },
    }, "*");
  }, [document.id, isActive]);

  useEffect(() => {
    postViewerVisibility(iframeRef.current, true);
    postViewerVisibility(stagingIframeRef.current, false);
  }, [postViewerVisibility, sourceSession?.sourcePreview?.activeSlot]);
  useEffect(() => () => releaseMesoscaleFrame(document.id, iframeRef.current?.contentWindow), [document.id]);

  const handleViewerLoad = useCallback((frame: HTMLIFrameElement, active: boolean) => {
    postViewerVisibility(frame, active);
    if (mesoscale && active && frame.contentWindow) bindMesoscaleFrame(document.id, frame.contentWindow);
  }, [document.id, mesoscale, postViewerVisibility]);
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
      className={`molecule-stage${mesoscaleLeftPanelOpen ? " mesoscale-left-panel-open" : ""}${mesoscaleRightPanelOpen ? " mesoscale-right-panel-open" : ""}`}
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
        stagingIframeRef={stagingIframeRef}
        sourcePreview={sourceSession?.sourcePreview ?? undefined}
        onViewerLoad={handleViewerLoad}
        onStagingLoad={(identity, frame) => sourceEditing?.stagingLoaded(document, identity, frame)}
      />
      {mesoscale && mesoscaleSceneOpen ? <MesoscaleSceneOverlay document={document} onClose={() => setMesoscaleSceneOpen(document.id, false)} /> : null}
      {mesoscale ? (
        <MesoscaleSceneToggle
          open={mesoscaleSceneOpen}
          onToggle={() => setMesoscaleSceneOpen(document.id, !mesoscaleSceneOpen)}
        />
      ) : null}
      {mesoscale ? (
        <MesoscaleToolbar
          document={document}
          actions={actions}
          preferences={preferences}
        />
      ) : null}
    </div>
  );
}
