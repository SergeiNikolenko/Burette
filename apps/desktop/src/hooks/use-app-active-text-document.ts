import { useMemo } from "react";
import type { MoleculeTab } from "../stores/molecule-store";
import type { TextFileDocument } from "../types";

type UseAppActiveTextDocumentOptions = {
  activeTab: MoleculeTab | null;
  textDocuments: TextFileDocument[];
};

export function useAppActiveTextDocument({
  activeTab,
  textDocuments,
}: UseAppActiveTextDocumentOptions) {
  return useMemo(() => {
    const location = activeTab?.location;
    if (location?.kind !== "text-file") return null;
    return textDocuments.find((document) => document.id === location.documentId || document.path === location.path) ?? null;
  }, [activeTab?.location, textDocuments]);
}
