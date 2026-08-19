import {
  CODE_VIEWER_BLOCK_PADDING,
  CODE_VIEWER_INITIAL_VIEWPORT_HEIGHT,
  CODE_VIEWER_OVERSCAN_PX,
} from "./code-viewer-scale";
import type { CodeSyntax, CodeTokenLeaf } from "./code-viewer-syntax";
import {
  getCodeLogicalScrollTop,
  getCodePagedLayoutTop,
  getCodePhysicalScrollSize,
  getCodeVirtualLineWindow,
  getCodeVirtualTotalSize,
  resolveCodePhysicalScrollPosition,
  type CodeVirtualLine,
} from "./code-viewer-virtualization";
import { getCodeLineRenderText } from "./code-viewer-long-lines";
import { isLineInRange, type NormalizedTextLineRange } from "./line-ranges";

// Opaque fills mixed from the theme's opaque `--foreground`/`--background`
// tokens (the `--muted`/`--accent` tokens are alpha-based, so they cannot mask
// scrolled content). Shared with the viewport's full-height gutter rail.
export const CODE_GUTTER_BACKGROUND =
  "color-mix(in oklab, var(--foreground) 3%, var(--background))";
const CODE_HIGHLIGHT_BACKGROUND =
  "color-mix(in oklab, var(--foreground) 8%, var(--background))";
const CODE_HIGHLIGHT_ACCENT_SHADOW = "inset 2px 0 0 0 var(--primary)";
const CODE_HIGHLIGHT_NUMBER_COLOR =
  "color-mix(in oklab, var(--foreground) 70%, transparent)";

export type CodeProjectionIdentity = {
  contentIdentity: string;
  layoutIdentity: string;
  syntaxIdentity: string;
};

export type CodeProjectionInput = CodeProjectionIdentity & {
  rowHost: HTMLPreElement;
  viewport: HTMLDivElement;
  textLines: readonly string[];
  lineHeight: number;
  gutterWidth: string;
  highlightRange: NormalizedTextLineRange | null;
  syntax: CodeSyntax;
};

export type CodeProjector = {
  getLogicalScrollTop(input: CodeProjectionScrollInput): number;
  project(input: CodeProjectionInput): boolean;
  scrollToLogical(input: CodeProjectionScrollToInput): void;
  destroy(): void;
};

export type CodeProjectionScrollInput = {
  lineCount: number;
  lineHeight: number;
  viewport: HTMLDivElement;
};

export type CodeProjectionScrollToInput = CodeProjectionScrollInput & {
  behavior?: ScrollBehavior;
  logicalScrollTop: number;
};

export type CodeProjectionMetrics = {
  contentPatches: number;
  layoutPatches: number;
  noops: number;
  projections: number;
  rowsCreated: number;
  rowsRemoved: number;
  rowsReused: number;
  tokenSpanRebuilds: number;
  visibleEnd: number;
  visibleStart: number;
};

export type CodeProjectorOptions = {
  metrics?: CodeProjectionMetrics;
};

type CodeRowCache = {
  contentIdentity: string;
  contentSpan: HTMLSpanElement;
  gutterSpan: HTMLSpanElement;
  layoutIdentity: string;
  row: HTMLDivElement;
};

type VisibleRange = {
  end: number;
  start: number;
};

type LastProjection = CodeProjectionIdentity & {
  highlightIdentity: string;
  horizontalScrollLeft: number;
  renderedWindowHeight: number;
  renderedWindowStickyOffset: number;
  renderedWindowTop: number;
  logicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: string;
  visibleEnd: number;
  visibleStart: number;
};

type CodeRenderedWindow = {
  height: number;
  rowOffset: number;
  stickyOffset: number;
  top: number;
};

const MAX_RECYCLED_CODE_ROWS = 512;

export function createCodeProjectionMetrics(): CodeProjectionMetrics {
  return {
    contentPatches: 0,
    layoutPatches: 0,
    noops: 0,
    projections: 0,
    rowsCreated: 0,
    rowsRemoved: 0,
    rowsReused: 0,
    tokenSpanRebuilds: 0,
    visibleEnd: 0,
    visibleStart: 0,
  };
}

