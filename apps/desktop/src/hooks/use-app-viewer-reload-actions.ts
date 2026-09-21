import { useCallback, type MutableRefObject } from "react";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import type { OpenDocumentsResult, ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type OpenDocuments = (
  paths: string[],
  reloadOptions?: ViewerReloadOptions,
  preferencesOverride?: Partial<ViewerPreferences>,
  options?: { inActiveTab?: boolean },
) => Promise<OpenDocumentsResult | null | undefined>;

type UseAppViewerReloadActionsOptions = {
  activeDocument: ViewerDocument | null | undefined;
  documents: ViewerDocument[];
  openDocuments: OpenDocuments;
  pendingViewerReloadDocumentIdRef: MutableRefObject<string | null>;
  pendingViewerReloadOptionsRef: MutableRefObject<ViewerReloadOptions | null>;
  xyzrenderOrientationRefRef: MutableRefObject<string | null>;
};

export function useAppViewerReloadActions({
  activeDocument,
  documents,
  openDocuments,
  pendingViewerReloadDocumentIdRef,
  pendingViewerReloadOptionsRef,
  xyzrenderOrientationRefRef,
}: UseAppViewerReloadActionsOptions) {
  const reloadActive = useCallback(async () => {
    const targetDocument = (pendingViewerReloadDocumentIdRef.current
      ? documents.find((document) => document.id === pendingViewerReloadDocumentIdRef.current)
      : null) ?? activeDocument;
    if (!targetDocument) return;
    const reloadOptions = pendingViewerReloadOptionsRef.current ?? undefined;
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
    const preferences = reloadOptions?.xyzrenderControls || reloadOptions?.xyzrenderPreset
      ? { rendererMode: "xyzrender-external" as const }
      : undefined;
    await openDocuments([targetDocument.path], reloadOptions, preferences, { inActiveTab: true });
  }, [activeDocument, documents, openDocuments, pendingViewerReloadDocumentIdRef, pendingViewerReloadOptionsRef]);

  const reloadXyzrenderDocument = useCallback(async (document: ViewerDocument, reloadOptions: ViewerReloadOptions) => {
    const effectiveReloadOptions = {
      ...reloadOptions,
      xyzrenderOrientationRef: reloadOptions.xyzrenderOrientationRef ?? xyzrenderOrientationRefRef.current,
    };
    const iframe = activeViewerIframeForDocument(document.id);
    const canPatchXyzrenderIframe = iframe?.dataset.renderer === "xyzrender-external"
      || Boolean(iframe?.contentDocument?.querySelector(
        ".buret-external-artifact-root, .buret-xyzrender-sheet-item-base, .buret-external-artifact-object",
      ));
    if (iframe?.contentWindow && canPatchXyzrenderIframe) {
      iframe.contentWindow.postMessage({
        source: "burette-host",
        body: {
          type: "setXyzrenderControls",
          documentId: document.id,
          preset: effectiveReloadOptions.xyzrenderPreset ?? null,
          controls: effectiveReloadOptions.xyzrenderControls ?? null,
          selectionAction: effectiveReloadOptions.xyzrenderSelectionAction ?? null,
        },
      }, "*");
      return;
    }
    pendingViewerReloadDocumentIdRef.current = document.id;
    pendingViewerReloadOptionsRef.current = effectiveReloadOptions;
    await openDocuments([document.path], effectiveReloadOptions, { rendererMode: "xyzrender-external" }, { inActiveTab: true });
    pendingViewerReloadOptionsRef.current = null;
    pendingViewerReloadDocumentIdRef.current = null;
  }, [openDocuments, pendingViewerReloadDocumentIdRef, pendingViewerReloadOptionsRef, xyzrenderOrientationRefRef]);

  return {
    reloadActive,
    reloadXyzrenderDocument,
  };
}
