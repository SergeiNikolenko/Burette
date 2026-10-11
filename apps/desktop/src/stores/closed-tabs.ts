import type { MoleculeTab } from "./molecule-store";

// Codex's "Reopen closed tab" (⇧⌘T): tabs closed in this window, newest last.
// Memory only, like Codex; a new launch starts with an empty history.
const closedTabs: MoleculeTab[] = [];
const LIMIT = 20;

export function rememberClosedTab(tab: MoleculeTab | undefined) {
  if (!tab || tab.location.kind === "launcher" || tab.location.kind === "settings") return;
  closedTabs.push(tab);
  if (closedTabs.length > LIMIT) closedTabs.shift();
}

export function takeClosedTab(): MoleculeTab | undefined {
  return closedTabs.pop();
}