export function createCodeProjector(
  options: CodeProjectorOptions = {},
): CodeProjector {
  let identity: CodeProjectionIdentity | null = null;
  let lastProjection: LastProjection | null = null;
  let metrics = options.metrics;
  let rowHost: HTMLPreElement | null = null;
  let recycledRows: CodeRowCache[] = [];
  const rowsByLineIndex = new Map<number, CodeRowCache>();
  let scrollPageOffset = 0;
  let visibleRange: VisibleRange | null = null;

  return {
    getLogicalScrollTop(input) {
      return getCodeLogicalScrollTop({
        physicalScrollTop: input.viewport.scrollTop,
        scrollPageOffset,
        totalSize: codeTotalSize(input),
        viewportHeight: codeViewportHeight(input.viewport),
      });
    },
    project(input) {
      metrics = options.metrics;
      incrementMetric(metrics, "projections");

      if (rowHost !== input.rowHost) {
        clearRows();
        rowHost = input.rowHost;
      }

      const nextIdentity = codeProjectionIdentity(input);
      if (
        !identity ||
        identity.contentIdentity !== nextIdentity.contentIdentity
      ) {
        identity = nextIdentity;
        clearRows();
      } else {
        identity = nextIdentity;
      }

      const totalSize = codeTotalSize({
        lineCount: input.textLines.length,
        lineHeight: input.lineHeight,
        viewport: input.viewport,
      });
      const viewportHeight = codeViewportHeight(input.viewport);
      const previousProjection = lastProjection;
      const logicalScrollTop = getCodeLogicalScrollTop({
        physicalScrollTop: input.viewport.scrollTop,
        scrollPageOffset,
        totalSize,
        viewportHeight,
      });
      const physicalScrollPosition = resolveCodePhysicalScrollPosition({
        logicalScrollTop,
        scrollPageOffset,
        totalSize,
        viewportHeight,
      });
      const previousScrollPageOffset = scrollPageOffset;
      scrollPageOffset = physicalScrollPosition.scrollPageOffset;

      if (
        physicalScrollPosition.physicalScrollTop !== input.viewport.scrollTop
      ) {
        input.viewport.scrollTop = physicalScrollPosition.physicalScrollTop;
      }

      const physicalTotalSize = getCodePhysicalScrollSize({
        totalSize,
        viewportHeight,
      });
      const totalHeight = `${physicalTotalSize}px`;
      const fitPerfectly = shouldFitCodePerfectly({
        previousProjection,
        logicalScrollTop,
        viewportHeight,
      });

      const virtualWindow = getCodeVirtualLineWindow({
        lineCount: input.textLines.length,
        lineHeight: input.lineHeight,
        overscanPx: fitPerfectly
          ? getCodeFitPerfectlyOverscanPx(input.lineHeight)
          : CODE_VIEWER_OVERSCAN_PX,
        paddingStart: CODE_VIEWER_BLOCK_PADDING,
        scrollTop: logicalScrollTop,
        viewportHeight,
      });
      const visibleLines = virtualWindow.lines;
      const renderedWindow = codeRenderedWindow({
        physicalTotalSize,
        rowHost: input.rowHost,
        scrollPageOffset,
        totalSize,
        viewportHeight,
        visibleLines,
      });
      const nextVisibleRange = codeVisibleRange(visibleLines);
      const nextProjection = codeLastProjection({
        input,
        logicalScrollTop,
        renderedWindow,
        scrollPageOffset,
        totalHeight,
        visibleRange: nextVisibleRange,
      });
      if (
        lastProjection &&
        isSameCodeProjection(lastProjection, nextProjection) &&
        isRenderedDomValid(nextVisibleRange)
      ) {
        incrementMetric(metrics, "noops");
        return false;
      }
      lastProjection = nextProjection;
      setMetric(metrics, "visibleStart", nextVisibleRange.start);
      setMetric(metrics, "visibleEnd", nextVisibleRange.end);

      syncCodeScrollLayers({
        renderedWindow,
        rowHost: input.rowHost,
        totalHeight,
      });

      syncVisibleRows({
        input,
        nextVisibleRange,
        previousScrollPageOffset,
        renderedWindow,
        totalSize,
        viewportHeight,
        visibleLines,
      });
      visibleRange = nextVisibleRange;
      return fitPerfectly;
    },
    scrollToLogical(input) {
      const totalSize = codeTotalSize(input);
      const viewportHeight = codeViewportHeight(input.viewport);
      const physicalScrollPosition = resolveCodePhysicalScrollPosition({
        logicalScrollTop: input.logicalScrollTop,
        scrollPageOffset,
        totalSize,
        viewportHeight,
      });
      scrollPageOffset = physicalScrollPosition.scrollPageOffset;
      if (typeof input.viewport.scrollTo === "function") {
        input.viewport.scrollTo({
          top: physicalScrollPosition.physicalScrollTop,
          behavior: input.behavior,
        });
      } else {
        input.viewport.scrollTop = physicalScrollPosition.physicalScrollTop;
      }
    },
    destroy() {
      clearRows();
      recycledRows = [];
      rowHost = null;
      identity = null;
      scrollPageOffset = 0;
    },
  };

  function syncVisibleRows({
    input,
    nextVisibleRange,
    previousScrollPageOffset,
    renderedWindow,
    totalSize,
    viewportHeight,
    visibleLines,
  }: {
    input: CodeProjectionInput;
    nextVisibleRange: VisibleRange;
    previousScrollPageOffset: number;
    renderedWindow: CodeRenderedWindow;
    totalSize: number;
    viewportHeight: number;
    visibleLines: readonly CodeVirtualLine[];
  }) {
    if (
      previousScrollPageOffset === scrollPageOffset &&
      applyPartialRender({
        input,
        nextVisibleRange,
        renderedWindow,
        totalSize,
        viewportHeight,
        visibleLines,
      })
    ) {
      return;
    }

    clearMountedRows();
    syncVisibleRowOrder({
      input,
      renderedWindow,
      totalSize,
      viewportHeight,
      visibleLines,
    });
  }

  function syncVisibleRowOrder({
    input,
    renderedWindow,
    totalSize,
    viewportHeight,
    visibleLines,
  }: {
    input: CodeProjectionInput;
    renderedWindow: CodeRenderedWindow;
    totalSize: number;
    viewportHeight: number;
    visibleLines: readonly CodeVirtualLine[];
  }) {
    let cursor = input.rowHost.firstChild;

    for (const visibleLine of visibleLines) {
      const row = prepareCodeRow({
        input,
        renderedWindow,
        totalSize,
        viewportHeight,
        visibleLine,
      });
      if (row !== cursor) {
        input.rowHost.insertBefore(row, cursor);
      }
      cursor = row.nextSibling;
    }

    while (cursor) {
      const nextCursor = cursor.nextSibling;
      cursor.parentNode?.removeChild(cursor);
      cursor = nextCursor;
    }
  }

  function applyPartialRender({
    input,
    nextVisibleRange,
    renderedWindow,
    totalSize,
    viewportHeight,
    visibleLines,
  }: {
    input: CodeProjectionInput;
    nextVisibleRange: VisibleRange;
    renderedWindow: CodeRenderedWindow;
    totalSize: number;
    viewportHeight: number;
    visibleLines: readonly CodeVirtualLine[];
  }): boolean {
    const previousRange = visibleRange;
    if (!previousRange) return false;
    if (!isRenderedDomValid(previousRange)) return false;

    const overlapStart = Math.max(previousRange.start, nextVisibleRange.start);
    const overlapEnd = Math.min(previousRange.end, nextVisibleRange.end);
    if (overlapStart >= overlapEnd) {
      return false;
    }

    removeCodeRowRange(previousRange.start, overlapStart);
    removeCodeRowRange(overlapEnd, previousRange.end);

    syncVisibleRowOrder({
      input,
      renderedWindow,
      totalSize,
      viewportHeight,
      visibleLines,
    });
    return true;
  }

  function clearRows() {
    for (const row of rowsByLineIndex.values()) {
      recycleCodeRow(row);
    }
    rowHost?.replaceChildren();
    rowsByLineIndex.clear();
    lastProjection = null;
    visibleRange = null;
  }

  function clearMountedRows() {
    if (!visibleRange) return;
    removeCodeRowRange(visibleRange.start, visibleRange.end);
    visibleRange = null;
  }

  function removeCodeRowRange(start: number, end: number) {
    for (
      let index = Math.max(0, start);
      index < Math.max(start, end);
      index++
    ) {
      const row = rowsByLineIndex.get(index);
      if (!row) continue;
      row.row.remove();
      incrementMetric(metrics, "rowsRemoved");
      recycleCodeRow(row);
      rowsByLineIndex.delete(index);
    }
  }

  function isRenderedDomValid(range: VisibleRange) {
    if (!rowHost) return false;
    const expectedLength = Math.max(0, range.end - range.start);
    if (rowHost.children.length !== expectedLength) return false;

    for (let offset = 0; offset < expectedLength; offset += 1) {
      const index = range.start + offset;
      const element = rowHost.children[offset];
      const row = rowsByLineIndex.get(index);
      if (!(element instanceof HTMLDivElement) || row?.row !== element) {
        return false;
      }
      if (element.dataset.lineIndex !== String(index)) {
        return false;
      }
    }
    return true;
  }

  function recycleCodeRow(row: CodeRowCache) {
    row.contentIdentity = "";
    row.layoutIdentity = "";
    if (recycledRows.length < MAX_RECYCLED_CODE_ROWS) {
      recycledRows.push(row);
    }
  }

  function prepareCodeRow({
    input,
    renderedWindow,
    totalSize,
    viewportHeight,
    visibleLine,
  }: {
    input: CodeProjectionInput;
    renderedWindow: CodeRenderedWindow;
    totalSize: number;
    viewportHeight: number;
    visibleLine: CodeVirtualLine;
  }): HTMLDivElement {
    const lineNumber = visibleLine.index + 1;
    const text = input.textLines[visibleLine.index] ?? "";
    const isHighlighted = isLineInRange(lineNumber, input.highlightRange);
    const layoutIdentity = [
      lineNumber,
      input.layoutIdentity,
      isHighlighted ? "highlighted" : "",
    ].join("\u0000");
    const contentIdentity = codeRowContentIdentity({
      syntax: input.syntax,
      text,
    });

    let row = rowsByLineIndex.get(visibleLine.index);
    if (!row) {
      row = recycledRows.pop();
      if (row) {
        incrementMetric(metrics, "rowsReused");
      } else {
        row = createCodeRow();
        incrementMetric(metrics, "rowsCreated");
      }
      rowsByLineIndex.set(visibleLine.index, row);
    }

    setStyleValue(row.row.style, "height", `${visibleLine.size}px`);
    setStyleValue(
      row.row.style,
      "transform",
      `translateY(${
        getCodePagedLayoutTop({
          logicalTop: visibleLine.start,
          scrollPageOffset,
          totalSize,
          viewportHeight,
        }) - renderedWindow.rowOffset
      }px)`,
    );

    if (row.layoutIdentity !== layoutIdentity) {
      row.layoutIdentity = layoutIdentity;
      patchCodeRowLayout({
        gutterWidth: input.gutterWidth,
        isHighlighted,
        metrics,
        lineNumber,
        row,
      });
    }

    if (row.contentIdentity !== contentIdentity) {
      row.contentIdentity = contentIdentity;
      patchCodeRowContent({
        metrics,
        row,
        syntax: input.syntax,
        text,
      });
    }

    return row.row;
  }
}

