import type * as DocxPreview from "docx-preview";

import { ViewerFormatError } from "@/lib/viewer-errors";

import {
  DEFAULT_DOCX_PAGE_HEIGHT,
  DEFAULT_DOCX_PAGE_WIDTH,
  DOCX_RENDER_OPTIONS,
  positivePixel,
} from "./docx-viewer-core";
import {
  createDocxPageLayout,
  type DocxPageLayout,
  type DocxPageWindow,
} from "./docx-viewer-layout";
import {
  readDocxRenderCache,
  readPendingDocxRenderCache,
  writeDocxRenderCache,
  writePendingDocxRenderCache,
  type DocxPageSize,
  type DocxRenderCacheHit,
} from "./docx-viewer-render-cache";

let docxPromise: Promise<typeof DocxPreview> | null = null;

export interface DocxRenderedDocument {
  after: HTMLDivElement;
  before: HTMLDivElement;
  mountedEnd: number;
  mountedStart: number;
  pageLayout: DocxPageLayout;
  pages: readonly HTMLElement[];
  sticky: HTMLElement;
  wrapper: HTMLElement;
}

type DocxRenderBuffer = ArrayBuffer | (() => ArrayBuffer);

export function loadDocxPreview() {
  if (!docxPromise) {
    docxPromise = import("docx-preview").catch((error) => {
      docxPromise = null;
      throw error;
    });
  }
  return docxPromise;
}

export async function renderDocxPreview(
  buffer: ArrayBuffer,
  docxPreviewPromise = loadDocxPreview(),
) {
  const { renderAsync } = await docxPreviewPromise;
  const renderHost = document.createElement("div");
  await renderAsync(buffer, renderHost, undefined, DOCX_RENDER_OPTIONS);
  return renderHost;
}

export async function renderCachedDocxPreview({
  buffer,
  cacheKey,
  docxPreviewPromise,
  getScale,
}: {
  buffer: DocxRenderBuffer;
  cacheKey: string;
  docxPreviewPromise?: Promise<typeof DocxPreview>;
  getScale: () => number;
}): Promise<DocxRenderCacheHit> {
  const cached = readDocxRenderCache(cacheKey);
  if (cached) return cached;

  const pending = readPendingDocxRenderCache(cacheKey);
  if (pending) {
    const pendingEntry = await pending;
    if (pendingEntry) {
      return {
        pageSizes: pendingEntry.pageSizes,
        renderHost: pendingEntry.renderHost.cloneNode(true) as HTMLElement,
      };
    }
  }

  const renderPromise = renderDocxPreview(
    resolveDocxRenderBuffer(buffer),
    docxPreviewPromise ?? loadDocxPreview(),
  ).then((renderHost) => {
    const pageSizes = collectDocxPageSizes(renderHost, getScale());
    const cacheEntry = writeDocxRenderCache({
      key: cacheKey,
      pageSizes,
      renderHost,
    });

    return { cacheEntry, pageSizes, renderHost };
  });
  writePendingDocxRenderCache(
    cacheKey,
    renderPromise.then((result) => result.cacheEntry),
  );

  const result = await renderPromise;
  return {
    pageSizes: result.pageSizes,
    renderHost: result.renderHost,
  };
}

function resolveDocxRenderBuffer(buffer: DocxRenderBuffer) {
  return typeof buffer === "function" ? buffer() : buffer;
}

export function commitDocxRender({
  host,
  pageSizes,
  renderHost,
  scale,
}: {
  host: HTMLElement;
  pageSizes?: readonly DocxPageSize[];
  renderHost: HTMLElement;
  scale: number;
}) {
  const wrapper = renderHost.querySelector<HTMLElement>(".docx-wrapper");
  if (!wrapper) {
    throw new ViewerFormatError({
      format: "docx",
      kind: "render_failed",
      message: "DOCX render produced no pages.",
    });
  }
  const pages = Array.from(
    renderHost.querySelectorAll<HTMLElement>(".docx-wrapper > section.docx"),
  );
  if (!pages.length) {
    throw new ViewerFormatError({
      format: "docx",
      kind: "render_failed",
      message: "DOCX render produced no pages.",
    });
  }
  const z = scale || 1;
  const sizes =
    pageSizes && pageSizes.length === pages.length
      ? pageSizes
      : pages.map((el) => pageSize(el, z));
  pages.forEach((el, i) => {
    el.dataset.pageNumber = String(i + 1);
    el.style.contentVisibility = "auto";
    const [width, height] = sizes[i]!;
    el.style.containIntrinsicSize = `${width}px ${height}px`;
  });
  const pageLayout = createDocxPageLayout(sizes);
  const before = document.createElement("div");
  const after = document.createElement("div");
  before.dataset.slot = "docx-sticky-before-buffer";
  wrapper.dataset.slot = "docx-sticky-window";
  after.dataset.slot = "docx-sticky-after-buffer";
  before.setAttribute("aria-hidden", "true");
  after.setAttribute("aria-hidden", "true");
  wrapper.style.position = "sticky";
  wrapper.style.left = "0";
  wrapper.style.overflow = "visible";
  wrapper.style.width = "100%";

  const staticNodes = Array.from(renderHost.childNodes).filter(
    (node) => node !== wrapper,
  );
  wrapper.replaceChildren();
  host.replaceChildren(...staticNodes, before, wrapper, after);

  const virtualDocument: DocxRenderedDocument = {
    after,
    before,
    mountedEnd: 0,
    mountedStart: 0,
    pageLayout,
    pages,
    sticky: wrapper,
    wrapper,
  };
  return {
    numPages: pages.length,
    pageWidth: pages.length ? sizes[0][0] : null,
    pageLayout,
    virtualDocument,
  };
}

