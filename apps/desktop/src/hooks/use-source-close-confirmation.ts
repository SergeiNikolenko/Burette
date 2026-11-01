import { useCallback, useEffect, useRef, useState } from "react";

export type SourceCloseConfirmationRequest = Readonly<{
  id: string;
  message: string;
  busy: boolean;
  cancel: () => void;
  discard: () => void;
}>;

/** The source-close owner releases the dialog only after its acknowledgement finishes. */
export function useSourceCloseConfirmation() {
  const [closeConfirmation, setCloseConfirmation] = useState<SourceCloseConfirmationRequest | null>(null);
  const mounted = useRef(true);
  const pending = useRef<{ view: SourceCloseConfirmationRequest; resolve: (confirmed: boolean) => void; answered: boolean } | null>(null);
  const requestCloseConfirmation = useCallback((message: string) => {
    if (!mounted.current || pending.current) return { result: Promise.resolve(false), release() {} };
    let resolve!: (confirmed: boolean) => void;
    const result = new Promise<boolean>(done => { resolve = done; });
    const answer = (confirmed: boolean) => {
      const entry = pending.current;
      if (entry?.view !== view || entry.answered) return;
      entry.answered = true;
      setCloseConfirmation({ ...view, busy: true });
      resolve(confirmed);
    };
    const view: SourceCloseConfirmationRequest = { id: crypto.randomUUID(), message, busy: false,
      cancel: () => answer(false), discard: () => answer(true) };
    pending.current = { view, resolve, answered: false };
    setCloseConfirmation(view);
    return { result, release() {
      if (pending.current?.view !== view) return;
      pending.current = null; setCloseConfirmation(null); resolve(false);
    } };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const entry = pending.current; pending.current = null; entry?.resolve(false); };
  }, []);
  return { closeConfirmation, requestCloseConfirmation };
}