function codeLastProjection({
  input,
  logicalScrollTop,
  renderedWindow,
  scrollPageOffset,
  totalHeight,
  visibleRange,
}: {
  input: CodeProjectionInput;
  logicalScrollTop: number;
  renderedWindow: CodeRenderedWindow;
  scrollPageOffset: number;
  totalHeight: string;
  visibleRange: VisibleRange;
}): LastProjection {
  return {
    contentIdentity: input.contentIdentity,
    highlightIdentity: codeHighlightIdentity(input.highlightRange),
    horizontalScrollLeft: input.viewport.scrollLeft,
    layoutIdentity: input.layoutIdentity,
    logicalScrollTop,
    renderedWindowHeight: renderedWindow.height,
    renderedWindowStickyOffset: renderedWindow.stickyOffset,
    renderedWindowTop: renderedWindow.top,
    scrollPageOffset,
    syntaxIdentity: input.syntaxIdentity,
    totalHeight,
    visibleEnd: visibleRange.end,
    visibleStart: visibleRange.start,
  };
}

function codeHighlightIdentity(range: NormalizedTextLineRange | null) {
  return range ? `${range.start}:${range.end}` : "";
}

function isSameCodeProjection(previous: LastProjection, next: LastProjection) {
  return (
    previous.contentIdentity === next.contentIdentity &&
    previous.highlightIdentity === next.highlightIdentity &&
    previous.horizontalScrollLeft === next.horizontalScrollLeft &&
    previous.layoutIdentity === next.layoutIdentity &&
    previous.renderedWindowHeight === next.renderedWindowHeight &&
    previous.renderedWindowStickyOffset === next.renderedWindowStickyOffset &&
    previous.renderedWindowTop === next.renderedWindowTop &&
    previous.scrollPageOffset === next.scrollPageOffset &&
    previous.syntaxIdentity === next.syntaxIdentity &&
    previous.totalHeight === next.totalHeight &&
    previous.visibleEnd === next.visibleEnd &&
    previous.visibleStart === next.visibleStart
  );
}

