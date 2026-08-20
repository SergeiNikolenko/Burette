"use client";

import * as React from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

import type { ViewerResource } from "@/lib/viewer-resource";

import { ScrollArea } from "./scroll-area";
import { TextViewerControls, TextViewerFrame } from "./text-viewer-chrome";
import {
  createPreparedTextDocument,
  getCodeVisibleLineWindow,
  getInlineVisibleLineWindow,
  getTableVisibleRowWindow,
  layoutTextDocument,
  materializeCodeVisibleLines,
  materializeInlineVisibleLines,
  resolveTextViewerMode,
  serializeMarkdownTableForClipboard,
  textFrameIntersectsLineRange,
  type CodeTextBlockFrame,
  type ImageTextBlockFrame,
  type InlineTextBlockFrame,
  type PreparedCodeTextBlock,
  type PreparedImageTextBlock,
  type PreparedInlineTextBlock,
  type PreparedRuleTextBlock,
  type PreparedTableCell,
  type PreparedTableTextBlock,
  type PreparedTextBlock,
  type RuleTextBlockFrame,
  type TableTextBlockFrame,
  type TextBlockFrame,
  type TextDocumentFrame,
} from "./text-viewer-layout";
import { isLineInRange, normalizeTextLineRange } from "./text-viewer-ranges";
import {
  readTextDocument,
  resolvedTextViewerBounds,
} from "./text-viewer-resource";
import { clampTextViewerScale } from "./text-viewer-scale";
import type { TextViewerHandle, TextViewerProps } from "./text-viewer-types";
import {
  getTextFrameScrollAnchor,
  getTextFrameVirtualItems,
  getTextInverseStickyWindow,
  type TextFrameScrollAnchor,
  type TextInverseStickyWindow,
} from "./text-viewer-virtualization";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import { patchKeyedDomChildren } from "./text-viewer-dom-projection";
import { useTextViewerScrollInteractions } from "./text-viewer-scroll-interactions";
import { resolveFileViewerRendererLayoutInlineSize } from "./file-viewer-renderer-contract";
import {
  useOptionalFileViewerRendererEnvironment,
  useOptionalFileViewerRendererFrame,
} from "./file-viewer-renderer-frame";

const TEXT_VIEWER_HORIZONTAL_PADDING = 16;
const TEXT_VIEWER_DEFAULT_VIEWPORT_HEIGHT = 600;
const TEXT_VIEWER_DEFAULT_VIEWPORT_WIDTH = 800;
const TEXT_VIEWER_INITIAL_TEXT_WIDTH = 768;
const TEXT_VIEWER_OVERSCAN_PX = 800;
const TEXT_VIEWER_HIGHLIGHT_BACKGROUND =
  "color-mix(in oklab, var(--foreground) 8%, var(--background))";
const TEXT_VIEWER_HIGHLIGHT_ACCENT_SHADOW = "inset 2px 0 0 0 var(--primary)";
const TEXT_VIEWER_MAX_RECYCLED_ROWS = 512;
const TEXT_VIEWER_NATIVE_FIND_CHUNK_SIZE = 128;

type CachedRow = {
  renderKey: string;
  row: HTMLDivElement;
  visibleWindowKey: string;
};

type ProjectionWindow = {
  after: HTMLDivElement;
  before: HTMLDivElement;
  content: HTMLDivElement;
  sticky: HTMLDivElement;
};

export type TextProjectionMetrics = {
  noops: number;
  projections: number;
  rowContentPatches: number;
  rowLayoutPatches: number;
  rowPoolSize: number;
  rowsCreated: number;
  rowsDropped: number;
  rowsRemoved: number;
  rowsReused: number;
  visibleEnd: number;
  visibleStart: number;
};

export type ProjectionCache = {
  canvas: HTMLDivElement | null;
  frame: TextDocumentFrame | null;
  hasProjection: boolean;
  metrics?: TextProjectionMetrics;
  mountedEnd: number;
  mountedStart: number;
  preparedDocument: ReturnType<typeof createPreparedTextDocument> | null;
  projectionWindow: ProjectionWindow | null;
  recycledRows: CachedRow[];
  rows: Array<CachedRow | undefined>;
};

type ProjectionState = {
  cache: ProjectionCache;
  canvas: HTMLDivElement | null;
  contentWidth: number;
  frame: TextDocumentFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
  preparedDocument: ReturnType<typeof createPreparedTextDocument>;
  viewportHeight: number;
};

type ViewportSize = {
  height: number;
  width: number;
};

type NativeFindTextChunk = {
  endLine: number;
  startLine: number;
  text: string;
};

type TextIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

export function createTextProjectionMetrics(): TextProjectionMetrics {
  return {
    noops: 0,
    projections: 0,
    rowContentPatches: 0,
    rowLayoutPatches: 0,
    rowPoolSize: 0,
    rowsCreated: 0,
    rowsDropped: 0,
    rowsRemoved: 0,
    rowsReused: 0,
    visibleEnd: 0,
    visibleStart: 0,
  };
}

export function createTextProjectionCache({
  metrics,
}: {
  metrics?: TextProjectionMetrics;
} = {}): ProjectionCache {
  return {
    canvas: null,
    frame: null,
    hasProjection: false,
    metrics,
    mountedEnd: 0,
    mountedStart: 0,
    preparedDocument: null,
    projectionWindow: null,
    recycledRows: [],
    rows: [],
  };
}

