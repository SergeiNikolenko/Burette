import type { MoleculeTab } from "../stores/molecule-store";
import type { WorkspaceGroup } from "../stores/workspace-panes-store";

export function selectedGroupTab(tabs: readonly MoleculeTab[], activeTabId: string | null | undefined, selected: Partial<Record<WorkspaceGroup, string>>, group: WorkspaceGroup) {
  const candidates = tabs.filter(tab => (tab.pane ?? "main") === group && tab.location.kind !== "settings");
  return candidates.find(tab => tab.id === activeTabId) ?? candidates.find(tab => tab.id === selected[group]) ?? candidates[0] ?? null;
}

export function reconcileGroupSelections(
  previousTabs: readonly MoleculeTab[],
  tabs: readonly MoleculeTab[],
  selected: Partial<Record<WorkspaceGroup, string>>,
): Partial<Record<WorkspaceGroup, string>> {
  let result = selected;
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  for (const group of ["main", "right", "bottom", "floating"] as const) {
    const id = selected[group];
    if (!id) continue;
    const existing = byId.get(id);
    if (existing && existing.location.kind !== "settings" && (existing.pane ?? "main") === group) continue;
    const current = tabs.filter(tab => tab.location.kind !== "settings" && (tab.pane ?? "main") === group);
    const survivors = new Set(current.map(tab => tab.id));
    const previous = previousTabs.filter(tab => tab.location.kind !== "settings" && (tab.pane ?? "main") === group);
    const index = previous.findIndex(tab => tab.id === id);
    const next = index < 0 ? current[0]
      : previous.slice(index + 1).find(tab => survivors.has(tab.id))
        ?? previous.slice(0, index).reverse().find(tab => survivors.has(tab.id))
        ?? current[0];
    if (result === selected) result = { ...selected };
    if (next) result[group] = next.id;
    else delete result[group];
  }
  return result;
}
