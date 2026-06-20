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
import { isTauriRuntime } from "../lib/tauri";
import type { ActiveViewerIframeForDocument } from "../lib/viewer-bridge";
import type { ViewerDocument, ViewerPreferences } from "../types";

export type PendingMolstarReplaceResolver = (ok: boolean) => void;

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type OpenDocumentsInActiveTab = (
  documents: ViewerDocument[],
  options?: { backLocation?: { kind: "file"; documentId: string; path: string } },
) => void;

type UseAppGenerate3DConformerOptions = {
  activeViewerIframeForDocument: ActiveViewerIframeForDocument;
  openDocumentsInActiveTab: OpenDocumentsInActiveTab;
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
  openDocumentsInActiveTab,
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
    pushStatus(`Generating ${conformerGenerationTaskLabel(mode)} with ${preferences.conformerEngine.toUpperCase()}...`);
    try {
      const text = readBrowserDevVirtualTextDocument(document.path) ?? await readStructureText(document.path);
      const request = {
        title: document.title,
        extension: document.extension,
        text,
        ...conformerGenerationPreferences(preferences),
        mode,
        source3d: null,
      };
      const conformer = isTauriRuntime()
        ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
        : await generateBrowserDev3DConformer(request);
      const poseSetText = generated3DPoseSetText(text, document.extension, conformer.text, mode);
      const poseSetTitle = generated3DPoseSetTitle(document.title, poseSetText);
      const effectiveMolstarStyle = molstarStyle ?? preferences.molstarStyle;
      const molstarPreferences = { ...preferences, rendererMode: "molstar" as const, molstarStyle: effectiveMolstarStyle };
      const generatedDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: { title: poseSetTitle, extension: conformer.extension, text: poseSetText },
            preferences: molstarPreferences,
            reloadOptions: {},
          })
        : await openBrowserDevTextDocument(
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
  }, [activeViewerIframeForDocument, openDocumentsInActiveTab, pendingMolstarReplaceRef, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { generate3DConformer };
}
