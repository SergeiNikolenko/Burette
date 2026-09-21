export const PDF_THUMBNAIL_OVERSCAN_PX = 1000;
export const PDF_THUMBNAIL_INITIAL_VIEWPORT_HEIGHT = 680;
export const PDF_THUMBNAIL_DEFAULT_ASPECT = 4 / 3;
export const PDF_THUMBNAIL_LABEL_AND_GAP_HEIGHT = 22;

export type PdfThumbnailShape = "page" | "square";

export interface PdfThumbnailPageMetric {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfThumbnailLayoutItem {
  pageNumber: number;
  pageIndex: number;
  top: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface PdfThumbnailLayout {
  pageCount: number;
  width: number;
  shape: PdfThumbnailShape;
  estimatedImageHeight: number;
  estimatedItemHeight: number;
  labelAndGapHeight: number;
  metricByPageNumber: ReadonlyMap<number, PdfThumbnailPageMetric>;
  prefixHeightDeltas: readonly PdfThumbnailHeightDelta[];
  totalHeight: number;
}

export interface PdfThumbnailRenderedWindowItem
  extends PdfThumbnailLayoutItem {
  windowTop: number;
}

export interface PdfThumbnailRenderedWindow {
  afterHeight: number;
  beforeHeight: number;
  height: number;
  items: readonly PdfThumbnailRenderedWindowItem[];
  renderedBottom: number;
  renderedTop: number;
  stickyInset: number;
}

export interface PdfThumbnailPixelWindow {
  bottom: number;
  top: number;
}

interface PdfThumbnailHeightDelta {
  pageNumber: number;
  prefixDeltaAfterPage: number;
}

export function buildPdfThumbnailLayout({
  pageCount,
  width,
  metricByPageNumber,
  labelAndGapHeight = PDF_THUMBNAIL_LABEL_AND_GAP_HEIGHT,
  shape = "page",
}: {
  pageCount: number;
  width: number;
  metricByPageNumber?: ReadonlyMap<number, PdfThumbnailPageMetric>;
  labelAndGapHeight?: number;
  shape?: PdfThumbnailShape;
}): PdfThumbnailLayout {
  const safePageCount = normalizePageCount(pageCount);
  const safeWidth = normalizeWidth(width);
  const safeLabelAndGapHeight = normalizeSize(labelAndGapHeight, 0);
  const safeMetricByPageNumber = metricByPageNumber ?? new Map();
  const estimatedImageHeight = getThumbnailImageHeight({
    width: safeWidth,
    metric: safeMetricByPageNumber.get(1),
    shape,
  });
  const estimatedItemHeight =
    Math.ceil(estimatedImageHeight) + safeLabelAndGapHeight;
  const prefixHeightDeltas = buildPrefixHeightDeltas({
    pageCount: safePageCount,
    width: safeWidth,
    shape,
    estimatedItemHeight,
    metricByPageNumber: safeMetricByPageNumber,
    labelAndGapHeight: safeLabelAndGapHeight,
  });
  const totalHeight =
    safePageCount * estimatedItemHeight +
    (prefixHeightDeltas.at(-1)?.prefixDeltaAfterPage ?? 0);

  return {
    pageCount: safePageCount,
    width: safeWidth,
    shape,
    estimatedImageHeight,
    estimatedItemHeight,
    labelAndGapHeight: safeLabelAndGapHeight,
    metricByPageNumber: safeMetricByPageNumber,
    prefixHeightDeltas,
    totalHeight,
  };
}

export function getPdfThumbnailLayoutItem(
  layout: PdfThumbnailLayout,
  pageNumber: number,
): PdfThumbnailLayoutItem | null {
  const normalizedPage = normalizeThumbnailPage(pageNumber, layout.pageCount);
  if (normalizedPage == null) return null;

  const metric = layout.metricByPageNumber.get(normalizedPage);
  const imageHeight = getThumbnailImageHeight({
    width: layout.width,
    metric,
    shape: layout.shape,
  });
  const height = Math.ceil(imageHeight) + layout.labelAndGapHeight;

  return {
    pageNumber: normalizedPage,
    pageIndex: normalizedPage - 1,
    top:
      (normalizedPage - 1) * layout.estimatedItemHeight +
      getPrefixHeightDeltaBeforePage(layout, normalizedPage),
    height,
    imageWidth: layout.width,
    imageHeight,
  };
}

export function getVisiblePdfThumbnailItems({
  layout,
  scrollTop,
  viewportHeight,
  overscanPx,
}: {
  layout: PdfThumbnailLayout;
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}) {
  if (layout.pageCount === 0) return [];

  const window = getPdfThumbnailPixelWindow({
    layout,
    scrollTop,
    viewportHeight,
    overscanPx,
  });
  const firstVisiblePage = findPdfThumbnailPageByOffset(layout, window.top);
  const lastVisiblePage = findPdfThumbnailPageByOffset(layout, window.bottom);
  const items: PdfThumbnailLayoutItem[] = [];

  for (
    let pageNumber = firstVisiblePage;
    pageNumber <= lastVisiblePage;
    pageNumber += 1
  ) {
    const item = getPdfThumbnailLayoutItem(layout, pageNumber);
    if (item) items.push(item);
  }

  return items;
}

export function getPdfThumbnailPixelWindow({
  layout,
  scrollTop,
  viewportHeight,
  overscanPx,
}: {
  layout: PdfThumbnailLayout;
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}): PdfThumbnailPixelWindow {
  const scrollHeight = normalizeSize(layout.totalHeight, 0);
  const safeViewportHeight = normalizeSize(viewportHeight, 0);
  const safeOverscanPx = normalizeSize(overscanPx, 0);
  const windowHeight = safeViewportHeight + safeOverscanPx * 2;

  if (windowHeight >= scrollHeight) {
    return {
      bottom: scrollHeight,
      top: 0,
    };
  }

  const scrollCenter =
    Math.max(0, finiteNumber(scrollTop)) + safeViewportHeight / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;

  if (top < 0) {
    top = 0;
    bottom = windowHeight;
  }
  if (bottom > scrollHeight) {
    bottom = scrollHeight;
    top = scrollHeight - windowHeight;
  }

  return {
    bottom: Math.ceil(Math.max(bottom, top)),
    top: Math.floor(Math.max(0, top)),
  };
}

export function getPdfThumbnailRenderedWindow({
  layout,
  visibleItems,
  viewportHeight,
}: {
  layout: PdfThumbnailLayout;
  visibleItems: readonly PdfThumbnailLayoutItem[];
  viewportHeight: number;
}): PdfThumbnailRenderedWindow | null {
  if (visibleItems.length === 0 || layout.totalHeight <= 0) return null;

  const safeViewportHeight = Math.max(1, normalizeSize(viewportHeight, 1));
  let renderedTop = layout.totalHeight;
  let renderedBottom = 0;

  for (const item of visibleItems) {
    renderedTop = Math.min(renderedTop, item.top);
    renderedBottom = Math.max(renderedBottom, item.top + item.height);
  }

  renderedTop = clamp(renderedTop, 0, layout.totalHeight);
  renderedBottom = clamp(
    Math.max(renderedTop, renderedBottom),
    renderedTop,
    layout.totalHeight,
  );

  const height = renderedBottom - renderedTop;

  return {
    afterHeight: Math.max(0, layout.totalHeight - renderedBottom),
    beforeHeight: renderedTop,
    height,
    items: visibleItems.map((item) => ({
      ...item,
      windowTop: item.top - renderedTop,
    })),
    renderedBottom,
    renderedTop,
    stickyInset: -Math.max(0, height - safeViewportHeight),
  };
}

export function findPdfThumbnailPageByOffset(
  layout: PdfThumbnailLayout,
  offset: number,
) {
  const safeOffset = Math.max(0, offset);
  let low = 1;
  let high = layout.pageCount;
  let result = 1;

  while (low <= high) {
    const pageNumber = Math.floor((low + high) / 2);
    const item = getPdfThumbnailLayoutItem(layout, pageNumber);
    if (!item) break;

    if (item.top + item.height >= safeOffset) {
      result = pageNumber;
      high = pageNumber - 1;
    } else {
      low = pageNumber + 1;
    }
  }

  return result;
}

export function normalizeThumbnailPage(
  page: number | null | undefined,
  pageCount: number,
): number | null {
  return page != null &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= pageCount
    ? page
    : null;
}

function getThumbnailImageHeight({
  width,
  metric,
  shape,
}: {
  width: number;
  metric: PdfThumbnailPageMetric | undefined;
  shape: PdfThumbnailShape;
}) {
  if (shape === "square") return width;

  if (
    metric &&
    Number.isFinite(metric.width) &&
    Number.isFinite(metric.height) &&
    metric.width > 0 &&
    metric.height > 0
  ) {
    return width * (metric.height / metric.width);
  }

  return width * PDF_THUMBNAIL_DEFAULT_ASPECT;
}

function buildPrefixHeightDeltas({
  pageCount,
  width,
  shape,
  estimatedItemHeight,
  metricByPageNumber,
  labelAndGapHeight,
}: {
  pageCount: number;
  width: number;
  shape: PdfThumbnailShape;
  estimatedItemHeight: number;
  metricByPageNumber: ReadonlyMap<number, PdfThumbnailPageMetric>;
  labelAndGapHeight: number;
}) {
  let prefixDeltaAfterPage = 0;
  const prefixHeightDeltas: PdfThumbnailHeightDelta[] = [];

  for (const [pageNumber, metric] of [...metricByPageNumber.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    if (normalizeThumbnailPage(pageNumber, pageCount) == null) continue;

    const measuredItemHeight =
      Math.ceil(getThumbnailImageHeight({ width, metric, shape })) +
      labelAndGapHeight;
    const delta = measuredItemHeight - estimatedItemHeight;
    if (delta === 0) continue;

    prefixDeltaAfterPage += delta;
    prefixHeightDeltas.push({ pageNumber, prefixDeltaAfterPage });
  }

  return prefixHeightDeltas;
}

function getPrefixHeightDeltaBeforePage(
  layout: PdfThumbnailLayout,
  pageNumber: number,
) {
  let low = 0;
  let high = layout.prefixHeightDeltas.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const delta = layout.prefixHeightDeltas[mid];

    if (delta.pageNumber < pageNumber) {
      result = delta.prefixDeltaAfterPage;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function normalizePageCount(pageCount: number) {
  return Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0;
}

function normalizeWidth(width: number) {
  return normalizeSize(width, 0);
}

function normalizeSize(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
