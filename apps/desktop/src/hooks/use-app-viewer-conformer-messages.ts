import { useCallback } from "react";
import { normalizeMolstarStylePreference, type ConformerGenerationMode, type MolstarStylePreference } from "../lib/conformer-generation";
import type { ViewerDocument } from "../types";

type ViewerConformerMessageBody = Record<string, unknown> | null | undefined;
type Generate3DConformer = (
  document: ViewerDocument,
  mode: ConformerGenerationMode,
  molstarStyle?: MolstarStylePreference | null,
) => Promise<unknown>;
type PostMessageToViewerSource = (source: MessageEventSource | null, payload: unknown) => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppViewerConformerMessagesOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  generate3DConformer: Generate3DConformer;
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
  postMessageToViewerSource,
  pushStatus,
}: UseAppViewerConformerMessagesOptions) {
  const handleViewerConformerMessage = useCallback((body: ViewerConformerMessageBody, source: MessageEventSource | null) => {
    if (body?.type !== "generate3dConformer") return false;

    const requestDocumentId = bodyString(body.documentId).trim() || null;
    const requestPath = bodyString(body.path).trim() || null;
    const mode: ConformerGenerationMode = body.mode === "ensemble" ? "ensemble" : "single";
    const molstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
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
      notifyGeneratorState("generate3dConformerStarted");
      void generate3DConformer(targetDocument, mode, molstarStyle)
        .finally(() => notifyGeneratorState("generate3dConformerFinished"));
    } else {
      notifyGeneratorState("generate3dConformerFinished");
      pushStatus("The Generate 3D request came from a tab that is no longer open.", "error");
    }
    return true;
  }, [activeDocument, documents, generate3DConformer, postMessageToViewerSource, pushStatus]);

  return { handleViewerConformerMessage };
}
