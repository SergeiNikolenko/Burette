"use client";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import {
  readPdfDocumentResource,
  releasePdfDocumentResource,
  retainPdfDocumentResource,
} from "@/lib/pdf-document-resource";
import type { ViewerResource } from "@/lib/viewer-resource";

import { joinEffectKey } from "@/lib/effect-key";

export function usePdfThumbnailDocument(resource: ViewerResource) {
  const content = resource.content;
  const doc = readPdfDocumentResource(content);

  const retainEffectKey = joinEffectKey([
    "pdf-thumbnail-document",
    content.sourceKind,
    content.key,
    doc,
  ]);
  useKeyedMountEffect(retainEffectKey, () => {
    retainPdfDocumentResource(content, doc);
    return () => releasePdfDocumentResource(content, doc);
  });

  return doc;
}