function codeProjectionIdentity({
  contentIdentity,
  layoutIdentity,
  syntaxIdentity,
}: CodeProjectionIdentity): CodeProjectionIdentity {
  return {
    contentIdentity,
    layoutIdentity,
    syntaxIdentity,
  };
}

function codeVisibleRange(
  visibleLines: readonly CodeVirtualLine[],
): VisibleRange {
  const start = visibleLines[0]?.index ?? 0;
  const end = visibleLines.length
    ? visibleLines[visibleLines.length - 1]!.index + 1
    : start;
  return { end, start };
}

function codeTotalSize({
  lineCount,
  lineHeight,
}: {
  lineCount: number;
  lineHeight: number;
  viewport?: HTMLDivElement;
}) {
  return getCodeVirtualTotalSize({
    lineCount,
    lineHeight,
  });
}

function codeViewportHeight(viewport: HTMLDivElement) {
  return viewport.clientHeight || CODE_VIEWER_INITIAL_VIEWPORT_HEIGHT;
}

function shouldFitCodePerfectly({
  previousProjection,
  logicalScrollTop,
  viewportHeight,
}: {
  previousProjection: LastProjection | null;
  logicalScrollTop: number;
  viewportHeight: number;
}) {
  if (!previousProjection) return false;
  return (
    Math.abs(logicalScrollTop - previousProjection.logicalScrollTop) >
    viewportHeight + CODE_VIEWER_OVERSCAN_PX * 2
  );
}

