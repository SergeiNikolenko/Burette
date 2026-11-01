import { useMemo } from "react";
import { useSourceEditing } from "../source-editing/context";
import { useSourceText } from "../source-editing/use-structure-source-text";
import { captureLogicalSourceOwner, useLogicalSource } from "../science-session/state";
import { readStructureTextDocument } from "../structure-text";
import { useMoleculeStore } from "../../stores/molecule-store";
import type { ViewerDocument } from "../../types";

/** Shared by source-based builders: bounded text and the exact open document/draft lifetime. */
export function useOwnedSourceText(document: ViewerDocument | null, limit: number, tooLarge: string) {
  const editing = useSourceEditing(), session = editing?.sessionForDocument(document) ?? null;
  const open = useMoleculeStore(state => document !== null && state.documents.includes(document));
  const usable = open ? document : null;
  const logical = useLogicalSource(document?.id ?? null);
  const source = useSourceText(usable, (_identity, path) => ({
    text: readStructureTextDocument(path, undefined, { maxBytes: limit + 1 }).then(result => {
      if (result.truncated || result.byteCount > limit) throw new Error(tooLarge);
      return result.content;
    }), release() {},
  }));
  const oversized = useMemo(() => source.text !== null && (source.text.length > limit || new TextEncoder().encode(source.text).length > limit), [source.text]);
  const text = oversized ? null : source.text;
  const revision = useMemo(() => ({ document: usable, text, logical, sessionId: session?.sessionId, revision: session?.revision }),
    [usable, text, logical, session?.sessionId, session?.revision]);
  const capture = (onRetire?: () => void) => {
    if (!usable || text === null) return null;
    const operation = editing?.captureOperation(usable), logicalCurrent = captureLogicalSourceOwner(usable.id);
    let retired = false;
    const retire = () => { if (!retired) { retired = true; onRetire?.(); } };
    const unsubscribe = useMoleculeStore.subscribe(state => { if (!state.documents.includes(usable)) retire(); });
    const isCurrent = () => {
      const current = editing?.sessionForDocument(usable) ?? null;
      return !retired && useMoleculeStore.getState().documents.includes(usable) && logicalCurrent() && (!operation || operation.isCurrent())
        && current?.sessionId === session?.sessionId && current?.revision === session?.revision;
    };
    return { isCurrent, release: () => { retire(); unsubscribe(); operation?.release(); } };
  };
  return { text, error: oversized ? tooLarge : source.error, revision, capture };
}
