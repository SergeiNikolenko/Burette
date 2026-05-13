import { convertFileSrc } from "@tauri-apps/api/core";
import type { ViewerDocument } from "../../../types";
import { definePageKind } from "./types";

export type FileLocation = { kind: "file"; documentId?: string; path: string };

export const fileKind = definePageKind<"file", FileLocation>({
  kind: "file",
  title: (location, state) => {
    const document = findDocument(location, state.documents) ?? state.activeDocument;
    return document?.title ?? "Structure";
  },
  description: "Open structure",
  Component: ({ location, state }) => {
    const document = findDocument(location, state.documents) ?? state.activeDocument;
    return document ? <ViewerSurface document={document} /> : null;
  },
  keepAlive: true,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "file", documentId: typeof data.documentId === "string" ? data.documentId : undefined, path: data.path } : null),
  serialize: (location) => ({ documentId: location.documentId, path: location.path }),
});

function findDocument(location: FileLocation, documents: ViewerDocument[]) {
  return (
    documents.find((document) => document.id === location.documentId) ??
    documents.find((document) => document.path === location.path) ??
    null
  );
}

function ViewerSurface({ document }: { document: ViewerDocument }) {
  const url = convertFileSrc(document.runtimePath);
  return (
    <div className="molecule-stage">
      <iframe title={document.title} src={url} className="viewer-iframe" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" />
    </div>
  );
}