function getCodeFitPerfectlyOverscanPx(lineHeight: number) {
  return Math.max(
    CODE_VIEWER_BLOCK_PADDING,
    Number.isFinite(lineHeight) ? lineHeight : 0,
  );
}

function codeRenderedWindow({
  physicalTotalSize,
  rowHost,
  scrollPageOffset,
  totalSize,
  viewportHeight,
  visibleLines,
}: {
  physicalTotalSize: number;
  rowHost: HTMLPreElement;
  scrollPageOffset: number;
  totalSize: number;
  viewportHeight: number;
  visibleLines: readonly CodeVirtualLine[];
}): CodeRenderedWindow {
  const renderedWindowElement = getCodeRenderedWindowElement(rowHost);
  if (!renderedWindowElement) {
    return {
      height: physicalTotalSize,
      rowOffset: 0,
      stickyOffset: 0,
      top: 0,
    };
  }

  const firstLine = visibleLines[0];
  const lastLine = visibleLines[visibleLines.length - 1];
  if (!firstLine || !lastLine) {
    return {
      height: 0,
      rowOffset: 0,
      stickyOffset: 0,
      top: 0,
    };
  }

  const top = getCodePagedLayoutTop({
    logicalTop: firstLine.start,
    scrollPageOffset,
    totalSize,
    viewportHeight,
  });
  const bottom = getCodePagedLayoutTop({
    logicalTop: lastLine.start + lastLine.size,
    scrollPageOffset,
    totalSize,
    viewportHeight,
  });
  const height = Math.max(0, bottom - top);

  return {
    height,
    rowOffset: top,
    stickyOffset: Math.min(0, viewportHeight - height),
    top,
  };
}

