import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { generateBrowserDev3DConformer, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { conformerGenerationPreferences, type ConformerGenerationResult } from "../lib/conformer-generation";
import { pathExtension } from "../lib/file-routing";
import { isTauriRuntime } from "../lib/tauri";
import { runConformerWorkflow, type ConformerVariant, type MmffVariant } from "../lib/compute-conformer";
import { runStandaloneConformerWorkflow, type StandaloneComputeSource } from "../lib/standalone-compute";
import { statusErrorMessage } from "./use-app-status";
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

function conformerMolblock(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const end = lines.findIndex((line) => line.trim() === "M  END");
  return end >= 0 ? lines.slice(0, end + 1).join("\n").trimEnd() : "";
}

function standaloneGridConformerSource(
  title: string,
  molecules: unknown[],
): StandaloneComputeSource | null {
  const records = molecules.map((molecule) => {
    const item = molecule && typeof molecule === "object" ? molecule as Record<string, unknown> : {};
    const extension = bodyString(item.extension).trim().toLowerCase().replace(/^\./u, "");
    const textBase64 = bodyString(item.textBase64).trim();
    return textBase64 ? { extension, text: decodeBase64Text(textBase64) } : null;
  }).filter((record): record is { extension: string; text: string } => Boolean(record?.text.trim()));
  if (records.length !== molecules.length) return null;
  if (records.every((record) => record.extension === "smi" || record.extension === "smiles")) {
    return {
      title,
      extension: "smi",
      text: `${records.map((record) => record.text.trim()).join("\n")}\n`,
    };
  }
  if (records.every((record) => ["sdf", "sd", "mol"].includes(record.extension))) {
    return {
      title,
      extension: "sdf",
      text: records.map((record) => `${record.text.trimEnd().replace(/\n\$\$\$\$$/u, "")}\n$$$$\n`).join(""),
    };
  }
  return null;
}

export function useAppGridConformerMessages({
  openDocuments,
  openDocumentsInActiveTab,
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
          source: "burette-grid-host",
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
        const message = statusErrorMessage(error);
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
          source: "burette-grid-host",
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
        const message = statusErrorMessage(error);
        reply("gridAlignmentError", { error: message });
        pushErrorStatus(error, "Grid pose alignment failed");
      });
      return true;
    }
    if (body?.type !== "generate3dGridSelection" && body?.type !== "optimizeGeometryGridSelection") return false;

    const molecules = Array.isArray(body.molecules) ? body.molecules : [];
    const reply = (type: "gridGenerate3DStarted" | "gridGenerate3DFinished" | "gridGenerate3DError", payload: Record<string, unknown> = {}) => {
      postMessageToViewerSource(source, {
        source: "burette-grid-host",
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
        try {
          const source = standaloneGridConformerSource(bodyString(body.title).trim() || "selected-molecules-3d.sdf", molecules);
          if (!optimizeInputGeometry && !source) {
            throw new Error("The selected Grid rows use mixed structure formats.");
          }
          const result = optimizeInputGeometry
            ? await runConformerWorkflow(documentId, sourceIndexes, (phase) => {
                const labels = {
                  extracting: "Extracting input geometry and MMFF parameters...",
                  embedding: `${mmffVariant}-optimizing input geometry...`,
                  stereo: "Validating stereochemistry on Metal...",
                  validation: "Checking CPU reference parity...",
                  publishing: "Publishing optimized geometries and updating Grid...",
                } as const;
                pushStatus(labels[phase]);
              }, {
                variant: conformerVariant,
                initialization: "inputGeometry",
                mmffVariant,
                conformersPerMolecule: 1,
              })
            : await runStandaloneConformerWorkflow(source!, (phase) => {
                const labels = {
                  extracting: "Extracting conformer constraints...",
                  embedding: `Generating ${conformerVariant} and ${mmffVariant}-optimizing conformers...`,
                  stereo: "Validating stereochemistry on Metal...",
                  validation: "Checking CPU reference parity...",
                  publishing: "Publishing the generated conformer artifact...",
                } as const;
                pushStatus(labels[phase]);
              }, {
                variant: conformerVariant,
                initialization: "generated",
                mmffVariant,
                conformersPerMolecule: 1,
              });
          void openTextDocuments([result.reportPath], { background: true });
          if (!optimizeInputGeometry) {
            await openDocuments([result.primaryOpenPath], {}, {
              rendererMode: "molstar",
              molstarStyle: "ball-and-stick",
            });
          }
          pushStatus(
            optimizeInputGeometry
              ? `Processed and validated ${result.passedCount.toLocaleString()} input geometries with ${mmffVariant} via Metal GPU; per-row convergence status and energy were written to Grid.`
              : `Generated and ${mmffVariant}-optimized ${result.passedCount.toLocaleString()} valid 3D geometries with ${conformerVariant} via Metal GPU and opened the generated conformer artifact.`,
            optimizeInputGeometry ? (result.gridApplied ? "success" : "error") : (result.failedCount ? "error" : "success"),
            result.gridWarning ? [result.gridWarning] : undefined,
          );
          return;
        } catch (error) {
          if (optimizeInputGeometry) throw error;
          pushStatus(
            `Metal 3D generation failed; retrying the selected molecules with RDKit CPU. ${statusErrorMessage(error)}`,
          );
        }
      }
      if (optimizeInputGeometry) {
        throw new Error("Input geometry optimization requires the native desktop Metal runtime.");
      }
      let generatedCount = 0;
      const generatedStructures: Array<{ sourceIndex: number; molblock: string }> = [];
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
          generatedCount += 1;
          const molblock = conformerMolblock(conformer.text);
          const sourceIndex = Number(item.sourceIndex);
          if (molblock && Number.isSafeInteger(sourceIndex)) {
            generatedStructures.push({ sourceIndex, molblock });
          }
        } catch (error) {
          errors.push(`${itemTitle}: ${statusErrorMessage(error)}`);
        }
      }
      if (!generatedCount) {
        throw new Error(errors.length ? errors.join("; ") : "3D generation did not return any structures.");
      }
      if (!generatedStructures.length) {
        throw new Error("3D generation did not return a structure artifact.");
      }
      const generatedSdf = generatedStructures.map((structure) => [
        structure.molblock,
        ">  <Source Index>",
        String(structure.sourceIndex),
        "",
        "$$$$",
        "",
      ].join("\n")).join("");
      const title = bodyString(body.title).trim() || "selected-molecules-3d.sdf";
      const generatedDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
            request: { title, extension: "sdf", text: generatedSdf },
            preferences: { ...preferences, rendererMode: "molstar", molstarStyle: "ball-and-stick" },
            reloadOptions: {},
          })
        : await openBrowserDevTextDocument(
            title,
            "sdf",
            generatedSdf,
            { ...preferences, rendererMode: "molstar", molstarStyle: "ball-and-stick" },
          );
      openDocumentsInActiveTab([generatedDocument]);
      rememberRecentStructures([generatedDocument]);
      const suffix = errors.length ? ` ${errors.length} failed.` : "";
      pushStatus(`Generated 3D for ${generatedCount} molecule${generatedCount === 1 ? "" : "s"} and opened the generated conformer artifact.${suffix}`);
    })()
      .catch((error) => {
        reply("gridGenerate3DError", { error: statusErrorMessage(error) });
        pushErrorStatus(error, "Grid 3D generation failed");
      })
      .finally(() => reply("gridGenerate3DFinished"));
    return true;
  }, [openDocuments, openDocumentsInActiveTab, openTextDocuments, postMessageToViewerSource, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { handleGridConformerMessage };
}
