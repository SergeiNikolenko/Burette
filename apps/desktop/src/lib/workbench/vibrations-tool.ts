import { useScientificDocument } from "./source";
import { vibrationalModes } from "./vibrational-modes";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const VIBRATIONS_COMMAND = { label: "Show vibrations", description: "Normal modes, IR spectrum and mode animation from this file" };

/** Capability follows this surface's document and the current scientific revision. */
export function useVibrationsAvailable(document: ViewerDocument | null) {
  const { document: science } = useScientificDocument(document);
  return Boolean(science && (vibrationalModes(science.modes).length || science.frames.some(frame => vibrationalModes(frame.modes).length)));
}

export function openVibrations(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "vibrations");
}

/** Return focus after the command dialog closes, only if its requested workspace and document still own the pane. */
export function focusVibrationsDock(documentId: string, workspaceId: string) {
  const pane = [...document.querySelectorAll<HTMLElement>('aside[data-area="right"][data-open="true"][data-active-tab="vibrations"]')]
    .find(element => element.dataset.documentId === documentId && element.dataset.workspaceId === workspaceId && !element.closest('[inert]'));
  const tab = pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!tab) return false;
  tab.focus();
  return document.activeElement === tab;
}
