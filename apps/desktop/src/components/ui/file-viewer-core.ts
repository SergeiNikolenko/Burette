import {
  detectCategory,
  extensionOf,
  extractName,
  resolveViewerDescriptor,
  textPayloadKey,
  type FileCategory,
  type ViewerDescriptor,
  type ViewerSource,
} from "@/lib/viewer-source";

export type { FileCategory, ViewerSource };
export type FileViewerFallbackSize = { width: number; height: number };

export interface FileViewerCoreProps {
  source: ViewerSource;
  category?: FileCategory;
  className?: string;
  /** Intrinsic first-frame size for image/TIFF loading skeletons. */
  fallbackFrameSize?: FileViewerFallbackSize;
  /** Intrinsic first-slide size for PPTX loading skeletons. */
  fallbackSlideSize?: FileViewerFallbackSize;
  isolateStyles?: boolean;
}

export type FileDescriptor = ViewerDescriptor;

export function resolveFileDescriptor({
  source,
  category,
}: FileViewerCoreProps): FileDescriptor {
  return resolveViewerDescriptor({
    source,
    category,
  });
}

export function descriptorResetKey(descriptor: FileDescriptor): string {
  return [
    descriptorIdentityResetKey(descriptor),
    descriptor.displayName,
    descriptor.mimeType ?? "",
    descriptor.category,
  ].join("\u0000");
}

function descriptorIdentityResetKey(descriptor: FileDescriptor): string {
  if (
    descriptor.source.kind === "text" &&
    descriptor.source.identityKey == null
  ) {
    return textPayloadKey(descriptor.source.text);
  }
  return descriptor.identityKey;
}

export function isProseTextDescriptor(descriptor: FileDescriptor): boolean {
  if (descriptor.category !== "text") return false;

  const extension = extensionOf(descriptor.fileName);
  if (extension === "txt" || extension === "text") return true;
  return !extension && descriptor.mimeType?.toLowerCase() === "text/plain";
}

export { detectCategory, extensionOf, extractName };
