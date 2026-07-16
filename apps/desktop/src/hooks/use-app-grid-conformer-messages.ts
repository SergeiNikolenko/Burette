import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { generateBrowserDev3DConformer, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { conformerGenerationPreferences, generated3DPoseSetText, type ConformerGenerationResult } from "../lib/conformer-generation";
import { pathExtension } from "../lib/file-routing";
import { isTauriRuntime } from "../lib/tauri";
import { runConformerWorkflow } from "../lib/compute-conformer";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";
import type { ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type GridConformerMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppGridConformerMessagesOptions = {
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openDocuments: (paths: string[], reloadOptions?: ViewerReloadOptions, preferencesOverride?: Partial<ViewerPreferences>) => Promise<unknown> | void;
  postMessageToViewerSource: PostMessageToViewerSource;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function decodeBase64Text(textBase64: string) {
  const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function useAppGridConformerMessages({
  openDocumentsInActiveTab,
  openDocuments,
  postMessageToViewerSource,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
}: UseAppGridConformerMessagesOptions) {
  const handleGridConformerMessage = useCallback((body: GridConformerMessageBody, source: MessageEventSource | null) => {
    if (body?.type !== "generate3dGridSelection") return false;

    const molecules = Array.isArray(body.molecules) ? body.molecules : [];
    const title = bodyString(body.title).trim() || "selected-3d-molecules.sdf";
    const reply = (type: "gridGenerate3DStarted" | "gridGenerate3DFinished" | "gridGenerate3DError", payload: Record<string, unknown> = {}) => {
      postMessageToViewerSource(source, {
        source: "burrete-grid-host",
        body: { type, ...payload },
      });
    };
    if (!molecules.length) {
      reply("gridGenerate3DError", { error: "Select one or more molecules before generating 3D." });
      pushStatus("Select one or more molecules before generating 3D.", "error");
      return true;
    }
    reply("gridGenerate3DStarted");
    void (async () => {
      const documentId = bodyString(body.documentId).trim();
      const sourceIndexes = Array.isArray(body.sourceIndexes)
        ? [...new Set(body.sourceIndexes.filter((value): value is number => (
            Number.isSafeInteger(value) && value >= 0
          )))]
        : [];
      if (isTauriRuntime() && documentId && sourceIndexes.length > 0) {
        const result = await runConformerWorkflow(documentId, sourceIndexes, (phase) => {
          const labels = {
            extracting: "Extracting ETKDG constraints...",
            embedding: "Generating conformers on Metal...",
            stereo: "Validating stereochemistry on Metal...",
            validation: "Checking CPU reference parity...",
            publishing: "Publishing conformers and updating Grid...",
          } as const;
          pushStatus(labels[phase]);
        });
        await openDocuments(
          [result.primaryOpenPath],
          {},
          { rendererMode: "molstar" },
        );
        const backend = result.backend === "nativeMetal" ? "Metal GPU" : "reference CPU";
        pushStatus(
          `Generated ${result.passedCount.toLocaleString()} valid conformers via ${backend} and opened the ensemble in Molstar.`,
          result.gridApplied ? "success" : "error",
          result.gridWarning ? [result.gridWarning] : undefined,
        );
        return;
      }
      const generatedTexts: string[] = [];
      const errors: string[] = [];
      for (const molecule of molecules) {
        const item = molecule && typeof molecule === "object" ? molecule as Record<string, unknown> : {};
        const itemTitle = bodyString(item.title).trim() || "molecule.smi";
        const extension = bodyString(item.extension).trim() || pathExtension(itemTitle);
        const textBase64 = bodyString(item.textBase64).trim();
        if (!textBase64) {
          errors.push(`${itemTitle}: empty structure text`);
          continue;
        }
        try {
          const text = decodeBase64Text(textBase64);
          const request = {
            title: itemTitle,
            extension,
            text,
            ...conformerGenerationPreferences(preferences),
            mode: "single" as const,
            source3d: null,
          };
          const conformer = isTauriRuntime()
            ? await invoke<ConformerGenerationResult>("generate_3d_conformer", { request })
            : await generateBrowserDev3DConformer(request);
          generatedTexts.push(generated3DPoseSetText(text, extension, conformer.text, "single").trimEnd());
        } catch (error) {
          errors.push(`${itemTitle}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!generatedTexts.length) {
        throw new Error(errors.length ? errors.join("; ") : "3D generation did not return any structures.");
      }
      const text = `${generatedTexts.join("\n")}\n`;
      const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
      const generatedDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: { title, extension: "sdf", text },
            preferences: molstarPreferences,
            reloadOptions: {},
          })
        : await openBrowserDevTextDocument(
            title,
            "sdf",
            text,
            molstarPreferences,
            {},
          );
      openDocumentsInActiveTab([generatedDocument]);
      rememberRecentStructures([generatedDocument]);
      const suffix = errors.length ? ` ${errors.length} failed.` : "";
      pushStatus(`Generated 3D for ${generatedTexts.length} molecule${generatedTexts.length === 1 ? "" : "s"} and opened it in Molstar.${suffix}`);
    })()
      .catch((error) => {
        reply("gridGenerate3DError", { error: error instanceof Error ? error.message : String(error) });
        pushErrorStatus(error, "Grid 3D generation failed");
      })
      .finally(() => reply("gridGenerate3DFinished"));
    return true;
  }, [openDocuments, openDocumentsInActiveTab, postMessageToViewerSource, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { handleGridConformerMessage };
}
