import { useCallback, useRef, useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../lib/tauri";
import {
  beginWindowCloseTransition,
  ExitTransitionActiveError,
  type WindowCloseMutationPermit,
} from "../lib/window-mutation-barrier";

const CLOSE_WITHOUT_SAVING_LABEL = "Close Without Saving";
let nextWindowDirtyRevision = 0;

async function confirmCloseWithoutSaving(dirtyCount: number) {
  const subject = dirtyCount === 1
    ? "This grid has unsaved or in-progress changes."
    : `${dirtyCount} grid documents have unsaved or in-progress changes.`;
  const detail = `${subject} Review before closing, or close without saving.`;
  if (!isTauriRuntime()) return window.confirm(`${detail}\n\nClose without saving?`);

  const result = await message(detail, {
    title: "Unsaved Changes",
    kind: "warning",
    buttons: {
      yes: "Review Unsaved Changes…",
      no: CLOSE_WITHOUT_SAVING_LABEL,
      cancel: "Cancel",
    },
  });
  return result === CLOSE_WITHOUT_SAVING_LABEL || result === "No";
}

export function useAppDirtyGridDocuments() {
  const [dirtyGridDocuments, setDirtyGridDocuments] = useState<Set<string>>(() => new Set());
  const dirtyGridDocumentsRef = useRef(dirtyGridDocuments);
  const dirtyRevisionRef = useRef(nextWindowDirtyRevision);

  const confirmDiscard = useCallback(async (
    documentIds: string[] | null,
  ): Promise<WindowCloseMutationPermit | null> => {
    let transition;
    try {
      transition = beginWindowCloseTransition();
    } catch (error) {
      if (error instanceof ExitTransitionActiveError) return null;
      throw error;
    }

    const targetIds = documentIds === null ? null : new Set(documentIds);
    const isTarget = (documentId: string) => targetIds === null || targetIds.has(documentId);
    const unsafeDocumentIds = new Set(
      [...dirtyGridDocumentsRef.current].filter(isTarget),
    );
    for (const documentId of transition.pendingDocumentIds) {
      if (isTarget(documentId)) unsafeDocumentIds.add(documentId);
    }

    try {
      if (unsafeDocumentIds.size > 0
        && !await confirmCloseWithoutSaving(unsafeDocumentIds.size)) {
        transition.release();
        return null;
      }
      return transition;
    } catch (error) {
      transition.release();
      throw error;
    }
  }, []);

  const confirmDiscardDirtyGridDocument = useCallback((documentId: string | null | undefined) => (
    confirmDiscard(documentId ? [documentId] : [])
  ), [confirmDiscard]);

  const confirmDiscardDirtyGridDocuments = useCallback((documentIds: string[]) => (
    confirmDiscard(documentIds)
  ), [confirmDiscard]);

  const confirmDiscardAllDirtyGridDocuments = useCallback(() => (
    confirmDiscard(null)
  ), [confirmDiscard]);

  const replaceDirtyGridDocuments = useCallback((next: Set<string>) => {
    nextWindowDirtyRevision += 1;
    dirtyRevisionRef.current = nextWindowDirtyRevision;
    dirtyGridDocumentsRef.current = next;
    setDirtyGridDocuments(next);
  }, []);

  const updateDirtyGridDocument = useCallback((documentId: string | null | undefined, dirty: boolean) => {
    if (!documentId) return;
    if (dirtyGridDocumentsRef.current.has(documentId) === dirty) return;
    const next = new Set(dirtyGridDocumentsRef.current);
    if (dirty) next.add(documentId);
    else next.delete(documentId);
    replaceDirtyGridDocuments(next);
  }, [replaceDirtyGridDocuments]);

  const forgetDirtyGridDocument = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !dirtyGridDocumentsRef.current.has(documentId)) return;
    const next = new Set(dirtyGridDocumentsRef.current);
    next.delete(documentId);
    replaceDirtyGridDocuments(next);
  }, [replaceDirtyGridDocuments]);

  const forgetDirtyGridDocuments = useCallback((documentIds: string[]) => {
    if (documentIds.length === 0) return;
    const next = new Set(dirtyGridDocumentsRef.current);
    for (const documentId of documentIds) next.delete(documentId);
    if (next.size !== dirtyGridDocumentsRef.current.size) replaceDirtyGridDocuments(next);
  }, [replaceDirtyGridDocuments]);

  const clearDirtyGridDocuments = useCallback(() => {
    if (dirtyGridDocumentsRef.current.size > 0) replaceDirtyGridDocuments(new Set());
  }, [replaceDirtyGridDocuments]);

  const getWindowDocumentDirtySnapshot = useCallback(() => ({
    dirty: dirtyGridDocumentsRef.current.size > 0,
    revision: dirtyRevisionRef.current,
  }), []);

  const isDirtyGridDocument = useCallback((documentId: string) => (
    dirtyGridDocumentsRef.current.has(documentId)
  ), []);

  return {
    clearDirtyGridDocuments,
    confirmDiscardAllDirtyGridDocuments,
    confirmDiscardDirtyGridDocument,
    confirmDiscardDirtyGridDocuments,
    forgetDirtyGridDocument,
    forgetDirtyGridDocuments,
    hasDirtyGridDocuments: dirtyGridDocuments.size > 0,
    getWindowDocumentDirtySnapshot,
    isDirtyGridDocument,
    updateDirtyGridDocument,
  };
}
