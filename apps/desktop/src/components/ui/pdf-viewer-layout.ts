import type { PdfPageSize } from "./pdf-viewer-types";

// The inter-page gap scales with the document so zoom behaves like a camera.
// The outer padding stays fixed because it is the loaded page's shared frame
// contract with the p-4 fallback skeleton.
export const PDF_PAGE_GAP = 16;
export const PDF_PAGE_PADDING = 16;
export const PDF_RENDER_FIT_PERFECTLY_OVERSCAN_PX =
  PDF_PAGE_GAP + PDF_PAGE_PADDING;
export const PDF_RENDER_WINDOW_OVERSCAN_PX = 1000;
export const PDF_VISIBLE_PAGE_OVERSCAN = 2;
export const PDF_PRELOAD_PAGE_OVERSCAN = 4;
export const PDF_SCROLL_REBASE_CONTAINER_PX = 12_000_000;
export const PDF_SCROLL_REBASE_TRIGGER_PX = 1_000_000;
export const PDF_SCROLL_REBASE_TARGET_PX = 2_000_000;
export const PDF_SCROLL_REBASE_TARGET_BOTTOM_PX =
  PDF_SCROLL_REBASE_CONTAINER_PX - PDF_SCROLL_REBASE_TARGET_PX;
export const PDF_SCROLL_REBASE_THRESHOLD_PX =
  PDF_SCROLL_REBASE_CONTAINER_PX - PDF_SCROLL_REBASE_TRIGGER_PX;

export type PdfPageLayout = {
  pageNumber: number;
  width: number;
  height: number;
  offsetTop: number;
};

export type PdfRenderedPageLayout = PdfPageLayout & {
  windowTop: number;
};

export type PdfRenderedPageWindow = {
  afterHeight: number;
  beforeHeight: number;
  height: number;
  pages: readonly PdfRenderedPageLayout[];
  stickyInset: number;
};

export type PdfRenderPixelWindow = {
  bottom: number;
  top: number;
};

export type PdfScrollRebasePosition = {
  physicalScrollTop: number;
  scrollPageOffset: number;
};

export type PdfMeasuredPageLayout = {
  pageNumber: number;
  width: number;
  height: number;
  heightDelta: number;
};

export type PdfPageLayoutModel = {
  pageCount: number;
  totalHeight: number;
  maxPageWidth: number;
  estimatedWidth: number;
  estimatedHeight: number;
  // Resolved (scaled) vertical spacing, so offset math reads the model rather
  // than re-deriving the scale.
  gap: number;
  padding: number;
  measuredPages: readonly PdfMeasuredPageLayout[];
  measuredPageByNumber: ReadonlyMap<number, PdfMeasuredPageLayout>;
  prefixHeightDeltas: readonly number[];
};

export function createPdfPageLayout({
  pageCount,
  defaultPageSize,
  pageSizeByNumber,
  scale,
  rotation,
}: {
  pageCount: number;
  defaultPageSize: PdfPageSize;
  pageSizeByNumber: ReadonlyMap<number, PdfPageSize>;
  scale: number;
  rotation: number;
}): PdfPageLayoutModel {
  // Rounded to whole pixels like the page dimensions, so offsets stay
  // integer. The sub-pixel rounding residual is absorbed by the model-based
  // reading anchor (which pins the transform to the visible page's actual
  // offset), exactly as page-height rounding already is.
  const gap = Math.round(PDF_PAGE_GAP * scale);
  const padding = PDF_PAGE_PADDING;
  const estimatedSize = getRenderedPageSize(defaultPageSize, scale, rotation);
  const measuredPages = Array.from(pageSizeByNumber.entries())
    .filter(([pageNumber]) => pageNumber >= 1 && pageNumber <= pageCount)
    .map(([pageNumber, pageSize]) => {
      const renderedSize = getRenderedPageSize(pageSize, scale, rotation);
      return {
        pageNumber,
        width: renderedSize.width,
        height: renderedSize.height,
        heightDelta: renderedSize.height - estimatedSize.height,
      };
    })
    .filter(
      (page) =>
        page.width !== estimatedSize.width ||
        page.height !== estimatedSize.height,
    )
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const measuredPageByNumber = new Map(
    measuredPages.map((page) => [page.pageNumber, page]),
  );
  const prefixHeightDeltas: number[] = [];
  let totalHeightDelta = 0;
  let maxPageWidth = pageCount === 0 ? 0 : estimatedSize.width;

  for (const page of measuredPages) {
    totalHeightDelta += page.heightDelta;
    prefixHeightDeltas.push(totalHeightDelta);
    maxPageWidth = Math.max(maxPageWidth, page.width);
  }

  return {
    pageCount,
    totalHeight:
      pageCount === 0
        ? 0
        : padding * 2 +
          pageCount * estimatedSize.height +
          (pageCount - 1) * gap +
          totalHeightDelta,
    maxPageWidth,
    estimatedWidth: estimatedSize.width,
    estimatedHeight: estimatedSize.height,
    gap,
    padding,
    measuredPages,
    measuredPageByNumber,
    prefixHeightDeltas,
  };
}