function syncCodeScrollLayers({
  renderedWindow,
  rowHost,
  totalHeight,
}: {
  renderedWindow: CodeRenderedWindow;
  rowHost: HTMLPreElement;
  totalHeight: string;
}) {
  const renderedWindowElement = getCodeRenderedWindowElement(rowHost);
  if (!renderedWindowElement) {
    setStyleValue(rowHost.style, "height", totalHeight);
    if (rowHost.parentElement instanceof HTMLElement) {
      setStyleValue(rowHost.parentElement.style, "height", totalHeight);
    }
    return;
  }

  const height = `${renderedWindow.height}px`;
  const top = `${renderedWindow.top}px`;
  const stickyOffset = `${renderedWindow.stickyOffset}px`;
  const offsetElement = getCodeRenderedWindowOffsetElement(
    renderedWindowElement,
  );

  setStyleValue(rowHost.style, "height", height);
  if (offsetElement) setStyleValue(offsetElement.style, "height", top);
  setStyleValue(renderedWindowElement.style, "height", height);
  setStyleValue(renderedWindowElement.style, "margin-top", "");
  setStyleValue(renderedWindowElement.style, "top", stickyOffset);
  setStyleValue(renderedWindowElement.style, "bottom", stickyOffset);

  if (renderedWindowElement.parentElement instanceof HTMLElement) {
    setStyleValue(renderedWindowElement.parentElement.style, "height", totalHeight);
  }
}

function getCodeRenderedWindowElement(rowHost: HTMLPreElement) {
  const element = rowHost.parentElement;
  if (
    element instanceof HTMLElement &&
    element.dataset.codeRenderWindow != null
  ) {
    return element;
  }
  return null;
}

function getCodeRenderedWindowOffsetElement(renderedWindowElement: HTMLElement) {
  const element = renderedWindowElement.previousElementSibling;
  if (
    element instanceof HTMLElement &&
    element.dataset.codeRenderOffset != null
  ) {
    return element;
  }
  return null;
}

function codeRowContentIdentity({
  syntax,
  text,
}: {
  syntax: CodeSyntax;
  text: string;
}) {
  return [text, syntax.identity, syntax.getLineVersion(text)].join("\u0000");
}

function createCodeRow(): CodeRowCache {
  const row = document.createElement("div");
  const gutterSpan = document.createElement("span");
  const contentSpan = document.createElement("span");

  row.className = codeRowClassName();
  row.style.position = "absolute";
  row.style.top = "0";
  row.style.left = "0";

  gutterSpan.className =
    "sticky left-0 z-10 flex-shrink-0 border-r px-2 pr-3 text-right text-muted-foreground/60 select-none";
  // The gutter must paint an opaque background so horizontally-scrolled code
  // never shows through the sticky line-number column. The theme's `--muted`
  // token is alpha-based (translucent), so the fill is mixed from the opaque
  // `--foreground`/`--background` pair instead.
  gutterSpan.style.backgroundColor = CODE_GUTTER_BACKGROUND;
  gutterSpan.dataset.codeGutter = "";
  gutterSpan.setAttribute("aria-hidden", "true");
  contentSpan.className = "whitespace-pre px-2";

  row.append(gutterSpan, contentSpan);

  return {
    contentIdentity: "",
    contentSpan,
    gutterSpan,
    layoutIdentity: "",
    row,
  };
}

