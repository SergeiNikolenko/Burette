import type * as React from "react";

export interface ThumbnailFile {
  name: string;
  type: string;
}

export type FileThumbnailState = "loading" | "loaded" | "error";

export type FileThumbnailShape = "document" | "square";

export type FileThumbnailSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface FileThumbnailFrameProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /** The file being previewed. A browser `File` works too. */
  file: ThumbnailFile | File;
  /** Aspect ratio of the preview frame (width / height). Defaults to 3 / 4. */
  previewAspectRatio?: number;
  /** Common thumbnail geometry. Defaults to document unless previewAspectRatio is provided. */
  thumbnailShape?: FileThumbnailShape;
  /** Common thumbnail width token. Use className for custom dimensions. */
  thumbnailSize?: FileThumbnailSize;
  previewClassName?: string;
  /** Custom React preview (e.g. a rendered PDF page). Takes priority over the image. */
  previewContent?: React.ReactNode;
  /** Externally generated thumbnail image URL. */
  previewImageUrl?: string | null;
  /** Called when the browser image preview fails to load. */
  onPreviewError?: () => void;
  /** Explicit preview lifecycle. */
  state?: FileThumbnailState;
}