export function TextViewerContent({
  resource,
  className,
  controls = true,
  download = true,
  highlight,
  bare = false,
  maxBytes,
  maxLines,
  retryVersion,
  forwardedRef,
  mode: forcedMode,
  projection = "chenglou",
}: Omit<TextViewerProps, "source"> & {
  resource: ViewerResource;
  retryVersion: number;
  forwardedRef?: React.ForwardedRef<TextViewerHandle>;
  projection?: "chenglou" | "vanillacheng";
}) {
  const bounds = React.useMemo(
    () => resolvedTextViewerBounds({ maxBytes, maxLines }),
    [maxBytes, maxLines],
  );
  const textDocument = React.useMemo(
    () =>
      readTextDocument({
        bounds,
        content: resource.content,
        retryVersion,
      }),
    [bounds, resource.content, retryVersion],
  );
  const text = textDocument.text;
  const textLines = textDocument.lines;
  const mode = React.useMemo(
    () =>
      forcedMode ??
      resolveTextViewerMode({
        fileName: resource.fileName,
        mimeType: resource.content.mimeType,
      }),
    [forcedMode, resource.content.mimeType, resource.fileName],
  );
  const downloadAction = download ? resource.originalDownload : null;
  const [fontScale, setFontScale] = React.useState(1);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const projectionCacheRef = React.useRef<ProjectionCache>(
    createTextProjectionCache(),
  );
  const pendingScrollAnchorRef = React.useRef<TextFrameScrollAnchor | null>(
    null,
  );
  const projectionStateRef = React.useRef<ProjectionState | null>(null);
  const scheduledRenderRef = React.useRef<number | null>(null);
  const fontEpoch = useTextViewerFontEpoch();
  const [contentWidth, setContentWidth] = React.useState(
    TEXT_VIEWER_INITIAL_TEXT_WIDTH,
  );
  const [viewportSize, setViewportSize] = React.useState<ViewportSize>({
    height: 0,
    width: 0,
  });
  const { usesShellGeometry } = useOptionalFileViewerRendererEnvironment();
  const rendererFrame = useOptionalFileViewerRendererFrame({
    fallbackInlineSize: viewportSize.width || null,
  });
  const viewportHeight =
    viewportSize.height || TEXT_VIEWER_DEFAULT_VIEWPORT_HEIGHT;
  const measuredViewportWidth =
    viewportSize.width || TEXT_VIEWER_DEFAULT_VIEWPORT_WIDTH;
  const viewportWidth = usesShellGeometry
    ? measuredViewportWidth
    : (resolveFileViewerRendererLayoutInlineSize({
        fallbackInlineSize: measuredViewportWidth,
        rendererFrame,
      }) ?? measuredViewportWidth);
  const documentInlineSize = contentWidth + TEXT_VIEWER_HORIZONTAL_PADDING * 2;

  const preparedDocument = React.useMemo(
    () =>
      createPreparedTextDocument({
        lines: mode === "text" ? textLines : undefined,
        mode,
        style: { fontEpoch, fontScale: 1 },
        text,
      }),
    [fontEpoch, mode, text, textLines],
  );
  const frame = React.useMemo(
    () =>
      layoutTextDocument({
        contentWidth,
        document: preparedDocument,
        fontScale,
      }),
    [contentWidth, fontScale, preparedDocument],
  );
  const highlightStart = highlight?.start;
  const highlightEnd = highlight?.end;
  const highlightRange = React.useMemo(
    () =>
      normalizeTextLineRange(
        highlightStart == null || highlightEnd == null
          ? null
          : { end: highlightEnd, start: highlightStart },
        preparedDocument.sourceLineCount,
      ),
    [highlightEnd, highlightStart, preparedDocument.sourceLineCount],
  );

  const captureScrollAnchor = React.useCallback(() => {
    pendingScrollAnchorRef.current = getTextFrameScrollAnchor({
      frames: frame.frames,
      scrollTop: viewportRef.current?.scrollTop ?? 0,
    });
  }, [frame.frames]);

  const projectCurrentRows = React.useCallback(() => {
    const state = projectionStateRef.current;
    if (!state) return;

    const scrollElement = viewportRef.current;

    projectRows({
      cache: state.cache,
      canvas: state.canvas,
      contentWidth: state.contentWidth,
      frame: state.frame,
      highlightRange: state.highlightRange,
      preparedDocument: state.preparedDocument,
      scrollTop: scrollElement?.scrollTop ?? 0,
      viewportHeight: scrollElement?.clientHeight || state.viewportHeight,
    });
  }, []);

  const scheduleProjectRows = React.useCallback(() => {
    if (scheduledRenderRef.current !== null) return;
    scheduledRenderRef.current = requestAnimationFrame(
      function renderChenglouTextFrame() {
        scheduledRenderRef.current = null;
        projectCurrentRows();
      },
    );
  }, [projectCurrentRows]);
  const getScrollInteractionTarget = React.useCallback(
    () =>
      projectionCacheRef.current.projectionWindow?.sticky ?? canvasRef.current,
    [],
  );
  const getScrollOverflowTarget = React.useCallback(
    () =>
      projectionCacheRef.current.projectionWindow?.sticky ?? canvasRef.current,
    [],
  );

  useKeyedLayoutEffect(
    joinEffectKey(["viewport-resize", usesShellGeometry]),
    () => {
      const scrollElement = viewportRef.current;
      if (!scrollElement) return;

      const readViewportSize = () => {
        const nextHeight = scrollElement.clientHeight;
        setViewportSize((current) => {
          const nextWidth =
            usesShellGeometry && current.width > 0
              ? current.width
              : scrollElement.clientWidth;

          return current.width === nextWidth && current.height === nextHeight
            ? current
            : { height: nextHeight, width: nextWidth };
        });
      };

      readViewportSize();
      const resizeObserver =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(readViewportSize);
      resizeObserver?.observe(scrollElement);

      return () => {
        resizeObserver?.disconnect();
      };
    },
  );

  useTextViewerScrollInteractions({
    getInteractionTarget: getScrollInteractionTarget,
    getOverflowTarget: getScrollOverflowTarget,
    onScroll: scheduleProjectRows,
    viewportRef,
  });

  useKeyedLayoutEffect(
    joinEffectKey([
      captureScrollAnchor,
      rendererFrame.documentTransition.layoutPolicy,
      rendererFrame.documentTransition.transitionId,
      viewportWidth,
    ]),
    () => {
      const nextContentWidth = Math.max(
        1,
        viewportWidth - TEXT_VIEWER_HORIZONTAL_PADDING * 2,
      );
      setContentWidth((current) => {
        if (current === nextContentWidth) return current;
        captureScrollAnchor();
        return nextContentWidth;
      });
    },
  );

  useKeyedLayoutEffect(joinEffectKey([frame.frames]), () => {
    const anchor = pendingScrollAnchorRef.current;
    const scrollElement = viewportRef.current;
    if (!anchor || !scrollElement) return;

    pendingScrollAnchorRef.current = null;
    const nextFrame = frame.frames[anchor.index];
    if (!nextFrame) return;

    scrollElement.scrollTop = Math.max(
      0,
      nextFrame.top +
        Math.min(anchor.offsetWithinFrame, Math.max(0, nextFrame.height - 1)),
    );
  });

  useKeyedLayoutEffect(
    joinEffectKey([
      contentWidth,
      frame,
      highlightRange,
      projectCurrentRows,
      preparedDocument,
      viewportHeight,
    ]),
    () => {
      projectionStateRef.current = {
        cache: projectionCacheRef.current,
        canvas: canvasRef.current,
        contentWidth,
        frame,
        highlightRange,
        preparedDocument,
        viewportHeight,
      };
      projectCurrentRows();
    },
  );

  useMountEffect(() => () => {
    if (scheduledRenderRef.current !== null) {
      cancelAnimationFrame(scheduledRenderRef.current);
    }
  });

  const scrollLineRange = React.useCallback(
    (
      range: ReturnType<typeof normalizeTextLineRange>,
      options?: ScrollToOptions,
    ) => {
      const scrollElement = viewportRef.current;
      if (!scrollElement || !range) return;

      const targetFrame =
        frame.frames.find((item) =>
          textFrameIntersectsLineRange({ frame: item, range }),
        ) ?? frame.frames[0];
      if (!targetFrame) return;

      const targetTop =
        targetFrame.height <= scrollElement.clientHeight
          ? targetFrame.top -
            (scrollElement.clientHeight - targetFrame.height) / 2
          : targetFrame.top;

      scrollElement.scrollTo({
        behavior: "smooth",
        top: Math.max(0, targetTop),
        ...options,
      });
    },
    [frame.frames],
  );

  const zoom = (factor: number) => {
    captureScrollAnchor();
    setFontScale((scale) => clampTextViewerScale(scale * factor));
  };

  const resetZoom = () => {
    captureScrollAnchor();
    setFontScale(1);
  };

  React.useImperativeHandle(
    forwardedRef ?? null,
    () => ({
      getViewportElement: () => viewportRef.current,
      scrollToLineRange: (range, options) => {
        scrollLineRange(
          normalizeTextLineRange(range, preparedDocument.sourceLineCount),
          options,
        );
      },
    }),
    [preparedDocument.sourceLineCount, scrollLineRange],
  );

  useKeyedMountEffect(joinEffectKey([highlightRange, scrollLineRange]), () => {
    scrollLineRange(highlightRange, { behavior: "auto" });
  });

  const scrollMarkdownFragment = React.useCallback(
    (event: React.MouseEvent) => {
      const href = localFragmentHrefFromEventTarget(event.target);
      if (!href) return;

      const targetId = decodeMarkdownFragmentHref(href);
      const targetIndex = markdownHeadingBlockIndex(
        preparedDocument.blocks,
        targetId,
      );
      const targetFrame = frame.frames[targetIndex];
      const scrollElement = viewportRef.current;
      if (!targetFrame || !scrollElement) return;

      event.preventDefault();
      scrollElement.scrollTo({
        behavior: "smooth",
        top: Math.max(0, targetFrame.top),
      });
      if (window.location.hash !== href) {
        window.history.replaceState(null, "", href);
      }
    },
    [frame.frames, preparedDocument.blocks],
  );

  return (
    <TextViewerFrame className={className} bare={bare}>
      {controls ? (
        <TextViewerControls
          wordCount={preparedDocument.wordCount}
          fontScale={fontScale}
          downloadAction={downloadAction}
          onZoomOut={() => zoom(1 / 1.2)}
          onZoomIn={() => zoom(1.2)}
          onResetZoom={resetZoom}
        />
      ) : null}
      <ScrollArea
        className="bg-background min-h-0 flex-1"
        orientation="vertical"
        viewportClassName="bg-background [overflow-anchor:none]"
        viewportProps={{ onClickCapture: scrollMarkdownFragment }}
        viewportRef={viewportRef}
      >
        <div
          className="relative min-w-0"
          style={{ minWidth: documentInlineSize }}
        >
          {mode === "text" ? (
            <DeferredNativeFindIndex
              lineCount={preparedDocument.sourceLineCount}
              lines={textLines}
              scrollToLineRange={scrollLineRange}
            />
          ) : null}
          <div
            ref={canvasRef}
            className="relative min-w-0"
            data-slot="text-virtual-canvas"
            data-projection={projection}
            style={{
              height: frame.totalHeight,
              minWidth: documentInlineSize,
            }}
          />
        </div>
      </ScrollArea>
    </TextViewerFrame>
  );
}

