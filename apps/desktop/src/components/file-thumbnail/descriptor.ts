import {
  extensionOf,
  resolveViewerDescriptor,
  type FileCategory,
  type ViewerDescriptor,
  type ViewerSource,
} from "@/lib/viewer-source";

export function resolveThumbnailDescriptor({
  source,
  as,
}: {
  source: ViewerSource;
  as?: FileCategory;
}): ViewerDescriptor {
  return resolveViewerDescriptor({ source, category: as });
}

export function isTiffDescriptor(descriptor: ViewerDescriptor): boolean {
  const mime = descriptor.mimeType?.toLowerCase().split(";")[0].trim();
  if (mime === "image/tiff" || mime === "image/tif") return true;
  const extension = extensionOf(descriptor.displayName);
  return extension === "tif" || extension === "tiff";
}
