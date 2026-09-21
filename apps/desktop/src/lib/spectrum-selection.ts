import { useCallback, useEffect, useState } from "react";

const SPECTRUM_SELECTION_EVENT = "burette-spectrum-selection";
const spectrumSelections = new Map<string, SpectrumSelectionState>();

export type SpectrumSelectionState = {
  activePeakIndex: number | null;
  selectedPeakIndices: number[];
};

type SpectrumSelectionDetail = SpectrumSelectionState & {
  documentId: string;
};

const EMPTY_SELECTION: SpectrumSelectionState = {
  activePeakIndex: null,
  selectedPeakIndices: [],
};

export function useSpectrumPeakSelection(documentId: string) {
  const [selection, setSelection] = useState<SpectrumSelectionState>(() => spectrumSelections.get(documentId) ?? EMPTY_SELECTION);

  useEffect(() => {
    setSelection(spectrumSelections.get(documentId) ?? EMPTY_SELECTION);
    const handleSelection = (event: Event) => {
      const detail = (event as CustomEvent<SpectrumSelectionDetail>).detail;
      if (detail.documentId !== documentId) return;
      setSelection({
        activePeakIndex: detail.activePeakIndex,
        selectedPeakIndices: detail.selectedPeakIndices,
      });
    };
    window.addEventListener(SPECTRUM_SELECTION_EVENT, handleSelection);
    return () => window.removeEventListener(SPECTRUM_SELECTION_EVENT, handleSelection);
  }, [documentId]);

  const setSpectrumSelection = useCallback((nextSelection: SpectrumSelectionState) => {
    spectrumSelections.set(documentId, nextSelection);
    window.dispatchEvent(new CustomEvent<SpectrumSelectionDetail>(SPECTRUM_SELECTION_EVENT, {
      detail: { documentId, ...nextSelection },
    }));
  }, [documentId]);

  const previewPeak = useCallback((peakIndex: number | null) => {
    const currentSelection = spectrumSelections.get(documentId) ?? EMPTY_SELECTION;
    setSpectrumSelection({
      activePeakIndex: peakIndex,
      selectedPeakIndices: currentSelection.selectedPeakIndices,
    });
  }, [documentId, setSpectrumSelection]);

  const selectPeak = useCallback((peakIndex: number | null) => {
    setSpectrumSelection({
      activePeakIndex: peakIndex,
      selectedPeakIndices: peakIndex === null ? [] : [peakIndex],
    });
  }, [setSpectrumSelection]);

  const selectPeakRange = useCallback((startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    setSpectrumSelection({
      activePeakIndex: endIndex,
      selectedPeakIndices: Array.from({ length: end - start + 1 }, (_value, offset) => start + offset),
    });
  }, [setSpectrumSelection]);

  const clearPeakSelection = useCallback(() => {
    setSpectrumSelection(EMPTY_SELECTION);
  }, [setSpectrumSelection]);

  return {
    activePeakIndex: selection.activePeakIndex,
    selectedPeakIndices: selection.selectedPeakIndices,
    previewPeak,
    selectPeak,
    selectPeakRange,
    clearPeakSelection,
  } as const;
}
