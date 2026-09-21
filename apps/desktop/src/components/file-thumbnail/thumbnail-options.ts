import type { ViewerDescriptor } from "@/lib/viewer-source";

import { isTiffDescriptor } from "./descriptor";
import { thumbnailOption, type ThumbnailOption } from "./keys";
import {
  CSV_THUMBNAIL_MAX_COLUMNS,
  CSV_THUMBNAIL_MAX_ROWS,
  TEXT_THUMBNAIL_MAX_BYTES,
  TIFF_THUMBNAIL_TARGET_WIDTH,
  XLSX_THUMBNAIL_MAX_COLUMNS,
  XLSX_THUMBNAIL_MAX_ROWS,
} from "./thumbnail-limits";

export function getThumbnailOptions(
  descriptor: ViewerDescriptor,
): ThumbnailOption[] {
  switch (descriptor.category) {
    case "text":
    case "markdown":
    case "html":
      return [thumbnailOption("text-max-bytes", TEXT_THUMBNAIL_MAX_BYTES)];
    case "csv":
      return [
        thumbnailOption("text-max-bytes", TEXT_THUMBNAIL_MAX_BYTES),
        thumbnailOption("csv-max-rows", CSV_THUMBNAIL_MAX_ROWS),
        thumbnailOption("csv-max-columns", CSV_THUMBNAIL_MAX_COLUMNS),
      ];
    case "xlsx":
      return [
        thumbnailOption("xlsx-max-rows", XLSX_THUMBNAIL_MAX_ROWS),
        thumbnailOption("xlsx-max-columns", XLSX_THUMBNAIL_MAX_COLUMNS),
      ];
    case "image":
      return isTiffDescriptor(descriptor)
        ? [thumbnailOption("tiff-target-width", TIFF_THUMBNAIL_TARGET_WIDTH)]
        : [];
    default:
      return [];
  }
}
