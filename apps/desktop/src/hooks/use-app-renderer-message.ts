import { useCallback } from "react";
import type { ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type RefValue<T> = { current: T };
type RendererMessageBody = Record<string, unknown> | null | undefined;

type UseAppRendererMessageOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  openDocuments: (
    paths: string[],
    reloadOptions?: ViewerReloadOptions,
    preferences?: Partial<ViewerPreferences>,
    options?: { inActiveTab?: boolean },
  ) => Promise<unknown> | void;
  pendingViewerReloadDocumentIdRef: RefValue<string | null>;
  pendingViewerReloadOptionsRef: RefValue<ViewerReloadOptions | null>;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  skipNextPreferenceRefreshRef: RefValue<boolean>;
  xyzrenderOrientationRefRef: RefValue<string | null>;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function bodyActiveModel(value: unknown) {
  if (value == null || value === "") return null;
  const index = Number(value);
  return Number.isFinite(index) && index >= 0 ? Math.trunc(index) : null;
}

export function useAppRendererMessage({
  activeDocument,
  documents,
  openDocuments,
  pendingViewerReloadDocumentIdRef,
  pendingViewerReloadOptionsRef,
  setPreference,
  skipNextPreferenceRefreshRef,
  xyzrenderOrientationRefRef,
}: UseAppRendererMessageOptions) {
  const handleRendererMessage = useCallback((body: RendererMessageBody) => {
    if (body?.type !== "setRenderer") return false;
    const renderer = body.value;
    if (renderer === "auto" || renderer === "molstar" || renderer === "xyzrender-external") {
      const documentId = bodyString(body.documentId);
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null) ?? activeDocument;
      const orientationRef = bodyString(body.orientationRef);
      const preset = bodyString(body.preset);
      const activeModel = bodyActiveModel(body.activeModel);
      const reloadOptions = renderer === "xyzrender-external"
        ? {
            xyzrenderOrientationRef: orientationRef ?? xyzrenderOrientationRefRef.current,
            xyzrenderPreset: preset ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
            xyzrenderControls: body.controls ?? pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
            activeModel,
          }
        : renderer === "molstar"
          ? {}
          : undefined;
      if (renderer === "xyzrender-external" && orientationRef) {
        xyzrenderOrientationRefRef.current = orientationRef;
      }
      pendingViewerReloadOptionsRef.current = renderer === "xyzrender-external"
        ? {
            xyzrenderOrientationRef: orientationRef ?? xyzrenderOrientationRefRef.current,
            xyzrenderPreset: preset ?? pendingViewerReloadOptionsRef.current?.xyzrenderPreset ?? null,
            xyzrenderControls: body.controls ?? pendingViewerReloadOptionsRef.current?.xyzrenderControls ?? null,
            activeModel,
          }
        : null;
      pendingViewerReloadDocumentIdRef.current = renderer === "xyzrender-external"
        ? documentId ?? null
        : null;
      skipNextPreferenceRefreshRef.current = true;
      setPreference("rendererMode", renderer);
      if (targetDocument) {
        pendingViewerReloadOptionsRef.current = null;
        pendingViewerReloadDocumentIdRef.current = null;
        void openDocuments([targetDocument.path], reloadOptions, { rendererMode: renderer }, { inActiveTab: true });
      }
    }
    return true;
  }, [activeDocument, documents, openDocuments, pendingViewerReloadDocumentIdRef, pendingViewerReloadOptionsRef, setPreference, skipNextPreferenceRefreshRef, xyzrenderOrientationRefRef]);

  return { handleRendererMessage };
}
