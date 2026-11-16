import type { DockTabKind } from "../../apps/desktop/src/lib/dock";

/**
 * Source editing reveals a tool as a right workspace tab; record each tool it brings forward.
 * The store loads lazily so a test's `mock.module` calls still apply to it.
 */
export async function recordRightToolReveals() {
  const { useMoleculeStore } = await import("../../apps/desktop/src/stores/molecule-store");
  const tools: DockTabKind[] = [];
  const stop = useMoleculeStore.subscribe((state, previous) => {
    const active = state.tabs.find(tab => tab.id === state.activeTabId);
    if (active?.pane === "right" && active.location.kind === "tool" && active.id !== previous.activeTabId) tools.push(active.location.tool);
  });
  return { tools, stop };
}
