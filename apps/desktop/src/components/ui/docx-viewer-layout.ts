import { clamp } from "./docx-viewer-core";

export const DOCX_PAGE_GAP_PX = 16;
export const DOCX_VIEWER_PADDING_PX = 16;
export const DOCX_READING_MARKER_RATIO = 0.2;
export const DOCX_VIRTUAL_OVERSCAN_PX = 1000;
export const DOCX_FALLBACK_VIEWPORT_HEIGHT_PX = 768;

export interface DocxPageMetric {
  pageNumber: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
}

export interface DocxPageLayout {
  pages: readonly DocxPageMetric[];
  totalHeight: number;
}

export interface DocxPageWindow {
  afterHeight: number;
  beforeHeight: number;
  endIndex: number;
  renderedBottom: number;
  renderedHeight: number;
  renderedTop: number;
  startIndex: number;
  stickyOffset: number;
}

export type DocxReadingAnchor =
  | {
      kind: "top";
    }
  | {
      kind: "page";
      pageNumber: number;
      yPercent: number;
    };

export function createDocxPageLayout(
  sizes: readonly (readonly [number, number])[],
  gap = DOCX_PAGE_GAP_PX,
): DocxPageLayout {
  let top = 0;
  const pages = sizes.map(([width, height], index) => {
    const page: DocxPageMetric = {
      pageNumber: index + 1,
      width,
      height,
      top,
      bottom: top + height,
    };
    top = page.bottom + gap;
    return page;
  });

  return {
    pages,
    totalHeight: pages.length ? pages[pages.length - 1]!.bottom : 0,
  };
}

export function findDocxPageByMarker({
  layout,
  scale,
  scrollTop,
  viewportHeight,
}: {
  layout: DocxPageLayout | null;
  scale: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  const pages = layout?.pages;
  if (!pages?.length) return null;

  const marker = scrollTop + viewportHeight * DOCX_READING_MARKER_RATIO;
  const y = Math.max(0, (marker - DOCX_VIEWER_PADDING_PX) / safeScale(scale));
  let low = 0;
  let high = pages.length - 1;
  let current = pages[0]!;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const page = pages[mid]!;
    if (page.top <= y) {
      current = page;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return current;
}

export function captureDocxReadingAnchorFromLayout({
  layout,
  scale,
  scrollTop,
  viewportHeight,
}: {
  layout: DocxPageLayout | null;
  scale: number;
  scrollTop: number;
  viewportHeight: number;
}): DocxReadingAnchor {
  if (scrollTop <= 0) return { kind: "top" };

  const page = findDocxPageByMarker({
    layout,
    scale,
    scrollTop,
    viewportHeight,
  });
  if (!page || page.height <= 0) return { kind: "top" };

  const marker = scrollTop + viewportHeight * DOCX_READING_MARKER_RATIO;
  const y = Math.max(0, (marker - DOCX_VIEWER_PADDING_PX) / safeScale(scale));

  return {
    kind: "page",
    pageNumber: page.pageNumber,
    yPercent: clamp((y - page.top) / page.height, 0, 1),
  };
}

export function restoreDocxReadingAnchorFromLayout({
  anchor,
  layout,
  maxScrollTop,
  scale,
  viewportHeight,
}: {
  anchor: DocxReadingAnchor;
  layout: DocxPageLayout | null;
  maxScrollTop: number;
  scale: number;
  viewportHeight: number;
}) {
  if (anchor.kind === "top") return 0;

  const page = layout?.pages[anchor.pageNumber - 1];
  if (!page || page.height <= 0) return null;

  const y = (page.top + page.height * anchor.yPercent) * safeScale(scale);
  const marker = viewportHeight * DOCX_READING_MARKER_RATIO;
  return clamp(DOCX_VIEWER_PADDING_PX + y - marker, 0, maxScrollTop);
}

export function createDocxPageWindowFromScroll({
  layout,
  overscanPx = DOCX_VIRTUAL_OVERSCAN_PX,
  scale,
  scrollTop,
  viewportHeight,
}: {
  layout: DocxPageLayout | null;
  overscanPx?: number;
  scale: number;
  scrollTop: number;
  viewportHeight: number;
}): DocxPageWindow {
  const pages = layout?.pages;
  if (!layout || !pages?.length) {
    return emptyDocxPageWindow();
  }

  const z = safeScale(scale);
  const viewHeight = safeViewportHeight(viewportHeight) / z;
  const overscan = Math.max(0, overscanPx) / z;
  const viewTop = Math.max(0, (scrollTop - DOCX_VIEWER_PADDING_PX) / z);
  const windowTop = Math.max(0, viewTop - overscan);
  const windowBottom = Math.min(
    layout.totalHeight,
    viewTop + viewHeight + overscan,
  );

  let startIndex = pages.findIndex((page) => page.bottom >= windowTop);
  if (startIndex === -1) startIndex = pages.length - 1;

  let endIndex = startIndex;
  while (
    endIndex < pages.length &&
    pages[endIndex]!.top <= Math.max(windowBottom, pages[startIndex]!.top)
  ) {
    endIndex += 1;
  }
  if (endIndex === startIndex)
    endIndex = Math.min(pages.length, startIndex + 1);

  return createDocxPageWindowFromRange({
    endIndex,
    layout,
    startIndex,
    viewportHeight: viewHeight,
  });
}

export function createDocxPageWindowForPage({
  layout,
  pageIndex,
  scale,
  viewportHeight,
}: {
  layout: DocxPageLayout | null;
  pageIndex: number;
  scale: number;
  viewportHeight: number;
}): DocxPageWindow {
  const pages = layout?.pages;
  if (!layout || !pages?.length) return emptyDocxPageWindow();
  const safePageIndex = clamp(Math.floor(pageIndex), 0, pages.length - 1);
  return createDocxPageWindowFromRange({
    endIndex: safePageIndex + 1,
    layout,
    startIndex: safePageIndex,
    viewportHeight: safeViewportHeight(viewportHeight) / safeScale(scale),
  });
}

function createDocxPageWindowFromRange({
  endIndex,
  layout,
  startIndex,
  viewportHeight,
}: {
  endIndex: number;
  layout: DocxPageLayout;
  startIndex: number;
  viewportHeight: number;
}): DocxPageWindow {
  const pages = layout.pages;
  const start = clamp(Math.floor(startIndex), 0, pages.length);
  const end = clamp(Math.ceil(endIndex), start, pages.length);
  const first = pages[start];
  const last = pages[end - 1];
  if (!first || !last) return emptyDocxPageWindow();

  const renderedTop = first.top;
  const renderedBottom = last.bottom;
  const renderedHeight = renderedBottom - renderedTop;

  return {
    afterHeight: Math.max(0, layout.totalHeight - renderedBottom),
    beforeHeight: renderedTop,
    endIndex: end,
    renderedBottom,
    renderedHeight,
    renderedTop,
    startIndex: start,
    stickyOffset: -Math.max(0, renderedHeight - Math.max(1, viewportHeight)),
  };
}

function emptyDocxPageWindow(): DocxPageWindow {
  return {
    afterHeight: 0,
    beforeHeight: 0,
    endIndex: 0,
    renderedBottom: 0,
    renderedHeight: 0,
    renderedTop: 0,
    startIndex: 0,
    stickyOffset: 0,
  };
}

function safeViewportHeight(value: number) {
  return Number.isFinite(value) && value > 0
    ? value
    : DOCX_FALLBACK_VIEWPORT_HEIGHT_PX;
}

function safeScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
