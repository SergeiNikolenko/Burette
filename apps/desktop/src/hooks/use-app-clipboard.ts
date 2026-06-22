import { useCallback } from "react";

type UseAppClipboardArgs = {
  openClipboardText: (text: string) => boolean;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

export function useAppClipboard({
  openClipboardText,
  pushErrorStatus,
  pushStatus,
}: UseAppClipboardArgs) {
  const openClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) {
        pushStatus("Clipboard text is not available in this environment.", "error");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!openClipboardText(text)) {
        pushStatus("Clipboard does not contain a supported molecular structure.", "error");
      }
    } catch (error) {
      pushErrorStatus(error, "Open from clipboard failed");
    }
  }, [openClipboardText, pushErrorStatus, pushStatus]);

  return { openClipboard };
}
