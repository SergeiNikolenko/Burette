import { isMolecularDelimitedFile } from "../lib/delimited-molecules";
import type { useDockLayout } from "./use-dock-layout";
import { useCallback } from "react";
import { rendererViewReloadOptions } from "../lib/renderer-view-state";
import { prepareDockCameraTransfer } from "../lib/dock-camera-transfer";
import { invoke } from "@tauri-apps/api/core";

import type { StatusKind } from "../components/types";
import { openBrowserDevDocuments } from "../lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import { DOCK_TAB_LABELS, dockMediaId, dockTabLoadsDroppedDocument, resolveDockDropPaths, type DockArea, type DockDropInput } from "../lib/dock";
import {
  documentFallbackExtensions,
  isDocumentMediaPath,
  isPreferredTextPath,
  NOT_RENDERABLE_RENDERER,
  pathExtension,
  structureAndTextExtensions,
  structureExtensions,
  summarizeErrors,
} from "../lib/file-routing";
import { isSpectrumPath, spectrumDocumentFromText } from "../lib/spectrum";
import { isTauriRuntime } from "../lib/tauri";
import { currentDocumentRegistryRevision } from "../lib/native-menu";
import { abortOpenDocumentClaims } from "../lib/open-document-claims";
import type {
  OpenDocumentsResult,
  OpenTextFilesResult,
  TextFileDocument,
  ViewerDocument,
  ViewerPreferences,
} from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type OpenStructureRecordDocuments = (
  records: DockDropInput["payload"]["records"],
) => Promise<{ opened: ViewerDocument[]; errors: string[] }>;

type UseAppDockPayloadOpenOptions = {
  preferences: ViewerPreferences;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  addBackgroundTextDocuments: (documents: TextFileDocument[]) => void;
  captureDockTarget: ReturnType<typeof useDockLayout>["captureDockTarget"];
  detectContentSpectrumPaths: (paths: string[]) => Promise<Set<string>>;
  documents: ViewerDocument[];
  openStructureRecordDocuments: OpenStructureRecordDocuments;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  textDocuments: TextFileDocument[];
};

function browserDevDockDocumentIds(area: DockArea, paths: string[]) {
  return Object.fromEntries(paths.map((path) => [path, `dock:${area}:${path}`]));
}

