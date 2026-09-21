import { toViewerErrorInfo, type ViewerErrorInfo } from "@/lib/viewer-errors";
import type { ViewerResource } from "@/lib/viewer-resource";
import type { ViewerDescriptor } from "@/lib/viewer-source";

import { thumbnailCategoryFormat } from "./thumbnail-errors";

export interface ThumbnailErrorState {
  renderKey: string;
  info: ViewerErrorInfo;
}

export function createThumbnailErrorState({
  renderKey,
  error,
  resource,
  descriptor,
}: {
  renderKey: string;
  error: unknown;
  resource: ViewerResource;
  descriptor: ViewerDescriptor;
}): ThumbnailErrorState {
  return {
    renderKey,
    info: toViewerErrorInfo(error, {
      format: thumbnailCategoryFormat(descriptor.category),
      sourceKind: resource.sourceKind,
      canDownload: !resource.originalDownload.isDisabled,
    }),
  };
}
