import {
  isResourceError,
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";
import type {
  PdfDocumentProxy,
  PdfjsModule,
  PdfPageProxy,
} from "@/lib/pdf-document-types";
import type {
  ViewerContentBytes,
  ViewerContentDirectUrl,
  ViewerContentIdentity,
} from "@/lib/viewer-resource";

const PDF_CACHE_MAX = 6;

type PdfDocumentContent = ViewerContentIdentity &
  ViewerContentDirectUrl &
  ViewerContentBytes;

type DocumentCacheEntry = {
  loadKey: string;
  promise: Promise<PdfDocumentProxy>;
  consumers: number;
  lastUsedAt: number;
  retainRejected: boolean;
  status: "pending" | "resolved" | "rejected";
  document?: PdfDocumentProxy;
  error?: unknown;
};

type PageCacheEntry = {
  promise: Promise<PdfPageProxy>;
  retainRejected: boolean;
  status: "pending" | "resolved" | "rejected";
  page?: PdfPageProxy;
  error?: unknown;
};

type PdfResourceOptions = {
  retainRejected?: boolean;
};

let pdfjsPromise: Promise<PdfjsModule> | null = null;
const documentCache = new Map<string, DocumentCacheEntry>();
const pageCache = new WeakMap<PdfDocumentProxy, Map<number, PageCacheEntry>>();
const detachedDocumentEntries = new Set<DocumentCacheEntry>();
let pruneTimer = 0;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      const pdfjsModule = pdfjs as unknown as PdfjsModule;
      if (!pdfjsModule.GlobalWorkerOptions.workerSrc) {
        pdfjsModule.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }
      return pdfjsModule;
    });
  }
  return pdfjsPromise;
}

function scheduleDocumentPrune() {
  if (typeof window === "undefined" || pruneTimer) return;
  pruneTimer = window.setTimeout(() => {
    pruneTimer = 0;
    pruneDocumentCache();
  }, 0);
}

function pruneDocumentCache() {
  while (documentCache.size > PDF_CACHE_MAX) {
    let evictKey: string | null = null;
    let evictEntry: DocumentCacheEntry | null = null;
    for (const [key, documentEntry] of documentCache) {
      if (documentEntry.consumers > 0 || documentEntry.status === "pending") {
        continue;
      }
      if (!evictEntry || documentEntry.lastUsedAt < evictEntry.lastUsedAt) {
        evictKey = key;
        evictEntry = documentEntry;
      }
    }
    if (!evictKey || !evictEntry) return;
    documentCache.delete(evictKey);
    if (evictEntry.status === "resolved") {
      if (!hasDetachedDocument(evictEntry.document)) {
        destroyPdfDocument(evictEntry.document);
      }
    }
  }
}

export function getPdfDocumentResource(
  content: PdfDocumentContent,
  options: PdfResourceOptions = {},
): Promise<PdfDocumentProxy> {
  return getDocumentCacheEntry(content, options).promise;
}

export function readPdfDocumentResource(
  content: PdfDocumentContent,
): PdfDocumentProxy {
  const documentEntry = getDocumentCacheEntry(content, {
    retainRejected: true,
  });
  documentEntry.lastUsedAt = Date.now();
  if (documentEntry.status === "pending") throw documentEntry.promise;
  if (documentEntry.status === "rejected") throw documentEntry.error;
  return documentEntry.document!;
}

function getDocumentCacheEntry(
  content: PdfDocumentContent,
  options: PdfResourceOptions,
) {
  const loadKey = content.key;
  const cachedDocumentEntry = documentCache.get(loadKey);
  if (cachedDocumentEntry) {
    if (options.retainRejected) {
      cachedDocumentEntry.retainRejected = true;
    }
    if (cachedDocumentEntry.status === "rejected" && !options.retainRejected) {
      documentCache.delete(loadKey);
    } else {
      cachedDocumentEntry.lastUsedAt = Date.now();
      return cachedDocumentEntry;
    }
  }

  const documentEntry: DocumentCacheEntry = {
    loadKey,
    promise: Promise.resolve(null as never),
    consumers: 0,
    lastUsedAt: Date.now(),
    retainRejected: Boolean(options.retainRejected),
    status: "pending",
  };
  documentEntry.promise = loadPdfjs()
    .then((pdfjs) => getPdfDocument(content, pdfjs))
    .then(
      (document) => {
        documentEntry.status = "resolved";
        documentEntry.document = document;
        if (documentCache.get(loadKey) !== documentEntry) {
          destroyPdfDocument(document);
        } else {
          scheduleDocumentPrune();
        }
        return document;
      },
      (error) => {
        documentEntry.status = "rejected";
        documentEntry.error = error;
        if (
          !documentEntry.retainRejected &&
          documentCache.get(loadKey) === documentEntry
        ) {
          documentCache.delete(loadKey);
        }
        throw error;
      },
    );

  documentCache.set(loadKey, documentEntry);
  scheduleDocumentPrune();
  return documentEntry;
}

export function clearPdfDocumentResource(content: ViewerContentIdentity) {
  const documentEntry = documentCache.get(content.key);
  if (!documentEntry) return;
  documentCache.delete(content.key);
  if (documentEntry.status === "resolved") {
    clearPageCache(documentEntry.document);
    if (documentEntry.consumers > 0) {
      detachedDocumentEntries.add(documentEntry);
    } else if (hasDetachedDocument(documentEntry.document)) {
      return;
    } else {
      destroyPdfDocument(documentEntry.document);
    }
  }
}

export function retainPdfDocumentResource(
  content: ViewerContentIdentity,
  document: PdfDocumentProxy,
) {
  const documentEntry = documentCache.get(content.key);
  if (!documentEntry || documentEntry.document !== document) return;
  documentEntry.consumers += 1;
  documentEntry.lastUsedAt = Date.now();
}