export function getPdfPageLayout(
  layout: PdfPageLayoutModel,
  pageNumber: number,
): PdfPageLayout | undefined {
  if (pageNumber < 1 || pageNumber > layout.pageCount) return undefined;

  const measuredPage = layout.measuredPageByNumber.get(pageNumber);
  return {
    pageNumber,
    width: measuredPage?.width ?? layout.estimatedWidth,
    height: measuredPage?.height ?? layout.estimatedHeight,
    offsetTop: getPdfPageOffsetTop(layout, pageNumber),
  };
}

export function findPdfPageByOffset(
  layout: PdfPageLayoutModel,
  offset: number,
) {
  if (layout.pageCount === 0) return 1;

  let low = 1;
  let high = layout.pageCount;
  let match = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (getPdfPageOffsetTop(layout, mid) <= offset) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return match;
}

export function getPdfVisiblePageNumbers({
  layout,
  scrollTop,
  viewportHeight,
  overscanPages = PDF_VISIBLE_PAGE_OVERSCAN,
}: {
  layout: PdfPageLayoutModel;
  scrollTop: number;
  viewportHeight: number;
  overscanPages?: number;
}) {
  if (layout.pageCount === 0) return [];

  return getPdfPageNumbersInRange({
    layout,
    startOffset: Math.max(0, scrollTop - viewportHeight),
    endOffset: scrollTop + viewportHeight * 2,
    overscanPages,
  });
}

