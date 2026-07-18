import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import type { KetcherImportRequest, KetcherSketchRequest, StatusKind } from "../components/types";
import type { KetcherLocation } from "../components/editor-area/page-kinds/ketcher";
import { openBrowserDevTextDocument, readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { downloadTextFile, exportDialogFilters, safeExportFileName, stableTextDocumentId } from "../lib/file-export";
import { pathExtension } from "../lib/file-routing";
import { ketcherDraftMolfileFromImportText, ketcherSource3DFromText, queueKetcherImportRequest } from "../lib/ketcher-workflow";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import { runStandaloneConformerWorkflow, runStandaloneSemiempirical } from "../lib/standalone-compute";
import type { MoleculeTab } from "../stores/molecule-store";
import type {
  TextFileDocument,
  ViewerDocument,
  ViewerPreferences,
  ViewerReloadOptions,
} from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenKetcherTab = (location?: KetcherLocation) => void;
type MergeMoleculeCollections = (targetPath: string | null, paths: string[]) => void | Promise<void>;
type OpenDocuments = (
  paths: string[],
  reloadOptions?: ViewerReloadOptions,
  preferencesOverride?: Partial<ViewerPreferences>,
  options?: { replace?: boolean; inActiveTab?: boolean },
) => Promise<unknown> | void;

type UseAppKetcherActionsOptions = {
  addDocuments: (documents: ViewerDocument[]) => void;
  addTextDocuments: (documents: TextFileDocument[]) => void;
  closeTab: (id: string) => void;
  mergeMoleculeCollections: MergeMoleculeCollections;
  openDocuments: OpenDocuments;
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  openKetcherTab: OpenKetcherTab;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setActiveDocument: (id: string) => void;
  setStructureDragActive: (active: boolean) => void;
  tabs: MoleculeTab[];
};

export function useAppKetcherActions({
  addDocuments,
  addTextDocuments,
  closeTab,
  mergeMoleculeCollections,
  openDocuments,
  openDocumentsInActiveTab,
  openTextDocuments,
  openKetcherTab,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  setActiveDocument,
  setStructureDragActive,
  tabs,
}: UseAppKetcherActionsOptions) {
  const [ketcherImportRequest, setKetcherImportRequest] = useState<KetcherImportRequest | null>(null);
  const [ketcherDraftMolfile, setKetcherDraftMolfile] = useState("");
  const ketcherImportSequenceRef = useRef(0);

  const openKetcher = useCallback(() => {
    openKetcherTab();
  }, [openKetcherTab]);

  const nextKetcherImportRequestId = useCallback(() => {
    const nextId = Math.max(ketcherImportSequenceRef.current + 1, Date.now());
    ketcherImportSequenceRef.current = nextId;
    return nextId;
  }, []);

  const openKetcherWithStructures = useCallback((paths: string[], fragments: KetcherImportRequest["fragments"] = []) => {
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    const virtualFragments: KetcherImportRequest["fragments"] = [];
    const readablePaths = cleanPaths.filter((path) => {
      const virtualText = readBrowserDevVirtualTextDocument(path);
      if (virtualText === null) return true;
      virtualFragments.push({
        title: basename(path),
        text: virtualText,
        source3d: ketcherSource3DFromText(basename(path), virtualText, pathExtension(path)),
      });
      return false;
    });
    const cleanFragments = [...(fragments?.filter((fragment) => fragment.text.trim()) ?? []), ...virtualFragments];
    if (readablePaths.length === 0 && cleanFragments.length === 0) return;
    const hasGridEditSource = cleanFragments.some((fragment) => fragment.source?.kind === "grid-row");
    if (!hasGridEditSource && readablePaths.length === 0 && cleanFragments.length === 1 && !cleanFragments[0]?.source3d) {
      const [fragment] = cleanFragments;
      const draftMolfile = ketcherDraftMolfileFromImportText(fragment.text);
      if (draftMolfile) {
        openKetcherTab({ kind: "ketcher", draftMolfile });
        setStructureDragActive(false);
        setKetcherDraftMolfile(draftMolfile);
        setKetcherImportRequest(null);
        pushStatus(`Opened ${fragment.title.trim() || "structure"} in Ketcher`);
        return;
      }
    }
    const request: KetcherImportRequest = {
      id: nextKetcherImportRequestId(),
      paths: readablePaths,
      fragments: cleanFragments,
    };
    queueKetcherImportRequest(request);
    setKetcherImportRequest(request);
    openKetcherTab({ kind: "ketcher", importRequestId: request.id, importRequest: request });
    setStructureDragActive(false);
    const count = readablePaths.length + cleanFragments.length;
    pushStatus(`Adding ${count} structure${count === 1 ? "" : "s"} to Ketcher`);
  }, [nextKetcherImportRequestId, openKetcherTab, pushStatus, setStructureDragActive]);

  const openKetcherExportRaw = useCallback((request: {
    title: string;
    extension: string;
    text: string;
  }) => {
    const title = safeExportFileName(request.title);
    const extension = request.extension.trim().toLowerCase().replace(/^\./u, "") || pathExtension(title) || "txt";
    const text = request.text;
    const id = stableTextDocumentId(`ketcher-export:${title}:${text}`);
    const document: TextFileDocument = {
      id,
      path: `burrete-ketcher-export://${id}/${title}`,
      title,
      extension,
      language: extension,
      byteCount: new TextEncoder().encode(text).byteLength,
      content: text,
      truncated: false,
      modifiedAt: Date.now(),
    };
    addTextDocuments([document]);
    pushStatus(`Opened ${title}`);
  }, [addTextDocuments, pushStatus]);

  const saveKetcherExportFile = useCallback(async (request: {
    title: string;
    extension: string;
    text: string;
  }) => {
    const title = safeExportFileName(request.title);
    if (!isTauriRuntime()) {
      downloadTextFile(title, request.text);
      pushStatus(`Saved ${title}`);
      return;
    }
    try {
      const outputPath = await save({
        defaultPath: title,
        filters: exportDialogFilters(title, "text/plain"),
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("save_text_as", { text: request.text, outputPath });
      pushStatus(`Saved ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Save Ketcher export failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openKetcherWithFragment = useCallback((title: string, text: string, source?: NonNullable<NonNullable<KetcherImportRequest["fragments"]>[number]["source"]>, extensionOverride?: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const cleanTitle = title.trim() || "structure";
    const source3d = ketcherSource3DFromText(cleanTitle, cleanText, source?.extension ?? extensionOverride ?? pathExtension(cleanTitle));
    const draftMolfile = source ? "" : ketcherDraftMolfileFromImportText(cleanText);
    if (!source && draftMolfile && !source3d) {
      openKetcherTab({ kind: "ketcher", draftMolfile });
      setStructureDragActive(false);
      setKetcherDraftMolfile(draftMolfile);
      setKetcherImportRequest(null);
      pushStatus(`Opened ${cleanTitle} in Ketcher`);
      return;
    }
    const request: KetcherImportRequest = {
      id: nextKetcherImportRequestId(),
      paths: [],
      fragments: [{
        title: cleanTitle,
        text,
        source3d,
        source: source
          ? {
              ...source,
              title: source.title.trim() || cleanTitle,
              extension: source.extension.trim().replace(/^\./u, "") || "sdf",
            }
          : undefined,
      }],
    };
    queueKetcherImportRequest(request);
    setKetcherImportRequest(request);
    openKetcherTab({ kind: "ketcher", importRequestId: request.id, importRequest: request });
    setStructureDragActive(false);
    pushStatus(`Adding ${cleanTitle} to Ketcher`);
  }, [nextKetcherImportRequestId, openKetcherTab, pushStatus, setStructureDragActive]);

  const applyKetcherToGridRow = useCallback((request: {
    documentId: string;
    rowIndex: number;
    title: string;
    extension: string;
    text: string;
  }) => {
    const ketcherTabId = tabs.find((tab) => tab.location.kind === "ketcher")?.id ?? null;
    const iframe = document.querySelector<HTMLIFrameElement>(`.viewer-iframe[data-document-id="${CSS.escape(request.documentId)}"]`);
    if (!iframe?.contentWindow) {
      pushStatus("Grid edit target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridApplyKetcherRow",
        documentId: request.documentId,
        rowIndex: request.rowIndex,
        title: request.title,
        extension: request.extension,
        text: request.text,
      },
    }, "*");
    if (ketcherTabId) {
      window.setTimeout(() => {
        setActiveDocument(request.documentId);
        closeTab(ketcherTabId);
      }, 0);
    }
    pushStatus("Applied Ketcher edit to grid");
  }, [closeTab, pushStatus, setActiveDocument, tabs]);

  const clearKetcherImportRequest = useCallback((id: number) => {
    setKetcherImportRequest((request) => (request?.id === id ? null : request));
  }, []);

  const openKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    const rendererMode: ViewerPreferences["rendererMode"] = request.target === "grid"
      ? "grid2d"
      : ["molstar", "generate3d", "generateEnsemble", "optimizeGeometry", "semiempiricalRm1"].includes(request.target)
      ? "molstar"
      : request.target === "xyzrender"
        ? "xyzrender-external"
        : "auto";
    const reloadOptions = request.target === "collection" ? undefined : {};
    const effectivePreferences = { ...preferences, rendererMode };
    pushStatus("Opening Ketcher sketch...");
    try {
      if (request.target === "collection" && request.collectionTargetPath) {
        if (isTauriRuntime()) {
          const document = await invoke<ViewerDocument>("append_to_molecule_collection", {
            request: {
              targetPath: request.collectionTargetPath,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
          });
          openDocumentsInActiveTab([document]);
          rememberRecentStructures([document]);
          pushStatus(`Added Ketcher sketch to ${basename(document.path)}`);
          return;
        }

        const sketchDocument = await openBrowserDevTextDocument(
          request.title,
          request.extension,
          request.text,
          effectivePreferences,
          reloadOptions,
        );
        await mergeMoleculeCollections(request.collectionTargetPath, [sketchDocument.path]);
        return;
      }
      if (request.target === "collection") {
        if (isTauriRuntime()) {
          const outputPath = await save({
            defaultPath: "ketcher-collection.sdf",
            filters: [{ name: "SDF collections", extensions: ["sdf", "sd"] }],
          });
          if (!outputPath) {
            pushStatus("New collection canceled");
            return;
          }
          const document = await invoke<ViewerDocument>("create_molecule_collection", {
            request: {
              outputPath,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
          });
          openDocumentsInActiveTab([document]);
          rememberRecentStructures([document]);
          pushStatus(`Created ${basename(document.path)}`);
          return;
        }

        const document = await openBrowserDevTextDocument(
          "ketcher-collection.sdf",
          request.extension,
          request.text,
          effectivePreferences,
          reloadOptions,
        );
        openDocumentsInActiveTab([document]);
        downloadTextFile("ketcher-collection.sdf", request.text);
        pushStatus("Created ketcher-collection.sdf");
        return;
      }

      if (["generate3d", "generateEnsemble", "optimizeGeometry", "semiempiricalRm1"].includes(request.target)) {
        if (!isTauriRuntime()) {
          pushStatus("Native Metal compute is available in the desktop app; browser dev only previews the interface.", "error");
          return;
        }
        const usesInputGeometry = request.target === "optimizeGeometry" || request.target === "semiempiricalRm1";
        const source3d = usesInputGeometry ? request.source3d : null;
        if (usesInputGeometry && !source3d) {
          pushStatus("Import a structure with 3D coordinates before running this operation.", "error");
          return;
        }
        const source = source3d
          ? { title: source3d.title, extension: source3d.extension, text: source3d.text }
          : { title: request.title, extension: request.extension, text: request.text };
        if (request.target === "semiempiricalRm1") {
          pushStatus("Calculating RM1 energy and charges...");
          const result = await runStandaloneSemiempirical(source, "RM1");
          if (result.reportPath) void openTextDocuments([result.reportPath], { background: false });
          const converged = result.rows.filter((row) => row.converged).length;
          pushStatus(`RM1 converged for ${converged.toLocaleString()} structure${converged === 1 ? "" : "s"}; opened the report.`, converged === result.rows.length ? "success" : "error");
          return;
        }
        const ensemble = request.target === "generateEnsemble";
        const optimize = request.target === "optimizeGeometry";
        pushStatus(optimize ? "Optimizing current 3D geometry with MMFF94s..." : ensemble ? "Generating conformer ensemble..." : "Generating 3D geometry...");
        const result = await runStandaloneConformerWorkflow(source, (phase) => {
          if (phase === "validation") pushStatus("Checking native result against the CPU reference...");
        }, {
          initialization: optimize ? "inputGeometry" : "generated",
          conformersPerMolecule: ensemble ? 16 : 1,
        });
        void openTextDocuments([result.reportPath], { background: true });
        await openDocuments([result.primaryOpenPath], {}, effectivePreferences, { inActiveTab: true });
        const backend = result.backend === "nativeMetal" ? "Metal GPU" : "CPU reference fallback";
        pushStatus(`${optimize ? "Optimized" : "Generated"} ${result.passedCount.toLocaleString()} validated structure${result.passedCount === 1 ? "" : "s"} via ${backend}.`, result.failedCount ? "error" : "success");
        return;
      }

      const document = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: {
              title: request.title,
              extension: request.extension,
              text: request.text,
            },
            preferences: effectivePreferences,
            reloadOptions,
          })
        : await openBrowserDevTextDocument(
            request.title,
            request.extension,
            request.text,
            effectivePreferences,
            reloadOptions,
          );
      addDocuments([document]);
      rememberRecentStructures([document]);
      pushStatus(
        `Opened Ketcher sketch in ${request.target === "grid" ? "grid" : request.target === "molstar" ? "Molstar" : "xyzrender"}`,
      );
    } catch (error) {
      pushErrorStatus(error, "Open Ketcher sketch failed");
      throw error;
    }
  }, [addDocuments, mergeMoleculeCollections, openDocuments, openDocumentsInActiveTab, openTextDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return {
    applyKetcherToGridRow,
    clearKetcherImportRequest,
    ketcherDraftMolfile,
    ketcherImportRequest,
    openKetcher,
    openKetcherExportRaw,
    openKetcherSketch,
    openKetcherWithFragment,
    openKetcherWithStructures,
    saveKetcherDraft: setKetcherDraftMolfile,
    saveKetcherExportFile,
  };
}
