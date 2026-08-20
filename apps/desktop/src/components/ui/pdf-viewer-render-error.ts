import { ViewerFormatError } from "@/lib/viewer-errors";

export function toPdfRenderFailedError(error: unknown) {
  return new ViewerFormatError({
    format: "pdf",
    kind: "render_failed",
    message: "Failed to render PDF page.",
    cause: error,
  });
}
