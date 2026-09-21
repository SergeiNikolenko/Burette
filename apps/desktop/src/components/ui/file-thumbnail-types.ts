import type * as React from "react";

import type { ViewerErrorInfo } from "@/lib/viewer-errors";
import type { FileCategory, ViewerSource } from "@/lib/viewer-source";
import type { ThumbnailAnchor } from "@/components/file-thumbnail/types";

import type {
  FileThumbnailFrameProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailState,
  ThumbnailFile,
} from "./file-thumbnail-frame-types";

export type {
  FileThumbnailFrameProps,
  FileThumbnailShape,
  FileThumbnailSize,
  FileThumbnailState,
  ThumbnailFile,
} from "./file-thumbnail-frame-types";

export type FileThumbnailSource = ViewerSource | File;

export interface FileThumbnailProps
  extends Omit<FileThumbnailFrameProps, "file" | "onError"> {
  /** File metadata renders a static shell; a browser File renders a generated preview. */
  file?: ThumbnailFile | File;
  /** URL, Blob/File, or inline text source for generated file thumbnails. */
  source?: FileThumbnailSource;
  /** Override auto-detection when name or MIME type is missing or wrong. */
  as?: FileCategory;
  /** Corner pinned when rendered content overflows the frame. */
  anchor?: ThumbnailAnchor;
  /** Hide rich preview internals from assistive tech when the parent row owns the accessible name. */
  presentation?: "document" | "decorative";
  /** Change to retry a failed generated thumbnail for the same source. */
  retryKey?: React.Key;
  /** Receives generated thumbnail failures with canonical viewer error info. */
  onError?: (error: unknown, info: ViewerErrorInfo) => void;
}
