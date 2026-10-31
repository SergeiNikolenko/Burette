export type WorkbenchToolDockKind = "vibrations" | "orbitals" | "scientific-spectra";

/** Return focus after the command dialog closes, only if its requested workspace and document still own the pane. */
export function focusToolDock(kind: WorkbenchToolDockKind, documentId: string, workspaceId: string) {
  const pane = [...document.querySelectorAll<HTMLElement>(`aside[data-area="right"][data-open="true"][data-active-tab="${kind}"]`)]
    .find(element => element.dataset.documentId === documentId && element.dataset.workspaceId === workspaceId && !element.closest('[inert]'));
  const tab = pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!tab) return false;
  tab.focus();
  return document.activeElement === tab;
}
