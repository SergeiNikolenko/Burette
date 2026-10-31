import { focusToolDock } from "./focus-tool-dock";
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

export function focusVibrationsDock(documentId: string, workspaceId: string) {
  return focusToolDock("vibrations", documentId, workspaceId);
}
