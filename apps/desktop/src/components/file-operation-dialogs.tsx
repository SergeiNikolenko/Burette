import { useId } from "react";
import { basename } from "../lib/sidebar-projects";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

export type FileOperationRequest =
  | { operation: "rename" | "renameFolder" | "createFolder"; path: string; name: string }
  | { operation: "duplicate" | "trash" | "trashFolder"; path: string }
  | { operation: "saveCopy" | "moveInto"; path: string; destination: string };

const labels = { rename: "Rename File", duplicate: "Duplicate File", trash: "Move to Trash", saveCopy: "Save File Copy", renameFolder: "Rename Folder", createFolder: "New Folder", trashFolder: "Move Folder to Trash", moveInto: "Move to Folder" };

// Native filesystem controllers own transactions; these forms only collect intent.
export function FileOperationDialog({ request, name, onNameChange, error, busy, onDismiss, onRun }: {
  request: FileOperationRequest | null; name: string; onNameChange: (name: string) => void;
  error: string; busy: boolean; onDismiss: () => void; onRun: (request: FileOperationRequest) => void;
}) {
  const problemId = useId();
  const needsName = request !== null && "name" in request;
  const renaming = request?.operation === "rename" || request?.operation === "renameFolder";
  const problem = !needsName ? "" : !name.trim() ? "Enter a name."
    : name !== name.trim() ? "Remove spaces at the start or end."
    : /[/\\\0:]/.test(name) || name === "." || name === ".." ? "Enter a name without path separators." : "";
  const trashing = request?.operation === "trash" || request?.operation === "trashFolder";
  return <Dialog open={request !== null} onOpenChange={open => { if (!open && !busy) onDismiss(); }}>
    <DialogContent variant="form" size="narrow" className="overscroll-contain" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <form className="grid gap-4" aria-busy={busy} onSubmit={event => {
        event.preventDefault();
        if (request && !problem && !busy) onRun(needsName ? { ...request, name } as FileOperationRequest : request);
      }}>
        <DialogHeader><DialogTitle>{request ? labels[request.operation] : "File"}</DialogTitle>
          <DialogDescription className={needsName ? "sr-only" : "break-words"}>
            {trashing ? `“${basename(request.path)}” can be restored from Trash.` : request ? basename(request.path) : "File operation"}
          </DialogDescription>
        </DialogHeader>
        {needsName ? <label className="grid gap-2 text-xs"><span className={renaming ? "sr-only" : undefined}>Name</span>
          <Input variant="field" name="file-name" aria-label="File or folder name" aria-invalid={Boolean(problem)}
            aria-describedby={problem ? problemId : undefined} autoComplete="off" spellCheck={false}
            value={name} onChange={event => onNameChange(event.target.value)} onFocus={event => event.target.select()} disabled={busy} />
        </label> : null}
        {problem ? <p id={problemId} role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {busy ? <span role="status" className="mr-auto flex items-center gap-2 text-sm"><Spinner aria-hidden />Working…</span> : null}
          <Button type="button" variant="secondary" disabled={busy} onClick={onDismiss}>Cancel</Button>
          <Button type="submit" disabled={busy || Boolean(problem)}>{renaming ? "Save" : request ? labels[request.operation] : "Apply"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function TrashFilesDialog({ paths, completed, error, busy, onDismiss, onRetry }: {
  paths: string[]; completed: number; error: string; busy: boolean; onDismiss: () => void; onRetry: () => void;
}) {
  return <Dialog open={paths.length > 0} onOpenChange={open => { if (!open && !busy) onDismiss(); }}>
    <DialogContent variant="form" size="narrow" className="overscroll-contain" showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Move {paths.length} {paths.length === 1 ? "File" : "Files"} to Trash</DialogTitle>
        <DialogDescription>You can restore these files in Finder.</DialogDescription>
      </DialogHeader>
      <ul aria-label="Files to move" className="grid min-w-0 max-h-[min(40dvh,280px)] gap-2 overflow-y-auto overscroll-contain break-words text-sm">
        {paths.map(path => <li key={path} className="[content-visibility:auto] [contain-intrinsic-size:auto_24px]">{basename(path)}</li>)}
      </ul>
      {completed > 0 ? <p role="status" className="text-sm">{completed} {completed === 1 ? "file" : "files"} moved.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        {busy ? <span role="status" className="mr-auto flex items-center gap-2 text-sm"><Spinner aria-hidden />Moving…</span> : null}
        <Button type="button" variant="secondary" disabled={busy} onClick={onDismiss}>Cancel</Button>
        <Button disabled={busy} onClick={onRetry}>Move to Trash</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
