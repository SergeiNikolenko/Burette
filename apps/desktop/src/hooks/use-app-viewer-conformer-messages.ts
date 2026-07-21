import { useCallback } from "react";
import { normalizeMolstarStylePreference, type ConformerGenerationMode, type MolstarStylePreference } from "../lib/conformer-generation";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";
import type { MolecularComputeOperation } from "../lib/standalone-compute";

type ViewerConformerMessageBody = Record<string, unknown> | null | undefined;
type Generate3DConformer = (
  document: ViewerDocument,
  mode: ConformerGenerationMode,
  molstarStyle?: MolstarStylePreference | null,
) => Promise<unknown>;
type RunMolecularCompute = (
  document: ViewerDocument,
  operation: MolecularComputeOperation,
  molstarStyle?: MolstarStylePreference | null,
) => Promise<unknown>;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppViewerConformerMessagesOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  generate3DConformer: Generate3DConformer;
  runMolecularCompute: RunMolecularCompute;
  postMessageToViewerSource: PostMessageToViewerSource;
  pushStatus: PushStatus;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useAppViewerConformerMessages({
  activeDocument,
  documents,
  generate3DConformer,
  runMolecularCompute,
  postMessageToViewerSource,
  pushStatus,
}: UseAppViewerConformerMessagesOptions) {
  const handleViewerConformerMessage = useCallback((body: ViewerConformerMessageBody, source: MessageEventSource | null) => {
    if (body?.type !== "generate3dConformer" && body?.type !== "molecularCompute") return false;

    const requestDocumentId = bodyString(body.documentId).trim() || null;
    const requestPath = bodyString(body.path).trim() || null;
    const mode: ConformerGenerationMode = body.mode === "ensemble" ? "ensemble" : "single";
    const molstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
    const operations: MolecularComputeOperation[] = ["generate3d", "generateEnsemble", "optimizeGeometry", "semiempiricalRm1", "alignPoses"];
    const requestedOperation = bodyString(body.operation) as MolecularComputeOperation;
    const operation: MolecularComputeOperation = body.type === "generate3dConformer"
      ? (mode === "ensemble" ? "generateEnsemble" : "generate3d")
      : operations.includes(requestedOperation) ? requestedOperation : "generate3d";
    const tracksConformerGeneration = operation === "generate3d" || operation === "generateEnsemble";
    const targetDocument = requestDocumentId
      ? documents.find((document) => document.id === requestDocumentId)
        ?? (requestPath ? documents.find((document) => document.path === requestPath) : undefined)
      : (requestPath ? documents.find((document) => document.path === requestPath) : undefined) ?? activeDocument;
    const notifyGeneratorState = (type: "generate3dConformerStarted" | "generate3dConformerFinished") => {
      postMessageToViewerSource(source, {
        source: "burrete-host",
        body: {
          type,
          documentId: targetDocument?.id ?? requestDocumentId ?? "",
          mode,
        },
      });
    };
    if (targetDocument) {
      if (tracksConformerGeneration) notifyGeneratorState("generate3dConformerStarted");
      const task = body.type === "molecularCompute"
        ? runMolecularCompute(targetDocument, operation, molstarStyle)
        : generate3DConformer(targetDocument, mode, molstarStyle);
      void task
        .finally(() => {
          if (tracksConformerGeneration) notifyGeneratorState("generate3dConformerFinished");
        });
    } else {
      if (tracksConformerGeneration) notifyGeneratorState("generate3dConformerFinished");
      pushStatus("The Generate 3D request came from a tab that is no longer open.", "error");
    }
    return true;
  }, [activeDocument, documents, generate3DConformer, postMessageToViewerSource, pushStatus, runMolecularCompute]);

  return { handleViewerConformerMessage };
}
