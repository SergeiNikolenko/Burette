import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { downloadTextFile, exportDialogFilters, safeExportFileName, type TextFileSaveOutcome } from "../lib/file-export";
import type { SourceDraftRecoveryDraft, SourceDraftRecoveryRequest } from "../lib/source-editing/context";
import { isTauriRuntime } from "../lib/tauri";

/** One recoverable prompt; it never republishes a retired draft as the current scene. */
export function useSourceDraftRecovery() {
  const [recovery, setRecovery] = useState<SourceDraftRecoveryRequest | null>(null);
  const pending = useRef<{ view: SourceDraftRecoveryRequest; settle: () => void; resolve: () => void; copying: boolean } | null>(null);
  const requestRecovery = useCallback((drafts: readonly SourceDraftRecoveryDraft[], ownerIsCurrent: () => boolean, discard: () => void) => {
    pending.current?.settle();
    return new Promise<false>(resolve => {
      const current = () => pending.current?.view === view && ownerIsCurrent();
      const settle = () => {
        if (pending.current?.view !== view) return;
        pending.current = null; setRecovery(null); resolve(false);
      };
      const saveCopy = async (sessionId: string): Promise<TextFileSaveOutcome> => {
        const draft = drafts.find(item => item.sessionId === sessionId), entry = pending.current;
        if (!current() || !draft || !entry || entry.copying) return { status: "cancelled" };
        entry.copying = true;
        try {
          const stem = safeExportFileName(draft.title).replace(/\.[^.]+$/u, "").slice(0, 100);
          const name = `${stem || "structure"}.${draft.extension}`;
          let path: string | null = null;
          if (isTauriRuntime()) {
            const outputPath = await saveDialog({ defaultPath: name, filters: exportDialogFilters(name, "text/plain") });
            if (!outputPath || !current()) return { status: "cancelled" };
            if (drafts.some(item => item.path === outputPath)) return { status: "failed", message: "Choose a new destination for the recovered draft." };
            path = await invoke<string>("save_text_as", { text: draft.content, outputPath, sourcePath: null });
          } else {
            downloadTextFile(name, draft.content);
          }
          if (current()) settle();
          return { status: "saved", path };
        } catch (error) {
          return { status: "failed", message: error instanceof Error ? error.message : String(error) };
        } finally { entry.copying = false; }
      };
      const view: SourceDraftRecoveryRequest = { requestId: crypto.randomUUID(), drafts, isCurrent: current, cancel: settle,
        discard: () => { if (current()) discard(); settle(); }, saveCopy };
      pending.current = { view, settle, resolve: () => resolve(false), copying: false };
      setRecovery(view);
    });
  }, []);
  const invalidateRecovery = useCallback(() => {
    if (pending.current && !pending.current.view.isCurrent()) pending.current.settle();
  }, []);
  useEffect(() => () => { const entry = pending.current; pending.current = null; entry?.resolve(); }, []);
  return { recovery, requestRecovery, invalidateRecovery };
}
