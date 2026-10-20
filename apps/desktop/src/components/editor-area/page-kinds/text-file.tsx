import { TextFileViewer } from "../../text-file-viewer";
import { findIndexedDocument } from "../document-index";
import { definePageKind } from "./types";

export type TextFileLocation = { kind: "text-file"; documentId?: string; path: string };

export const textFileKind = definePageKind<"text-file", TextFileLocation>({
  kind: "text-file",
  title: (location, state) => {
    const document = findIndexedDocument(state.textDocuments, location);
    return document?.title ?? fileName(location.path);
  },
  description: "Open text file",
  Component: ({ location, state, actions }) => {
    const document = findIndexedDocument(state.textDocuments, location);
    return document ? <TextFileViewer document={document} openPaths={actions.openPaths} onStructureSelection={actions.selectTextStructure} /> : null;
  },
  keepAlive: true,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "text-file", documentId: typeof data.documentId === "string" ? data.documentId : undefined, path: data.path } : null),
  serialize: (location) => ({ documentId: location.documentId, path: location.path }),
});

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Text file";
}