function DeferredNativeFindIndex({
  lines,
  lineCount,
  scrollToLineRange,
}: {
  lines: readonly string[];
  lineCount: number;
  scrollToLineRange: (
    range: ReturnType<typeof normalizeTextLineRange>,
    options?: ScrollToOptions,
  ) => void;
}) {
  const [isReady, setIsReady] = React.useState(false);

  useKeyedMountEffect(joinEffectKey([lines]), () => {
    setIsReady(false);
    const show = () => setIsReady(true);
    if (typeof window === "undefined") return;
    const browserWindow = window as TextIdleWindow;
    if (browserWindow.requestIdleCallback && browserWindow.cancelIdleCallback) {
      const idleId = browserWindow.requestIdleCallback(show, { timeout: 400 });
      return () => browserWindow.cancelIdleCallback?.(idleId);
    }
    const timeoutId = browserWindow.setTimeout(show, 80);
    return () => browserWindow.clearTimeout(timeoutId);
  });

  if (!isReady) return null;
  return (
    <NativeFindIndex
      lineCount={lineCount}
      lines={lines}
      scrollToLineRange={scrollToLineRange}
    />
  );
}

function NativeFindIndex({
  lines,
  lineCount,
  scrollToLineRange,
}: {
  lines: readonly string[];
  lineCount: number;
  scrollToLineRange: (
    range: ReturnType<typeof normalizeTextLineRange>,
    options?: ScrollToOptions,
  ) => void;
}) {
  const entries = React.useMemo(() => chunkNativeFindLines(lines), [lines]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 h-px w-px overflow-hidden opacity-0"
      data-native-find-indexed-chunks={entries.length}
      data-native-find-indexed-lines={lines.length}
      data-slot="text-native-find-index"
    >
      {entries.map((entry) => (
        <NativeFindEntry
          key={entry.startLine}
          entry={entry}
          lineCount={lineCount}
          scrollToLineRange={scrollToLineRange}
        />
      ))}
    </div>
  );
}

