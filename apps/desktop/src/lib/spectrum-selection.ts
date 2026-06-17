import { useCallback, useEffect, useState } from "react";

const SPECTRUM_SELECTION_EVENT = "burrete-spectrum-selection";
const selectedPeaks = new Map<string, number | null>();

type SpectrumSelectionDetail = {
  documentId: string;
  peakIndex: number | null;
};

export function useSpectrumPeakSelection(documentId: string) {
  const [selectedPeakIndex, setSelectedPeakIndex] = useState<number | null>(() => selectedPeaks.get(documentId) ?? null);

  useEffect(() => {
    setSelectedPeakIndex(selectedPeaks.get(documentId) ?? null);
    const handleSelection = (event: Event) => {
      const detail = (event as CustomEvent<SpectrumSelectionDetail>).detail;
      if (detail.documentId !== documentId) return;
      setSelectedPeakIndex(detail.peakIndex);
    };
    window.addEventListener(SPECTRUM_SELECTION_EVENT, handleSelection);
    return () => window.removeEventListener(SPECTRUM_SELECTION_EVENT, handleSelection);
  }, [documentId]);

  const selectPeak = useCallback((peakIndex: number | null) => {
    selectedPeaks.set(documentId, peakIndex);
    window.dispatchEvent(new CustomEvent<SpectrumSelectionDetail>(SPECTRUM_SELECTION_EVENT, {
      detail: { documentId, peakIndex },
    }));
  }, [documentId]);

  return [selectedPeakIndex, selectPeak] as const;
}
