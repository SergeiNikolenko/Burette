import type { TextFileDocument } from "../types";
import type { ShellActions } from "./types";
import { formatBytes } from "./format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function TextDocumentInfoPanel({ document, actions }: {
  document: TextFileDocument;
  actions: Pick<ShellActions, "showTextFileMetadata" | "revealPath" | "copyPath">;
}) {
  return <section className="dock-content min-w-0 text-sm text-(--color-text)" aria-label="File information">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <h3 className="min-w-0 wrap-anywhere font-semibold">{document.title}</h3>
      {document.extension ? <Badge variant="secondary">{document.extension.toUpperCase()}</Badge> : null}
    </div>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
      {document.language ? <><dt className="text-(--color-text-secondary)">Language</dt><dd className="text-right wrap-anywhere">{document.language}</dd></> : null}
      <dt className="text-(--color-text-secondary)">Size</dt><dd className="text-right tabular-nums">{formatBytes(document.byteCount)}</dd>
      {document.truncated ? <><dt className="text-(--color-text-secondary)">Preview</dt><dd className="text-right">Partial</dd></> : null}
    </dl>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="xs" onClick={() => void actions.showTextFileMetadata(document)}>Show metadata</Button>
      <Button type="button" variant="secondary" size="xs" onClick={() => void actions.revealPath(document.path, "file")}>Reveal file</Button>
      <Button type="button" variant="secondary" size="xs" onClick={() => void actions.copyPath(document.path, "file")}>Copy path</Button>
    </div>
  </section>;
}
