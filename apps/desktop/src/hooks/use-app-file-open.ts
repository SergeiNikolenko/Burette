import { isNativePreviewWindow } from "../lib/window-scope";
import { useCallback } from "react";
import { saveStructureRecordsInFolder } from "./save-structure-records";
import { useMoleculeStore } from "../stores/molecule-store";
import { invoke } from "@tauri-apps/api/core";

import { showNativeContextMenu } from "../components/native-context-menu";
import type { FepNetworkLocation } from "../components/editor-area/page-kinds/fep-network";
import type { FileOpenOptions, StatusKind } from "../components/types";
import { deleteBrowserDevVirtualTextDocument, openBrowserDevDocuments, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { openStoredScientificFile } from "../lib/workbench/browser-import";
import { importedOriginalFor } from "../lib/workbench/scientific-source-state";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import type { DockArea, DockTabKind } from "../lib/dock";
import {
  delimitedColumnChoiceLabel,
  isDelimitedColumnAmbiguity,
  documentFallbackExtensions,
  documentTextViewerExtensions,
  isDocumentViewerPath,
  isFepGraphmlPath,
  isPreferredTextPath,
  NOT_RENDERABLE_RENDERER,
  pathExtension,
  structureAndTextExtensions,
  structureExtensionFromPath,
  structureExtensions,
  summarizeErrors,
  type GridDelimitedColumnChoice,
} from "../lib/file-routing";
import { journalAction } from "../lib/action-journal";
import { markPerformanceOnce } from "../lib/performance";
import { tracePerf } from "../lib/perf-trace";
import { fetchRemoteStructure } from "../lib/remote-structure";
import { currentDocumentRegistryRevision } from "../lib/native-menu";
import { abortOpenDocumentClaims } from "../lib/open-document-claims";
import { basename } from "../lib/sidebar-projects";
import type { StructureDragRecord } from "../lib/structure-drag";
import { readStructureText, readStructureTextDocument } from "../lib/structure-text";
import { isMolecularDelimitedFile } from "../lib/delimited-molecules";
import { DEFAULT_MAX_BYTES as RETAB_TEXT_VIEWER_MAX_BYTES } from "../components/ui/text-viewer-resource";
import { isSpectrumPath, spectrumDocumentFromText } from "../lib/spectrum";
import { isTauriRuntime } from "../lib/tauri";
import type {
  OpenDocumentsMode,
  OpenDocumentsResult,
  OpenTextFilesResult,
  TextFileDocument,
  ViewerDocument,
  ViewerPreferences,
  ViewerReloadOptions,
} from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type ClassifiedOpenPaths = {
  files: string[];
  directories: string[];
  errors: string[];
};

type UseAppFileOpenOptions = {
  preferences: ViewerPreferences;
  addProjectRoot: (path: string) => void;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  addBackgroundTextDocuments: (documents: TextFileDocument[]) => void;
  addDocuments: (documents: ViewerDocument[], options?: { preserveActiveTab?: boolean }) => void;
  addTextDocuments: (documents: TextFileDocument[], options?: { preserveActiveTab?: boolean }) => void;
  closeDocument: (id: string) => void;
  detectContentSpectrumPaths: (paths: string[]) => Promise<Set<string>>;
  expandStructureBundles: (paths: string[]) => Promise<string[]>;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openDocumentTab: (path: string) => void;
  openFepNetworkTab: (location: FepNetworkLocation) => void;
  openTextDocumentsInActiveTab: (documents: TextFileDocument[]) => void;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  replaceDocument: (documentId: string, replacement: ViewerDocument) => void;
  setActiveDocument: (id: string) => void;
  setDockActiveTab: (area: DockArea, kind: DockTabKind) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setDocuments: (documents: ViewerDocument[]) => void;
};

async function fitsRetabTextViewer(path: string) {
  try {
    const probe = await readStructureTextDocument(path, undefined, { maxBytes: 1 });
    return probe.byteCount <= RETAB_TEXT_VIEWER_MAX_BYTES;
  } catch {
    return true;
  }
}

/**
 * Releases prepared text structures that were never added: their native source registration
 * and virtual grid runtime on the desktop, their virtual text in the browser. A path or id
 * that an open document already uses stays.
 */
async function releaseUnadoptedStructures(documents: ViewerDocument[]) {
  const open = useMoleculeStore.getState().documents;
  const unadopted = documents.filter((document) => !open.some(({ id, path }) => id === document.id || path === document.path));
  if (unadopted.length === 0) return;
  if (!isTauriRuntime()) {
    for (const document of unadopted) deleteBrowserDevVirtualTextDocument(document.path);
    return;
  }
  await abortOpenDocumentClaims(unadopted);
  await invoke("close_opened_source_documents", { documentIds: unadopted.map((document) => document.id) });
}


export function useAppFileOpen({
  preferences,
  addProjectRoot,
  addBackgroundDocuments,
  addBackgroundTextDocuments,
  addDocuments,
  addTextDocuments,
  closeDocument,
  detectContentSpectrumPaths,
  expandStructureBundles,
  openDockTab,
  openDocumentsInActiveTab,
  openDocumentTab,
  openFepNetworkTab,
  openTextDocumentsInActiveTab,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  replaceDocument,
  setActiveDocument,
  setDockActiveTab,
  setDockDocument,
  setDockOpen,
  setDocuments,
}: UseAppFileOpenOptions) {
  const openDelimitedGridDocument = useCallback(
    async (
      path: string,
      smilesColumn: string,
      effectivePreferences: ViewerPreferences,
      replace: boolean,
    ) => {
      const document = await invoke<ViewerDocument>("open_delimited_grid_document", {
        request: { path, smilesColumn },
        preferences: effectivePreferences,
        openStateRevision: currentDocumentRegistryRevision(),
      });
      try {
        if (replace) setDocuments([document]);
        else addDocuments([document]);
      } catch (error) {
        void abortOpenDocumentClaims([document]).catch((abortError) => {
          console.warn("Open document claim abort failed", abortError);
        });
        throw error;
      }
      rememberRecentStructures([document]);
      pushStatus(`Opened ${document.title}`);
    },
    [addDocuments, pushStatus, rememberRecentStructures, setDocuments],
  );

  const showDelimitedGridColumnOpenMenu = useCallback(
    async (path: string, effectivePreferences: ViewerPreferences, replace: boolean) => {
      const choices = await invoke<GridDelimitedColumnChoice[]>("grid_delimited_columns", {
        request: { path },
      });
      if (choices.length === 0) {
        pushStatus("No structure columns were found in the delimited file", "error");
        return;
      }
      pushStatus("Choose a structure column for the delimited file");
      await showNativeContextMenu(
        choices.map((choice) => ({
          kind: "item" as const,
          id: `delimited-column-open-${choice.index}`,
          text: delimitedColumnChoiceLabel(choice),
          action: () => {
            void openDelimitedGridDocument(path, String(choice.index), effectivePreferences, replace)
              .catch((error) => pushErrorStatus(error, "Open failed"));
          },
        })),
        undefined,
        { presentation: "dropdown" },
      );
    },
    [openDelimitedGridDocument, pushErrorStatus, pushStatus],
  );

  const openDocuments = useCallback(
    async (
      paths: string[],
      reloadOptions?: ViewerReloadOptions,
      preferencesOverride?: Partial<ViewerPreferences>,
      options: { replace?: boolean; inActiveTab?: boolean; mode?: OpenDocumentsMode; deferErrorStatus?: boolean; preserveActiveTab?: boolean; reuseExisting?: boolean; shouldApply?: () => boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      if (options.shouldApply?.() === false) return null;
      const graphmlPaths = cleanPaths.filter(isFepGraphmlPath);
      const structurePaths = cleanPaths.filter((path) => !isFepGraphmlPath(path));
      if (graphmlPaths.length > 0) {
        try {
          for (const path of graphmlPaths) {
            const graphmlText = await readStructureText(path);
            if (options.shouldApply && !options.shouldApply()) return null;
            openFepNetworkTab({ kind: "fep-network", title: basename(path), graphmlText });
          }
          pushStatus(`Opened ${graphmlPaths.length} FEP network${graphmlPaths.length === 1 ? "" : "s"}`);
        } catch (error) {
          if (structurePaths.length === 0) {
            pushErrorStatus(error, "Open failed");
            return;
          }
          pushErrorStatus(error, "FEP network open failed");
        }
      }
      if (structurePaths.length === 0) return;
      const effectivePreferences = {
        ...preferences,
        ...(isNativePreviewWindow() ? { rendererMode: "molstar" as const } : {}),
        ...preferencesOverride,
      };
      pushStatus("Opening structures...");
      try {
        const result: OpenDocumentsResult = { documents: [], errors: [] };
        const admittedPaths = new Set<string>();
        const mayContinue = () => options.shouldApply?.() !== false
          && (admittedPaths.size === 0 || useMoleculeStore.getState().documents.some((document) => admittedPaths.has(document.path)));
        // Combined scenes must reach the native reader as one request. Ordinary
        // opens publish the first document immediately, then bounded batches.
        const combined = options.mode === "combinePoses" || options.mode === "combineGrid";
        for (let offset = 0; offset < structurePaths.length;) {
          if (!mayContinue()) return null;
          const batchPaths = structurePaths.slice(offset, offset + (combined ? structurePaths.length : offset === 0 ? 1 : 32));
          offset += batchPaths.length;
          const deferRuntime = !combined && offset > 1 && !reloadOptions && !options.deferErrorStatus;
          const retainedByPath = new Map(deferRuntime || options.reuseExisting
            ? useMoleculeStore.getState().documents.map((document) => [document.path, document] as const)
            : []);
          const pathsToOpen = batchPaths.filter((path) => !retainedByPath.has(path));
          let batch: OpenDocumentsResult;
          try {
            batch = pathsToOpen.length === 0 ? { documents: [], errors: [] } : isTauriRuntime()
              ? await invoke<OpenDocumentsResult>("open_documents", {
                  paths: pathsToOpen,
                  preferences: effectivePreferences,
                  reloadOptions,
                  mode: options.mode,
                  deferRuntime,
                  openStateRevision: currentDocumentRegistryRevision(),
                })
              : await openBrowserDevDocuments(pathsToOpen, effectivePreferences, reloadOptions);
            batch.documents = batch.documents.map((document) => document.runtimeDeferred
              ? { ...document, runtimeDeferredPreferences: { ...preferencesOverride, rendererMode: effectivePreferences.rendererMode } }
              : document);
            if (retainedByPath.size > 0) {
              const openedByPath = new Map(batch.documents.map((document) => [document.path, document]));
              batch.documents = batchPaths.flatMap((path) => {
                const document = retainedByPath.get(path) ?? openedByPath.get(path);
                return document ? [document] : [];
              });
            }
          } catch (error) {
            // An entirely invalid batch rejects rather than returning errors.
            // Keep later files reachable without swallowing a single-file menu.
            if (structurePaths.length === 1 || combined) throw error;
            result.errors.push(String(error));
            continue;
          }
          if (!mayContinue()) {
            await abortOpenDocumentClaims(batch.documents);
            return null;
          }
          result.errors.push(...batch.errors);
          if (batch.documents.length === 0) continue;
          const previousActiveTabId = useMoleculeStore.getState().activeTabId;
          try {
            if (result.documents.length === 0 && options.replace) setDocuments(batch.documents);
            else if (result.documents.length === 0 && options.inActiveTab) openDocumentsInActiveTab(batch.documents);
            else addDocuments(batch.documents, { preserveActiveTab: options.preserveActiveTab || result.documents.length > 0 });
          } catch (error) {
            void abortOpenDocumentClaims(batch.documents).catch((abortError) => {
              console.warn("Open document claim abort failed", abortError);
            });
            throw error;
          }
          if (result.documents.length === 0 && !options.replace && !options.inActiveTab && !options.preserveActiveTab && batch.documents[0]) {
            setActiveDocument(batch.documents[0].id);
          }
          if (options.preserveActiveTab && (options.replace || options.inActiveTab) && previousActiveTabId) {
            useMoleculeStore.getState().setActiveTab(previousActiveTabId);
          }
          markPerformanceOnce("app:first-document-opened");
          result.documents.push(...batch.documents);
          for (const document of batch.documents) admittedPaths.add(document.path);
          tracePerf("open:batch", { detail: { total: structurePaths.length, processed: offset, admitted: result.documents.length } });
          // Yield so the selected viewer can mount and input/cancellation can run.
          if (offset < structurePaths.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        tracePerf("open:complete", { detail: { total: structurePaths.length, admitted: result.documents.length } });
        rememberRecentStructures(result.documents);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        // deferErrorStatus: the caller falls back to another opener for anything
        // the grid rejects, and that opener surfaces its own failures — a toast
        // here would report an error for a file that opens fine a moment later.
        if (result.errors.length > 0) {
          if (!options.deferErrorStatus) pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else if (result.documents.length > 0 || !options.deferErrorStatus) {
          pushStatus(openedText);
        }
        return result;
      } catch (error) {
        if (isTauriRuntime() && cleanPaths.length === 1 && isDelimitedColumnAmbiguity(error)) {
          void showDelimitedGridColumnOpenMenu(cleanPaths[0], effectivePreferences, options.replace === true)
            .catch((menuError) => pushErrorStatus(menuError, "Structure column menu failed"));
          return null;
        }
        // The raw error (with its path) stays in Details; the toast names the file.
        if (!options.deferErrorStatus) pushErrorStatus(error, cleanPaths.length === 1 ? `Couldn’t open ${basename(cleanPaths[0])}` : "Couldn’t open files");
        return null;
      }
    },
    [addDocuments, openDocumentsInActiveTab, openFepNetworkTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments, showDelimitedGridColumnOpenMenu],
  );

  const openTextDocuments = useCallback(
    async (
      paths: string[],
      options: { inActiveTab?: boolean; background?: boolean; shouldApply?: () => boolean; preserveActiveTab?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening text files...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", {
              paths: cleanPaths,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevTextFiles(cleanPaths);
        if (options.shouldApply && !options.shouldApply()) { await abortOpenDocumentClaims(result.documents); return null; }
        try {
          if (options.background) addBackgroundTextDocuments(result.documents);
          else if (options.inActiveTab) openTextDocumentsInActiveTab(result.documents);
          else addTextDocuments(result.documents, { preserveActiveTab: options.preserveActiveTab });
        } catch (error) {
          void abortOpenDocumentClaims(result.documents).catch((abortError) => {
            console.warn("Open document claim abort failed", abortError);
          });
          throw error;
        }
        const openedText = "Opened " + result.documents.length + " text file" + (result.documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return result;
      } catch (error) {
        pushErrorStatus(error, "Open text file failed");
        return null;
      }
    },
    [addBackgroundTextDocuments, addTextDocuments, openTextDocumentsInActiveTab, pushErrorStatus, pushStatus],
  );

  const openSpectrumDocuments = useCallback(
    async (
      paths: string[],
      options: { inActiveTab?: boolean; background?: boolean; shouldApply?: () => boolean; preserveActiveTab?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening spectra...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", {
              paths: cleanPaths,
              openStateRevision: currentDocumentRegistryRevision(),
            })
          : await openBrowserDevTextFiles(cleanPaths);
        if (options.shouldApply && !options.shouldApply()) { await abortOpenDocumentClaims(result.documents); return null; }
        const documents = result.documents.map(spectrumDocumentFromText);
        try {
          if (options.background) addBackgroundDocuments(documents);
          else if (options.inActiveTab) openDocumentsInActiveTab(documents);
          else addDocuments(documents, { preserveActiveTab: options.preserveActiveTab });
        } catch (error) {
          void abortOpenDocumentClaims(result.documents).catch((abortError) => {
            console.warn("Open document claim abort failed", abortError);
          });
          throw error;
        }
        if (!options.background && !options.inActiveTab && !options.preserveActiveTab && documents[0]) {
          setActiveDocument(documents[0].id);
          setDockDocument("right", documents[0].id);
          setDockActiveTab("right", "inspector");
          setDockOpen("right", true);
          setDockDocument("bottom", documents[0].id);
          openDockTab("bottom", "spectrum");
        }
        rememberRecentStructures(documents);
        const openedText = "Opened " + documents.length + " spectrum" + (documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return { documents, errors: result.errors };
      } catch (error) {
        pushErrorStatus(error, "Open spectrum failed");
        return null;
      }
    },
    [addBackgroundDocuments, addDocuments, openDockTab, openDocumentsInActiveTab, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDockActiveTab, setDockDocument, setDockOpen],
  );

  const openPathBatch = useCallback(async (paths: string[], options: FileOpenOptions = {}) => {
    const mayApply = () => options.shouldApply?.() !== false;
    if (!mayApply()) return;
    let openedAny = false;
    const requestedPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (!requestedPaths.length) return;
    journalAction("file", "open", { detail: { paths: requestedPaths.slice(0, 20), count: requestedPaths.length } });
    let filePaths = requestedPaths;
    if (isTauriRuntime()) {
      try {
        const classified = await invoke<ClassifiedOpenPaths>("classify_open_paths", { paths: requestedPaths });
        if (!mayApply()) return;
        if (options.requireSuccess && classified.errors.length) throw new Error(summarizeErrors(classified.errors));
        for (const directory of classified.directories) addProjectRoot(directory);
        if (classified.directories.length > 0) {
          pushStatus(
            `Added ${classified.directories.length.toLocaleString()} project folder`
            + (classified.directories.length === 1 ? "" : "s"),
          );
        }
        if (classified.errors.length > 0) {
          pushStatus(`Some open targets were unavailable. ${summarizeErrors(classified.errors)}`, "error", classified.errors);
        }
        filePaths = classified.files;
      } catch (error) {
        pushErrorStatus(error, "Open path classification failed");
        if (options.requireSuccess) throw error;
        return;
      }
    }
    if (options.preferredPath) {
      filePaths = filePaths.slice().sort((a, b) => a === options.preferredPath ? -1 : b === options.preferredPath ? 1 : 0);
    }
    const cleanPaths = await expandStructureBundles(filePaths);
    if (!mayApply()) return;
    if (!cleanPaths.length) {
      if (options.requireSuccess) throw new Error("No files could be opened.");
      return;
    }

    const structurePaths: string[] = [];
    const spectrumPaths: string[] = [];
    const documentPaths: string[] = [];
    const textPaths: string[] = [];
    const structureAndTextPaths: string[] = [];
    let preferredStructureDocumentId: string | null = null;
    const contentSpectrumPaths = await detectContentSpectrumPaths(cleanPaths);

    for (const path of cleanPaths) {
      if (!isTauriRuntime()) {
        const existing = useMoleculeStore.getState().documents.find((document) => document.path === path);
        // Opening the same scientific tab preserves its current draft and import lifetime.
        if (existing?.virtual && importedOriginalFor(existing.id)) {
          openedAny = true;
          preferredStructureDocumentId ??= existing.id;
          continue;
        }
        // A later open/close owns this path even if it eventually returns to no document.
        let sourceCurrent = true;
        const stopWatching = useMoleculeStore.subscribe((state) => {
          if (state.documents.find((document) => document.path === path) !== existing) sourceCurrent = false;
        });
        let scientific: ViewerDocument[] | null;
        try {
          scientific = await openStoredScientificFile(path, preferences, (document) => {
            addDocuments([document], { preserveActiveTab: options.preserveActiveTab });
            rememberRecentStructures([document]);
          }, () => mayApply() && sourceCurrent);
        } finally { stopWatching(); }
        if (!mayApply()) return;
        if (scientific !== null) {
          const current = useMoleculeStore.getState().documents.find((document) => document.path === path);
          const opened = scientific[0] ?? (current?.virtual && importedOriginalFor(current.id) ? current : null);
          openedAny ||= Boolean(opened);
          preferredStructureDocumentId ??= opened?.id ?? null;
          continue;
        }
      }
      const extension = pathExtension(path);
      if (isSpectrumPath(path, extension) || contentSpectrumPaths.has(path)) {
        spectrumPaths.push(path);
      } else if (isDocumentViewerPath(path, extension)) {
        // The Retab text viewer hard-errors past its byte bound; oversized text
        // and code stay on the legacy CodeMirror path, which shows a truncated
        // preview instead.
        if (documentTextViewerExtensions.has(extension) && !(await fitsRetabTextViewer(path))) {
          textPaths.push(path);
        } else {
          documentPaths.push(path);
        }
      } else if (
        isPreferredTextPath(path, extension)
        || (extension.length > 0 && !structureExtensions.has(extension) && !structureAndTextExtensions.has(extension))
      ) {
        textPaths.push(path);
      } else if (documentFallbackExtensions.has(extension)) {
        if (await isMolecularDelimitedFile(path)) structureAndTextPaths.push(path);
        else documentPaths.push(path);
      } else if (structureAndTextExtensions.has(extension)) {
        structureAndTextPaths.push(path);
      } else if (structureExtensions.has(extension)) {
        structurePaths.push(path);
      } else {
        textPaths.push(path);
      }
    }

    if (!mayApply()) return;
    for (const path of documentPaths) {
      openDocumentTab(path); openedAny = true;
    }

    if (spectrumPaths.length > 0) {
      const result = await openSpectrumDocuments(spectrumPaths, options);
      if (!mayApply()) return;
      openedAny ||= Boolean(result?.documents.length);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    if (structurePaths.length > 0) {
      // Normal file opening follows format support; Open As passes an explicit renderer.
      const result = await openDocuments(structurePaths, undefined, { rendererMode: "auto" }, { ...options, reuseExisting: true });
      if (!mayApply()) return;
      openedAny ||= Boolean(result?.documents.length);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    const openedStructureAndTextPaths = new Set<string>();
    if (structureAndTextPaths.length > 0) {
      const result = await openDocuments(structureAndTextPaths, undefined, { rendererMode: "auto" }, { ...options, reuseExisting: true, deferErrorStatus: true });
      if (!mayApply()) return;
      const openedDocuments = result?.documents ?? [];
      for (const document of openedDocuments) {
        if (document.renderer === NOT_RENDERABLE_RENDERER) {
          closeDocument(document.id);
          void abortOpenDocumentClaims([document]).catch((abortError) => {
            console.warn("Open document claim abort failed", abortError);
          });
        } else {
          openedStructureAndTextPaths.add(document.path);
          openedAny = true;
          preferredStructureDocumentId = preferredStructureDocumentId ?? document.id;
        }
      }
    }

    if (textPaths.length > 0) {
      const result = await openTextDocuments(textPaths, options);
      if (!mayApply()) return;
      openedAny ||= Boolean(result?.documents.length);
    }

    const backgroundTextPaths = structureAndTextPaths.filter((path) => openedStructureAndTextPaths.has(path));
    if (backgroundTextPaths.length > 0) {
      await openTextDocuments(backgroundTextPaths, { ...options, background: true });
      if (!mayApply()) return;
    }

    const unopenedStructureAndTextPaths = structureAndTextPaths.filter((path) => !openedStructureAndTextPaths.has(path));
    const fallbackDocumentPaths = unopenedStructureAndTextPaths.filter((path) => documentFallbackExtensions.has(pathExtension(path)));
    for (const path of fallbackDocumentPaths) {
      openDocumentTab(path); openedAny = true;
    }
    const fallbackTextPaths = unopenedStructureAndTextPaths.filter((path) => !documentFallbackExtensions.has(pathExtension(path)));
    if (fallbackTextPaths.length > 0) {
      const result = await openTextDocuments(fallbackTextPaths, options);
      if (!mayApply()) return;
      openedAny ||= Boolean(result?.documents.length);
    }
    if (preferredStructureDocumentId && !options.preserveActiveTab) {
      setActiveDocument(preferredStructureDocumentId);
    }
    if (options.requireSuccess && !openedAny) throw new Error("The file could not be opened. Check its format and contents.");
  }, [addProjectRoot, closeDocument, detectContentSpectrumPaths, expandStructureBundles, openDocuments, openDocumentTab, openSpectrumDocuments, openTextDocuments, pushErrorStatus, pushStatus, setActiveDocument, preferences, addDocuments, rememberRecentStructures]);

  const openPaths = useCallback(async (paths: string[], options: FileOpenOptions = {}) => {
    // Restore the selected file before classification/routing of the tail,
    // including when it is text or a spectrum rather than a molecular file.
    if (options.preferredPath && paths.includes(options.preferredPath)) {
      await openPathBatch([options.preferredPath], options);
      paths = paths.filter((path) => path !== options.preferredPath);
    }
    if (paths.length > 0) await openPathBatch(paths, options);
  }, [openPathBatch]);

  const openStructureRecordDocuments = useCallback(async (records: StructureDragRecord[]) => {
    const cleanRecords = records.filter((record) => record.text.trim().length > 0);
    if (cleanRecords.length === 0) return { opened: [], errors: [] };
    const opened: ViewerDocument[] = [];
    const errors: string[] = [];
    for (const record of cleanRecords) {
      try {
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title: record.path,
                extension: record.inputExtension,
                text: record.text,
              },
              preferences,
              reloadOptions: undefined,
            })
          : await openBrowserDevTextDocument(record.path, record.inputExtension, record.text, preferences);
        opened.push(document);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { opened, errors };
  }, [preferences]);

  const openStructureRecords = useCallback(async (records: StructureDragRecord[], directory?: string, options: { shouldApply?: () => boolean } = {}) => {
    const mayApply = () => options.shouldApply?.() !== false;
    if (!mayApply()) return [];
    if (directory) {
      try {
        const { paths, errors } = await saveStructureRecordsInFolder(records, directory);
        window.dispatchEvent(new Event("burette-folder-contents-changed"));
        if (paths.length && mayApply()) await openDocuments(paths);
        const message = `Saved ${paths.length} molecule file${paths.length === 1 ? "" : "s"} in ${directory}`;
        pushStatus(errors.length ? `${message}. ${summarizeErrors(errors)}` : message, errors.length ? "error" : "success", errors);
      } catch (error) { pushErrorStatus(error, "Could not save dropped molecules"); }
      return [];
    }
    pushStatus("Opening pasted structures...");
    const { opened, errors } = await openStructureRecordDocuments(records);
    if (!mayApply()) {
      await releaseUnadoptedStructures(opened);
      return [];
    }
    if (opened.length === 0 && errors.length === 0) return opened;
    if (opened.length > 0) {
      addDocuments(opened);
      rememberRecentStructures(opened);
    }
    const openedText = "Opened " + opened.length + " pasted structure" + (opened.length === 1 ? "" : "s");
    if (errors.length > 0) {
      pushStatus(opened.length > 0 ? `${openedText}. ${summarizeErrors(errors)}` : summarizeErrors(errors), "error", errors);
      return opened;
    }
    pushStatus(openedText);
    return opened;
  }, [addDocuments, openDocuments, openStructureRecordDocuments, pushErrorStatus, pushStatus, rememberRecentStructures]);

  const openStructureUrlInMolstar = useCallback(async (url: string) => {
    try {
      pushStatus("Fetching remote structure...");
      const remote = await fetchRemoteStructure(url);
      const molstarPreferences: ViewerPreferences = {
        ...preferences,
        rendererMode: "molstar",
      };
      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: {
              title: remote.title,
              extension: remote.extension,
              text: remote.text,
            },
            preferences: molstarPreferences,
            reloadOptions: undefined,
          })
        : await openBrowserDevTextDocument(remote.title, remote.extension, remote.text, molstarPreferences);
      addDocuments([document]);
      rememberRecentStructures([document]);
      setActiveDocument(document.id);
      pushStatus(`Opened ${remote.title}`, "success");
    } catch (error) {
      pushErrorStatus(error, "Fetch structure failed");
    }
  }, [addDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument]);

  const rebindSavedGridDocument = useCallback(async (documentId: string, path: string) => {
    if (!isTauriRuntime()) {
      throw new Error("Saved grid rebinding is available in the desktop app only.");
    }
    const extension = pathExtension(path);
    const gridPreferences = { ...preferences, rendererMode: "grid2d" as const };
    const replacement = extension === "csv" || extension === "tsv"
      ? await invoke<ViewerDocument>("open_delimited_grid_document", {
          request: { path, smilesColumn: "smiles" },
          preferences: gridPreferences,
          openStateRevision: currentDocumentRegistryRevision(),
        })
      : await invoke<OpenDocumentsResult>("open_documents", {
          paths: [path],
          preferences: gridPreferences,
          reloadOptions: undefined,
          mode: undefined,
          openStateRevision: currentDocumentRegistryRevision(),
        }).then((result) => {
          const document = result.documents[0];
          if (!document) {
            throw new Error(result.errors[0] ?? "The saved collection could not be reopened.");
          }
          return document;
        });
    try {
      replaceDocument(documentId, replacement);
    } catch (error) {
      void abortOpenDocumentClaims([replacement]).catch((abortError) => {
        console.warn("Open document claim abort failed", abortError);
      });
      throw error;
    }
    rememberRecentStructures([replacement]);
    return replacement;
  }, [preferences, rememberRecentStructures, replaceDocument]);

  return {
    openDocuments,
    openPaths,
    rebindSavedGridDocument,
    openStructureRecordDocuments,
    openStructureRecords,
    openStructureUrlInMolstar,
    openTextDocuments,
  };
}
