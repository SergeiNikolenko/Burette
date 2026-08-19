import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { FileViewerPreview } from "../../ui/file-viewer";
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
  if (source.status === "error") {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-destructive" role="alert">{source.message}</div>;
  }
  if (!source.source) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Loading {basename(path)}...</div>;
  }
  return <FileViewerPreview className="bg-background" source={source.source} />;
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
};

function documentMimeType(extension: string) {
  return DOCUMENT_MIME_TYPES[extension] ?? "application/octet-stream";
}
