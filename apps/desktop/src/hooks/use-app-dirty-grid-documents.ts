import { useCallback, useState } from "react";

export function useAppDirtyGridDocuments() {
  const [dirtyGridDocuments, setDirtyGridDocuments] = useState<Set<string>>(() => new Set());

  const confirmDiscardDirtyGridDocument = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !dirtyGridDocuments.has(documentId)) return true;
    return window.confirm("This grid has unsaved changes. Save or Save As before closing to keep edits. Close without saving?");
  }, [dirtyGridDocuments]);

  const confirmDiscardDirtyGridDocuments = useCallback((documentIds: string[]) => {
    const dirtyCount = documentIds.filter((documentId) => dirtyGridDocuments.has(documentId)).length;
    if (dirtyCount === 0) return true;
    return window.confirm(`${dirtyCount} grid document${dirtyCount === 1 ? " has" : "s have"} unsaved changes. Save or Save As before closing to keep edits. Close without saving?`);
  }, [dirtyGridDocuments]);

  const updateDirtyGridDocument = useCallback((documentId: string | null | undefined, dirty: boolean) => {
    if (!documentId) return;
    setDirtyGridDocuments((previous) => {
      const next = new Set(previous);
      if (dirty) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }, []);

  const forgetDirtyGridDocument = useCallback((documentId: string | null | undefined) => {
    if (!documentId) return;
    setDirtyGridDocuments((previous) => {
      const next = new Set(previous);
      next.delete(documentId);
      return next;
    });
  }, []);

  const forgetDirtyGridDocuments = useCallback((documentIds: string[]) => {
    if (documentIds.length === 0) return;
    setDirtyGridDocuments((previous) => {
      const next = new Set(previous);
      for (const documentId of documentIds) next.delete(documentId);
      return next;
    });
  }, []);

  const clearDirtyGridDocuments = useCallback(() => {
    setDirtyGridDocuments(new Set());
  }, []);

  return {
    clearDirtyGridDocuments,
    confirmDiscardDirtyGridDocument,
    confirmDiscardDirtyGridDocuments,
    forgetDirtyGridDocument,
    forgetDirtyGridDocuments,
    updateDirtyGridDocument,
  };
}
