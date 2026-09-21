"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { ViewerResource } from "@/lib/viewer-resource";

import {
  CodeViewerControls,
  codeViewerControlsState,
  CodeViewerFrame,
} from "./code-viewer-chrome";
import { scrollTopForLineRangeMetrics } from "./code-viewer-layout";
import { getCodeLongLineSelectionText } from "./code-viewer-long-lines";
import { useCodeProjectionScheduler } from "./code-viewer-projection-scheduler";
import { createCodeProjector } from "./code-viewer-projector";
import {
  clampCodeViewerScale,
  CODE_VIEWER_BASE_LINE_PX,
  CODE_VIEWER_BLOCK_PADDING,
} from "./code-viewer-scale";
import { createCodeSyntax } from "./code-viewer-syntax";
import { useCodeViewerSyntaxStyle } from "./code-viewer-syntax-style";
import type {
  CodeLineRange,
  CodeViewerHandle,
  CodeViewerProps,
} from "./code-viewer-types";
import { CodeViewerViewport } from "./code-viewer-viewport";
import { normalizeTextLineRange } from "./line-ranges";
import {
  readTextDocument,
  resolvedTextViewerBounds,
} from "./plain-text-resource";
import { useViewerControlsRegistration } from "./viewer-controls";
import { joinEffectKey } from "@/lib/effect-key";

type CodeReadingAnchor = {
  lineIndex: number;
  offsetPx: number;
};

type NativeFindCodeChunk = {
  endLine: number;
  startLine: number;
  text: string;
};

type CodeIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

const CODE_VIEWER_DEFERRED_SYNTAX_LINE_COUNT = 500;
const CODE_VIEWER_NATIVE_FIND_CHUNK_SIZE = 128;

type CodeViewerContentProps = Omit<CodeViewerProps, "source"> & {
  resource: ViewerResource;
  retryVersion: number;
  forwardedRef?: React.ForwardedRef<CodeViewerHandle>;
};

