import type { ReactNode } from "react";
import type { ShellActions } from "./types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function FileInfoPanel({ file, actions, children, onShowMetadata }: {
  file: { title: string; extension: string; path: string };
  actions: Pick<ShellActions, "revealPath" | "copyPath">;
  children?: ReactNode;
  onShowMetadata?: () => void;
}) {
  return <section className="dock-content min-w-0 text-sm text-(--color-text)" aria-label="File information">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <h3 className="min-w-0 wrap-anywhere font-semibold">{file.title}</h3>
      {file.extension ? <Badge variant="secondary">{file.extension.toUpperCase()}</Badge> : null}
    </div>
    {children}
    <div className="flex flex-wrap gap-2">
      {onShowMetadata ? <Button type="button" variant="secondary" size="xs" onClick={onShowMetadata}>Show metadata</Button> : null}
      <Button type="button" variant="secondary" size="xs" onClick={() => void actions.revealPath(file.path, "file")}>Reveal file</Button>
      <Button type="button" variant="secondary" size="xs" onClick={() => void actions.copyPath(file.path, "file")}>Copy path</Button>
    </div>
  </section>;
}
