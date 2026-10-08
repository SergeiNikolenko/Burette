import type { TextFileDocument } from "../types";
import type { ShellActions } from "./types";
import { formatBytes } from "./format";
import { FileInfoPanel } from "./file-info-panel";

export function TextDocumentInfoPanel({ document, actions }: {
  document: TextFileDocument;
  actions: Pick<ShellActions, "showTextFileMetadata" | "revealPath" | "copyPath">;
}) {
  return <FileInfoPanel file={document} actions={actions} onShowMetadata={() => void actions.showTextFileMetadata(document)}>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
      {document.language ? <><dt className="text-(--color-text-secondary)">Language</dt><dd className="text-right wrap-anywhere">{document.language}</dd></> : null}
      <dt className="text-(--color-text-secondary)">Size</dt><dd className="text-right tabular-nums">{formatBytes(document.byteCount)}</dd>
      {document.truncated ? <><dt className="text-(--color-text-secondary)">Preview</dt><dd className="text-right">Partial</dd></> : null}
    </dl>
  </FileInfoPanel>;
}
