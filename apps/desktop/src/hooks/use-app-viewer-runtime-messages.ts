import { useCallback } from "react";
import { summarizeErrorText } from "../lib/file-routing";
import { markPerformanceOnce } from "../lib/performance";
import type { ViewerDocument, ViewerReloadOptions } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type RefValue<T> = { current: T };
type ViewerRuntimeMessageBody = Record<string, unknown> | null | undefined;

type UseAppViewerRuntimeMessagesOptions = {
  documents: ViewerDocument[];
  pendingViewerReloadDocumentIdRef: RefValue<string | null>;
  pendingViewerReloadOptionsRef: RefValue<ViewerReloadOptions | null>;
  pushStatus: PushStatus;
  reloadActive: () => Promise<void>;
  xyzrenderOrientationRefRef: RefValue<string | null>;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function bodyControls(value: unknown): ViewerReloadOptions["xyzrenderControls"] {
  return (value ?? null) as ViewerReloadOptions["xyzrenderControls"];
}

function formatViewerError(
  message: string | undefined,
  documentId: string | undefined,
  documents: { id: string; title: string }[],
) {
  const text = (message || "Viewer error").trim();
  const title = documentId
    ? documents.find((document) => document.id === documentId)?.title
    : null;
  const summary = summarizeErrorText(text);
  return title ? `${title}: ${summary}` : summary;
}

export function useAppViewerRuntimeMessages({
  documents,
  pendingViewerReloadDocumentIdRef,
  pendingViewerReloadOptionsRef,
  pushStatus,
  reloadActive,
  xyzrenderOrientationRefRef,
}: UseAppViewerRuntimeMessagesOptions) {
  const markViewerFirstRenderMessage = useCallback((sourceName: unknown, body: ViewerRuntimeMessageBody) => {
    if (
      sourceName === "burrete-viewer" &&
      (body?.type === "ready" || (body?.type === "status" && bodyString(body.message)?.startsWith("[web] Rendered ")))
    ) {
      markPerformanceOnce("viewer:first-render");
    }
  }, []);

  const handleViewerRuntimeMessage = useCallback((body: ViewerRuntimeMessageBody) => {
    if (body?.type === "error") {
      const message = bodyString(body.message);
      pushStatus(
        formatViewerError(message, bodyString(body.documentId), documents),
        "error",
        message ? [message] : [],
      );
      return true;
    }

    if (body?.type === "setXyzrenderOrientation") {
      xyzrenderOrientationRefRef.current = bodyString(body.text) ?? bodyString(body.value) ?? null;
      return true;
    }

    if (body?.type === "setXyzrenderPreset") {
      pendingViewerReloadDocumentIdRef.current = bodyString(body.documentId) ?? null;
      pendingViewerReloadOptionsRef.current = {
        xyzrenderPreset: bodyString(body.value) ?? null,
        xyzrenderOrientationRef: xyzrenderOrientationRefRef.current,
        xyzrenderControls: pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
      };
      void reloadActive();
      return true;
    }

    if (body?.type === "setXyzrenderControls") {
      pendingViewerReloadDocumentIdRef.current = bodyString(body.documentId) ?? null;
      pendingViewerReloadOptionsRef.current = {
        xyzrenderPreset: bodyString(body.preset) ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
        xyzrenderOrientationRef: xyzrenderOrientationRefRef.current,
        xyzrenderControls: bodyControls(body.controls),
      };
      void reloadActive();
      return true;
    }

    return false;
  }, [documents, pendingViewerReloadDocumentIdRef, pendingViewerReloadOptionsRef, pushStatus, reloadActive, xyzrenderOrientationRefRef]);

  return { handleViewerRuntimeMessage, markViewerFirstRenderMessage };
}
