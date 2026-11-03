import type { MoleculeTab } from "./molecule-store";
import type { ViewerDocument } from "../types";

export type ClosedTab = {
  tab: MoleculeTab;
  index: number;
  rendererMode?: "molstar" | "grid2d" | "xyzrender-external";
};

// Codex's "Reopen closed tab" (⇧⌘T): tabs closed in this window, newest last.
// Memory only, like Codex; a new launch starts with an empty history.
const closedTabs: ClosedTab[] = [];
const LIMIT = 20;

export function rememberClosedTab(tab: MoleculeTab | undefined, tabs: MoleculeTab[], documents: ViewerDocument[]) {
  if (!tab || tab.preview || tab.location.kind === "launcher" || tab.location.kind === "settings") return;
  const location = tab.location;
  const renderer = location.kind === "file" ? documents.find(document => document.id === location.documentId || document.path === location.path)?.renderer : undefined;
  returnClosedTab({ tab, index: tabs.indexOf(tab), rendererMode: renderer === "molstar" || renderer === "grid2d" || renderer === "xyzrender-external" ? renderer : undefined });
}

export function returnClosedTab(entry: ClosedTab) {
  closedTabs.push(entry);
  if (closedTabs.length > LIMIT) closedTabs.shift();
}

export function takeClosedTab(): ClosedTab | undefined {
  return closedTabs.pop();
}
