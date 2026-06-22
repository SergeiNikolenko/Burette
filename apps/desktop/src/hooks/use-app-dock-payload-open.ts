import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { StatusKind } from "../components/types";
import { openBrowserDevDocuments } from "../lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import type { DockArea, DockDropInput, DockToolKind } from "../lib/dock";
import {
  NOT_RENDERABLE_RENDERER,
  pathExtension,
  preferredTextExtensions,
  structureAndTextExtensions,
  structureExtensions,
  summarizeErrors,
} from "../lib/file-routing";
import { isSpectrumPath, spectrumDocumentFromText } from "../lib/spectrum";
import { isTauriRuntime } from "../lib/tauri";
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
  openStructureRecordDocuments: OpenStructureRecordDocuments;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockTool: (area: DockArea, tool: DockToolKind | null) => void;
};

export function useAppDockPayloadOpen({
  preferences,
  addBackgroundDocuments,
  addBackgroundTextDocuments,
  addDockDrop,
  detectContentSpectrumPaths,
  openStructureRecordDocuments,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  setDockDocument,
  setDockTool,
}: UseAppDockPayloadOpenOptions) {
  return useCallback(async (input: DockDropInput) => {
    const ketcherItem = input.payload.items?.find((item) => item.kind === "ketcher") ?? null;
    const itemPaths = (input.payload.items ?? [])
      .map((item) => item.path)
      .filter((path): path is string => Boolean(path));
    const cleanPaths = Array.from(new Set([...input.payload.paths, ...itemPaths].map((path) => path.trim()).filter(Boolean)));
    const cleanRecords = input.payload.records;
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

    pushStatus(`Opening in ${input.area === "right" ? "right dock" : "bottom dock"}...`);
    try {
      let dockOpenPaths = cleanPaths;
      if (input.area === "right" && cleanPaths.length > 0) {
        const rightDockContentSpectrumPaths = await detectContentSpectrumPaths(cleanPaths);
        const rightDockTextPaths = cleanPaths.filter((path) => {
          const extension = pathExtension(path);
          return !isSpectrumPath(path, extension) && !rightDockContentSpectrumPaths.has(path) && !structureExtensions.has(extension) && !structureAndTextExtensions.has(extension);
        });
        dockOpenPaths = cleanPaths.filter((path) => !rightDockTextPaths.includes(path));
        if (rightDockTextPaths.length > 0) {
          const textResult = isTauriRuntime()
            ? await invoke<OpenTextFilesResult>("open_text_files", { paths: rightDockTextPaths })
            : await openBrowserDevTextFiles(rightDockTextPaths);
          if (textResult.documents.length > 0) {
            addBackgroundTextDocuments(textResult.documents);
            setDockDocument(input.area, textResult.documents[0].id);
            addDockDrop(input);
          }
          const openedText = `Opened ${textResult.documents.length} text file${textResult.documents.length === 1 ? "" : "s"} in right dock`;
          if (textResult.errors.length > 0) {
            pushStatus(textResult.documents.length > 0 ? `${openedText}. ${summarizeErrors(textResult.errors)}` : summarizeErrors(textResult.errors), "error", textResult.errors);
            return;
          }
          pushStatus(openedText);
          if (dockOpenPaths.length === 0 && cleanRecords.length === 0) return;
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
        } else if (structureAndTextExtensions.has(extension)) {
          structureAndTextPaths.push(path);
        } else if (structureExtensions.has(extension)) {
          structurePaths.push(path);
        } else if (preferredTextExtensions.has(extension) || extension.length > 0) {
          textPaths.push(path);
        } else {
          textPaths.push(path);
        }
      }

      const structurePathResult = structurePaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: structurePaths, preferences, reloadOptions: undefined })
          : await openBrowserDevDocuments(structurePaths, preferences, undefined)
        : { documents: [], errors: [] };
      const spectrumTextResult = spectrumPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: spectrumPaths })
          : await openBrowserDevTextFiles(spectrumPaths)
        : { documents: [], errors: [] };
      const spectrumDocuments = spectrumTextResult.documents.map(spectrumDocumentFromText);
      const structureAndTextResults: OpenDocumentsResult[] = [];
      for (const path of structureAndTextPaths) {
        try {
          const result = isTauriRuntime()
            ? await invoke<OpenDocumentsResult>("open_documents", { paths: [path], preferences, reloadOptions: undefined })
            : await openBrowserDevDocuments([path], preferences, undefined);
          const documents = result.documents.filter((document) => document.renderer !== NOT_RENDERABLE_RENDERER);
          if (documents.length > 0 || result.errors.length > 0) {
            structureAndTextResults.push({ documents, errors: result.errors });
          }
        } catch {}
      }
      const textOpenPaths = [...textPaths, ...structureAndTextPaths];
      const textResult = textOpenPaths.length > 0
        ? isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: textOpenPaths })
          : await openBrowserDevTextFiles(textOpenPaths)
        : { documents: [], errors: [] };
      const recordResult = cleanRecords.length > 0
        ? await openStructureRecordDocuments(cleanRecords)
        : { opened: [], errors: [] };
      const openedStructures = [
        ...spectrumDocuments,
        ...structurePathResult.documents,
        ...structureAndTextResults.flatMap((result) => result.documents),
        ...recordResult.opened,
      ];
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
        rememberRecentStructures(openedStructures);
      }
      if (openedTextDocuments.length > 0) {
        addBackgroundTextDocuments(openedTextDocuments);
      }
      const firstDockDocumentId = openedStructures[0]?.id ?? openedTextDocuments[0]?.id ?? null;
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
      pushErrorStatus(error, "Dock open failed");
    }
  }, [
    addBackgroundDocuments,
    addBackgroundTextDocuments,
    addDockDrop,
    detectContentSpectrumPaths,
    openStructureRecordDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setDockDocument,
    setDockTool,
  ]);
}