export function CodeViewerContent({
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
}: CodeViewerContentProps) {
  const bounds = resolvedTextViewerBounds({ maxBytes, maxLines });
  const textDocument = readTextDocument({
    content: resource.content,
    retryVersion,
    bounds,
  });
  const textLines = textDocument.lines;
  const [syntaxVersion, setSyntaxVersion] = React.useState(0);
  const syntax = React.useMemo(
    () =>
      createCodeSyntax(resource, {
        deferTokens: textLines.length > CODE_VIEWER_DEFERRED_SYNTAX_LINE_COUNT,
        onTokensChanged: () => setSyntaxVersion((version) => version + 1),
      }),
    [resource, textLines.length],
  );
  const syntaxIdentity =
    syntaxVersion === 0
      ? syntax.identity
      : `${syntax.identity}\u0000${syntaxVersion}`;
  const highlightStart = highlight?.start;
  const highlightEnd = highlight?.end;
  const highlightRange = React.useMemo(
    () =>
      normalizeTextLineRange(
        highlightStart == null || highlightEnd == null
          ? null
          : { start: highlightStart, end: highlightEnd },
        textLines.length,
      ),
    [highlightStart, highlightEnd, textLines.length],
  );
  const downloadAction = download ? resource.originalDownload : null;

  const [fontScale, setFontScale] = React.useState(1);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowHostRef = React.useRef<HTMLPreElement | null>(null);
  const pendingScrollAnchorRef = React.useRef<CodeReadingAnchor | null>(null);
  const projector = React.useMemo(() => createCodeProjector(), []);
  const lineHeight = CODE_VIEWER_BASE_LINE_PX * fontScale;
  const contentIdentity = React.useMemo(
    () =>
      codeContentIdentity({
        contentKey: resource.content.key,
        maxBytes: bounds.maxBytes,
        maxLines: bounds.maxLines,
        retryVersion,
      }),
    [bounds.maxBytes, bounds.maxLines, resource.content.key, retryVersion],
  );
  const gutterWidth = `calc(${String(textLines.length).length + 1}ch + 1.25rem)`;
  const layoutIdentity = codeLayoutIdentity({ gutterWidth, lineHeight });

  useCodeViewerSyntaxStyle();

  const commitFontScale = React.useCallback(
    (nextScale: number) => {
      const clampedScale = clampCodeViewerScale(nextScale);
      if (clampedScale === fontScale) return;

      pendingScrollAnchorRef.current = captureCodeReadingAnchor({
        lineCount: textLines.length,
        lineHeight,
        projector,
        viewportElement: viewportRef.current,
      });
      setFontScale(clampedScale);
    },
    [fontScale, lineHeight, projector, textLines.length],
  );

  const zoom = React.useCallback(
    (factor: number) => commitFontScale(fontScale * factor),
    [commitFontScale, fontScale],
  );
  const onZoomOut = React.useCallback(() => zoom(1 / 1.2), [zoom]);
  const onZoomIn = React.useCallback(() => zoom(1.2), [zoom]);
  const onResetZoom = React.useCallback(
    () => commitFontScale(1),
    [commitFontScale],
  );

  useKeyedMountEffect(
    joinEffectKey(["code-anchor", lineHeight, textLines.length]),
    () => {
      const anchor = pendingScrollAnchorRef.current;
      const viewportElement = viewportRef.current;
      if (!anchor || !viewportElement) return;

      pendingScrollAnchorRef.current = null;
      projector.scrollToLogical({
        lineCount: textLines.length,
        lineHeight,
        logicalScrollTop: restoreCodeReadingAnchor({
          anchor,
          lineCount: textLines.length,
          lineHeight,
        }),
        viewport: viewportElement,
      });
    },
  );

  const scrollLineRange = React.useCallback(
    (range: CodeLineRange | null, options?: ScrollToOptions) => {
      const viewportElement = viewportRef.current;
      const normalizedRange = normalizeTextLineRange(range, textLines.length);
      if (!viewportElement || !normalizedRange) return;

      projector.scrollToLogical({
        behavior: options?.behavior ?? "smooth",
        lineCount: textLines.length,
        lineHeight,
        logicalScrollTop: scrollTopForLineRangeMetrics({
          startLine: normalizedRange.start,
          endLine: normalizedRange.end,
          lineHeight,
          paddingStart: CODE_VIEWER_BLOCK_PADDING,
          viewportHeight: viewportElement.clientHeight,
        }),
        viewport: viewportElement,
      });
    },
    [lineHeight, projector, textLines.length],
  );

  React.useImperativeHandle(
    forwardedRef ?? null,
    () => ({
      scrollToLineRange: scrollLineRange,
      getViewportElement: () => viewportRef.current,
    }),
    [scrollLineRange],
  );

  useKeyedMountEffect(
    joinEffectKey(["code-highlight-scroll", highlightRange, scrollLineRange]),
    () => {
      if (!highlightRange) return;
      scrollLineRange(highlightRange, { behavior: "smooth" });
    },
  );

  const project = React.useCallback(() => {
    const rowHost = rowHostRef.current;
    const viewport = viewportRef.current;
    if (!rowHost || !viewport) return false;

    return projector.project({
      contentIdentity,
      gutterWidth,
      highlightRange,
      layoutIdentity,
      lineHeight,
      rowHost,
      syntax,
      syntaxIdentity,
      textLines,
      viewport,
    });
  }, [
    contentIdentity,
    gutterWidth,
    highlightRange,
    layoutIdentity,
    lineHeight,
    projector,
    syntax,
    syntaxIdentity,
    textLines,
  ]);

  const copyLongLineSelection = React.useCallback(
    (event: React.ClipboardEvent<HTMLPreElement>) => {
      const rowHost = rowHostRef.current;
      if (!rowHost) return;

      const selectedText = getCodeLongLineSelectionText({
        rowHost,
        selection: window.getSelection(),
        textLines,
      });
      if (selectedText == null) return;

      event.clipboardData.setData("text/plain", selectedText);
      event.preventDefault();
    },
    [textLines],
  );

  useCodeProjectionScheduler({
    project,
    rowHostRef,
    viewportRef,
  });

  useMountEffect(() => () => projector.destroy());
  // Burette patch: destroy the syntax engine on a macrotask so StrictMode's
  // mount -> cleanup -> mount cycle does not permanently kill the memoized
  // instance (destroyed engines answer every token request with null, which
  // renders the whole file without highlighting).
  const syntaxDisposalRef = React.useRef<{ syntax: typeof syntax; timer: number } | null>(null);
  useKeyedMountEffect(joinEffectKey(["code-syntax", syntax]), () => {
    const pending = syntaxDisposalRef.current;
    if (pending && pending.syntax === syntax) {
      window.clearTimeout(pending.timer);
      syntaxDisposalRef.current = null;
    }
    setSyntaxVersion(0);
    return () => {
      const timer = window.setTimeout(() => {
        if (syntaxDisposalRef.current?.syntax === syntax) syntaxDisposalRef.current = null;
        syntax.destroy?.();
      }, 0);
      syntaxDisposalRef.current = { syntax, timer };
    };
  });

  useCodeControlsRegistration({
    downloadAction,
    fontScale,
    lineCount: textLines.length,
    onResetZoom,
    onZoomIn,
    onZoomOut,
  });

  return (
    <CodeViewerFrame className={className} bare={bare}>
      {controls ? (
        <CodeViewerControls
          lineCount={textLines.length}
          fontScale={fontScale}
          downloadAction={downloadAction}
          onZoomOut={onZoomOut}
          onZoomIn={onZoomIn}
          onResetZoom={onResetZoom}
        />
      ) : null}
      <DeferredNativeFindIndex
        lineCount={textLines.length}
        lines={textLines}
        scrollToLineRange={scrollLineRange}
      />
      <CodeViewerViewport
        fontScale={fontScale}
        gutterWidth={gutterWidth}
        lineCount={textLines.length}
        lineHeight={lineHeight}
        onCopy={copyLongLineSelection}
        rowHostRef={rowHostRef}
        viewportRef={viewportRef}
      />
    </CodeViewerFrame>
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
    range: CodeLineRange | null,
    options?: ScrollToOptions,
  ) => void;
}) {
  const [isReady, setIsReady] = React.useState(false);

  useKeyedMountEffect(joinEffectKey(["code-native-find", lines]), () => {
    setIsReady(false);
    const show = () => setIsReady(true);
    if (typeof window === "undefined") return;
    const browserWindow = window as CodeIdleWindow;
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
    range: CodeLineRange | null,
    options?: ScrollToOptions,
  ) => void;
}) {
  const entries = React.useMemo(() => chunkNativeFindLines(lines), [lines]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none h-0 w-0 overflow-hidden opacity-0"
      data-native-find-indexed-chunks={entries.length}
      data-native-find-indexed-lines={lines.length}
      data-slot="code-native-find-index"
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
  entry: NativeFindCodeChunk;
  lineCount: number;
  scrollToLineRange: (
    range: CodeLineRange | null,
    options?: ScrollToOptions,
  ) => void;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  useKeyedLayoutEffect(
    joinEffectKey([
      "code-native-find-entry",
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
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            element.setAttribute("hidden", "until-found");
          });
          return;
        }
        element.setAttribute("hidden", "until-found");
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
      className="block h-px w-px overflow-hidden whitespace-pre"
      data-native-find-end-line={entry.endLine}
      data-native-find-start-line={entry.startLine}
    >
      {entry.text || " "}
    </span>
  );
}

