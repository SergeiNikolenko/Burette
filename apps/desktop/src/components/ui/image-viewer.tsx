"use client";

import * as React from "react";

import {
  createFrameSource,
  isTiffBytes,
  type FrameDescriptor,
  type FrameSource,
} from "@/lib/image-frame-source";
import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";
import { ImageViewerFallback } from "@/components/ui/image-viewer-chrome";
import {
  getImageSource,
  ImageViewerContent,
  resetImageSourceCacheForTests,
} from "@/components/ui/image-viewer-content";
import type {
  ImageViewerHandle,
  ImageViewerProps,
} from "@/components/ui/image-viewer-types";
import { useIsClient } from "@/components/ui/use-is-client";
import { ViewerErrorBoundary } from "@/components/ui/viewer-error";

export type {
  ImageDocumentSource,
  ImageFrameOverlayProps,
  ImageFrameRenderTiming,
  ImageViewerHandle,
  ImageViewerProps,
} from "@/components/ui/image-viewer-types";
export type { FrameDescriptor, FrameSource };
export { getImageSource, resetImageSourceCacheForTests };

export type ImageResourceContentProps = Omit<ImageViewerProps, "source"> & {
  resource: ViewerResource;
};

export type ImageViewerProviderProps = {
  children: React.ReactNode;
  resource: ViewerResource;
};

export type ImageViewerFramesProps = Omit<
  ImageResourceContentProps,
  "resource"
>;

export const ImageViewer = React.forwardRef<
  ImageViewerHandle,
  ImageViewerProps
>(function ImageViewer(props, ref) {
  const { source, ...resourceProps } = props;
  const resource = React.useMemo(() => createViewerResource(source), [source]);
  return (
    <ImageResourceContent {...resourceProps} ref={ref} resource={resource} />
  );
});

export const ImageResourceContent = React.forwardRef<
  ImageViewerHandle,
  ImageResourceContentProps
>(function ImageResourceContent(props, ref) {
  const isClient = useIsClient();
  const resource = props.resource;
  if (!isClient) {
    return (
      <ImageViewerFallback
        bare={props.bare}
        className={props.className}
        fallbackFrameSize={props.fallbackFrameSize}
        scale={props.scale ?? props.defaultScale}
        controls={props.controls}
      />
    );
  }
  return (
    <ViewerErrorBoundary
      className={props.className}
      download={
        props.controls === false || props.download === false
          ? null
          : resource.originalDownload
      }
      format="image"
      resetKey={resource.keys.resource}
      sourceKind={resource.sourceKind}
    >
      <React.Suspense
        fallback={
          <ImageViewerFallback
            bare={props.bare}
            className={props.className}
            fallbackFrameSize={props.fallbackFrameSize}
            scale={props.scale ?? props.defaultScale}
            controls={props.controls}
          />
        }
      >
        <ImageViewerContent {...props} forwardedRef={ref} resource={resource} />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
});

const ImageViewerResourceContext = React.createContext<ViewerResource | null>(
  null,
);

export function ImageViewerProvider({
  children,
  resource,
}: ImageViewerProviderProps) {
  return (
    <ImageViewerResourceContext.Provider value={resource}>
      {children}
    </ImageViewerResourceContext.Provider>
  );
}

function useImageViewerResource(): ViewerResource {
  const resource = React.useContext(ImageViewerResourceContext);
  if (!resource) {
    throw new Error(
      "ImageViewerFrames must be used within ImageViewerProvider.",
    );
  }
  return resource;
}

export const ImageViewerFrames = React.forwardRef<
  ImageViewerHandle,
  ImageViewerFramesProps
>(function ImageViewerFrames(props, ref) {
  const resource = useImageViewerResource();
  return <ImageResourceContent {...props} ref={ref} resource={resource} />;
});

export function looksLikeTiff(
  src: string,
  contentType: string | null,
  bytes: ArrayBuffer,
): boolean {
  return isTiffBytes(src, contentType, bytes);
}

export function createImageSourceForTests(
  kind: "image" | "tiff",
  frames: readonly { width: number; height: number }[],
  decode: (frameIndex: number) => Promise<ImageBitmap>,
  onDispose?: (reason: Error) => void,
): FrameSource {
  return createFrameSource({
    kind: kind === "image" ? "native-image" : "tiff",
    frames: frames.map((frame) => ({
      intrinsicSize: { width: frame.width, height: frame.height },
    })),
    decode,
    maxDecodedFrames: 16,
    onDispose,
  });
}
