import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

type ViewerRuntimeFileMessageBody = Record<string, unknown> | null | undefined;

type UseAppViewerRuntimeFileMessagesOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  postMessageToViewerSource: PostMessageToViewerSource;
};

function normalizeViewerRuntimeRelativePath(path: unknown) {
  const normalized = String(path || "").replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

export function useAppViewerRuntimeFileMessages({
  activeDocument,
  documents,
  postMessageToViewerSource,
}: UseAppViewerRuntimeFileMessagesOptions) {
  const handleViewerRuntimeFileMessage = useCallback((
    sourceName: unknown,
    body: ViewerRuntimeFileMessageBody,
    source: MessageEventSource | null,
  ) => {
    if (sourceName !== "burette-viewer" || (body?.type !== "requestData" && body?.type !== "requestRuntimeFile")) {
      return false;
    }
    if (!body.requestToken) return true;

    const document = body.documentId
      ? documents.find((item) => item.id === body.documentId)
      : activeDocument;
    const reply = (payload: Record<string, unknown>) => {
      postMessageToViewerSource(source, {
        source: "burette-native-host",
        body: {
          type: body.type === "requestData" ? "nativeData" : "nativeRuntimeFile",
          documentId: body.documentId,
          payload,
        },
      });
    };

    void (async () => {
      try {
        if (!document) throw new Error("No matching viewer document.");
        const fileName = body.type === "requestData"
          ? "preview-data.bin"
          : normalizeViewerRuntimeRelativePath(body.path);
        if (!fileName) throw new Error("Invalid runtime file path.");
        const base64 = await invoke<string>("read_viewer_runtime_file_base64", {
          runtimePath: document.runtimePath,
          relativePath: fileName,
        });
        reply({ requestToken: body.requestToken, base64 });
      } catch (error) {
        reply({ requestToken: body.requestToken, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }, [activeDocument, documents, postMessageToViewerSource]);

  return { handleViewerRuntimeFileMessage };
}
