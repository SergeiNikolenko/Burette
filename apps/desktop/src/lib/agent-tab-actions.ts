import type { MoleculeTab } from "../stores/molecule-store";

export type AgentTabActions = {
  openNewTab: () => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
};

export type AgentTabAction = {
  type: "manage_tabs";
  operation?: unknown;
  tabId?: unknown;
  index?: unknown;
  path?: unknown;
  toIndex?: unknown;
};

export async function executeAgentTabAction(
  action: AgentTabAction,
  tabs: MoleculeTab[],
  activeTabId: string | null | undefined,
  actions: AgentTabActions,
  openPaths: (paths: string[]) => void | Promise<void>,
) {
  const operation = String(action.operation || "");
  if (operation === "open_file") {
    const path = typeof action.path === "string" ? action.path.trim() : "";
    if (!path) return failure("INVALID_ARGS", "manage_tabs open_file requires path.");
    await openPaths([path]);
    return success(operation, { path });
  }
  if (operation === "new") {
    actions.openNewTab();
    return success(operation);
  }
  if (tabs.length === 0) return failure("TAB_NOT_FOUND", "The workspace has no tabs.");
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
  const explicitIndex = Number.isInteger(action.index) ? Number(action.index) : null;
  const explicitId = typeof action.tabId === "string" ? action.tabId.trim() : "";
  const target = explicitId
    ? tabs.find(tab => tab.id === explicitId) ?? null
    : explicitIndex !== null
      ? tabs[explicitIndex] ?? null
      : tabs[activeIndex] ?? null;
  if (operation === "next" || operation === "previous") {
    const offset = operation === "next" ? 1 : -1;
    const index = (activeIndex + offset + tabs.length) % tabs.length;
    actions.setActiveTab(tabs[index].id);
    return success(operation, { tabId: tabs[index].id, index });
  }
  if (!target) return failure("TAB_NOT_FOUND", "The requested Burette tab does not exist.");
  if (operation === "focus") {
    actions.setActiveTab(target.id);
    return success(operation, { tabId: target.id, index: tabs.indexOf(target) });
  }
  if (operation === "close") {
    actions.closeTab(target.id);
    return success(operation, { tabId: target.id });
  }
  if (operation === "move") {
    const toIndex = Number(action.toIndex);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= tabs.length) return failure("INVALID_ARGS", "manage_tabs move requires a valid toIndex.");
    actions.moveTab(target.id, toIndex);
    return success(operation, { tabId: target.id, toIndex });
  }
  return failure("INVALID_ARGS", "manage_tabs operation must be focus, next, previous, open_file, new, close, or move.");
}

function success(operation: string, result: Record<string, unknown> = {}) {
  return { ok: true, command: "manage_tabs", result: { operation, ...result } };
}

function failure(code: string, message: string) {
  return { ok: false, command: "manage_tabs", error: { code, message } };
}
