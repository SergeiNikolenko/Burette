import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  openBrowserDevDockingDocument,
  openBrowserDevMergedCollection,
  readBrowserDevCollectionText,
} from "../lib/browser-dev-documents";
import { isMoleculeCollectionPath } from "../lib/collection-documents";
import { dockingRequestForDrop } from "../lib/docking-documents";
import type { DockTabKind } from "../lib/dock";
import { downloadTextFile } from "../lib/file-export";
import { summarizeErrors } from "../lib/file-routing";
import { basename } from "../lib/sidebar-projects";
import type { StructureDragRecord } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";
import type {
  DockingDocumentRequest,
  DockingSceneMode,
  ViewerDocument,
  ViewerPreferences,
} from "../types";
import type { StatusKind } from "../components/types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenStructureRecordDocuments = (
  records: StructureDragRecord[],
) => Promise<{ opened: ViewerDocument[]; errors: string[] }>;
type SetDockOpen = (area: "right" | "bottom", open: boolean) => void;
type OpenPoseReviewTab = (location: {
  kind: "pose-review";
  receptorPath: string;
  gridDocumentId: string;
  gridPath: string;
  dockingDocumentId: string;
  dockingPath: string;
}) => void;

type UseAppDockingWorkflowsOptions = {
  addDocuments: (documents: ViewerDocument[]) => void;
  documents: ViewerDocument[];
  notifyGridPoseReviewSelection: (targetDocumentId: string, activePose: number) => void;
  openPoseReviewTab: OpenPoseReviewTab;
  openStructureRecordDocuments: OpenStructureRecordDocuments;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  rightDockActiveTab: DockTabKind;
  rightDockOpen: boolean;
  setDockOpen: SetDockOpen;
  setStructureDragActive: (active: boolean) => void;
};

