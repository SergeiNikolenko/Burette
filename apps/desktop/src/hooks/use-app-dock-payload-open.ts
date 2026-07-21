import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { StatusKind } from "../components/types";
import { openBrowserDevDocuments } from "../lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import { DOCK_TAB_LABELS, dockTabLoadsDroppedDocument, resolveDockDropPaths, type DockArea, type DockDropInput, type DockToolKind } from "../lib/dock";
import {
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
  addDockDrop: (input: DockDropInput) => void;
  detectContentSpectrumPaths: (paths: string[]) => Promise<Set<string>>;
  documents: ViewerDocument[];
  openStructureRecordDocuments: OpenStructureRecordDocuments;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockTool: (area: DockArea, tool: DockToolKind | null) => void;
  textDocuments: TextFileDocument[];
};

function browserDevDockDocumentIds(area: DockArea, paths: string[]) {
  return Object.fromEntries(paths.map((path) => [path, `dock:${area}:${path}`]));
}

export function useAppDockPayloadOpen({
  preferences,
  addBackgroundDocuments,
  addBackgroundTextDocuments,
  addDockDrop,
  detectContentSpectrumPaths,
  documents,
  openStructureRecordDocuments,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  setDockDocument,
  setDockTool,
  textDocuments,
}: UseAppDockPayloadOpenOptions) {
  return useCallback(async (input: DockDropInput) => {
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

    const { existingDocumentId, unopenedPaths } = resolveDockDropPaths(cleanPaths, documents, textDocuments);
    if (existingDocumentId) setDockDocument(input.area, existingDocumentId);
    if (unopenedPaths.length === 0 && cleanRecords.length === 0) {
      addDockDrop(input);
      pushStatus(`Opened existing document in ${input.area === "right" ? "right dock" : "bottom dock"}`);
      return;
    }

    pushStatus(`Opening in ${input.area === "right" ? "right dock" : "bottom dock"}...`);
    let unmaterializedDocuments: Array<ViewerDocument | TextFileDocument> = [];
    try {
      let dockOpenPaths = unopenedPaths;
      if (input.area === "right" && unopenedPaths.length > 0) {
        const rightDockContentSpectrumPaths = await detectContentSpectrumPaths(unopenedPaths);
        const rightDockTextPaths = unopenedPaths.filter((path) => {
          const extension = pathExtension(path);
          return !isSpectrumPath(path, extension)
            && !rightDockContentSpectrumPaths.has(path)
            && (isPreferredTextPath(path, extension) || (!structureExtensions.has(extension) && !structureAndTextExtensions.has(extension)));
        });
        dockOpenPaths = unopenedPaths.filter((path) => !rightDockTextPaths.includes(path));
        if (rightDockTextPaths.length > 0) {
          const textResult = isTauriRuntime()
            ? await invoke<OpenTextFilesResult>("open_text_files", {
                paths: rightDockTextPaths,
                openStateRevision: currentDocumentRegistryRevision(),
              })
            : await openBrowserDevTextFiles(rightDockTextPaths);
          unmaterializedDocuments.push(...textResult.documents);
          if (textResult.documents.length > 0) {
            addBackgroundTextDocuments(textResult.documents);
            const materializedRightDockTextClaims = new Set<ViewerDocument | TextFileDocument>(textResult.documents);
            unmaterializedDocuments = unmaterializedDocuments.filter((document) => !materializedRightDockTextClaims.has(document));
            setDockDocument(input.area, textResult.documents[0].id);
          }
          const openedText = `Opened ${textResult.documents.length} text file${textResult.documents.length === 1 ? "" : "s"} in right dock`;
          if (textResult.errors.length > 0) {
            if (existingDocumentId || textResult.documents.length > 0) addDockDrop(input);
            pushStatus(textResult.documents.length > 0 ? `${openedText}. ${summarizeErrors(textResult.errors)}` : summarizeErrors(textResult.errors), "error", textResult.errors);
            return;
          }
          pushStatus(openedText);
          if (dockOpenPaths.length === 0 && cleanRecords.length === 0) {
            addDockDrop(input);
            return;
          }
        }
      }

      const structurePaths: string[] = [];
      const spectrumPaths: string[] = [];
      const textPaths: string[] = [];
      const structureAndTextPaths: string[] = [];
      const contentSpectrumPaths = await detectContentSpectrumPaths(dockOpenPaths);
      for (const path of dockOpenPaths) {
        const extension = pathExtension(path);
        if (isSpectrumPath(path, extension) || contentSpectrumPaths.has(path)) {
          spectrumPaths.push(path);
        } else if (isPreferredTextPath(path, extension)) {
          textPaths.push(path);
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
              preferences,
              reloadOptions: undefined,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevDocuments(structurePaths, preferences, undefined, browserDevDockDocumentIds(input.area, structurePaths))
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
      const structureAndTextResults: OpenDocumentsResult[] = [];
      for (const path of structureAndTextPaths) {
        try {
          const result = isTauriRuntime()
            ? await invoke<OpenDocumentsResult>("open_documents", {
                paths: [path],
                preferences,
                reloadOptions: undefined,
                openStateRevision: currentDocumentRegistryRevision(),
              })
            : await openBrowserDevDocuments([path], preferences, undefined, browserDevDockDocumentIds(input.area, [path]));
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
            structureAndTextResults.push({ documents, errors: result.errors });
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
      const errors = [
        ...spectrumTextResult.errors,
        ...structurePathResult.errors,
        ...structureAndTextResults.flatMap((result) => result.errors),
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
      const firstDockDocumentId = openedStructures[0]?.id ?? openedTextDocuments[0]?.id ?? existingDocumentId;
      if (firstDockDocumentId) {
        setDockDocument(input.area, firstDockDocumentId);
        addDockDrop(input);
      }
      const openedCount = openedStructures.length + openedTextDocuments.length;
      const openedText = `Opened ${openedCount} item${openedCount === 1 ? "" : "s"} in ${input.area === "right" ? "right dock" : "bottom dock"}`;
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
    addDockDrop,
    detectContentSpectrumPaths,
    documents,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setDockDocument,
    setDockTool,
    textDocuments,
  ]);
}
