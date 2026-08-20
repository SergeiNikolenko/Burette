"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

import { FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT } from "./file-viewer-elements";
import { createFileViewerAlignTranslateSurfaceMotionResolver } from "./file-viewer-fit-width-motion";
import {
  resolveFileViewerRendererLayoutInlineSize,
  type FileViewerDocumentAlign,
} from "./file-viewer-renderer-contract";
import {
  useOptionalFileViewerRendererEnvironment,
  useOptionalFileViewerRendererFrame,
} from "./file-viewer-renderer-frame";
import { MARKDOWN_GREENFIELD_CHUNK_MAX_INLINE_SIZE } from "./markdown-greenfield-layout";

export type MarkdownGreenfieldRendererFrame = {
  setDocumentSurfaceElement: React.RefCallback<HTMLDivElement>;
  transformOrigin: string;
  usesShellGeometry: boolean;
  viewportInlineSize: number;
};

export function useMarkdownGreenfieldRendererFrame({
  fallbackViewportInlineSize,
  onBeforeLayoutMotion,
}: {
  fallbackViewportInlineSize: number;
  onBeforeLayoutMotion: () => void;
}): MarkdownGreenfieldRendererFrame {
  const { registerDocumentSurface, usesShellGeometry } =
    useOptionalFileViewerRendererEnvironment();
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: fallbackViewportInlineSize,
  });
  const viewportInlineSize =
    resolveFileViewerRendererLayoutInlineSize({
      fallbackInlineSize: fallbackViewportInlineSize,
      rendererFrame,
    }) ?? fallbackViewportInlineSize;
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [surfaceElement, setSurfaceElement] =
    React.useState<HTMLDivElement | null>(null);
  const handleBeforeLayoutMotion = React.useCallback(() => {
    onBeforeLayoutMotion();
  }, [onBeforeLayoutMotion]);
  const setDocumentSurfaceElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      const previousElement = surfaceRef.current;
      if (previousElement === element) return;
      previousElement?.removeEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
      surfaceRef.current = element;
      setSurfaceElement((previous) =>
        previous === element ? previous : element,
      );
      if (!element) return;
      element.addEventListener(
        FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT,
        handleBeforeLayoutMotion,
      );
    },
    [handleBeforeLayoutMotion],
  );
  // Commit-then-relax's relax half. The canvas commits the motion's TARGET
  // width via minWidth from the first sliding frame, so on a widening pane
  // the centered chunks would recenter synchronously with the click; the
  // resolver translates them back to the live width's align margin and eases
  // to identity. The chunk column is CLAMPED (max inline size), not
  // fit-width — its content width does not scale with the pane — so the
  // reprojection is translate-only, never a scale.
  //
  // The align is the CHUNK COLUMN's, not rendererFrame.align: the shell
  // declares the document frame "start" (inert — the frame is w-full), while
  // the column centers itself inside the canvas by its own markup (left-1/2
  // -translate-x-1/2, physical and direction-independent). Deriving from the
  // shell align here made the resolver a silent no-op and the close-leg snap
  // survived it.
  const resolveSurfaceMotionStyle = React.useMemo(
    () =>
      createFileViewerAlignTranslateSurfaceMotionResolver({
        align: "center",
        direction: rendererFrame.direction,
        maxStageInlineSize: MARKDOWN_GREENFIELD_CHUNK_MAX_INLINE_SIZE,
      }),
    [rendererFrame.direction],
  );
  const documentSurfaceKey = surfaceElement
    ? joinEffectKey([
        "markdown-document-surface",
        surfaceElement,
        registerDocumentSurface,
        resolveSurfaceMotionStyle,
      ])
    : null;
  useKeyedLayoutEffect(documentSurfaceKey, () => {
    if (!surfaceElement) return;
    return registerDocumentSurface({
      element: surfaceElement,
      resolveMotionStyle: resolveSurfaceMotionStyle,
    });
  });

  return React.useMemo(
    () => ({
      setDocumentSurfaceElement,
      transformOrigin: getMarkdownGreenfieldDocumentTransformOrigin(
        rendererFrame.align,
      ),
      usesShellGeometry,
      viewportInlineSize,
    }),
    [
      rendererFrame.align,
      setDocumentSurfaceElement,
      usesShellGeometry,
      viewportInlineSize,
    ],
  );
}

function getMarkdownGreenfieldDocumentTransformOrigin(
  align: FileViewerDocumentAlign,
) {
  switch (align) {
    case "start":
      return "left top";
    case "end":
      return "right top";
    case "center":
      return "center top";
  }
}