export function getPdfRenderPageNumbers({
  fitPerfectly = false,
  fitPerfectlyOverscanPx = PDF_RENDER_FIT_PERFECTLY_OVERSCAN_PX,
  layout,
  overscanPx = PDF_RENDER_WINDOW_OVERSCAN_PX,
  scrollTop,
  viewportHeight,
}: {
  fitPerfectly?: boolean;
  fitPerfectlyOverscanPx?: number;
  layout: PdfPageLayoutModel;
  overscanPx?: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  if (layout.pageCount === 0) return [];

  const window = createWindowFromScrollPosition({
    fitPerfectly,
    fitPerfectlyOverscanPx,
    overscanPx,
    scrollHeight: layout.totalHeight,
    scrollTop,
    viewportHeight,
  });

  return getPdfPageNumbersInRange({
    layout,
    startOffset: window.top,
    endOffset: window.bottom,
    overscanPages: 0,
  });
}

export function getPdfPreloadPageNumbers({
  layout,
  renderPageNumbers,
  overscanPages = PDF_PRELOAD_PAGE_OVERSCAN,
}: {
  layout: PdfPageLayoutModel;
  renderPageNumbers: readonly number[];
  overscanPages?: number;
}) {
  if (layout.pageCount === 0 || renderPageNumbers.length === 0) return [];

  const firstRenderPage = renderPageNumbers[0];
  const lastRenderPage = renderPageNumbers[renderPageNumbers.length - 1];
  const firstPage = Math.max(1, firstRenderPage - overscanPages);
  const lastPage = Math.min(layout.pageCount, lastRenderPage + overscanPages);

  return createPageNumberRange(firstPage, lastPage);
}

export function getPdfRenderedPageWindow({
  layout,
  pageNumbers,
  physicalScrollHeight = layout.totalHeight,
  scrollPageOffset = 0,
  viewportHeight,
}: {
  layout: PdfPageLayoutModel;
  pageNumbers: readonly number[];
  physicalScrollHeight?: number;
  scrollPageOffset?: number;
  viewportHeight: number;
}): PdfRenderedPageWindow | null {
  const pages = pageNumbers
    .map((pageNumber) => getPdfPageLayout(layout, pageNumber))
    .filter((page): page is PdfPageLayout => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  if (pages.length === 0) return null;

  const logicalBeforeHeight = pages[0].offsetTop;
  const windowBottom = Math.max(
    ...pages.map((page) => page.offsetTop + page.height),
  );
  const height = Math.max(0, windowBottom - logicalBeforeHeight);
  const beforeHeight = getPdfPagedLayoutTop({
    logicalTop: logicalBeforeHeight,
    scrollPageOffset,
    totalHeight: layout.totalHeight,
    viewportHeight,
  });
  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const safePhysicalScrollHeight = Math.max(
    0,
    finiteNumber(physicalScrollHeight),
  );
  const stickyInset =
    safeViewportHeight > 0 ? -Math.max(0, height - safeViewportHeight) : 0;

  return {
    afterHeight: Math.max(0, safePhysicalScrollHeight - beforeHeight - height),
    beforeHeight,
    height,
    pages: pages.map((page) => ({
      ...page,
      windowTop: page.offsetTop - logicalBeforeHeight,
    })),
    stickyInset,
  };
}

export function createWindowFromScrollPosition({
  fitPerfectly = false,
  fitPerfectlyOverscanPx = 0,
  overscanPx,
  scrollHeight,
  scrollTop,
  viewportHeight,
}: {
  fitPerfectly?: boolean;
  fitPerfectlyOverscanPx?: number;
  overscanPx: number;
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): PdfRenderPixelWindow {
  const safeOverscanPx = safePadding(overscanPx);
  const safeScrollHeight = Math.max(0, finiteNumber(scrollHeight));
  const safeScrollTop = Math.max(0, finiteNumber(scrollTop));
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight));
  const windowHeight = safeViewportHeight + safeOverscanPx * 2;
  const fitPerfectlyOverscan = safePadding(fitPerfectlyOverscanPx);
  const effectiveHeight = fitPerfectly
    ? safeViewportHeight + fitPerfectlyOverscan * 2
    : windowHeight;

  if (windowHeight >= safeScrollHeight || fitPerfectly) {
    const fitScrollTop = Math.min(safeScrollTop, safeScrollHeight);
    const top = Math.max(fitScrollTop - fitPerfectlyOverscan, 0);
    const bottom = Math.min(fitScrollTop + effectiveHeight, safeScrollHeight);
    return {
      bottom: Math.ceil(Math.max(bottom, top)),
      top: Math.floor(Math.max(0, top)),
    };
  }

  const scrollCenter = safeScrollTop + safeViewportHeight / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;

  if (top < 0) {
    top = 0;
    bottom = windowHeight;
  }
  if (bottom > safeScrollHeight) {
    bottom = safeScrollHeight;
    top = safeScrollHeight - windowHeight;
  }

  return {
    bottom: Math.ceil(Math.max(bottom, top)),
    top: Math.floor(Math.max(0, top)),
  };
}

export function getPdfPhysicalScrollHeight({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  const safeTotalHeight = safeSize(totalHeight);
  return shouldRebasePdfScroll({ totalHeight: safeTotalHeight, viewportHeight })
    ? Math.min(safeTotalHeight, PDF_SCROLL_REBASE_CONTAINER_PX)
    : safeTotalHeight;
}

export function getPdfLogicalScrollTop({
  physicalScrollTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  physicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  return clamp(
    finiteNumber(physicalScrollTop) + safePadding(scrollPageOffset),
    0,
    getPdfMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );
}

export function resolvePdfPhysicalScrollPosition({
  logicalScrollTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}): PdfScrollRebasePosition {
  const safeLogicalScrollTop = clamp(
    finiteNumber(logicalScrollTop),
    0,
    getPdfMaxLogicalScrollTop({ totalHeight, viewportHeight }),
  );

  if (!shouldRebasePdfScroll({ totalHeight, viewportHeight })) {
    return {
      physicalScrollTop: clamp(
        safeLogicalScrollTop,
        0,
        getPdfMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
      ),
      scrollPageOffset: 0,
    };
  }

  const currentPageOffset = clampPdfScrollPageOffset({
    scrollPageOffset,
    totalHeight,
    viewportHeight,
  });
  const physicalScrollTop = safeLogicalScrollTop - currentPageOffset;
  const maxPhysicalScrollTop = getPdfMaxPhysicalScrollTop({
    totalHeight,
    viewportHeight,
  });
  const maxPageOffset = getPdfMaxScrollPageOffset({
    totalHeight,
    viewportHeight,
  });
  const shouldMoveDown =
    physicalScrollTop > PDF_SCROLL_REBASE_THRESHOLD_PX &&
    currentPageOffset < maxPageOffset;
  const shouldMoveUp =
    physicalScrollTop < PDF_SCROLL_REBASE_TRIGGER_PX && currentPageOffset > 0;

  if (
    physicalScrollTop < 0 ||
    physicalScrollTop > maxPhysicalScrollTop ||
    shouldMoveDown ||
    shouldMoveUp
  ) {
    return resolvePdfScrollPageWindow({
      logicalScrollTop: safeLogicalScrollTop,
      preferredPhysicalScrollTop: shouldMoveUp
        ? Math.min(PDF_SCROLL_REBASE_TARGET_BOTTOM_PX, maxPhysicalScrollTop)
        : PDF_SCROLL_REBASE_TARGET_PX,
      totalHeight,
      viewportHeight,
    });
  }

  return {
    physicalScrollTop: roundPdfScrollPixel(
      clamp(physicalScrollTop, 0, maxPhysicalScrollTop),
    ),
    scrollPageOffset: currentPageOffset,
  };
}

export function getPdfPagedLayoutTop({
  logicalTop,
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  logicalTop: number;
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  const offset = finiteNumber(scrollPageOffset);
  if (
    Math.abs(offset) <= 0.001 &&
    !shouldRebasePdfScroll({ totalHeight, viewportHeight })
  ) {
    return finiteNumber(logicalTop);
  }
  return Math.max(0, finiteNumber(logicalTop) - offset);
}

function getPdfPageNumbersInRange({
  layout,
  startOffset,
  endOffset,
  overscanPages,
}: {
  layout: PdfPageLayoutModel;
  startOffset: number;
  endOffset: number;
  overscanPages: number;
}) {
  const safeStartOffset = Math.max(0, startOffset);
  const safeEndOffset = Math.max(safeStartOffset, endOffset);
  const firstVisiblePage = findPdfPageByOffset(layout, safeStartOffset);
  const lastVisiblePage = findPdfPageByOffset(layout, safeEndOffset);
  const firstPage = Math.max(1, firstVisiblePage - overscanPages);
  const lastPage = Math.min(layout.pageCount, lastVisiblePage + overscanPages);

  return createPageNumberRange(firstPage, lastPage);
}

function shouldRebasePdfScroll({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return (
    getPdfMaxLogicalScrollTop({ totalHeight, viewportHeight }) >
    PDF_SCROLL_REBASE_THRESHOLD_PX
  );
}

function getPdfMaxLogicalScrollTop({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    safeSize(totalHeight) - Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getPdfMaxPhysicalScrollTop({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getPdfPhysicalScrollHeight({ totalHeight, viewportHeight }) -
      Math.max(0, finiteNumber(viewportHeight)),
    0,
  );
}

function getPdfMaxScrollPageOffset({
  totalHeight,
  viewportHeight,
}: {
  totalHeight: number;
  viewportHeight: number;
}) {
  return Math.max(
    getPdfMaxLogicalScrollTop({ totalHeight, viewportHeight }) -
      getPdfMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    0,
  );
}

function clampPdfScrollPageOffset({
  scrollPageOffset,
  totalHeight,
  viewportHeight,
}: {
  scrollPageOffset: number;
  totalHeight: number;
  viewportHeight: number;
}) {
  return clamp(
    safePadding(scrollPageOffset),
    0,
    getPdfMaxScrollPageOffset({ totalHeight, viewportHeight }),
  );
}

function resolvePdfScrollPageWindow({
  logicalScrollTop,
  preferredPhysicalScrollTop,
  totalHeight,
  viewportHeight,
}: {
  logicalScrollTop: number;
  preferredPhysicalScrollTop: number;
  totalHeight: number;
  viewportHeight: number;
}): PdfScrollRebasePosition {
  let physicalScrollTop = roundPdfScrollPixel(
    clamp(
      finiteNumber(preferredPhysicalScrollTop),
      0,
      getPdfMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  let scrollPageOffset = clampPdfScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  physicalScrollTop = roundPdfScrollPixel(
    clamp(
      logicalScrollTop - scrollPageOffset,
      0,
      getPdfMaxPhysicalScrollTop({ totalHeight, viewportHeight }),
    ),
  );
  scrollPageOffset = clampPdfScrollPageOffset({
    scrollPageOffset: logicalScrollTop - physicalScrollTop,
    totalHeight,
    viewportHeight,
  });

  return { physicalScrollTop, scrollPageOffset };
}

function createPageNumberRange(firstPage: number, lastPage: number) {
  if (lastPage < firstPage) return [];

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
}

function getRenderedPageSize(
  pageSize: PdfPageSize,
  scale: number,
  rotation: number,
) {
  const isRotated = rotation % 180 !== 0;
  return {
    width: Math.round((isRotated ? pageSize.height : pageSize.width) * scale),
    height: Math.round((isRotated ? pageSize.width : pageSize.height) * scale),
  };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundPdfScrollPixel(value: number) {
  if (typeof window === "undefined") return Math.round(value);
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function safePadding(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPdfPageOffsetTop(layout: PdfPageLayoutModel, pageNumber: number) {
  return (
    layout.padding +
    (pageNumber - 1) * (layout.estimatedHeight + layout.gap) +
    getHeightDeltaBeforePage(layout, pageNumber)
  );
}

function getHeightDeltaBeforePage(
  layout: PdfPageLayoutModel,
  pageNumber: number,
) {
  const measuredPageIndex = getLastMeasuredPageIndexBefore(layout, pageNumber);
  return measuredPageIndex < 0
    ? 0
    : layout.prefixHeightDeltas[measuredPageIndex];
}

function getLastMeasuredPageIndexBefore(
  layout: PdfPageLayoutModel,
  pageNumber: number,
) {
  let low = 0;
  let high = layout.measuredPages.length - 1;
  let match = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (layout.measuredPages[mid].pageNumber < pageNumber) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return match;
}
