import type { MoleculeTab } from "../stores/molecule-store";

// Tabs retain their serializable memory history for native session restore and
// undo. React Router and the native Back/Forward commands use this same cursor.
export function moveTabHistory(tab: MoleculeTab, delta: number): MoleculeTab {
  if (!Number.isInteger(delta) || delta === 0) return tab;
  const entries = [...tab.back, tab.location, ...tab.forward];
  const index = Math.max(0, Math.min(entries.length - 1, tab.back.length + delta));
  if (index === tab.back.length) return tab;
  return { ...tab, location: entries[index]!, back: entries.slice(0, index), forward: entries.slice(index + 1) };
}
