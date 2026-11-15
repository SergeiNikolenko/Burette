import { useEffect, useRef, useState } from "react";
import type { SourceDraftRecoveryRequest } from "../lib/source-editing/context";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

export function SourceDraftRecoveryDialog({ request }: { request: SourceDraftRecoveryRequest | null }) {
  return request ? <RecoveryBody key={request.requestId} request={request} /> : null;
}

function RecoveryBody({ request }: { request: SourceDraftRecoveryRequest }) {
  const [selected, setSelected] = useState(request.drafts[0]?.sessionId);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const draft = request.drafts.find(value => value.sessionId === selected) ?? request.drafts[0];
  const dismiss = () => { if (!running.current && request.isCurrent()) request.cancel(); };
  const copy = async () => {
    if (!draft || running.current || !request.isCurrent()) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const result = await request.saveCopy(draft.sessionId);
      if (mounted.current && request.isCurrent() && result.status === "failed") setError("Could not save a copy. Try again.");
    } catch {
      if (mounted.current && request.isCurrent()) setError("Could not save a copy. Try again.");
    } finally {
      running.current = false;
      if (mounted.current && request.isCurrent()) setBusy(false);
    }
  };
  if (!draft) return null;
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent variant="form" size="wide" showCloseButton={!busy} aria-busy={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Unsaved Source Changes</DialogTitle>
        <DialogDescription className="sr-only">Save a copy or discard the unsaved source draft.</DialogDescription>
      </DialogHeader>
      {request.drafts.length > 1 ? <NativeSelect aria-label="Unsaved source draft" value={draft.sessionId} disabled={busy}
        onChange={event => { setSelected(event.target.value); setError(null); }}>
        {request.drafts.map(value => <NativeSelectOption key={value.sessionId} value={value.sessionId}>{value.title}</NativeSelectOption>)}
      </NativeSelect> : <span className="truncate text-sm" title={draft.title}>{draft.title}</span>}
      <Textarea readOnly className="workbench-code max-h-[min(45dvh,320px)] overflow-auto" aria-label="Unsaved source contents" value={draft.content} rows={12} wrap="off" spellCheck={false} />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        {busy ? <span role="status" className="mr-auto flex items-center gap-2 text-sm"><Spinner aria-hidden />Saving…</span> : null}
        <Button type="button" variant="secondary" disabled={busy} onClick={dismiss}>Cancel</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!running.current && request.isCurrent()) request.discard(); }}>Discard</Button>
        <Button type="button" disabled={busy} onClick={() => void copy()}>Save copy</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
