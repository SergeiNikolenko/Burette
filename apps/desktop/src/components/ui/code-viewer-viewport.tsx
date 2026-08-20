"use client";

import * as React from "react";

import { CODE_GUTTER_BACKGROUND } from "./code-viewer-projector";
import {
  CODE_VIEWER_BASE_FONT_PX,
  CODE_VIEWER_INITIAL_VIEWPORT_HEIGHT,
} from "./code-viewer-scale";
import {
  getCodePhysicalScrollSize,
  getCodeVirtualTotalSize,
} from "./code-viewer-virtualization";
import { ScrollArea } from "./scroll-area";

const CODE_VIEWER_DEFAULT_VIEWPORT_WIDTH = 800;

export function CodeViewerViewport({
  fontScale,
  gutterWidth,
  lineCount,
  lineHeight,
  onCopy,
  rowHostRef,
  viewportRef,
}: {
  fontScale: number;
  gutterWidth: string;
  lineCount: number;
  lineHeight: number;
  onCopy?: React.ClipboardEventHandler<HTMLPreElement>;
  rowHostRef: React.RefObject<HTMLPreElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const fontSize = `${CODE_VIEWER_BASE_FONT_PX * fontScale}px`;
  const totalSize = getCodeVirtualTotalSize({
    lineCount,
    lineHeight,
  });
  const physicalTotalSize = getCodePhysicalScrollSize({
    totalSize,
    viewportHeight: CODE_VIEWER_INITIAL_VIEWPORT_HEIGHT,
  });

  return (
    <div className="bg-background relative min-h-0 flex-1">
      {/* Fixed full-height gutter rail, behind the scrolling content: the
          line-number column and its divider always reach the bottom of the
          viewport and never move while scrolling, because it lives outside the
          scroll container. The per-row gutters paint the numbers — and mask
          horizontally-scrolled code — on top of it. The viewport itself is
          transparent so this shows through below the last line. */}
      <div
        aria-hidden
        data-code-gutter-rail=""
        className="pointer-events-none absolute inset-y-0 left-0 z-0 border-r font-mono"
        style={{
          width: gutterWidth,
          backgroundColor: CODE_GUTTER_BACKGROUND,
          fontSize,
        }}
      />
      <ScrollArea
        className="absolute inset-0 z-10"
        viewportProps={{ style: { overflowAnchor: "none" } }}
        viewportRef={viewportRef}
      >
        <div
          data-code-scroll-spacer=""
          className="relative w-max min-w-full font-mono"
          style={{
            contain: "layout style",
            fontSize,
            height: physicalTotalSize,
            lineHeight: `${lineHeight}px`,
            minWidth: CODE_VIEWER_DEFAULT_VIEWPORT_WIDTH,
          }}
        >
          <div
            aria-hidden
            data-code-render-offset=""
            style={{
              contain: "layout size",
              height: 0,
            }}
          />
          <div
            data-code-render-window=""
            className="w-full"
            style={{
              bottom: 0,
              contain: "layout style inline-size",
              display: "flex",
              flexDirection: "column",
              height: physicalTotalSize,
              isolation: "isolate",
              position: "sticky",
              top: 0,
            }}
          >
            <pre
              onCopy={onCopy}
              ref={rowHostRef}
              className="relative w-full"
              suppressHydrationWarning
              style={{
                fontSize,
                height: physicalTotalSize,
                lineHeight: `${lineHeight}px`,
              }}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
