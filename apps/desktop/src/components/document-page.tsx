import { readBrowserPickedFile } from "../lib/web-demo-workspace";
import { FileViewerErrorState, FileViewerLoadingState } from "./ui/file-viewer-state";
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
} from "./ui/file-viewer";
import { PdfViewerPages, PdfViewerProvider, PdfViewerThumbnails } from "./ui/pdf-viewer";
import { detectCategory } from "../lib/viewer-source";
import type { ViewerSource } from "../lib/viewer-source";
import { basename } from "../lib/sidebar-projects";
import { pathExtension } from "../lib/file-routing";
import { isTauriRuntime } from "../lib/tauri";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";

export function DocumentSurface({ path }: { path: string }) {
  const source = useDocumentSource(path);
  return (
    <div className="document-stage">
      {source.status === "error" ? (
        <FileViewerErrorState className="h-full" error={source.error} title="Could not open file" retry="always" onRetry={source.retry} />
      ) : source.source ? (
        detectCategory(basename(path)) === "pdf"
          ? <PdfDocumentViewer source={source.source} />
          : <GenericDocumentViewer source={source.source} />
      ) : (
        <FileViewerLoadingState className="h-full" />
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
  | { status: "error"; source: null; error: unknown };

// The web view cannot read arbitrary paths through the asset protocol, so the desktop
// app pulls the bytes over IPC. Browser dev keeps using its own read-file bridge.
function useDocumentSource(path: string): DocumentSourceState & { retry: () => void } {
  const devSource = useMemo<ViewerSource | null>(() => {
    if (isTauriRuntime()) return null;
    // Web-demo paths exist only in the in-memory virtual store; the dev-server
    // bridge would try the real filesystem and 404.
    const picked = readBrowserPickedFile(path);
    if (picked) return { kind: "blob", blob: picked, fileName: basename(path), identityKey: path };
    const virtualText = readBrowserDevVirtualTextDocument(path);
    if (virtualText !== null) {
      return { kind: "text", text: virtualText, fileName: basename(path), identityKey: path };
    }
    return {
      kind: "url",
      url: `/__burette/read-file?path=${encodeURIComponent(path)}`,
      fileName: basename(path),
      identityKey: path,
    };
  }, [path]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ path: string; attempt: number; value: DocumentSourceState } | null>(null);

  useEffect(() => {
    if (devSource) return;
    let cancelled = false;
    setState({ path, attempt, value: { status: "loading", source: null } });
    invoke<ArrayBuffer>("read_document_file", { path })
      .then((bytes) => {
        if (cancelled) return;
        setState({ path, attempt, value: {
          status: "ready",
          source: {
            kind: "blob",
            blob: new Blob([bytes], { type: documentMimeType(pathExtension(path)) }),
            identityKey: path,
            fileName: basename(path),
          },
        } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ path, attempt, value: { status: "error", source: null, error } });
      });
    return () => {
      cancelled = true;
    };
  }, [devSource, path, attempt]);

  // Never render the previous file (or a failed attempt) under a new filename,
  // even on the render before the effect's cleanup has run.
  const value: DocumentSourceState = devSource ? { status: "ready", source: devSource }
    : state?.path === path && state.attempt === attempt ? state.value
    : { status: "loading", source: null };
  return { ...value, retry: () => setAttempt(value => value + 1) };
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
