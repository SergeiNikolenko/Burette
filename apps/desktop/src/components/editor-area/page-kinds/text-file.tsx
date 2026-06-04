import { TextFileViewer } from "../../text-file-viewer";
import type { TextFileDocument } from "../../../types";
import { definePageKind } from "./types";

export type TextFileLocation = { kind: "text-file"; documentId?: string; path: string };

export const textFileKind = definePageKind<"text-file", TextFileLocation>({
  kind: "text-file",
  title: (location, state) => {
    const document = findTextDocument(location, state.textDocuments);
    return document?.title ?? fileName(location.path);
  },
  description: "Open text file",
  Component: ({ location, state, actions }) => {
    const document = findTextDocument(location, state.textDocuments);
    return document ? <TextFileViewer document={document} openPaths={actions.openPaths} /> : null;
  },
  keepAlive: true,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "text-file", documentId: typeof data.documentId === "string" ? data.documentId : undefined, path: data.path } : null),
  serialize: (location) => ({ documentId: location.documentId, path: location.path }),
});

function findTextDocument(location: TextFileLocation, documents: TextFileDocument[]) {
  return (
    documents.find((document) => document.id === location.documentId) ??
    documents.find((document) => document.path === location.path) ??
    null
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Text file";
}
