import { useMemo } from "react";
import { isMoleculeCollectionPath } from "../lib/collection-documents";
import type { ViewerDocument } from "../types";

type MergeMoleculeCollections = (targetPath: string | null, paths: string[]) => void | Promise<void>;

type UseAppOpenDropMergeCollectionsOptions = {
  activeDocument: ViewerDocument | null;
  mergeMoleculeCollections: MergeMoleculeCollections;
};

export function useAppOpenDropMergeCollections({
  activeDocument,
  mergeMoleculeCollections,
}: UseAppOpenDropMergeCollectionsOptions) {
  return useMemo(() => {
    if (activeDocument?.renderer !== "grid2d") return undefined;
    return (paths: string[]) => {
      if (!paths.some(isMoleculeCollectionPath)) return false;
      void mergeMoleculeCollections(activeDocument.path, paths);
      return true;
    };
  }, [activeDocument, mergeMoleculeCollections]);
}
