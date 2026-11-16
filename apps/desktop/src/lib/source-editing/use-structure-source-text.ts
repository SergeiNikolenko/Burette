import { useEffect, useMemo, useState } from "react";
import { useSourceEditing } from "./context";
import { readStructureText } from "../structure-text";
import { useLogicalSource } from "../science-session/state";
import type { ViewerDocument } from "../../types";

/**
 * Current source text: the unsaved draft when one exists, otherwise the file.
 * A replacement document at the same path (a reload) is read again; the previous
 * text is never returned for it.
 */
export function useStructureSourceText(document: ViewerDocument | null) {
  return useSourceText(document, (_identity, path) => ({ text: readStructureText(path), release() {} }));
}

export function useSourceText(document: ViewerDocument | null, read: (identity: ViewerDocument, path: string) => { text: Promise<string>; release: () => void }) {
  const session = useSourceEditing()?.sessionForDocument(document) ?? null;
  // A restored scene's text is its logical source; the archive is never read as text.
  const logical = useLogicalSource(document?.id ?? null);
  const [file, setFile] = useState<{ identity: { document: ViewerDocument | null }; text: string | null; error: string | null } | null>(null);
  const path = document?.path ?? null;
  // Returning from a draft or restored source starts a fresh file read too.
  // Its previous text/error must not flash while that read is pending.
  const identity = useMemo(() => ({ document }), [document, Boolean(session), Boolean(logical)]);
  useEffect(() => {
    if (!identity.document || !path || session || logical) return undefined;
    let current = true;
    const { text, release } = read(identity.document, path);
    void text
      .then((value) => { if (current) setFile({ identity, text: value, error: null }); })
      .catch((error) => { if (current) setFile({ identity, text: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { current = false; release(); };
  }, [identity, Boolean(session), Boolean(logical)]);
  if (!document) return { text: null, error: null };
  if (session) return { text: session.content, error: null };
  if (logical) return { text: logical.text, error: null };
  return file?.identity === identity ? { text: file.text, error: file.error } : { text: null, error: null };
}
