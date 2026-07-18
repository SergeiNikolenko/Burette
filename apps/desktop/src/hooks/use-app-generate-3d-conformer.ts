import { type MutableRefObject, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import { generateBrowserDev3DConformer, openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import {
  conformerGenerationPreferences,
  conformerGenerationTaskLabel,
  generated3DPoseSetText,
  generated3DPoseSetTitle,
  generated3DStatus,
  textToBase64,
  type ConformerGenerationMode,
  type ConformerGenerationResult,
  type MolstarStylePreference,
} from "../lib/conformer-generation";
import { readStructureText } from "../lib/structure-text";
import {
  runStandaloneAlignment,
  runStandaloneConformerWorkflow,
  runStandaloneSemiempirical,
  type MolecularComputeOperation,
} from "../lib/standalone-compute";
import { isTauriRuntime } from "../lib/tauri";
import type { ActiveViewerIframeForDocument } from "../lib/viewer-bridge";
import type { ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

export type PendingMolstarReplaceResolver = (ok: boolean) => void;

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type OpenDocumentsInActiveTab = (
  documents: ViewerDocument[],
  options?: { backLocation?: { kind: "file"; documentId: string; path: string } },
) => void;
type OpenDocuments = (
  paths: string[],
  reloadOptions?: ViewerReloadOptions,
  preferencesOverride?: Partial<ViewerPreferences>,
  options?: { replace?: boolean; inActiveTab?: boolean },
) => Promise<unknown> | void;

type UseAppGenerate3DConformerOptions = {
  activeViewerIframeForDocument: ActiveViewerIframeForDocument;
  openDocuments: OpenDocuments;
  openDocumentsInActiveTab: OpenDocumentsInActiveTab;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  pendingMolstarReplaceRef: MutableRefObject<Map<string, PendingMolstarReplaceResolver>>;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
};

function replaceMolstarStructureInPlace(
  sourceDocument: ViewerDocument,
  generatedDocument: ViewerDocument,
  conformer: ConformerGenerationResult,
  pendingReplacements: Map<string, PendingMolstarReplaceResolver>,
  molstarStyle: MolstarStylePreference,
  activeViewerIframeForDocument: ActiveViewerIframeForDocument,
) {
  if (sourceDocument.renderer !== "molstar") return Promise.resolve(false);
  const iframe = activeViewerIframeForDocument(sourceDocument.id);
  if (!iframe?.contentWindow) return Promise.resolve(false);
  const requestId = `molstar-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingReplacements.delete(requestId);
      resolve(false);
    }, 8000);
    pendingReplacements.set(requestId, (ok) => {
      window.clearTimeout(timeout);
      resolve(ok);
    });
    try {
      iframe.contentWindow?.postMessage({
        source: "burrete-host",
        body: {
          type: "replaceMolstarStructure",
          requestId,
          documentId: sourceDocument.id,
          title: conformer.title,
          extension: conformer.extension,
          path: generatedDocument.path,
          byteCount: new TextEncoder().encode(conformer.text).byteLength,
          textBase64: textToBase64(conformer.text),
          method: conformer.method,
          molstarStyle,
        },
      }, "*");
    } catch {
      window.clearTimeout(timeout);
      pendingReplacements.delete(requestId);
      resolve(false);
    }
  });
}

export function useAppGenerate3DConformer({
  activeViewerIframeForDocument,
  openDocuments,
  openDocumentsInActiveTab,
  openTextDocuments,
  pendingMolstarReplaceRef,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
}: UseAppGenerate3DConformerOptions) {
  const generate3DConformer = useCallback(async (
    document: ViewerDocument,
    mode: ConformerGenerationMode = "single",
    molstarStyle?: MolstarStylePreference | null,
  ) => {
    if (!["sdf", "sd", "mol", "smi", "smiles"].includes(document.extension.trim().toLowerCase())) {
      pushStatus("3D conformer generation supports SDF, MOL, and SMILES structures.", "error");
      return;
    }
    pushStatus(isTauriRuntime()
      ? `Starting native ${conformerGenerationTaskLabel(mode)} workflow...`
      : `Generating ${conformerGenerationTaskLabel(mode)} with ${preferences.conformerEngine.toUpperCase()}...`);
    try {
      const text = readBrowserDevVirtualTextDocument(document.path) ?? await readStructureText(document.path);
      if (isTauriRuntime()) {
        const result = await runStandaloneConformerWorkflow(
          { title: document.title, extension: document.extension, text },
          (phase) => {
            const labels = {
              extracting: "Preparing molecular constraints...",
              embedding: mode === "ensemble" ? "Generating and optimizing conformer ensemble on Metal..." : "Generating and optimizing 3D geometry on Metal...",
              stereo: "Validating stereochemistry on Metal...",
              validation: "Checking CPU reference parity...",
              publishing: "Publishing conformer artifact...",
            } as const;
            pushStatus(labels[phase]);
          },
          { conformersPerMolecule: mode === "ensemble" ? 16 : 1 },
        );
        void openTextDocuments([result.reportPath], { background: true });
        await openDocuments(
          [result.primaryOpenPath],
          {},
          { rendererMode: "molstar", molstarStyle: molstarStyle ?? preferences.molstarStyle },
          { inActiveTab: true },
        );
        const backend = result.backend === "nativeMetal" ? "Metal GPU" : "CPU reference fallback";
        pushStatus(
          `Generated ${result.passedCount.toLocaleString()} validated conformer${result.passedCount === 1 ? "" : "s"} via ${backend} and opened the artifact in Molstar.`,
          result.failedCount ? "error" : "success",
        );
        return;
      }
      const request = {
        title: document.title,
        extension: document.extension,
        text,
        ...conformerGenerationPreferences(preferences),
        mode,
        source3d: null,
      };
      const conformer = await generateBrowserDev3DConformer(request);
      const poseSetText = generated3DPoseSetText(text, document.extension, conformer.text, mode);
      const poseSetTitle = generated3DPoseSetTitle(document.title, poseSetText);
      const effectiveMolstarStyle = molstarStyle ?? preferences.molstarStyle;
      const molstarPreferences = { ...preferences, rendererMode: "molstar" as const, molstarStyle: effectiveMolstarStyle };
      const generatedDocument = await openBrowserDevTextDocument(
        poseSetTitle,
        conformer.extension,
        poseSetText,
        molstarPreferences,
        {},
      );
      const replacedInPlace = await replaceMolstarStructureInPlace(
        document,
        generatedDocument,
        { ...conformer, title: poseSetTitle, text: poseSetText },
        pendingMolstarReplaceRef.current,
        effectiveMolstarStyle,
        activeViewerIframeForDocument,
      );
      if (replacedInPlace) {
        if (!isTauriRuntime()) writeBrowserDevVirtualTextDocument(generatedDocument.path, poseSetText);
        openDocumentsInActiveTab([generatedDocument], {
          backLocation: { kind: "file", documentId: document.id, path: document.path },
        });
        rememberRecentStructures([generatedDocument]);
        pushStatus(generated3DStatus(conformer, "added it as a new Molstar pose"));
        return;
      }
      if (document.renderer === "molstar") {
        pushStatus(
          "3D conformer was generated, but the current Molstar viewer did not apply it in place. Reload the viewer tab once and try again.",
          "error",
        );
        return;
      }
      openDocumentsInActiveTab([generatedDocument]);
      rememberRecentStructures([generatedDocument]);
      pushStatus(generated3DStatus(conformer, "opened it in Molstar"));
    } catch (error) {
      pushErrorStatus(error, "3D conformer generation failed");
    }
  }, [activeViewerIframeForDocument, openDocuments, openDocumentsInActiveTab, openTextDocuments, pendingMolstarReplaceRef, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  const runMolecularCompute = useCallback(async (
    document: ViewerDocument,
    operation: MolecularComputeOperation,
    molstarStyle?: MolstarStylePreference | null,
  ) => {
    if (!isTauriRuntime()) {
      pushStatus("Native Metal compute is available in the desktop app; browser dev only previews the interface.", "error");
      return;
    }
    if (operation === "generate3d" || operation === "generateEnsemble") {
      await generate3DConformer(document, operation === "generateEnsemble" ? "ensemble" : "single", molstarStyle);
      return;
    }
    try {
      const text = await readStructureText(document.path);
      const source = { title: document.title, extension: document.extension, text };
      if (operation === "optimizeGeometry") {
        pushStatus("Optimizing the current 3D geometry with MMFF94s on Metal...");
        const result = await runStandaloneConformerWorkflow(source, (phase) => {
          if (phase === "validation") pushStatus("Checking optimized geometry against the CPU reference...");
        }, { initialization: "inputGeometry", conformersPerMolecule: 1 });
        void openTextDocuments([result.reportPath], { background: true });
        await openDocuments([result.primaryOpenPath], {}, { rendererMode: "molstar" }, { inActiveTab: true });
        pushStatus(`Optimized and validated ${result.passedCount.toLocaleString()} structure${result.passedCount === 1 ? "" : "s"}.`, result.failedCount ? "error" : "success");
        return;
      }
      if (operation === "semiempiricalRm1") {
        pushStatus("Calculating RM1 energy and charges...");
        const result = await runStandaloneSemiempirical(source, "RM1");
        if (result.reportPath) void openTextDocuments([result.reportPath], { background: false });
        const converged = result.rows.filter((row) => row.converged).length;
        const backend = result.backend === "nativeMetalScfHybrid" ? "Metal SCF kernels" : "CPU reference fallback";
        pushStatus(`RM1 converged for ${converged.toLocaleString()} structure${converged === 1 ? "" : "s"} via ${backend}; opened the report.`, converged === result.rows.length ? "success" : "error");
        return;
      }
      pushStatus("Aligning and scoring the pose ensemble on Metal...");
      const result = await runStandaloneAlignment(source);
      if (result.reportPath) void openTextDocuments([result.reportPath], { background: true });
      const alignedDocument = await invoke<ViewerDocument>("open_text_structure", {
        request: { title: result.title, extension: "sdf", text: result.alignedSdf },
        preferences: { ...preferences, rendererMode: "molstar" },
        reloadOptions: {},
      });
      openDocumentsInActiveTab([alignedDocument]);
      rememberRecentStructures([alignedDocument]);
      pushStatus(`Aligned and scored ${result.scores.length.toLocaleString()} poses on Metal; opened the aligned ensemble.`, "success");
    } catch (error) {
      pushErrorStatus(error, "Molecular compute failed");
    }
  }, [generate3DConformer, openDocuments, openDocumentsInActiveTab, openTextDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { generate3DConformer, runMolecularCompute };
}