export function releasePdfDocumentResource(
  content: ViewerContentIdentity,
  document: PdfDocumentProxy,
) {
  const documentEntry =
    findDetachedDocumentEntry(content, document) ??
    findAttachedDocumentEntry(content, document);
  if (!documentEntry || documentEntry.document !== document) return;
  documentEntry.consumers = Math.max(0, documentEntry.consumers - 1);
  documentEntry.lastUsedAt = Date.now();
  if (detachedDocumentEntries.has(documentEntry)) {
    if (documentEntry.consumers === 0) {
      detachedDocumentEntries.delete(documentEntry);
      if (!hasAttachedDocument(documentEntry.document)) {
        destroyPdfDocument(documentEntry.document);
      }
    }
    return;
  }
  scheduleDocumentPrune();
}

export function resetPdfDocumentResourceCacheForTests() {
  pdfjsPromise = null;
  if (pruneTimer && typeof window !== "undefined") {
    window.clearTimeout(pruneTimer);
    pruneTimer = 0;
  }
  const destroyedDocuments = new Set<PdfDocumentProxy>();
  for (const documentEntry of documentCache.values()) {
    if (documentEntry.status === "resolved") {
      destroyPdfDocumentOnce(documentEntry.document, destroyedDocuments);
    }
  }
  for (const documentEntry of detachedDocumentEntries) {
    if (documentEntry.status === "resolved") {
      destroyPdfDocumentOnce(documentEntry.document, destroyedDocuments);
    }
  }
  documentCache.clear();
  detachedDocumentEntries.clear();
}

function findAttachedDocumentEntry(
  content: ViewerContentIdentity,
  document: PdfDocumentProxy,
) {
  const documentEntry = documentCache.get(content.key);
  return documentEntry?.document === document ? documentEntry : undefined;
}

function findDetachedDocumentEntry(
  content: ViewerContentIdentity,
  document: PdfDocumentProxy,
) {
  for (const documentEntry of detachedDocumentEntries) {
    if (
      documentEntry.loadKey === content.key &&
      documentEntry.document === document
    ) {
      return documentEntry;
    }
  }
  return undefined;
}

function hasAttachedDocument(document: PdfDocumentProxy | undefined) {
  for (const documentEntry of documentCache.values()) {
    if (documentEntry.document === document) return true;
  }
  return false;
}

function hasDetachedDocument(document: PdfDocumentProxy | undefined) {
  for (const documentEntry of detachedDocumentEntries) {
    if (documentEntry.document === document) return true;
  }
  return false;
}

export function getPdfPageResource(
  document: PdfDocumentProxy,
  pageNumber: number,
  options: PdfResourceOptions = {},
) {
  return getPageCacheEntry(document, pageNumber, options).promise;
}

export function readPdfPageResource(
  document: PdfDocumentProxy,
  pageNumber: number,
): PdfPageProxy {
  const pageEntry = getPageCacheEntry(document, pageNumber, {
    retainRejected: true,
  });
  if (pageEntry.status === "pending") throw pageEntry.promise;
  if (pageEntry.status === "rejected") throw pageEntry.error;
  return pageEntry.page!;
}

function getPageCacheEntry(
  document: PdfDocumentProxy,
  pageNumber: number,
  options: PdfResourceOptions,
) {
  let pages = pageCache.get(document);
  if (!pages) {
    pages = new Map();
    pageCache.set(document, pages);
  }
  const cachedPageEntry = pages.get(pageNumber);
  if (cachedPageEntry) {
    if (options.retainRejected) {
      cachedPageEntry.retainRejected = true;
    }
    if (cachedPageEntry.status === "rejected" && !options.retainRejected) {
      pages.delete(pageNumber);
    } else {
      return cachedPageEntry;
    }
  }

  const pageEntry: PageCacheEntry = {
    promise: document.getPage(pageNumber),
    retainRejected: Boolean(options.retainRejected),
    status: "pending",
  };
  pages.set(pageNumber, pageEntry);
  pageEntry.promise.then(
    (page) => {
      pageEntry.status = "resolved";
      pageEntry.page = page;
    },
    (error) => {
      pageEntry.status = "rejected";
      pageEntry.error = error;
      if (!pageEntry.retainRejected && pages?.get(pageNumber) === pageEntry) {
        pages.delete(pageNumber);
      }
    },
  );
  return pageEntry;
}

async function getPdfDocument(
  content: PdfDocumentContent,
  pdfjs: PdfjsModule,
): Promise<PdfDocumentProxy> {
  try {
    if (content.directUrl) {
      return await pdfjs.getDocument(content.directUrl).promise;
    }

    const buffer = await content.readBytes();
    return await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch (error) {
    if (isResourceError(error)) throw error;
    throw toPdfFormatError(error, {
      kind: "parse_failed",
      message: "Failed to parse PDF.",
    });
  }
}

function toPdfFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions,
): ViewerFormatError {
  if (isViewerFormatError(error)) return error;
  return new ViewerFormatError({
    format: "pdf",
    kind: options.kind,
    message: options.message,
    cause: error,
  });
}

function destroyPdfDocument(document: PdfDocumentProxy | undefined) {
  clearPageCache(document);
  void document?.destroy().catch(() => {});
}

function destroyPdfDocumentOnce(
  document: PdfDocumentProxy | undefined,
  destroyedDocuments: Set<PdfDocumentProxy>,
) {
  if (!document || destroyedDocuments.has(document)) return;
  destroyedDocuments.add(document);
  destroyPdfDocument(document);
}

function clearPageCache(document: PdfDocumentProxy | undefined) {
  if (document) pageCache.delete(document);
}
