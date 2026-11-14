import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";
import { openWorkbenchDialog } from "./dialog-store";

export type SelectCommand = "all" | "none" | "invert" | "residues" | "enlarge";

/** Avogadro's Select menu in the command palette; the 3D context menu has the same commands. */
export const SELECT_COMMANDS: readonly { command: SelectCommand; label: string }[] = [
  { command: "all", label: "Select all atoms" },
  { command: "none", label: "Select none" },
  { command: "invert", label: "Invert selection" },
  { command: "residues", label: "Select whole residues" },
  { command: "enlarge", label: "Enlarge selection" },
];

export function runSelectCommand(actions: ShellActions, document: ViewerDocument, command: SelectCommand) {
  return actions.runStructureViewerAction(document, { type: "select_command", command, label: "Select", notify: false });
}

/** Selects source atoms by index, as the document's graph numbers them. */
export function selectSourceAtoms(actions: ShellActions, document: ViewerDocument, atoms: number[]) {
  return actions.runStructureViewerAction(document, { type: "select_command", command: "atoms", atoms, label: "Select", notify: false });
}

export function openSmartsSelect(document: ViewerDocument) {
  openWorkbenchDialog({ kind: "smarts", document });
}