function NativeFindEntry({
  entry,
  lineCount,
  scrollToLineRange,
}: {
  entry: NativeFindTextChunk;
  lineCount: number;
  scrollToLineRange: (
    range: ReturnType<typeof normalizeTextLineRange>,
    options?: ScrollToOptions,
  ) => void;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  useKeyedLayoutEffect(
    joinEffectKey([
      entry.startLine,
      entry.endLine,
      lineCount,
      scrollToLineRange,
    ]),
    () => {
      const element = ref.current;
      if (!element) return;
      element.setAttribute("hidden", "until-found");

      const handleBeforeMatch = () => {
        scrollToLineRange(
          normalizeTextLineRange(
            {
              end: entry.endLine,
              start: entry.startLine,
            },
            lineCount,
          ),
          { behavior: "auto" },
        );
        requestAnimationFrame(() => {
          element.setAttribute("hidden", "until-found");
        });
      };

      element.addEventListener("beforematch", handleBeforeMatch);
      return () => {
        element.removeEventListener("beforematch", handleBeforeMatch);
      };
    },
  );

  return (
    <span
      ref={ref}
      className="absolute top-0 left-0 block h-px w-px overflow-hidden whitespace-pre"
      data-native-find-end-line={entry.endLine}
      data-native-find-start-line={entry.startLine}
    >
      {entry.text || " "}
    </span>
  );
}

function chunkNativeFindLines(lines: readonly string[]): NativeFindTextChunk[] {
  const chunks: NativeFindTextChunk[] = [];
  for (
    let startIndex = 0;
    startIndex < lines.length;
    startIndex += TEXT_VIEWER_NATIVE_FIND_CHUNK_SIZE
  ) {
    const endIndex = Math.min(
      lines.length,
      startIndex + TEXT_VIEWER_NATIVE_FIND_CHUNK_SIZE,
    );
    chunks.push({
      endLine: endIndex,
      startLine: startIndex + 1,
      text: lines.slice(startIndex, endIndex).join("\n"),
    });
  }
  return chunks;
}

export function projectRows({
  cache,
  canvas,
  contentWidth,
  frame,
  highlightRange,
  preparedDocument,
  scrollTop,
  viewportHeight,
}: {
  cache: ProjectionCache;
  canvas: HTMLDivElement | null;
  contentWidth: number;
  frame: TextDocumentFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
  preparedDocument: ReturnType<typeof createPreparedTextDocument>;
  scrollTop: number;
  viewportHeight: number;
}) {
  incrementTextMetric(cache.metrics, "projections");
  if (!canvas) return;

  if (cache.canvas !== canvas) {
    clearCachedRows(cache, cache.canvas);
    cache.canvas = canvas;
  }

  if (cache.frame !== frame || cache.preparedDocument !== preparedDocument) {
    clearCachedRows(cache, canvas);
    cache.frame = frame;
    cache.preparedDocument = preparedDocument;
  }

  const totalHeight = `${frame.totalHeight}px`;
  setStyleValue(canvas.style, "height", totalHeight);
  const virtualItems = getTextFrameVirtualItems({
    frames: frame.frames,
    overscanPx: TEXT_VIEWER_OVERSCAN_PX,
    scrollTop,
    viewportHeight,
  });
  const start = virtualItems[0]?.index ?? 0;
  const end = virtualItems.length
    ? virtualItems[virtualItems.length - 1]!.index + 1
    : start;
  setTextMetric(cache.metrics, "visibleStart", start);
  setTextMetric(cache.metrics, "visibleEnd", end);
  const previousStart = cache.mountedStart;
  const previousEnd = cache.mountedEnd;
  const overlapStart = Math.max(start, previousStart);
  const overlapEnd = Math.min(end, previousEnd);
  const viewportTop = scrollTop - TEXT_VIEWER_OVERSCAN_PX;
  const viewportBottom = scrollTop + viewportHeight + TEXT_VIEWER_OVERSCAN_PX;
  const stickyWindow = getTextInverseStickyWindow({
    renderedBottom: virtualItems.at(-1)?.end ?? 0,
    renderedTop:
      virtualItems[0]?.index === 0 ? 0 : (virtualItems[0]?.start ?? 0),
    totalHeight: frame.totalHeight,
    viewportHeight,
  });
  const projectionWindow = ensureProjectionWindow(cache, canvas);
  syncProjectionWindow(projectionWindow, stickyWindow);

  const project = (index: number) => {
    const block = preparedDocument.blocks[index];
    const blockFrame = frame.frames[index];
    if (!block || !blockFrame) return null;
    const cachedRow = prepareRow({
      block,
      cache,
      contentWidth,
      frame: blockFrame,
      highlightRange,
      index,
      renderedTop: stickyWindow.renderedTop,
      viewportBottom,
      viewportTop,
    });
    projectRowNode(
      cachedRow.row,
      blockFrame,
      stickyWindow.renderedTop,
      cache.metrics,
    );
    return cachedRow.row;
  };

  if (
    cache.hasProjection &&
    previousStart === start &&
    previousEnd === end &&
    isRenderedDomValid(cache, projectionWindow.content, start, end)
  ) {
    if (
      areCachedRowsUnchanged({
        cache,
        contentWidth,
        frame,
        highlightRange,
        preparedDocument,
        renderedTop: stickyWindow.renderedTop,
        start,
        end,
        viewportBottom,
        viewportTop,
      })
    ) {
      incrementTextMetric(cache.metrics, "noops");
      return;
    }

    for (let index = start; index < end; index++) {
      project(index);
    }
    cache.hasProjection = true;
    cache.mountedStart = start;
    cache.mountedEnd = end;
    return;
  }

  for (
    let index = previousStart;
    index < Math.min(previousEnd, start);
    index++
  ) {
    removeCachedRow(cache, index);
  }
  for (let index = Math.max(previousStart, end); index < previousEnd; index++) {
    removeCachedRow(cache, index);
  }

  if (overlapStart >= overlapEnd) {
    for (let index = start; index < end; index++) {
      const row = project(index);
      if (row && row.parentNode === null) projectionWindow.content.append(row);
    }
  } else {
    let anchorRow = cache.rows[overlapStart]?.row ?? null;
    for (let index = overlapStart - 1; index >= start; index--) {
      const row = project(index);
      if (!row) continue;
      if (anchorRow === null) {
        if (row.parentNode === null) projectionWindow.content.append(row);
      } else if (
        row.parentNode !== projectionWindow.content ||
        row.nextSibling !== anchorRow
      ) {
        projectionWindow.content.insertBefore(row, anchorRow);
      }
      anchorRow = row;
    }

    for (let index = overlapStart; index < overlapEnd; index++) {
      project(index);
    }

    for (let index = overlapEnd; index < end; index++) {
      const row = project(index);
      if (row && row.parentNode === null) projectionWindow.content.append(row);
    }
  }

  cache.mountedStart = start;
  cache.mountedEnd = end;
  cache.hasProjection = true;
}

function removeCachedRow(cache: ProjectionCache, index: number) {
  const cachedRow = cache.rows[index];
  if (!cachedRow) return;
  cachedRow.row.remove();
  incrementTextMetric(cache.metrics, "rowsRemoved");
  recycleCachedRow(cache, cachedRow);
  cache.rows[index] = undefined;
}

function clearCachedRows(
  cache: ProjectionCache,
  canvas: HTMLDivElement | null,
) {
  for (const cachedRow of cache.rows) {
    if (!cachedRow) continue;
    cachedRow.row.remove();
    incrementTextMetric(cache.metrics, "rowsRemoved");
    recycleCachedRow(cache, cachedRow);
  }
  canvas?.replaceChildren();
  cache.hasProjection = false;
  cache.mountedEnd = 0;
  cache.mountedStart = 0;
  cache.projectionWindow = null;
  cache.rows = [];
}

function ensureProjectionWindow(
  cache: ProjectionCache,
  canvas: HTMLDivElement,
): ProjectionWindow {
  const existing = cache.projectionWindow;
  if (existing?.before.parentElement === canvas) return existing;

  const before = document.createElement("div");
  const sticky = document.createElement("div");
  const content = document.createElement("div");
  const after = document.createElement("div");

  before.dataset.slot = "text-sticky-before-buffer";
  sticky.dataset.slot = "text-sticky-window";
  content.dataset.slot = "text-sticky-content";
  after.dataset.slot = "text-sticky-after-buffer";

  before.style.contain = "layout size";
  sticky.style.position = "sticky";
  sticky.style.left = "0";
  sticky.style.width = "100%";
  sticky.style.overflow = "visible";
  sticky.style.contain = "layout style inline-size";
  sticky.style.isolation = "isolate";
  sticky.style.display = "flex";
  sticky.style.flexDirection = "column";
  content.style.position = "relative";
  content.style.width = "100%";
  after.style.contain = "layout size";

  sticky.append(content);
  canvas.replaceChildren(before, sticky, after);

  cache.projectionWindow = {
    after,
    before,
    content,
    sticky,
  };
  return cache.projectionWindow;
}

function syncProjectionWindow(
  projectionWindow: ProjectionWindow,
  stickyWindow: TextInverseStickyWindow,
) {
  setStyleValue(
    projectionWindow.before.style,
    "height",
    `${stickyWindow.beforeHeight}px`,
  );
  setStyleValue(
    projectionWindow.sticky.style,
    "top",
    `${stickyWindow.stickyOffset}px`,
  );
  setStyleValue(
    projectionWindow.sticky.style,
    "bottom",
    `${stickyWindow.stickyOffset}px`,
  );
  setStyleValue(
    projectionWindow.sticky.style,
    "height",
    `${stickyWindow.renderedHeight}px`,
  );
  setStyleValue(
    projectionWindow.content.style,
    "height",
    `${stickyWindow.renderedHeight}px`,
  );
  setStyleValue(
    projectionWindow.after.style,
    "height",
    `${stickyWindow.afterHeight}px`,
  );
}

function prepareRow({
  block,
  cache,
  contentWidth,
  frame,
  highlightRange,
  index,
  renderedTop,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedTextBlock;
  cache: ProjectionCache;
  contentWidth: number;
  frame: TextBlockFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
  index: number;
  renderedTop: number;
  viewportBottom: number;
  viewportTop: number;
}): CachedRow {
  let cachedRow = cache.rows[index];
  if (!cachedRow) {
    cachedRow = acquireCachedRow(cache);
    cache.rows[index] = cachedRow;
  }

  const renderKey = rowRenderKey({
    block,
    contentWidth,
    frame,
    highlightRange,
  });
  const visibleWindowKey = blockVisibleWindowKey(
    frame,
    viewportTop,
    viewportBottom,
  );
  if (cachedRow.renderKey !== renderKey) {
    cachedRow.renderKey = renderKey;
    cachedRow.visibleWindowKey = visibleWindowKey;
    incrementTextMetric(cache.metrics, "rowContentPatches");
    renderRowContent({
      block,
      contentWidth,
      frame,
      highlightRange,
      renderedTop,
      row: cachedRow.row,
      viewportBottom,
      viewportTop,
    });
  } else if (cachedRow.visibleWindowKey !== visibleWindowKey) {
    cachedRow.visibleWindowKey = visibleWindowKey;
    incrementTextMetric(cache.metrics, "rowContentPatches");
    patchRowContent({
      block,
      contentWidth,
      frame,
      row: cachedRow.row,
      viewportBottom,
      viewportTop,
    });
  }
  return cachedRow;
}

function acquireCachedRow(cache: ProjectionCache): CachedRow {
  const cachedRow = cache.recycledRows.pop();
  if (cachedRow) {
    incrementTextMetric(cache.metrics, "rowsReused");
    setTextMetric(cache.metrics, "rowPoolSize", cache.recycledRows.length);
    return cachedRow;
  }

  incrementTextMetric(cache.metrics, "rowsCreated");
  return {
    renderKey: "",
    row: document.createElement("div"),
    visibleWindowKey: "",
  };
}

function recycleCachedRow(cache: ProjectionCache, cachedRow: CachedRow) {
  cachedRow.renderKey = "";
  cachedRow.visibleWindowKey = "";
  cachedRow.row.replaceChildren();

  if (cache.recycledRows.length >= TEXT_VIEWER_MAX_RECYCLED_ROWS) {
    incrementTextMetric(cache.metrics, "rowsDropped");
    setTextMetric(cache.metrics, "rowPoolSize", cache.recycledRows.length);
    return;
  }

  cache.recycledRows.push(cachedRow);
  setTextMetric(cache.metrics, "rowPoolSize", cache.recycledRows.length);
}

function projectRowNode(
  row: HTMLDivElement,
  frame: TextBlockFrame,
  renderedTop: number,
  metrics: TextProjectionMetrics | undefined,
) {
  let didPatch = false;
  didPatch =
    setStyleValue(row.style, "height", `${frame.height}px`) || didPatch;
  didPatch =
    setStyleValue(
      row.style,
      "transform",
      `translateY(${frame.top - renderedTop}px)`,
    ) || didPatch;
  if (didPatch) {
    incrementTextMetric(metrics, "rowLayoutPatches");
  }
}

function areCachedRowsUnchanged({
  cache,
  contentWidth,
  frame,
  highlightRange,
  preparedDocument,
  renderedTop,
  start,
  end,
  viewportBottom,
  viewportTop,
}: {
  cache: ProjectionCache;
  contentWidth: number;
  frame: TextDocumentFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
  preparedDocument: ReturnType<typeof createPreparedTextDocument>;
  renderedTop: number;
  start: number;
  end: number;
  viewportBottom: number;
  viewportTop: number;
}) {
  for (let index = start; index < end; index++) {
    const block = preparedDocument.blocks[index];
    const blockFrame = frame.frames[index];
    const cachedRow = cache.rows[index];
    if (!block || !blockFrame || !cachedRow) return false;
    if (!isRowLayoutValid(cachedRow.row, blockFrame, renderedTop)) {
      return false;
    }
    if (
      cachedRow.renderKey !==
      rowRenderKey({
        block,
        contentWidth,
        frame: blockFrame,
        highlightRange,
      })
    ) {
      return false;
    }
    if (
      cachedRow.visibleWindowKey !==
      blockVisibleWindowKey(blockFrame, viewportTop, viewportBottom)
    ) {
      return false;
    }
  }
  return true;
}

function isRenderedDomValid(
  cache: ProjectionCache,
  canvas: HTMLDivElement,
  start: number,
  end: number,
) {
  const expectedLength = Math.max(0, end - start);
  if (canvas.children.length !== expectedLength) return false;

  for (let offset = 0; offset < expectedLength; offset++) {
    const index = start + offset;
    const element = canvas.children[offset];
    const cachedRow = cache.rows[index];
    if (!(element instanceof HTMLDivElement) || cachedRow?.row !== element) {
      return false;
    }
  }
  return true;
}

function isRowLayoutValid(
  row: HTMLDivElement,
  frame: TextBlockFrame,
  renderedTop: number,
) {
  return (
    row.style.height === `${frame.height}px` &&
    row.style.transform === `translateY(${frame.top - renderedTop}px)`
  );
}

function setStyleValue(
  style: CSSStyleDeclaration,
  propertyName: string,
  value: string,
) {
  if (style.getPropertyValue(propertyName) === value) return false;
  style.setProperty(propertyName, value);
  return true;
}

function incrementTextMetric(
  metrics: TextProjectionMetrics | undefined,
  key:
    | "noops"
    | "projections"
    | "rowContentPatches"
    | "rowLayoutPatches"
    | "rowsCreated"
    | "rowsDropped"
    | "rowsRemoved"
    | "rowsReused",
) {
  if (!metrics) return;
  metrics[key] += 1;
}

function setTextMetric(
  metrics: TextProjectionMetrics | undefined,
  key: "rowPoolSize" | "visibleEnd" | "visibleStart",
  value: number,
) {
  if (!metrics) return;
  metrics[key] = value;
}

function rowRenderKey({
  block,
  contentWidth,
  frame,
  highlightRange,
}: {
  block: PreparedTextBlock;
  contentWidth: number;
  frame: TextBlockFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
}) {
  return [
    block.kind,
    contentWidth,
    frame.height,
    frame.top,
    frame.scale,
    textFrameIsHighlighted(frame, highlightRange) ? "highlighted" : "",
  ].join(":");
}

function renderRowContent({
  block,
  contentWidth,
  frame,
  highlightRange,
  renderedTop,
  row,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedTextBlock;
  contentWidth: number;
  frame: TextBlockFrame;
  highlightRange: ReturnType<typeof normalizeTextLineRange>;
  renderedTop: number;
  row: HTMLDivElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const isHighlighted = textFrameIsHighlighted(frame, highlightRange);
  row.replaceChildren();
  row.className = "absolute left-0 w-full px-4";
  row.dataset.slot = "text-line";
  row.dataset.sourceLine = String(frame.sourceStartLine);
  if (isHighlighted) {
    row.dataset.textHighlighted = "";
  } else {
    delete row.dataset.textHighlighted;
  }
  if (block.kind === "inline" && block.headingId) {
    row.id = block.headingId;
    row.dataset.headingId = block.headingId;
  } else {
    row.removeAttribute("id");
    delete row.dataset.headingId;
  }
  if (frame.listDepth) {
    row.dataset.listDepth = String(frame.listDepth);
  } else {
    delete row.dataset.listDepth;
  }
  if (frame.quoteDepth) {
    row.dataset.quoteDepth = String(frame.quoteDepth);
  } else {
    delete row.dataset.quoteDepth;
  }
  applyRowSemantics(row, block, frame);
  row.style.position = "absolute";
  row.style.left = "0";
  row.style.width = "100%";
  row.style.paddingLeft = "16px";
  row.style.paddingRight = "16px";
  row.style.height = `${frame.height}px`;
  row.style.transform = `translateY(${frame.top - renderedTop}px)`;
  row.style.backgroundColor = isHighlighted
    ? TEXT_VIEWER_HIGHLIGHT_BACKGROUND
    : "";
  row.style.boxShadow = isHighlighted
    ? TEXT_VIEWER_HIGHLIGHT_ACCENT_SHADOW
    : "";

  appendBlockChrome(row, frame);

  switch (block.kind) {
    case "inline":
      renderInlineBlock({
        block,
        contentWidth,
        frame: frame as InlineTextBlockFrame,
        row,
        viewportBottom,
        viewportTop,
      });
      break;
    case "code":
      renderCodeBlock({
        block,
        contentWidth,
        frame: frame as CodeTextBlockFrame,
        row,
        viewportBottom,
        viewportTop,
      });
      break;
    case "image":
      renderImageBlock({
        block,
        frame: frame as ImageTextBlockFrame,
        row,
      });
      break;
    case "rule":
      renderRuleBlock({
        frame: frame as RuleTextBlockFrame,
        row,
      });
      break;
    case "table":
      renderTableBlock({
        block,
        frame: frame as TableTextBlockFrame,
        row,
        viewportBottom,
        viewportTop,
      });
      break;
  }
}

function patchRowContent({
  block,
  contentWidth,
  frame,
  row,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedTextBlock;
  contentWidth: number;
  frame: TextBlockFrame;
  row: HTMLDivElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  switch (block.kind) {
    case "inline": {
      const linesNode = row.querySelector<HTMLElement>(
        '[data-slot="text-inline-lines"]',
      );
      if (!linesNode) return;
      patchInlineBlockLines({
        block,
        contentWidth,
        frame: frame as InlineTextBlockFrame,
        linesNode,
        viewportBottom,
        viewportTop,
      });
      break;
    }
    case "code": {
      const code = row.querySelector<HTMLElement>(
        '[data-slot="text-code-lines"]',
      );
      if (!code) return;
      patchCodeBlockLines({
        block,
        code,
        contentWidth,
        frame: frame as CodeTextBlockFrame,
        viewportBottom,
        viewportTop,
      });
      break;
    }
    case "table": {
      const tbody = row.querySelector<HTMLTableSectionElement>(
        '[data-slot="text-table-body"]',
      );
      if (!tbody) return;
      patchTableBodyRows({
        block,
        frame: frame as TableTextBlockFrame,
        tbody,
        viewportBottom,
        viewportTop,
      });
      break;
    }
    case "image":
    case "rule":
      break;
  }
}

function applyRowSemantics(
  row: HTMLDivElement,
  block: PreparedTextBlock,
  frame: TextBlockFrame,
) {
  row.removeAttribute("role");
  row.removeAttribute("aria-level");

  if (block.kind === "inline") {
    const headingLevel = inlineHeadingLevel(block);
    if (headingLevel != null) {
      row.setAttribute("role", "heading");
      row.setAttribute("aria-level", String(headingLevel));
      return;
    }
  }

  if (frame.markerText) {
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-level", String(frame.listDepth));
  }
}

function inlineHeadingLevel(block: PreparedInlineTextBlock) {
  if (block.variant === "heading-1") return 1;
  if (block.variant === "heading-2") return 2;
  return null;
}

function renderInlineBlock({
  block,
  contentWidth,
  frame,
  row,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedInlineTextBlock;
  contentWidth: number;
  frame: InlineTextBlockFrame;
  row: HTMLDivElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const linesNode = document.createElement("div");
  linesNode.dataset.slot = "text-inline-lines";
  row.append(linesNode);
  patchInlineBlockLines({
    block,
    contentWidth,
    frame,
    linesNode,
    viewportBottom,
    viewportTop,
  });
}

function patchInlineBlockLines({
  block,
  contentWidth,
  frame,
  linesNode,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedInlineTextBlock;
  contentWidth: number;
  frame: InlineTextBlockFrame;
  linesNode: HTMLElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const lineWindow = getInlineVisibleLineWindow({
    frame,
    viewportBottom,
    viewportTop,
  });
  if (!lineWindow) {
    patchKeyedDomChildren({
      createElement: () => document.createElement("div"),
      getKey: () => "",
      items: [],
      parent: linesNode,
      updateElement: () => {},
    });
    return;
  }

  const lines = materializeInlineVisibleLines({
    block,
    frame,
    lineWindow,
    maxWidth: contentWidth,
    viewportBottom,
    viewportTop,
  });

  patchKeyedDomChildren({
    createElement: () => document.createElement("div"),
    getKey: (item) => String(item.lineIndex),
    items: lines.map((line) => ({
      line,
      lineIndex: line.lineIndex,
    })),
    parent: linesNode,
    updateElement: (lineRow, item) => {
      lineRow.className = "absolute flex w-max items-center gap-0";
      lineRow.dataset.lineIndex = String(item.lineIndex);
      lineRow.dataset.slot = "text-inline-line";
      lineRow.style.height = `${frame.lineHeight}px`;
      lineRow.style.left = `${16 + frame.contentLeft}px`;
      lineRow.style.top = `${item.line.top}px`;
      lineRow.style.transform = `scale(${frame.scale})`;
      lineRow.style.transformOrigin = "left top";

      const renderKey = inlineLineRenderKey(item.line);
      if (lineRow.dataset.renderKey === renderKey) return;
      lineRow.dataset.renderKey = renderKey;
      lineRow.replaceChildren();

      for (const fragment of item.line.fragments) {
        const node = fragment.href
          ? document.createElement("a")
          : document.createElement("span");
        node.className = fragment.className;
        node.textContent = fragment.text;
        node.style.font = fragment.font;
        node.style.letterSpacing = "0";
        if (fragment.leadingGap > 0) {
          node.style.marginLeft = `${fragment.leadingGap}px`;
        }
        if (node instanceof HTMLAnchorElement && fragment.href) {
          node.href = fragment.href;
          if (!isLocalFragmentHref(fragment.href)) {
            node.rel = "noopener noreferrer";
            node.target = "_blank";
          }
          if (fragment.title) node.title = fragment.title;
        }
        lineRow.append(node);
      }
    },
  });
}

function inlineLineRenderKey(
  line: ReturnType<typeof materializeInlineVisibleLines>[number],
) {
  return [
    line.top,
    line.width,
    ...line.fragments.map((fragment) =>
      [
        fragment.className,
        fragment.font,
        fragment.href ?? "",
        fragment.leadingGap,
        fragment.text,
        fragment.title ?? "",
      ].join("\u0001"),
    ),
  ].join("\u0002");
}

function renderCodeBlock({
  block,
  contentWidth,
  frame,
  row,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedCodeTextBlock;
  contentWidth: number;
  frame: CodeTextBlockFrame;
  row: HTMLDivElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const pre = document.createElement("pre");
  pre.className =
    "absolute overflow-hidden rounded-md border bg-muted text-foreground";
  pre.style.height = `${frame.height}px`;
  pre.style.left = `${16 + frame.contentLeft}px`;
  pre.style.width = `${frame.width}px`;

  const code = document.createElement("code");
  code.dataset.slot = "text-code-lines";
  patchCodeBlockLines({
    block,
    code,
    contentWidth,
    frame,
    viewportBottom,
    viewportTop,
  });

  pre.append(code);
  row.append(pre);
  appendCodeBlockToolbar({ block, frame, row });
}

function patchCodeBlockLines({
  block,
  code,
  contentWidth,
  frame,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedCodeTextBlock;
  code: HTMLElement;
  contentWidth: number;
  frame: CodeTextBlockFrame;
  viewportBottom: number;
  viewportTop: number;
}) {
  const lineWindow = getCodeVisibleLineWindow({
    frame,
    viewportBottom,
    viewportTop,
  });
  if (!lineWindow) {
    patchKeyedDomChildren({
      createElement: () => document.createElement("span"),
      getKey: () => "",
      items: [],
      parent: code,
      updateElement: () => {},
    });
    return;
  }

  const lines = materializeCodeVisibleLines({
    block,
    contentWidth,
    frame,
    lineWindow,
    viewportBottom,
    viewportTop,
  });

  patchKeyedDomChildren({
    createElement: () => document.createElement("span"),
    getKey: (item) => String(item.lineIndex),
    items: lines.map((line) => ({
      line,
      lineIndex: line.lineIndex,
    })),
    parent: code,
    updateElement: (span, item) => {
      span.className = "absolute font-mono whitespace-pre";
      span.dataset.lineIndex = String(item.lineIndex);
      span.dataset.slot = "text-code-line";
      span.style.font = block.font;
      span.style.left = "12px";
      span.style.lineHeight = `${frame.lineHeight}px`;
      span.style.top = `${item.line.top}px`;
      span.style.transform = `scale(${frame.scale})`;
      span.style.transformOrigin = "left top";

      const renderKey = `${item.line.top}\u0001${item.line.line.text}`;
      if (span.dataset.renderKey === renderKey) return;
      span.dataset.renderKey = renderKey;
      span.textContent = item.line.line.text;
    },
  });
}

function appendCodeBlockToolbar({
  block,
  frame,
  row,
}: {
  block: PreparedCodeTextBlock;
  frame: CodeTextBlockFrame;
  row: HTMLDivElement;
}) {
  const controls = document.createElement("div");
  controls.className = "absolute z-10 flex items-center gap-1";
  controls.style.left = `${16 + frame.contentLeft + Math.max(0, frame.width - 66)}px`;
  controls.style.top = "6px";

  if (block.language) {
    const language = document.createElement("span");
    language.className =
      "rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm";
    language.textContent = block.language;
    controls.append(language);
  }

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className =
    "rounded bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground";
  copyButton.setAttribute("aria-label", "Copy code block");
  appendCopyIcon(copyButton);
  copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(block.fallbackText).then(() => {
      copyButton.setAttribute("aria-label", "Copied");
      copyButton.replaceChildren();
      appendCheckIcon(copyButton);
      window.setTimeout(() => {
        copyButton.setAttribute("aria-label", "Copy code block");
        copyButton.replaceChildren();
        appendCopyIcon(copyButton);
      }, 1200);
    });
  });
  controls.append(copyButton);
  row.append(controls);
}

function appendCopyIcon(parent: HTMLElement) {
  const svg = createIconSvg();
  const back = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  back.setAttribute("x", "8");
  back.setAttribute("y", "8");
  back.setAttribute("width", "8");
  back.setAttribute("height", "8");
  back.setAttribute("rx", "1");
  const front = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  front.setAttribute("x", "4");
  front.setAttribute("y", "4");
  front.setAttribute("width", "8");
  front.setAttribute("height", "8");
  front.setAttribute("rx", "1");
  svg.append(back, front);
  parent.append(svg);
}

function appendCheckIcon(parent: HTMLElement) {
  const svg = createIconSvg();
  svg.classList.add("text-emerald-600", "dark:text-emerald-400");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m5 10 3 3 7-7");
  svg.append(path);
  parent.append(svg);
}

function createIconSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("size-3");
  return svg;
}

function renderImageBlock({
  block,
  frame,
  row,
}: {
  block: PreparedImageTextBlock;
  frame: ImageTextBlockFrame;
  row: HTMLDivElement;
}) {
  if (block.src) {
    const image = document.createElement("img");
    image.alt = block.alt;
    image.className = "absolute rounded-md border bg-muted object-contain";
    image.src = block.src;
    if (block.title) image.title = block.title;
    image.style.height = `${frame.imageHeight}px`;
    image.style.left = `${16 + frame.contentLeft}px`;
    image.style.maxWidth = "calc(100% - 32px)";
    image.style.width = `${frame.imageWidth}px`;
    row.append(image);
    return;
  }

  const placeholder = document.createElement("div");
  placeholder.className =
    "absolute flex items-center rounded-md border bg-muted px-4 text-sm text-muted-foreground";
  placeholder.textContent = block.alt;
  placeholder.setAttribute("role", "img");
  placeholder.setAttribute("aria-label", block.alt);
  placeholder.style.height = `${frame.imageHeight}px`;
  placeholder.style.left = `${16 + frame.contentLeft}px`;
  placeholder.style.width = `${frame.imageWidth}px`;
  row.append(placeholder);
}

function renderRuleBlock({
  frame,
  row,
}: {
  frame: RuleTextBlockFrame;
  row: HTMLDivElement;
}) {
  const rule = document.createElement("div");
  rule.className = "absolute h-px bg-border";
  rule.style.left = `${16 + frame.contentLeft}px`;
  rule.style.top = `${Math.floor(frame.height / 2)}px`;
  rule.style.width = `${frame.width}px`;
  row.append(rule);
}

function renderTableBlock({
  block,
  frame,
  row,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedTableTextBlock;
  frame: TableTextBlockFrame;
  row: HTMLDivElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const headerIdPrefix = `markdown-table-${frame.sourceStartLine}-${frame.sourceEndLine}`;
  const wrapper = document.createElement("div");
  wrapper.className =
    "absolute max-w-[calc(100%-32px)] overflow-hidden rounded-md border";
  wrapper.style.height = `${frame.height}px`;
  wrapper.style.left = `${16 + frame.contentLeft}px`;
  wrapper.style.width = `${frame.tableWidth}px`;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className =
    "absolute top-1 right-1 z-10 rounded bg-background/90 px-1.5 py-1 text-[10px] text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground";
  copyButton.setAttribute("aria-label", "Copy table");
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(
      serializeMarkdownTableForClipboard(block),
    );
  });
  wrapper.append(copyButton);

  const scroller = document.createElement("div");
  scroller.className = "h-full overflow-x-auto";

  const table = document.createElement("table");
  table.className = "border-collapse text-left text-[13px]";
  table.style.width = `${frame.tableWidth}px`;

  const colgroup = document.createElement("colgroup");
  for (const width of frame.columnWidths) {
    const col = document.createElement("col");
    col.style.width = `${width}px`;
    colgroup.append(col);
  }
  table.append(colgroup);

  const thead = document.createElement("thead");
  thead.className = "bg-muted";
  const headerRow = document.createElement("tr");
  headerRow.style.height = `${frame.headerHeight}px`;
  for (let index = 0; index < block.header.length; index++) {
    const th = document.createElement("th");
    th.className = "border-b px-3.5 py-2 font-semibold text-foreground";
    th.id = `${headerIdPrefix}-column-${index}`;
    th.scope = "col";
    th.style.textAlign = block.alignments[index] ?? "left";
    appendTableCellContent(th, block.header[index]);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  tbody.dataset.slot = "text-table-body";
  patchTableBodyRows({
    block,
    frame,
    tbody,
    viewportBottom,
    viewportTop,
  });
  table.append(tbody);
  scroller.append(table);
  wrapper.append(scroller);
  row.append(wrapper);
}

type TableBodyProjectionItem =
  | {
      height: number;
      kind: "spacer";
      slot: "after" | "before";
    }
  | {
      kind: "row";
      rowIndex: number;
    };

function patchTableBodyRows({
  block,
  frame,
  tbody,
  viewportBottom,
  viewportTop,
}: {
  block: PreparedTableTextBlock;
  frame: TableTextBlockFrame;
  tbody: HTMLTableSectionElement;
  viewportBottom: number;
  viewportTop: number;
}) {
  const rowWindow = getTableVisibleRowWindow({
    frame,
    viewportBottom,
    viewportTop,
  });
  const items: TableBodyProjectionItem[] = [];
  if (rowWindow.beforeHeight > 0) {
    items.push({
      height: rowWindow.beforeHeight,
      kind: "spacer",
      slot: "before",
    });
  }
  for (
    let rowIndex = rowWindow.startIndex;
    rowIndex < rowWindow.endIndex;
    rowIndex++
  ) {
    items.push({ kind: "row", rowIndex });
  }
  if (rowWindow.afterHeight > 0) {
    items.push({
      height: rowWindow.afterHeight,
      kind: "spacer",
      slot: "after",
    });
  }

  const headerIdPrefix = `markdown-table-${frame.sourceStartLine}-${frame.sourceEndLine}`;
  patchKeyedDomChildren({
    createElement: () => document.createElement("tr"),
    getKey: (item) =>
      item.kind === "spacer" ? `spacer:${item.slot}` : `row:${item.rowIndex}`,
    items,
    parent: tbody,
    updateElement: (tableRow, item) => {
      if (item.kind === "spacer") {
        updateTableSpacerRow(tableRow, item, block.header.length);
        return;
      }

      updateTableDataRow({
        alignments: block.alignments,
        cellCount: block.header.length,
        frame,
        headerIdPrefix,
        row: tableRow,
        rowIndex: item.rowIndex,
        sourceRow: block.rows[item.rowIndex] ?? [],
      });
    },
  });
}

function updateTableSpacerRow(
  row: HTMLTableRowElement,
  item: Extract<TableBodyProjectionItem, { kind: "spacer" }>,
  colSpan: number,
) {
  row.dataset.slot = "text-table-spacer";
  delete row.dataset.rowIndex;
  delete row.dataset.sourceLine;
  row.setAttribute("aria-hidden", "true");
  row.style.height = `${item.height}px`;

  const renderKey = `spacer:${item.height}:${colSpan}`;
  if (row.dataset.renderKey === renderKey) return;
  row.dataset.renderKey = renderKey;
  const cell = document.createElement("td");
  cell.colSpan = colSpan || 1;
  row.replaceChildren(cell);
}

function updateTableDataRow({
  alignments,
  cellCount,
  frame,
  headerIdPrefix,
  row,
  rowIndex,
  sourceRow,
}: {
  alignments: PreparedTableTextBlock["alignments"];
  cellCount: number;
  frame: TableTextBlockFrame;
  headerIdPrefix: string;
  row: HTMLTableRowElement;
  rowIndex: number;
  sourceRow: PreparedTableCell[];
}) {
  row.dataset.rowIndex = String(rowIndex);
  row.dataset.slot = "text-table-row";
  row.dataset.sourceLine = String(frame.rowSourceStartLines[rowIndex]);
  row.removeAttribute("aria-hidden");
  row.style.height = `${frame.rowHeights[rowIndex] ?? 0}px`;

  const renderKey = tableDataRowRenderKey({
    alignments,
    cellCount,
    frame,
    rowIndex,
    sourceRow,
  });
  if (row.dataset.renderKey === renderKey) return;
  row.dataset.renderKey = renderKey;
  row.replaceChildren();

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const td = document.createElement("td");
    td.className = "border-t px-3.5 py-1.5 align-top text-foreground";
    td.headers = `${headerIdPrefix}-column-${cellIndex}`;
    td.style.textAlign = alignments[cellIndex] ?? "left";
    appendTableCellContent(td, sourceRow[cellIndex]);
    row.append(td);
  }
}

function tableDataRowRenderKey({
  alignments,
  cellCount,
  frame,
  rowIndex,
  sourceRow,
}: {
  alignments: PreparedTableTextBlock["alignments"];
  cellCount: number;
  frame: TableTextBlockFrame;
  rowIndex: number;
  sourceRow: PreparedTableCell[];
}) {
  const cells = Array.from({ length: cellCount }, (_, cellIndex) => {
    const cell = sourceRow[cellIndex];
    return [
      alignments[cellIndex] ?? "left",
      cell?.className ?? "",
      cell?.href ?? "",
      cell?.text ?? "",
      cell?.title ?? "",
    ].join("\u0001");
  });
  return [
    rowIndex,
    frame.rowHeights[rowIndex] ?? 0,
    frame.rowSourceStartLines[rowIndex] ?? "",
    ...cells,
  ].join("\u0002");
}

function appendTableCellContent(
  parent: HTMLElement,
  cell: PreparedTableCell | undefined,
) {
  if (!cell) return;
  const node = cell.href
    ? document.createElement("a")
    : document.createElement("span");
  node.className = `wrap-break-word ${cell.className}`;
  node.textContent = cell.text;
  if (node instanceof HTMLAnchorElement && cell.href) {
    node.href = cell.href;
    if (!isLocalFragmentHref(cell.href)) {
      node.rel = "noopener noreferrer";
      node.target = "_blank";
    }
    if (cell.title) node.title = cell.title;
  }
  parent.append(node);
}

function appendBlockChrome(row: HTMLDivElement, frame: TextBlockFrame) {
  for (const left of frame.quoteRailLefts) {
    const rail = document.createElement("div");
    rail.className = "absolute top-0 bottom-0 w-[3px] rounded-full bg-border";
    rail.style.left = `${16 + left}px`;
    rail.setAttribute("aria-hidden", "true");
    row.append(rail);
  }

  if (!frame.markerText || frame.markerLeft == null) return;

  const marker = document.createElement("span");
  marker.className = `absolute font-mono text-xs whitespace-pre ${frame.markerClassName ?? ""}`;
  marker.textContent = frame.markerText;
  marker.style.left = `${16 + frame.markerLeft}px`;
  marker.style.top =
    frame.kind === "inline"
      ? `${Math.max(0, Math.round((frame.lineHeight - 12) / 2))}px`
      : "10px";
  marker.setAttribute("aria-hidden", "true");
  row.append(marker);
}

function localFragmentHrefFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
  const href = link?.getAttribute("href") ?? null;
  return href && href.length > 1 ? href : null;
}

function decodeMarkdownFragmentHref(href: string) {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

function markdownHeadingBlockIndex(
  blocks: readonly PreparedTextBlock[],
  headingId: string,
) {
  return blocks.findIndex((block) => {
    return block.kind === "inline" && block.headingId === headingId;
  });
}

function isLocalFragmentHref(href: string) {
  return href.startsWith("#");
}

function textFrameIsHighlighted(
  frame: TextBlockFrame,
  highlightRange: ReturnType<typeof normalizeTextLineRange>,
) {
  return frame.sourceStartLine === frame.sourceEndLine
    ? isLineInRange(frame.sourceStartLine, highlightRange)
    : textFrameIntersectsLineRange({ frame, range: highlightRange });
}

function blockVisibleWindowKey(
  frame: TextBlockFrame,
  viewportTop: number,
  viewportBottom: number,
) {
  switch (frame.kind) {
    case "inline": {
      const lineWindow = getInlineVisibleLineWindow({
        frame,
        viewportBottom,
        viewportTop,
      });
      return lineWindow
        ? `${lineWindow.firstLine}:${lineWindow.lastLine}`
        : "none";
    }
    case "code": {
      const lineWindow = getCodeVisibleLineWindow({
        frame,
        viewportBottom,
        viewportTop,
      });
      return lineWindow
        ? `${lineWindow.firstLine}:${lineWindow.lastLine}`
        : "none";
    }
    case "table": {
      const rowWindow = getTableVisibleRowWindow({
        frame,
        viewportBottom,
        viewportTop,
      });
      return `${rowWindow.startIndex}:${rowWindow.endIndex}`;
    }
    case "image":
    case "rule":
      return "static";
  }
}

function useTextViewerFontEpoch() {
  const [fontEpoch, setFontEpoch] = React.useState(0);

  useMountEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;

    let isMounted = true;
    void fonts.ready.then(() => {
      if (isMounted) setFontEpoch((epoch) => epoch + 1);
    });

    return () => {
      isMounted = false;
    };
  });

  return fontEpoch;
}
