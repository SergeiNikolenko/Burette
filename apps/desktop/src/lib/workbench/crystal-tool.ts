import type { ShellActions } from "../../components/types";

export const CRYSTAL_COMMAND = { label: "Show crystal tools", description: "Unit cell, supercell, space group, powder pattern and g(r) of this crystal" };

export function openCrystal(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "crystal");
}