export function useAppDockPayloadOpen({
  preferences,
  addBackgroundDocuments,
  addBackgroundTextDocuments,
  captureDockTarget,
  detectContentSpectrumPaths,
  documents,
  openStructureRecordDocuments,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  textDocuments,
}: UseAppDockPayloadOpenOptions) {
  return useCallback(async (input: DockDropInput) => {
    const { workspaceId, addDockDrop, setDockDocument, setDockTool } = captureDockTarget();
    const ketcherItem = input.payload.items?.find((item) => item.kind === "ketcher") ?? null;
    const itemPaths = (input.payload.items ?? [])
      .map((item) => item.path)
      .filter((path): path is string => Boolean(path));
    const cleanPaths = Array.from(new Set([...input.payload.paths, ...itemPaths].map((path) => path.trim()).filter(Boolean)));
    const cleanRecords = input.payload.records;
    if (!dockTabLoadsDroppedDocument(input.tabKind)) {
      addDockDrop(input);
      pushStatus(`Added input to ${DOCK_TAB_LABELS[input.tabKind]} in ${input.area === "right" ? "right dock" : "bottom dock"}`);
      return;
    }
    if (ketcherItem && cleanPaths.length === 0 && cleanRecords.length === 0) {
      setDockTool(input.area, "ketcher");
      addDockDrop(input);
      pushStatus(`Opened Ketcher in ${input.area === "right" ? "right dock" : "bottom dock"}`);
      return;
    }
    if (cleanPaths.length === 0 && cleanRecords.length === 0) {
      addDockDrop(input);
      return;
    }

    const { existingDocumentId, unopenedPaths } = input.rendererMode
      ? { existingDocumentId: null, unopenedPaths: cleanPaths }
      : resolveDockDropPaths(cleanPaths, documents, textDocuments);
    const dockPreferences = { ...preferences, rendererMode: input.rendererMode ?? "auto" as const };
    if (existingDocumentId) {
      const source = documents.find(document => document.id === existingDocumentId);
      if (input.tabKind === "files" && source) await prepareDockCameraTransfer(input.area, source, workspaceId);
      setDockDocument(input.area, existingDocumentId);
    }
    if (unopenedPaths.length === 0 && cleanRecords.length === 0) {
      addDockDrop(input);
      pushStatus(`Opened existing document in ${input.area === "right" ? "right dock" : "bottom dock"}`);
      return;
    }

    pushStatus(`Opening in ${input.area === "right" ? "right dock" : "bottom dock"}...`);
    let unmaterializedDocuments: Array<ViewerDocument | TextFileDocument> = [];
    try {
      const dockOpenPaths = unopenedPaths;
      const structurePaths: string[] = [];
      const spectrumPaths: string[] = [];
      const documentPaths: string[] = [];
      const textPaths: string[] = [];
      const structureAndTextPaths: string[] = [];
      const contentSpectrumPaths = await detectContentSpectrumPaths(dockOpenPaths);
      for (const path of dockOpenPaths) {
        const extension = pathExtension(path);
        if (isSpectrumPath(path, extension) || contentSpectrumPaths.has(path)) {
          spectrumPaths.push(path);
        } else if (isDocumentMediaPath(path, extension)) {
          documentPaths.push(path);
        } else if (isPreferredTextPath(path, extension)) {
          textPaths.push(path);
        } else if (documentFallbackExtensions.has(extension) && !(await isMolecularDelimitedFile(path))) {
          documentPaths.push(path);
        } else if (structureAndTextExtensions.has(extension)) {
          structureAndTextPaths.push(path);
        } else if (structureExtensions.has(extension)) {
          structurePaths.push(path);
        } else if (extension.length > 0) {
          textPaths.push(path);
        } else {
          textPaths.push(path);
        }
      }

      const structurePathResult = structurePaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", {
              paths: structurePaths,
              preferences: dockPreferences,
              reloadOptions: structurePaths.length === 1 ? rendererViewReloadOptions(structurePaths[0]) : undefined,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevDocuments(structurePaths, dockPreferences, structurePaths.length === 1 ? rendererViewReloadOptions(structurePaths[0]) : undefined, browserDevDockDocumentIds(input.area, structurePaths))
        : { documents: [], errors: [] };
      unmaterializedDocuments.push(...structurePathResult.documents);
      const spectrumTextResult = spectrumPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", {
              paths: spectrumPaths,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevTextFiles(spectrumPaths)
        : { documents: [], errors: [] };
      unmaterializedDocuments.push(...spectrumTextResult.documents);
      const spectrumDocuments = spectrumTextResult.documents.map(spectrumDocumentFromText);
      const structureAndTextResults: Array<OpenDocumentsResult & { path: string }> = [];
      for (const path of structureAndTextPaths) {
        try {
          const result = isTauriRuntime()
            ? await invoke<OpenDocumentsResult>("open_documents", {
                paths: [path],
                preferences: dockPreferences,
                reloadOptions: rendererViewReloadOptions(path),
                openStateRevision: currentDocumentRegistryRevision(),
              })
            : await openBrowserDevDocuments([path], dockPreferences, rendererViewReloadOptions(path), browserDevDockDocumentIds(input.area, [path]));
          unmaterializedDocuments.push(...result.documents);
          const documents = result.documents.filter((document) => document.renderer !== NOT_RENDERABLE_RENDERER);
          const discardedDocuments = result.documents.filter((document) => document.renderer === NOT_RENDERABLE_RENDERER);
          if (discardedDocuments.length > 0) {
            const discardedClaims = new Set<ViewerDocument | TextFileDocument>(discardedDocuments);
            unmaterializedDocuments = unmaterializedDocuments.filter((document) => !discardedClaims.has(document));
            void abortOpenDocumentClaims(discardedDocuments).catch((abortError) => {
              console.warn("Open document claim abort failed", abortError);
            });
          }
          if (documents.length > 0 || result.errors.length > 0) {
            structureAndTextResults.push({ path, documents, errors: result.errors });
          }
        } catch {}
      }
      const textOpenPaths = [...textPaths, ...structureAndTextPaths];
      const textResult = textOpenPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", {
              paths: textOpenPaths,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevTextFiles(textOpenPaths)
        : { documents: [], errors: [] };
      unmaterializedDocuments.push(...textResult.documents);
      const recordResult = cleanRecords.length > 0
        ? await openStructureRecordDocuments(cleanRecords)
        : { opened: [], errors: [] };
      unmaterializedDocuments.push(...recordResult.opened);
      const openedStructures = [
        ...spectrumDocuments,
        ...structurePathResult.documents,
        ...structureAndTextResults.flatMap((result) => result.documents),
        ...recordResult.opened,
      ];
      const materializedStructureClaims = new Set<ViewerDocument | TextFileDocument>([
        ...spectrumTextResult.documents,
        ...structurePathResult.documents,
        ...structureAndTextResults.flatMap((result) => result.documents),
        ...recordResult.opened,
      ]);
      const openedTextDocuments = textResult.documents;
      // A delimited file the grid rejected still opened as dock text right above,
      // so its grid error would only mislead: the file is on screen.
      const openedTextPaths = new Set(textResult.documents.map((document) => document.path));
      const errors = [
        ...spectrumTextResult.errors,
        ...structurePathResult.errors,
        ...structureAndTextResults.flatMap((result) => (
          result.documents.length === 0
            && documentFallbackExtensions.has(pathExtension(result.path))
            && openedTextPaths.has(result.path)
            ? []
            : result.errors
        )),
        ...textResult.errors,
        ...recordResult.errors,
      ];
      if (openedStructures.length > 0) {
        addBackgroundDocuments(openedStructures);
        unmaterializedDocuments = unmaterializedDocuments.filter((document) => !materializedStructureClaims.has(document));
        rememberRecentStructures(openedStructures);
      }
      if (openedTextDocuments.length > 0) {
        addBackgroundTextDocuments(openedTextDocuments);
        const materializedTextClaims = new Set<ViewerDocument | TextFileDocument>(openedTextDocuments);
        unmaterializedDocuments = unmaterializedDocuments.filter((document) => !materializedTextClaims.has(document));
      }
      const firstDockDocumentId = documentPaths[0] ? dockMediaId(documentPaths[0]) : openedStructures[0]?.id ?? openedTextDocuments[0]?.id ?? existingDocumentId;
      if (firstDockDocumentId) {
        setDockDocument(input.area, firstDockDocumentId);
        addDockDrop(input);
      }
      const openedCount = openedStructures.length + openedTextDocuments.length + documentPaths.length;
      const dockLabel = input.area === "right" ? "right dock" : "bottom dock";
      const openedText = `Opened ${openedCount} item${openedCount === 1 ? "" : "s"} in ${dockLabel}`;
      if (errors.length > 0) {
        pushStatus(openedCount > 0 ? `${openedText}. ${summarizeErrors(errors)}` : summarizeErrors(errors), "error", errors);
        return;
      }
      pushStatus(openedText);
    } catch (error) {
      if (unmaterializedDocuments.length > 0) {
        void abortOpenDocumentClaims(unmaterializedDocuments).catch((abortError) => {
          console.warn("Open document claim abort failed", abortError);
        });
      }
      pushErrorStatus(error, "Dock open failed");
    }
  }, [
    addBackgroundDocuments,
    addBackgroundTextDocuments,
    captureDockTarget,
    detectContentSpectrumPaths,
    documents,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    textDocuments,
  ]);
}
