import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridNativeMenuState } from "../lib/native-menu";
import type { ViewerDocument } from "../types";

function sameState(left: GridNativeMenuState | undefined, right: GridNativeMenuState) {
  return left
    && left.selectedCount === right.selectedCount
    && left.selectedStructureCount === right.selectedStructureCount
    && left.dirty === right.dirty
    && left.canUndo === right.canUndo
    && left.canRedo === right.canRedo
    && left.undoLabel === right.undoLabel
    && left.redoLabel === right.redoLabel
    && left.editingText === right.editingText
    && left.viewMode === right.viewMode
    && left.showProperties === right.showProperties
    && left.cardRenderer === right.cardRenderer
    && left.hasMolecules === right.hasMolecules
    && left.saveEnabled === right.saveEnabled
    && left.exportEnabled === right.exportEnabled
    && left.selectionEnabled === right.selectionEnabled
    && left.canOpenSelectedInMolstar === right.canOpenSelectedInMolstar
    && left.canOpenSelectedInKetcher === right.canOpenSelectedInKetcher
    && left.canGenerate3dForSelection === right.canGenerate3dForSelection
    && left.supportsXyzrender === right.supportsXyzrender
    && left.generating3d === right.generating3d;
}

export function useGridNativeMenuState(
  activeDocument: ViewerDocument | null,
  documents: ViewerDocument[],
) {
  const [states, setStates] = useState<Record<string, GridNativeMenuState>>({});

  useEffect(() => {
    const openIds = new Set(documents.map((document) => document.id));
    setStates((previous) => {
      const entries = Object.entries(previous).filter(([documentId]) => openIds.has(documentId));
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    });
  }, [documents]);

  const updateGridMenuState = useCallback((documentId: string, state: GridNativeMenuState) => {
    if (!documentId) return;
    setStates((previous) => sameState(previous[documentId], state)
      ? previous
      : { ...previous, [documentId]: state });
  }, []);

  const activeGridMenuState = useMemo(() => (
    activeDocument?.renderer === "grid2d" ? states[activeDocument.id] ?? null : null
  ), [activeDocument, states]);

  return { activeGridMenuState, updateGridMenuState };
}