function chunkNativeFindLines(lines: readonly string[]): NativeFindCodeChunk[] {
  const chunks: NativeFindCodeChunk[] = [];
  for (
    let startIndex = 0;
    startIndex < lines.length;
    startIndex += CODE_VIEWER_NATIVE_FIND_CHUNK_SIZE
  ) {
    const endIndex = Math.min(
      lines.length,
      startIndex + CODE_VIEWER_NATIVE_FIND_CHUNK_SIZE,
    );
    chunks.push({
      endLine: endIndex,
      startLine: startIndex + 1,
      text: lines.slice(startIndex, endIndex).join("\n"),
    });
  }
  return chunks;
}

function useCodeControlsRegistration({
  downloadAction,
  fontScale,
  lineCount,
  onResetZoom,
  onZoomIn,
  onZoomOut,
}: {
  downloadAction: ViewerResource["originalDownload"] | null;
  fontScale: number;
  lineCount: number;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const onControlsChange = useViewerControlsRegistration();
  const controlsState = React.useMemo(
    () =>
      codeViewerControlsState({
        downloadAction,
        fontScale,
        lineCount,
        onResetZoom,
        onZoomIn,
        onZoomOut,
      }),
    [downloadAction, fontScale, lineCount, onResetZoom, onZoomIn, onZoomOut],
  );

  useKeyedMountEffect(
    joinEffectKey(["code-controls", onControlsChange, controlsState]),
    () => {
      if (!onControlsChange) return;
      onControlsChange(controlsState);
      return () => onControlsChange(null);
    },
  );
}

function captureCodeReadingAnchor({
  lineCount,
  lineHeight,
  projector,
  viewportElement,
}: {
  lineCount: number;
  lineHeight: number;
  projector: ReturnType<typeof createCodeProjector>;
  viewportElement: HTMLDivElement | null;
}): CodeReadingAnchor | null {
  if (!viewportElement || lineCount <= 0 || lineHeight <= 0) return null;

  const scrollTop = projector.getLogicalScrollTop({
    lineCount,
    lineHeight,
    viewport: viewportElement,
  });
  const contentTop = Math.max(0, scrollTop - CODE_VIEWER_BLOCK_PADDING);
  const lineIndex = Math.min(
    lineCount - 1,
    Math.max(0, Math.floor(contentTop / lineHeight)),
  );

  return {
    lineIndex,
    offsetPx: Math.max(0, contentTop - lineIndex * lineHeight),
  };
}

function restoreCodeReadingAnchor({
  anchor,
  lineCount,
  lineHeight,
}: {
  anchor: CodeReadingAnchor;
  lineCount: number;
  lineHeight: number;
}) {
  if (lineCount <= 0 || lineHeight <= 0) return 0;

  const lineIndex = Math.min(lineCount - 1, Math.max(0, anchor.lineIndex));
  return (
    CODE_VIEWER_BLOCK_PADDING +
    lineIndex * lineHeight +
    Math.min(anchor.offsetPx, Math.max(0, lineHeight - 1))
  );
}

function codeContentIdentity({
  contentKey,
  maxBytes,
  maxLines,
  retryVersion,
}: {
  contentKey: string;
  maxBytes: number;
  maxLines: number;
  retryVersion: number;
}) {
  return [contentKey, retryVersion, maxBytes, maxLines].join("\u0000");
}

function codeLayoutIdentity({
  gutterWidth,
  lineHeight,
}: {
  gutterWidth: string;
  lineHeight: number;
}) {
  return [lineHeight, gutterWidth].join("\u0000");
}