export function useAppDockingWorkflows({
  addDocuments,
  documents,
  notifyGridPoseReviewSelection,
  openPoseReviewTab,
  openStructureRecordDocuments,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  rightDockActiveTab,
  rightDockOpen,
  setDockOpen,
  setStructureDragActive,
}: UseAppDockingWorkflowsOptions) {
  const openDockingDocument = useCallback(async (
    targetPath: string,
    droppedPaths: string[],
    options: { activePose?: number | null; sceneMode?: DockingSceneMode | null } = {},
  ) => {
    const existingDockingRequest = documents.find((document) => document.path === targetPath || document.id === targetPath)?.dockingRequest;
    const request = dockingRequestForDrop(targetPath, droppedPaths, existingDockingRequest);
    if (!request) return null;
    if (request.ligandPaths.length === 0) return null;
    request.activePose = options.activePose ?? null;
    request.sceneMode = options.sceneMode ?? null;
    request.poseMode = options.sceneMode === "structureAll" ? "all" : "single";
    pushStatus("Opening Molstar docking view...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences, options);
      addDocuments([document]);
      rememberRecentStructures([document]);
      setStructureDragActive(false);
      pushStatus(`Opened docking view with ${request.ligandPaths.length} ligand${request.ligandPaths.length === 1 ? "" : "s"}`);
      return document;
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
      return null;
    }
  }, [addDocuments, documents, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, rightDockActiveTab, rightDockOpen, setDockOpen, setStructureDragActive]);

  const openDockingStructureRecords = useCallback(async (
    receptorPath: string,
    ligandPaths: string[],
    records: StructureDragRecord[],
  ) => {
    const cleanLigandPaths = Array.from(new Set(ligandPaths.map((path) => path.trim()).filter(Boolean)));
    const cleanRecords = records.filter((record) => record.text.trim().length > 0);
    if (!receptorPath || (cleanLigandPaths.length === 0 && cleanRecords.length === 0)) return;
    pushStatus("Opening Molstar docking view...");
    try {
      const { opened, errors } = await openStructureRecordDocuments(cleanRecords);
      if (errors.length > 0 && opened.length === 0 && cleanLigandPaths.length === 0) {
        pushStatus(summarizeErrors(errors), "error", errors);
        return;
      }
      const request: DockingDocumentRequest = {
        receptorPath,
        ligandPaths: [...cleanLigandPaths, ...opened.map((document) => document.path)],
      };
      if (request.ligandPaths.length === 0) return;
      const dockingDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_docking_document", { request, preferences })
        : await openBrowserDevDockingDocument(request.receptorPath, request.ligandPaths, preferences);
      if (opened.length > 0) addDocuments(opened);
      addDocuments([dockingDocument]);
      rememberRecentStructures([...opened, dockingDocument]);
      setStructureDragActive(false);
      const message = "Opened docking view";
      if (errors.length > 0) {
        pushStatus(`${message}. ${summarizeErrors(errors)}`, "error", errors);
      } else {
        pushStatus(message);
      }
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Docking view failed");
    }
  }, [addDocuments, openStructureRecordDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, rightDockActiveTab, rightDockOpen, setDockOpen, setStructureDragActive]);

  const collectionSourcePaths = useCallback((path: string | null) => {
    if (!path) return [];
    const document = documents.find((candidate) => candidate.path === path || candidate.id === path);
    if (document?.mergedCollection) return document.mergedCollection.sourcePaths;
    return [path];
  }, [documents]);

  const mergeMoleculeCollections = useCallback(async (targetPath: string | null, paths: string[]) => {
    const candidatePaths = Array.from(new Set([
      ...collectionSourcePaths(targetPath),
      ...paths.flatMap((path) => collectionSourcePaths(path)),
    ].map((path) => path.trim()).filter(Boolean)));
    const unsupportedPaths = candidatePaths.filter((path) => !isMoleculeCollectionPath(path));
    if (unsupportedPaths.length > 0) {
      pushStatus(
        "Collection merge accepts only SDF, SMILES, CSV, or TSV inputs.",
        "error",
        unsupportedPaths,
      );
      return;
    }
    const sourcePaths = candidatePaths;
    if (sourcePaths.length < 2) {
      pushStatus("Drop another SDF, SMILES, CSV, or TSV collection to merge it.", "error");
      return;
    }
    pushStatus("Merging molecule collections...");
    try {
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_merged_collection", {
            request: { paths: sourcePaths },
            preferences,
          })
        : await openBrowserDevMergedCollection(sourcePaths, preferences);
      addDocuments([document]);
      setStructureDragActive(false);
      pushStatus(`Merged ${sourcePaths.length} collection${sourcePaths.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStructureDragActive(false);
      pushErrorStatus(error, "Merge collections failed");
    }
  }, [addDocuments, collectionSourcePaths, preferences, pushErrorStatus, pushStatus, setStructureDragActive]);

  const saveMoleculeCollectionAs = useCallback(async (targetPath: string) => {
    const document = documents.find((candidate) => candidate.path === targetPath || candidate.id === targetPath);
    const path = document?.path ?? targetPath;
    const suggestedFileName = document?.mergedCollection?.suggestedFileName ?? basename(path);
    try {
      if (isTauriRuntime()) {
        const outputPath = await save({
          defaultPath: suggestedFileName,
          filters: [{ name: "Molecule collections", extensions: ["sdf", "sd", "smi", "smiles", "csv", "tsv"] }],
        });
        if (!outputPath) return;
        await invoke("save_molecule_collection_as", { path, outputPath });
        pushStatus(`Saved ${basename(outputPath)}`);
        return;
      }

      const text = document?.mergedCollection?.text ?? await readBrowserDevCollectionText(path);
      downloadTextFile(suggestedFileName || "molecule-collection.sdf", text);
      pushStatus(`Saved ${suggestedFileName}`);
    } catch (error) {
      pushErrorStatus(error, "Save collection failed");
    }
  }, [documents, pushErrorStatus, pushStatus]);

  const openPoseReviewWorkspace = useCallback(async (
    receptorDocument: ViewerDocument,
    gridDocument: ViewerDocument,
    activePose: number,
  ) => {
    const dockingDocument = await openDockingDocument(receptorDocument.path, [gridDocument.path], { activePose });
    if (!dockingDocument) return;
    openPoseReviewTab({
      kind: "pose-review",
      receptorPath: receptorDocument.path,
      gridDocumentId: gridDocument.id,
      gridPath: gridDocument.path,
      dockingDocumentId: dockingDocument.id,
      dockingPath: dockingDocument.path,
    });
    notifyGridPoseReviewSelection(gridDocument.id, activePose);
    pushStatus("Opened pose-review workspace");
  }, [notifyGridPoseReviewSelection, openDockingDocument, openPoseReviewTab, pushStatus]);

  return {
    mergeMoleculeCollections,
    openDockingDocument,
    openDockingStructureRecords,
    openPoseReviewWorkspace,
    saveMoleculeCollectionAs,
  };
}