export function projectDocxPages(
  document: DocxRenderedDocument,
  window: DocxPageWindow,
) {
  document.before.style.height = `${window.beforeHeight}px`;
  document.after.style.height = `${window.afterHeight}px`;
  document.sticky.style.top = `${window.stickyOffset}px`;
  document.sticky.style.bottom = `${window.stickyOffset}px`;
  document.sticky.style.height = `${window.renderedHeight}px`;

  const start = window.startIndex;
  const end = window.endIndex;
  if (start === document.mountedStart && end === document.mountedEnd) return;

  if (
    document.mountedEnd <= document.mountedStart ||
    end <= start ||
    end <= document.mountedStart ||
    start >= document.mountedEnd
  ) {
    document.wrapper.replaceChildren(...document.pages.slice(start, end));
    document.mountedStart = start;
    document.mountedEnd = end;
    return;
  }

  for (
    let index = document.mountedStart;
    index < Math.min(start, document.mountedEnd);
    index += 1
  ) {
    document.pages[index]?.remove();
  }
  for (
    let index = Math.max(end, document.mountedStart);
    index < document.mountedEnd;
    index += 1
  ) {
    document.pages[index]?.remove();
  }

  if (start < document.mountedStart) {
    const fragment = globalThis.document.createDocumentFragment();
    for (let index = start; index < document.mountedStart; index += 1) {
      const page = document.pages[index];
      if (page) fragment.append(page);
    }
    document.wrapper.insertBefore(fragment, document.wrapper.firstChild);
  }

  if (end > document.mountedEnd) {
    const fragment = globalThis.document.createDocumentFragment();
    for (
      let index = Math.max(document.mountedEnd, start);
      index < end;
      index += 1
    ) {
      const page = document.pages[index];
      if (page) fragment.append(page);
    }
    document.wrapper.append(fragment);
  }

  document.mountedStart = start;
  document.mountedEnd = end;
}

function collectDocxPageSizes(
  renderHost: HTMLElement,
  scale: number,
): readonly DocxPageSize[] {
  const pages = Array.from(
    renderHost.querySelectorAll<HTMLElement>(".docx-wrapper > section.docx"),
  );
  const z = scale || 1;
  return pages.map((el) => pageSize(el, z));
}

function pageSize(el: HTMLElement, scale: number) {
  const styledWidth = positivePixel(Math.round(cssLengthToPx(el.style.width)));
  const styledHeight = positivePixel(
    Math.round(
      cssLengthToPx(el.style.height) || cssLengthToPx(el.style.minHeight),
    ),
  );
  if (styledWidth && styledHeight) {
    return [styledWidth, styledHeight] as const;
  }

  const r = el.getBoundingClientRect();
  const width = positivePixel(Math.round(r.width / scale));
  const height = positivePixel(Math.round(r.height / scale));
  return [
    styledWidth ?? width ?? DEFAULT_DOCX_PAGE_WIDTH,
    styledHeight ?? height ?? DEFAULT_DOCX_PAGE_HEIGHT,
  ] as const;
}

function cssLengthToPx(value: string) {
  const match = value.trim().match(/^(-?\d*\.?\d+)(px|pt|in|cm|mm|pc)?$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const unit = (match[2] ?? "px").toLowerCase();
  if (unit === "px") return amount;
  if (unit === "pt") return (amount * 96) / 72;
  if (unit === "in") return amount * 96;
  if (unit === "cm") return (amount * 96) / 2.54;
  if (unit === "mm") return (amount * 96) / 25.4;
  if (unit === "pc") return amount * 16;
  return 0;
}
