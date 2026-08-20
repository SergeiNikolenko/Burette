import "katex/dist/katex.min.css";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  FileViewer,
  FileViewerContent,
  FileViewerControls,
  FileViewerDocument,
  FileViewerHeader,
  FileViewerInset,
  FileViewerMeta,
  FileViewerProvider,
  FileViewerSidebar,
  FileViewerSidebarTrigger,
  FileViewerTitle,
  FileViewerViewport,
} from "../../ui/file-viewer";
import { PdfViewerPages, PdfViewerProvider, PdfViewerThumbnails } from "../../ui/pdf-viewer";
import { detectCategory } from "../../../lib/viewer-source";
import type { ViewerSource } from "../../../lib/viewer-source";
import { basename } from "../../../lib/sidebar-projects";
import { pathExtension } from "../../../lib/file-routing";
import { isTauriRuntime } from "../../../lib/tauri";
import { definePageKind } from "./types";

export type DocumentLocation = { kind: "document"; path: string };

export const documentKind = definePageKind<"document", DocumentLocation>({
  kind: "document",
  title: (location) => basename(location.path),
  description: "Open document",
  Component: ({ location }) => <DocumentSurface path={location.path} />,
  keepAlive: true,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "document", path: data.path } : null),
  serialize: (location) => ({ path: location.path }),
});

function DocumentSurface({ path }: { path: string }) {
  const source = useDocumentSource(path);
  return (
    <div className="document-stage">
      {source.status === "error" ? (
        <div className="flex h-full items-center justify-center p-6 text-sm text-destructive" role="alert">{source.message}</div>
      ) : source.source ? (
        detectCategory(basename(path)) === "pdf"
          ? <PdfDocumentViewer source={source.source} />
          : <GenericDocumentViewer source={source.source} />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Loading {basename(path)}...</div>
      )}
    </div>
  );
}

// The upstream pdf-viewer-demo composition: page thumbnails in the viewer sidebar,
// a sidebar trigger in the header, and pages at 100% (no fit-width auto zoom).
function PdfDocumentViewer({ source }: { source: ViewerSource }) {
  return (
    <FileViewerProvider source={source} isolateStyles defaultSidebarOpen>
      <FileViewer className="h-full min-h-0">
        <PdfViewerProvider>
          <FileViewerHeader>
            <FileViewerSidebarTrigger className="-ml-1" />
            <FileViewerTitle />
            <FileViewerMeta />
            <FileViewerControls />
          </FileViewerHeader>
          <FileViewerContent>
            <FileViewerSidebar aria-label="PDF pages" className="border-r">
              <PdfViewerThumbnails />
            </FileViewerSidebar>
            <FileViewerInset>
              <FileViewerViewport>
                <PdfViewerPages bare className="h-full" defaultScale={1} />
              </FileViewerViewport>
            </FileViewerInset>
          </FileViewerContent>
        </PdfViewerProvider>
      </FileViewer>
    </FileViewerProvider>
  );
}

// Reference composition: no separate FileViewerHeader — each viewer draws its
// own chrome row (sheet name and dimensions for XLSX, row/column meta for CSV,
// word count and zoom for Markdown) when FileViewerDocument gets `controls`.
function GenericDocumentViewer({ source }: { source: ViewerSource }) {
  return (
    <FileViewerProvider source={source} isolateStyles>
      <FileViewer className="h-full min-h-0">
        <FileViewerContent>
          <FileViewerInset>
            <FileViewerViewport>
              <FileViewerDocument controls />
            </FileViewerViewport>
          </FileViewerInset>
        </FileViewerContent>
      </FileViewer>
    </FileViewerProvider>
  );
}

type DocumentSourceState =
  | { status: "loading"; source: null }
  | { status: "ready"; source: ViewerSource }
  | { status: "error"; source: null; message: string };

// The web view cannot read arbitrary paths through the asset protocol, so the desktop
// app pulls the bytes over IPC. Browser dev keeps using its own read-file bridge.
function useDocumentSource(path: string): DocumentSourceState {
  const devSource = useMemo<ViewerSource | null>(() => (isTauriRuntime() ? null : {
    kind: "url",
    url: `/__burette/read-file?path=${encodeURIComponent(path)}`,
    fileName: basename(path),
    identityKey: path,
  }), [path]);
  const [state, setState] = useState<DocumentSourceState>(() => (
    devSource ? { status: "ready", source: devSource } : { status: "loading", source: null }
  ));

  useEffect(() => {
    if (devSource) {
      setState({ status: "ready", source: devSource });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", source: null });
    invoke<ArrayBuffer>("read_document_file", { path })
      .then((bytes) => {
        if (cancelled) return;
        setState({
          status: "ready",
          source: {
            kind: "blob",
            blob: new Blob([bytes], { type: documentMimeType(pathExtension(path)) }),
            identityKey: path,
            fileName: basename(path),
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", source: null, message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [devSource, path]);

  return state;
}

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  eml: "message/rfc822",
  tif: "image/tiff",
  tiff: "image/tiff",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
};

function documentMimeType(extension: string) {
  return DOCUMENT_MIME_TYPES[extension] ?? "application/octet-stream";
}
