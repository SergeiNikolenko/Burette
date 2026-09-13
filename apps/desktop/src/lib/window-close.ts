export type WindowCloseDecision = "abort" | "close";

export type WindowCloseInput = {
  /** Mutations still running inside the sealed window barrier. */
  pendingCount: number;
  /** A save or close transition is in flight (barrier or source editing). */
  closeTransitionActive: boolean;
  /** Combined dirty flag of the window's documents. */
  dirty: boolean;
  /** Grid documents with unsaved edits. */
  gridDirty: boolean;
  /** Source editing sessions with unsaved edits. */
  sourceDirty: boolean;
  /** Generic "discard unsaved changes and close" prompt. */
  confirm: () => Promise<boolean>;
  /** Source editing prompt with its own wording; asked only when sources are dirty. */
  sourceConfirm: () => Promise<boolean>;
  /** Tells the user a save is still running and the window cannot close yet. */
  notifySaveInProgress: () => Promise<void>;
};

/**
 * Decides whether a non-last workspace window may close. Pure apart from the
 * injected prompts so the policy can be exercised without a webview: a running
 * save always aborts, dirty sources get the source-editing prompt, and any
 * other unsaved edits get the generic prompt.
 */
export async function decideWindowClose(input: WindowCloseInput): Promise<WindowCloseDecision> {
  if (input.pendingCount > 0 || input.closeTransitionActive) {
    await input.notifySaveInProgress();
    return "abort";
  }
  if (input.sourceDirty && !(await input.sourceConfirm())) return "abort";
  const needsGenericConfirm = input.gridDirty || (input.dirty && !input.sourceDirty);
  if (needsGenericConfirm && !(await input.confirm())) return "abort";
  return "close";
}
