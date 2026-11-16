import { useEffect } from "react";
import type { SourceEditingContextValue } from "../lib/source-editing/context";
import type { ViewerDocument } from "../types";
import { isBrowserSessionWorkspace } from "../lib/window-scope";
import { readBrowserSourceCheckpoint } from "../lib/browser-source-checkpoint";
import { captureLogicalSourceOwner, captureSourceCloseOwner, logicalSourceFor } from "../lib/science-session/state";
import { importedOriginalFor } from "../lib/workbench/scientific-source-state";
import { useMoleculeStore } from "../stores/molecule-store";

type RecoveryActions = Pick<SourceEditingContextValue, "beginEditing" | "sessionForDocument" | "applyPreview">;

/** Admission is the same fresh dirty source session used for ordinary editing. */
export async function recoverBrowserSource(document: ViewerDocument, actions: RecoveryActions, isCurrent: () => boolean) {
  if (!isBrowserSessionWorkspace() || logicalSourceFor(document.id) || !importedOriginalFor(document.id)
    || actions.sessionForDocument(document)) return;
  const checkpoint = await readBrowserSourceCheckpoint(document.path);
  if (!checkpoint || !isCurrent() || actions.sessionForDocument(document)) return;
  await actions.beginEditing(document, "text", { reveal: false, failure: "throw" });
  if (!isCurrent()) return;
  const session = actions.sessionForDocument(document);
  if (!session || session.documentId !== document.id || session.content !== checkpoint.text || !session.dirty) {
    throw new Error("The saved draft could not be recovered. Try opening the source again.");
  }
}

export function useBrowserSourceRecovery(document: ViewerDocument | null, actions: RecoveryActions, onError: (error: unknown, prefix?: string) => void) {
  useEffect(() => {
    if (!document || !isBrowserSessionWorkspace()) return;
    let active = true;
    const source = captureLogicalSourceOwner(document.id), close = captureSourceCloseOwner(document.id);
    const current = () => active && source() && close() && useMoleculeStore.getState().documents.some(value => value === document);
    void recoverBrowserSource(document, actions, current).then(async () => {
      if (current() && actions.sessionForDocument(document)?.previewState === "manual") await actions.applyPreview(document);
    }).catch(error => { if (current()) onError(error, "Recover source draft"); });
    return () => { active = false; };
  }, [document, actions, onError]);
}
