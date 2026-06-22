import { useCallback } from "react";
import { openBrowserDevDocuments } from "../lib/browser-dev-documents";
import { openBrowserDevTextFiles } from "../lib/browser-dev-text-files";
import { detectContentSpectrumPaths } from "../lib/content-spectrum-detection";
import { pathExtension } from "../lib/file-routing";
import { isSpectrumPath, spectrumDocumentFromText } from "../lib/spectrum";
import type { ViewerPreferences } from "../types";

type UseAppQuickLookDocumentOpenOptions = {
  preferences: ViewerPreferences;
};

export function useAppQuickLookDocumentOpen({ preferences }: UseAppQuickLookDocumentOpenOptions) {
  const openQuickLookDocument = useCallback(async (quickLookPath: string) => {
    const extension = pathExtension(quickLookPath);
    const contentSpectrumPaths = await detectContentSpectrumPaths([quickLookPath]);
    if (isSpectrumPath(quickLookPath, extension) || contentSpectrumPaths.has(quickLookPath)) {
      const result = await openBrowserDevTextFiles([quickLookPath]);
      const textDocument = result.documents[0] ?? null;
      if (!textDocument) return null;
      return spectrumDocumentFromText(textDocument);
    }
    const result = await openBrowserDevDocuments([quickLookPath], preferences);
    return result.documents[0] ?? null;
  }, [preferences]);

  return { openQuickLookDocument };
}
