import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { generateBrowserDev3DConformer, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { conformerGenerationPreferences, generated3DPoseSetText, type ConformerGenerationResult } from "../lib/conformer-generation";
import { pathExtension } from "../lib/file-routing";
import { isTauriRuntime } from "../lib/tauri";
import { runConformerWorkflow, type ConformerVariant, type MmffVariant } from "../lib/compute-conformer";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";
import type { ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type GridConformerMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppGridConformerMessagesOptions = {
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openDocuments: (paths: string[], reloadOptions?: ViewerReloadOptions, preferencesOverride?: Partial<ViewerPreferences>) => Promise<unknown> | void;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  postMessageToViewerSource: PostMessageToViewerSource;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
};

type GridAlignmentResult = {
  runId: string;
  title: string;
  alignedSdf: string;
  scores: Array<{
    sourceIndex: number;
    name: string;
    isReference: boolean;
    rmsd: number;
    shapeTanimoto: number;
    electrostaticCarbo: number | null;
    combinedSimilarity: number;
  }>;
  gpuTimeMs: number;
  backend: "nativeMetal";
  mapping: string;
  chargeModel: string;
  gridApplied: boolean;
  reportPath: string | null;
};

type GridSemiempiricalResult = {
  runId: string;
  method: "RM1" | "AM1" | "PM3" | "PM6" | "PM6_D" | "PM6_D3H4" | "PM6_SP" | "AM1*";
  rows: Array<{
    sourceIndex: number;
    name: string;
    totalEnergyEv: number | null;
    converged: boolean;
    error: string | null;
  }>;
  hostTimeMs: number;
  gpuTimeMs: number;
  backend: "nativeMetalScfHybrid" | "nativeCpuReference";
  gridApplied: boolean;
  reportPath: string | null;
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
  openTextDocuments,
  postMessageToViewerSource,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
}: UseAppGridConformerMessagesOptions) {
  const handleGridConformerMessage = useCallback((body: GridConformerMessageBody, source: MessageEventSource | null) => {
    if (body?.type === "evaluateSemiempiricalGridSelection") {
      const documentId = bodyString(body.documentId).trim();
      const supportedMethods = ["RM1", "AM1", "PM3", "PM6", "PM6_D", "PM6_D3H4", "PM6_SP", "AM1_STAR"] as const;
      const requestedMethod = bodyString(body.method).trim().toUpperCase();
      const method = supportedMethods.find((candidate) => candidate === requestedMethod);
      const sourceIndexes = Array.isArray(body.sourceIndexes)
        ? [...new Set(body.sourceIndexes.filter((value): value is number => (
            Number.isSafeInteger(value) && value >= 0
          )))]
        : [];
      const reply = (type: "gridSemiempiricalStarted" | "gridSemiempiricalFinished" | "gridSemiempiricalError", payload: Record<string, unknown> = {}) => {
        postMessageToViewerSource(source, {
          source: "burrete-grid-host",
          body: { type, ...payload },
        });
      };
      if (!isTauriRuntime() || !documentId || sourceIndexes.length < 1 || !method) {
        const error = "Native semi-empirical evaluation requires a supported method and at least one selected desktop Grid row.";
        reply("gridSemiempiricalError", { error });
        pushStatus(error, "error");
        return true;
      }
      reply("gridSemiempiricalStarted");
      void invoke<GridSemiempiricalResult>("compute_evaluate_grid_semiempirical", {
        request: { documentId, sourceIndexes, method },
      }).then((result) => {
        if (result.reportPath) void openTextDocuments([result.reportPath], { background: true });
        const converged = result.rows.filter((row) => row.converged).length;
        const failed = result.rows.length - converged;
        const execution = result.backend === "nativeMetalScfHybrid"
          ? `with Metal SCF kernels (${result.gpuTimeMs.toLocaleString()} ms GPU, ${result.hostTimeMs.toLocaleString()} ms host)`
          : `on the CPU reference backend in ${result.hostTimeMs.toLocaleString()} ms`;
        pushStatus(
          `Calculated native ${result.method} energies and charges for ${converged.toLocaleString()} molecule${converged === 1 ? "" : "s"} ${execution}${failed ? `; ${failed.toLocaleString()} failed` : ""}; results were written to Grid.`,
          failed ? "error" : "success",
        );
        reply("gridSemiempiricalFinished", {
          runId: result.runId,
          moleculeCount: result.rows.length,
          convergedCount: converged,
          method: result.method,
          backend: result.backend,
        });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        reply("gridSemiempiricalError", { error: message });
        pushErrorStatus(error, `Grid ${method.replace("_STAR", "*")} evaluation failed`);
      });
      return true;
    }
    if (body?.type === "alignGridPoses") {
      const documentId = bodyString(body.documentId).trim();
      const sourceIndexes = Array.isArray(body.sourceIndexes)
        ? [...new Set(body.sourceIndexes.filter((value): value is number => (
            Number.isSafeInteger(value) && value >= 0
          )))]
        : [];
      const reply = (type: "gridAlignmentStarted" | "gridAlignmentFinished" | "gridAlignmentError", payload: Record<string, unknown> = {}) => {
        postMessageToViewerSource(source, {
          source: "burrete-grid-host",
          body: { type, ...payload },
        });
      };
      if (!isTauriRuntime() || !documentId || sourceIndexes.length < 2) {
        const error = "Native Metal pose alignment requires at least two selected rows in the desktop Grid.";
        reply("gridAlignmentError", { error });
        pushStatus(error, "error");
        return true;
      }
      reply("gridAlignmentStarted");
      void (async () => {
        const result = await invoke<GridAlignmentResult>("compute_align_grid_poses", {
          request: {
            documentId,
            sourceIndexes,
            maxMemoryBytes: 2 * 1_024 * 1_024 * 1_024,
          },
        });
        if (result.reportPath) void openTextDocuments([result.reportPath], { background: true });
        const document = await invoke<ViewerDocument>("open_text_structure", {
          request: {
            title: result.title,
            extension: "sdf",
            text: result.alignedSdf,
          },
          preferences: { ...preferences, rendererMode: "molstar" },
          reloadOptions: {},
        });
        openDocumentsInActiveTab([document]);
        rememberRecentStructures([document]);
        const compared = Math.max(0, result.scores.length - 1);
        pushStatus(
          `Aligned and scored ${compared.toLocaleString()} pose${compared === 1 ? "" : "s"} against the first selected row on Metal in ${result.gpuTimeMs.toLocaleString()} ms; scores were written to Grid.`,
          result.gridApplied ? "success" : "error",
        );
        reply("gridAlignmentFinished", {
          runId: result.runId,
          poseCount: result.scores.length,
          gpuTimeMs: result.gpuTimeMs,
          backend: result.backend,
        });
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        reply("gridAlignmentError", { error: message });
        pushErrorStatus(error, "Grid pose alignment failed");
      });
      return true;
    }
    if (body?.type !== "generate3dGridSelection" && body?.type !== "optimizeGeometryGridSelection") return false;

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
      const optimizeInputGeometry = body.type === "optimizeGeometryGridSelection";
      const documentId = bodyString(body.documentId).trim();
      const sourceIndexes = Array.isArray(body.sourceIndexes)
        ? [...new Set(body.sourceIndexes.filter((value): value is number => (
            Number.isSafeInteger(value) && value >= 0
          )))]
        : [];
      if (isTauriRuntime() && documentId && sourceIndexes.length > 0) {
        const conformerVariants: ConformerVariant[] = ["DG", "KDG", "ETDG", "ETDGv2", "ETKDG", "ETKDGv2", "ETKDGv3", "srETKDGv3"];
        const requestedConformerVariant = bodyString(body.conformerVariant) as ConformerVariant;
        const conformerVariant = conformerVariants.includes(requestedConformerVariant)
          ? requestedConformerVariant
          : "ETKDGv3";
        const requestedMmffVariant = bodyString(body.mmffVariant) as MmffVariant;
        const mmffVariant: MmffVariant = requestedMmffVariant === "MMFF94" ? "MMFF94" : "MMFF94s";
        const result = await runConformerWorkflow(documentId, sourceIndexes, (phase) => {
          const labels = {
            extracting: optimizeInputGeometry ? "Extracting input geometry and MMFF parameters..." : "Extracting conformer constraints...",
            embedding: optimizeInputGeometry ? `${mmffVariant}-optimizing input geometry...` : `Generating ${conformerVariant} and ${mmffVariant}-optimizing conformers...`,
            stereo: "Validating stereochemistry on Metal...",
            validation: "Checking CPU reference parity...",
            publishing: "Publishing conformers and updating Grid...",
          } as const;
          pushStatus(labels[phase]);
        }, {
          variant: conformerVariant,
          initialization: optimizeInputGeometry ? "inputGeometry" : "generated",
          mmffVariant,
          conformersPerMolecule: optimizeInputGeometry ? 1 : 16,
        });
        void openTextDocuments([result.reportPath], { background: true });
        await openDocuments(
          [result.primaryOpenPath],
          {},
          { rendererMode: "molstar" },
        );
        pushStatus(
          optimizeInputGeometry
            ? `Processed and validated ${result.passedCount.toLocaleString()} input geometries with ${mmffVariant} via Metal GPU; per-row convergence status and energy were written to Grid and the results opened in Molstar.`
            : `Generated ${conformerVariant} and ${mmffVariant}-ranked ${result.passedCount.toLocaleString()} valid conformers via Metal GPU and opened the ensemble in Molstar.`,
          result.gridApplied ? "success" : "error",
          result.gridWarning ? [result.gridWarning] : undefined,
        );
        return;
      }
      if (optimizeInputGeometry) {
        throw new Error("Input geometry optimization requires the native desktop Metal runtime.");
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
  }, [openDocuments, openDocumentsInActiveTab, openTextDocuments, postMessageToViewerSource, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { handleGridConformerMessage };
}
