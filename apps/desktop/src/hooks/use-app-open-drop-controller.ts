import { useAgentSession } from "./use-agent-session";
import { useAppClipboard } from "./use-app-clipboard";
import { useAppOpenDropMergeCollections } from "./use-app-open-drop-merge-collections";
import { useOpenDrop } from "./use-open-drop";
import { useOpenEvents } from "./use-open-events";
import type { DockArea, DockDropInput } from "../lib/dock";
import type { DropActionChoice } from "../lib/drop-actions";
import type { StructureDragPayload, StructureDragRecord } from "../lib/structure-drag";
import type { DockingDocumentRequest, FepSetupRequest, OpenTextFilesResult, ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenPaths = (paths: string[]) => void | Promise<void>;
type OpenTextDocuments = (paths: string[]) => Promise<OpenTextFilesResult | null>;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
  options?: { activePose?: number | null },
) => void | Promise<ViewerDocument | null>;
type OpenDockingStructureRecords = (
  receptorPath: string,
  ligandPaths: string[],
  records: StructureDragRecord[],
) => void | Promise<void>;
type OpenStructureRecords = (records: StructureDragRecord[]) => void | Promise<void>;
type OpenKetcherWithStructures = (
  paths: string[],
  fragments?: Array<{ title: string; text: string }>,
) => void;
type OpenFepSetupWorkspace = (request: FepSetupRequest) => void;
type ChooseDropAction = (
  choices: DropActionChoice[],
  at: { x: number; y: number } | null | undefined,
  runChoice: (choice: DropActionChoice) => void,
) => boolean | Promise<boolean>;

type UseAppOpenDropControllerOptions = {
  activeDocument: ViewerDocument | null;
  activeTabKind: string | null;
  addProjectRoots: (paths: string[]) => void;
  addXyzrenderSheetItems: (payload: StructureDragPayload) => boolean;
  appendGridRecords: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  chooseDropAction: ChooseDropAction;
  documents: ViewerDocument[];
  fepSetupRequest: FepSetupRequest | null;
  mergeMoleculeCollections: (targetPath: string | null, paths: string[]) => void | Promise<void>;
  openDockPayload: (input: DockDropInput) => void | Promise<void>;
  openDockingDocument: OpenDockingDocument;
  openDockingStructureRecords: OpenDockingStructureRecords;
  openFepSetupWorkspace: OpenFepSetupWorkspace;
  openKetcherWithStructures: OpenKetcherWithStructures;
  openPaths: OpenPaths;
  openStructureRecords: OpenStructureRecords;
  openTextDocuments: OpenTextDocuments;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
};

export function useAppOpenDropController({
  activeDocument,
  activeTabKind,
  addProjectRoots,
  addXyzrenderSheetItems,
  appendGridRecords,
  chooseDropAction,
  documents,
  fepSetupRequest,
  mergeMoleculeCollections,
  openDockPayload,
  openDockingDocument,
  openDockingStructureRecords,
  openFepSetupWorkspace,
  openKetcherWithStructures,
  openPaths,
  openStructureRecords,
  openTextDocuments,
  pushErrorStatus,
  pushStatus,
  setDockDocument,
}: UseAppOpenDropControllerOptions) {
  useOpenEvents(openPaths, pushErrorStatus);
  const mergeDroppedMoleculeCollections = useAppOpenDropMergeCollections({
    activeDocument,
    mergeMoleculeCollections,
  });
  useAgentSession({
    activeDocument,
    documents,
    openTextDocuments,
    openPaths,
    pushErrorStatus,
    setDockDocument,
  });
  const {
    dropActive,
    dropPreview,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
    handleBrowserPaste,
    openClipboardText,
  } = useOpenDrop(openPaths, pushStatus, {
    activeTabKind,
    activeDocumentId: activeDocument?.id ?? null,
    activeDocumentPath: activeDocument?.path ?? null,
    activeDocumentRenderer: activeDocument?.renderer ?? null,
    activeDockingRequest: activeDocument?.dockingRequest ?? null,
    documents,
    fepSetupRequest,
    openDockingDocument,
    openDockingStructureRecords,
    openStructureRecords,
    openTextDocuments,
    openKetcherWithStructures,
    openFepSetupWorkspace,
    openDockPayload,
    appendGridRecords,
    addXyzrenderSheetItems,
    addProjectRoots,
    chooseDropAction,
    mergeMoleculeCollections: mergeDroppedMoleculeCollections,
  });
  const { openClipboard } = useAppClipboard({ openClipboardText, pushErrorStatus, pushStatus });

  return {
    dropActive,
    dropPreview,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
    handleBrowserPaste,
    openClipboard,
  };
}
