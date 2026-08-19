import {
  isResourceError,
  ViewerFormatError,
  type ViewerFormat,
} from "@/lib/viewer-errors";
import type { FileCategory } from "@/lib/viewer-source";

export async function withThumbnailFormatError<T>(
  category: FileCategory,
  kind:
    | "decode_failed"
    | "load_failed"
    | "parse_failed"
    | "render_failed"
    | "unknown",
  fileName: string,
  message: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isResourceError(error)) throw error;
    throw new ViewerFormatError({
      format: thumbnailCategoryFormat(category),
      kind,
      message: `${message}: ${fileName}`,
      cause: error,
    });
  }
}

export function createThumbnailImageLoadError(): ViewerFormatError {
  return new ViewerFormatError({
    format: "image",
    kind: "load_failed",
    message: "Could not load image preview.",
  });
}

export function thumbnailCategoryFormat(category: FileCategory): ViewerFormat {
  if (category === "markdown" || category === "html" || category === "email") {
    return "text";
  }
  if (category === "unsupported") return "file";
  return category;
}
