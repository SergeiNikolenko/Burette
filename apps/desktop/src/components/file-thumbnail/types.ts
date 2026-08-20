export type ThumbnailAnchor = "top-left" | "top-right" | "bottom-left";

/** Absolute-position classes that pin a covered element to its anchor corner. */
export const ANCHOR_CORNER: Record<ThumbnailAnchor, string> = {
  "top-left": "top-0 left-0",
  "top-right": "top-0 right-0",
  "bottom-left": "bottom-0 left-0",
};

/** `object-position` classes for the <img> cover path (raster images). */
export const ANCHOR_OBJECT_POSITION: Record<ThumbnailAnchor, string> = {
  "top-left": "object-left-top",
  "top-right": "object-right-top",
  "bottom-left": "object-left-bottom",
};