function patchCodeRowLayout({
  gutterWidth,
  isHighlighted,
  metrics,
  lineNumber,
  row,
}: {
  gutterWidth: string;
  isHighlighted: boolean;
  metrics: CodeProjectionMetrics | undefined;
  lineNumber: number;
  row: CodeRowCache;
}) {
  incrementMetric(metrics, "layoutPatches");
  row.row.dataset.lineIndex = String(lineNumber - 1);
  row.row.dataset.lineNumber = String(lineNumber);
  setStyleValue(row.gutterSpan.style, "width", gutterWidth);
  setTextContent(row.gutterSpan, String(lineNumber));

  // Highlighted range: a continuous opaque band (no per-row borders) with a
  // single left accent stripe on the gutter that merges across adjacent lines.
  setStyleValue(
    row.row.style,
    "background-color",
    isHighlighted ? CODE_HIGHLIGHT_BACKGROUND : "",
  );
  setStyleValue(
    row.gutterSpan.style,
    "background-color",
    isHighlighted ? CODE_HIGHLIGHT_BACKGROUND : CODE_GUTTER_BACKGROUND,
  );
  setStyleValue(
    row.gutterSpan.style,
    "box-shadow",
    isHighlighted ? CODE_HIGHLIGHT_ACCENT_SHADOW : "",
  );
  setStyleValue(
    row.gutterSpan.style,
    "color",
    isHighlighted ? CODE_HIGHLIGHT_NUMBER_COLOR : "",
  );
}

function patchCodeRowContent({
  metrics,
  row,
  syntax,
  text,
}: {
  metrics: CodeProjectionMetrics | undefined;
  row: CodeRowCache;
  syntax: CodeSyntax;
  text: string;
}) {
  incrementMetric(metrics, "contentPatches");
  const renderText = getCodeLineRenderText(text);
  if (renderText.isTruncated) {
    row.row.dataset.codeLineTruncated = "";
    row.contentSpan.dataset.codeLineTruncated = "";
    row.contentSpan.setAttribute(
      "aria-label",
      `${text.length} character line preview; ${renderText.omittedCharacterCount} middle characters omitted.`,
    );
    row.contentSpan.title =
      "Long line preview. Copying the selected row copies the complete line.";
  } else {
    delete row.row.dataset.codeLineTruncated;
    delete row.contentSpan.dataset.codeLineTruncated;
    row.contentSpan.removeAttribute("aria-label");
    row.contentSpan.removeAttribute("title");
  }

  patchCodeContent(
    row.contentSpan,
    renderText.isTruncated ? null : syntax.getLineTokens(text),
    renderText.text,
    metrics,
  );
}

function patchCodeContent(
  contentSpan: HTMLSpanElement,
  leaves: readonly CodeTokenLeaf[] | null,
  text: string,
  metrics: CodeProjectionMetrics | undefined,
) {
  if (text === "") {
    contentSpan.replaceChildren();
    contentSpan.textContent = " ";
    return;
  }
  if (!leaves) {
    setTextContent(contentSpan, text);
    return;
  }

  contentSpan.replaceChildren();
  incrementMetric(metrics, "tokenSpanRebuilds");
  const fragment = document.createDocumentFragment();
  for (const leaf of leaves) {
    if (!leaf.kind) {
      fragment.append(document.createTextNode(leaf.text));
      continue;
    }
    const span = document.createElement("span");
    span.className = "cv-token-" + leaf.kind;
    span.textContent = leaf.text;
    fragment.append(span);
  }
  contentSpan.append(fragment);
}

function codeRowClassName() {
  return "absolute top-0 left-0 flex min-w-full";
}

function setStyleValue(
  style: CSSStyleDeclaration,
  propertyName: string,
  value: string,
) {
  if (style.getPropertyValue(propertyName) !== value) {
    style.setProperty(propertyName, value);
  }
}

function setTextContent(element: HTMLElement, text: string) {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function incrementMetric(
  metrics: CodeProjectionMetrics | undefined,
  key: keyof CodeProjectionMetrics,
) {
  if (!metrics) return;
  metrics[key] += 1;
}

function setMetric(
  metrics: CodeProjectionMetrics | undefined,
  key: keyof CodeProjectionMetrics,
  value: number,
) {
  if (!metrics) return;
  metrics[key] = value;
}
