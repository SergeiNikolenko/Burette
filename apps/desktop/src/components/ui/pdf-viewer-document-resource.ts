"use client";

import * as React from "react";

import {
  readPdfDocumentResource,
  readPdfPageResource,
  releasePdfDocumentResource,
  retainPdfDocumentResource,
} from "@/lib/pdf-document-resource";
import type { ViewerResource } from "@/lib/viewer-resource";
import { joinEffectKey } from "@/lib/effect-key";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import type { PdfPageSize } from "./pdf-viewer-types";

export type PdfDocument = ReturnType<typeof readPdfDocumentResource>;
export type PdfDocumentContent = ViewerResource["content"];

export function usePdfDocumentResource(content: PdfDocumentContent) {
  const document = readPdfDocumentResource(content);

  useKeyedMountEffect(joinEffectKey([content, document]), () => {
    retainPdfDocumentResource(content, document);
    return () => releasePdfDocumentResource(content, document);
  });

  return document;
}

export function usePdfFirstPageSize(document: PdfDocument): PdfPageSize {
  const firstPage = readPdfPageResource(document, 1);

  return React.useMemo<PdfPageSize>(() => {
    const viewport = firstPage.getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }, [firstPage]);
}

export function usePdfDocumentRotation(document: PdfDocument) {
  const [rotationState, setRotationState] = React.useState<{
    document: PdfDocument;
    value: number;
  }>(() => ({ document, value: 0 }));
  const rotation = Object.is(rotationState.document, document)
    ? rotationState.value
    : 0;
  const rotateClockwise = React.useCallback(() => {
    setRotationState((state) => ({
      document,
      value:
        ((Object.is(state.document, document) ? state.value : 0) + 90) % 360,
    }));
  }, [document]);

  return { rotation, rotateClockwise };
}
