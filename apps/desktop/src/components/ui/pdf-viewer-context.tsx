"use client";

import * as React from "react";

import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";
import type { BlobViewerSource, UrlViewerSource } from "@/lib/viewer-source";

import { useOptionalFileViewerResource } from "./file-viewer-resource-state";
import {
  PdfResourceContent,
  type PdfViewerContentProps,
} from "./pdf-viewer-content";
import type { PdfViewerHandle } from "./pdf-viewer-types";

export type PdfDocumentSource = UrlViewerSource | BlobViewerSource;

export type PdfViewerThumbnailsState = {
  currentPage: number | null;
  onSelectPage: ((page: number) => void) | undefined;
  resource: ViewerResource;
};

export interface PdfViewerProviderProps {
  source?: PdfDocumentSource;
  children: React.ReactNode;
}

type PdfViewerContextValue = {
  currentPage: number | null;
  isViewerReady: boolean;
  resource: ViewerResource;
  setCurrentPage: (page: number | null) => void;
  setViewerHandle: (handle: PdfViewerHandle | null) => void;
  viewerHandleRef: React.RefObject<PdfViewerHandle | null>;
};

type PdfDocumentPagesState = {
  resource: ViewerResource;
  setCurrentPage: (page: number | null) => void;
  setViewerHandle: (handle: PdfViewerHandle | null) => void;
};

const PdfViewerContext = React.createContext<PdfViewerContextValue | null>(
  null,
);

const PDF_THUMBNAIL_SMOOTH_SCROLL_MAX_PAGE_DELTA = 8;

function usePdfViewerContext(
  consumer = "PdfViewer parts",
): PdfViewerContextValue {
  const context = React.useContext(PdfViewerContext);
  if (!context) {
    throw new Error(`${consumer} must be used within PdfViewerProvider.`);
  }
  return context;
}

export function usePdfViewerThumbnails(): PdfViewerThumbnailsState {
  const { currentPage, isViewerReady, resource, viewerHandleRef } =
    usePdfViewerContext("usePdfViewerThumbnails");
  const onSelectPage = React.useCallback(
    (page: number) => {
      const pageDelta = currentPage == null ? 0 : Math.abs(page - currentPage);
      viewerHandleRef.current?.scrollToPage(page, {
        behavior:
          pageDelta > PDF_THUMBNAIL_SMOOTH_SCROLL_MAX_PAGE_DELTA
            ? "auto"
            : "smooth",
      });
    },
    [currentPage, viewerHandleRef],
  );

  return {
    currentPage,
    onSelectPage: isViewerReady ? onSelectPage : undefined,
    resource,
  };
}

function usePdfDocumentPagesState(): PdfDocumentPagesState {
  const { resource, setCurrentPage, setViewerHandle } = usePdfViewerContext();
  return { resource, setCurrentPage, setViewerHandle };
}

export const PdfViewerPages = React.forwardRef<
  PdfViewerHandle,
  PdfViewerContentProps
>(function PdfViewerPages(props, ref) {
  const { resource, setCurrentPage, setViewerHandle } =
    usePdfDocumentPagesState();
  const { onVisiblePageChange } = props;
  const handleVisiblePageChange = React.useCallback(
    (page: number) => {
      setCurrentPage(page);
      onVisiblePageChange?.(page);
    },
    [onVisiblePageChange, setCurrentPage],
  );
  const handleRef = React.useCallback(
    (handle: PdfViewerHandle | null) => {
      setViewerHandle(handle);
      if (typeof ref === "function") {
        ref(handle);
        return;
      }
      if (ref) ref.current = handle;
    },
    [ref, setViewerHandle],
  );

  return (
    <PdfResourceContent
      {...props}
      ref={handleRef}
      resource={resource}
      controls={false}
      onVisiblePageChange={handleVisiblePageChange}
    />
  );
});

export function PdfViewerProvider({
  source,
  children,
}: PdfViewerProviderProps) {
  const fileViewerResource = useOptionalFileViewerResource();
  const resource = React.useMemo(() => {
    if (source) return createViewerResource(source);
    if (fileViewerResource) return fileViewerResource;
    throw new Error(
      "PdfViewerProvider requires a source or enclosing FileViewer.",
    );
  }, [fileViewerResource, source]);
  const [currentPage, setCurrentPage] = React.useState<number | null>(null);
  const viewerHandleRef = React.useRef<PdfViewerHandle | null>(null);
  const [isViewerReady, setIsViewerReady] = React.useState(false);
  const setViewerHandle = React.useCallback((handle: PdfViewerHandle | null) => {
    viewerHandleRef.current = handle;
    const nextIsViewerReady = handle !== null;
    setIsViewerReady((currentIsViewerReady) =>
      currentIsViewerReady === nextIsViewerReady
        ? currentIsViewerReady
        : nextIsViewerReady,
    );
  }, []);
  const value = React.useMemo<PdfViewerContextValue>(
    () => ({
      currentPage,
      isViewerReady,
      resource,
      setCurrentPage,
      setViewerHandle,
      viewerHandleRef,
    }),
    [currentPage, isViewerReady, resource, setViewerHandle],
  );

  return (
    <PdfViewerContext.Provider value={value}>
      {children}
    </PdfViewerContext.Provider>
  );
}
