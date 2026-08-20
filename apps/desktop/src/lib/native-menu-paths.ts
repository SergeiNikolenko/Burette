type ViewerDocumentPath = {
  path: string;
  virtual?: boolean;
};

type TextDocumentPath = {
  path: string;
};

export function isAbsoluteNativeFilePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\");
}

export function fileBackedViewerDocumentPath(document: ViewerDocumentPath) {
  if (document.virtual || !isAbsoluteNativeFilePath(document.path)) return null;
  return document.path;
}

export function nativeOpenDocumentPaths(
  viewerDocuments: ViewerDocumentPath[],
  textDocuments: TextDocumentPath[],
  documentTabPaths: string[] = [],
) {
  const paths = [
    ...viewerDocuments
      .map(fileBackedViewerDocumentPath)
      .filter((path): path is string => path !== null),
    ...textDocuments
      .map((document) => document.path)
      .filter(isAbsoluteNativeFilePath),
    // Retab document tabs hold no ViewerDocument/TextFileDocument, but the file
    // is open all the same: without these paths the Rust write guard would let a
    // Save As overwrite a document the user is looking at.
    ...documentTabPaths.filter(isAbsoluteNativeFilePath),
  ];
  return Array.from(new Set(paths));
}
