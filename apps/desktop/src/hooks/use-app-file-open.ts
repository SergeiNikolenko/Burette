import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import { showNativeContextMenu } from "../components/native-context-menu";
import type { FepNetworkLocation } from "../components/editor-area/page-kinds/fep-network";
import type { StatusKind } from "../components/types";
import { openBrowserDevDocuments, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import type { DockArea, DockTabKind } from "../lib/dock";
import {
  delimitedColumnChoiceLabel,
  isDelimitedColumnAmbiguity,
  isFepGraphmlPath,
  NOT_RENDERABLE_RENDERER,
  pathExtension,
  preferredTextExtensions,
  structureAndTextExtensions,
  structureExtensionFromPath,
  structureExtensions,
  summarizeErrors,
  type GridDelimitedColumnChoice,
} from "../lib/file-routing";
import { markPerformanceOnce } from "../lib/performance";
import { fetchRemoteStructure } from "../lib/remote-structure";
import { basename } from "../lib/sidebar-projects";
import type { StructureDragRecord } from "../lib/structure-drag";
import { readStructureText } from "../lib/structure-text";
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

type UseAppFileOpenOptions = {
  preferences: ViewerPreferences;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  addBackgroundTextDocuments: (documents: TextFileDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  addTextDocuments: (documents: TextFileDocument[]) => void;
  closeDocument: (id: string) => void;
  detectContentSpectrumPaths: (paths: string[]) => Promise<Set<string>>;
  expandStructureBundles: (paths: string[]) => Promise<string[]>;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openFepNetworkTab: (location: FepNetworkLocation) => void;
  openTextDocumentsInActiveTab: (documents: TextFileDocument[]) => void;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setActiveDocument: (id: string) => void;
  setDockActiveTab: (area: DockArea, kind: DockTabKind) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setDocuments: (documents: ViewerDocument[]) => void;
};

export function useAppFileOpen({
  preferences,
  addBackgroundDocuments,
  addBackgroundTextDocuments,
  addDocuments,
  addTextDocuments,
  closeDocument,
  detectContentSpectrumPaths,
  expandStructureBundles,
  openDockTab,
  openDocumentsInActiveTab,
  openFepNetworkTab,
  openTextDocumentsInActiveTab,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
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
      });
      if (replace) setDocuments([document]);
      else addDocuments([document]);
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
      );
    },
    [openDelimitedGridDocument, pushErrorStatus, pushStatus],
  );

  const openDocuments = useCallback(
    async (
      paths: string[],
      reloadOptions?: ViewerReloadOptions,
      preferencesOverride?: Partial<ViewerPreferences>,
      options: { replace?: boolean; inActiveTab?: boolean; mode?: OpenDocumentsMode } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return;
      const graphmlPaths = cleanPaths.filter(isFepGraphmlPath);
      const structurePaths = cleanPaths.filter((path) => !isFepGraphmlPath(path));
      if (graphmlPaths.length > 0) {
        try {
          for (const path of graphmlPaths) {
            const graphmlText = await readStructureText(path);
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
      const effectivePreferences = preferencesOverride ? { ...preferences, ...preferencesOverride } : preferences;
      pushStatus("Opening structures...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenDocumentsResult>("open_documents", { paths: structurePaths, preferences: effectivePreferences, reloadOptions, mode: options.mode })
          : await openBrowserDevDocuments(structurePaths, effectivePreferences, reloadOptions);
        if (options.replace) setDocuments(result.documents);
        else if (options.inActiveTab) openDocumentsInActiveTab(result.documents);
        else addDocuments(result.documents);
        if (!options.replace && !options.inActiveTab && result.documents[0]) {
          setActiveDocument(result.documents[0].id);
        }
        if (result.documents.length > 0) markPerformanceOnce("app:first-document-opened");
        rememberRecentStructures(result.documents);
        const openedText = "Opened " + result.documents.length + " structure" + (result.documents.length === 1 ? "" : "s");
        if (result.errors.length > 0) {
          pushStatus(`${openedText}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(openedText);
        }
        return result;
      } catch (error) {
        if (isTauriRuntime() && cleanPaths.length === 1 && isDelimitedColumnAmbiguity(error)) {
          void showDelimitedGridColumnOpenMenu(cleanPaths[0], effectivePreferences, options.replace === true)
            .catch((menuError) => pushErrorStatus(menuError, "Structure column menu failed"));
          return null;
        }
        pushErrorStatus(error);
        return null;
      }
    },
    [addDocuments, openDocumentsInActiveTab, openFepNetworkTab, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument, setDocuments, showDelimitedGridColumnOpenMenu],
  );

  const openTextDocuments = useCallback(
    async (
      paths: string[],
      options: { inActiveTab?: boolean; background?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening text files...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: cleanPaths })
          : await openBrowserDevTextFiles(cleanPaths);
        if (options.background) addBackgroundTextDocuments(result.documents);
        else if (options.inActiveTab) openTextDocumentsInActiveTab(result.documents);
        else addTextDocuments(result.documents);
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
      options: { inActiveTab?: boolean; background?: boolean } = {},
    ) => {
      const cleanPaths = Array.from(new Set(paths.filter(Boolean)));
      if (!cleanPaths.length) return null;
      pushStatus("Opening spectra...");
      try {
        const result = isTauriRuntime()
          ? await invoke<OpenTextFilesResult>("open_text_files", { paths: cleanPaths })
          : await openBrowserDevTextFiles(cleanPaths);
        const documents = result.documents.map(spectrumDocumentFromText);
        if (options.background) addBackgroundDocuments(documents);
        else if (options.inActiveTab) openDocumentsInActiveTab(documents);
        else addDocuments(documents);
        if (!options.background && !options.inActiveTab && documents[0]) {
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

  const openPaths = useCallback(async (paths: string[]) => {
    const cleanPaths = await expandStructureBundles(Array.from(new Set(paths.filter(Boolean))));
    if (!cleanPaths.length) return;

    const structurePaths: string[] = [];
    const spectrumPaths: string[] = [];
    const textPaths: string[] = [];
    const structureAndTextPaths: string[] = [];
    let preferredStructureDocumentId: string | null = null;
    const contentSpectrumPaths = await detectContentSpectrumPaths(cleanPaths);

    for (const path of cleanPaths) {
      const extension = pathExtension(path);
      if (isSpectrumPath(path, extension) || contentSpectrumPaths.has(path)) {
        spectrumPaths.push(path);
      } else if (
        preferredTextExtensions.has(extension)
        || (extension.length > 0 && !structureExtensions.has(extension) && !structureAndTextExtensions.has(extension))
      ) {
        textPaths.push(path);
      } else if (structureAndTextExtensions.has(extension)) {
        structureAndTextPaths.push(path);
      } else if (structureExtensions.has(extension)) {
        structurePaths.push(path);
      } else {
        textPaths.push(path);
      }
    }

    if (spectrumPaths.length > 0) {
      const result = await openSpectrumDocuments(spectrumPaths);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    if (structurePaths.length > 0) {
      const result = await openDocuments(structurePaths);
      preferredStructureDocumentId = result?.documents[0]?.id ?? preferredStructureDocumentId;
    }

    const openedStructureAndTextPaths = new Set<string>();
    if (structureAndTextPaths.length > 0) {
      const result = await openDocuments(structureAndTextPaths);
      const openedDocuments = result?.documents ?? [];
      for (const document of openedDocuments) {
        if (document.renderer === NOT_RENDERABLE_RENDERER) {
          closeDocument(document.id);
        } else {
          openedStructureAndTextPaths.add(document.path);
          preferredStructureDocumentId = preferredStructureDocumentId ?? document.id;
        }
      }
    }

    if (textPaths.length > 0) {
      await openTextDocuments(textPaths);
    }

    const backgroundTextPaths = structureAndTextPaths.filter((path) => openedStructureAndTextPaths.has(path));
    if (backgroundTextPaths.length > 0) {
      await openTextDocuments(backgroundTextPaths, { background: true });
    }

    const fallbackTextPaths = structureAndTextPaths.filter((path) => !openedStructureAndTextPaths.has(path));
    if (fallbackTextPaths.length > 0) {
      await openTextDocuments(fallbackTextPaths);
    }
    if (preferredStructureDocumentId) {
      setActiveDocument(preferredStructureDocumentId);
    }
  }, [closeDocument, detectContentSpectrumPaths, expandStructureBundles, openDocuments, openSpectrumDocuments, openTextDocuments, setActiveDocument]);

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

  const openStructureRecords = useCallback(async (records: StructureDragRecord[]) => {
    pushStatus("Opening pasted structures...");
    const { opened, errors } = await openStructureRecordDocuments(records);
    if (opened.length === 0 && errors.length === 0) return;
    if (opened.length > 0) {
      addDocuments(opened);
      rememberRecentStructures(opened);
    }
    const openedText = "Opened " + opened.length + " pasted structure" + (opened.length === 1 ? "" : "s");
    if (errors.length > 0) {
      pushStatus(opened.length > 0 ? `${openedText}. ${summarizeErrors(errors)}` : summarizeErrors(errors), "error", errors);
      return;
    }
    pushStatus(openedText);
  }, [addDocuments, openStructureRecordDocuments, pushStatus, rememberRecentStructures]);

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
      pushStatus(`Fetched ${remote.title} in Mol*`, "success");
    } catch (error) {
      pushErrorStatus(error, "Fetch structure failed");
    }
  }, [addDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures, setActiveDocument]);

  return {
    openDocuments,
    openPaths,
    openStructureRecordDocuments,
    openStructureRecords,
    openStructureUrlInMolstar,
    openTextDocuments,
  };
}
