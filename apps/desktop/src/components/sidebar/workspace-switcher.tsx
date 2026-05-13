import { useRef } from "react";
import { showNativeContextMenu, type MenuItemSpec } from "../context-menu";
import type { ShellActions, ShellViewState } from "../types";

function basename(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

function workspaceLabel(path: string | null) {
  return path ? basename(path) : "No Workspace";
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function WorkspaceSwitcher({
  state,
  actions,
}: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function showWorkspaceMenu() {
    if (!isTauriRuntime()) {
      actions.openCommandPalette();
      return;
    }

    const otherWorkspaces = state.recentWorkspaces.filter((path) => path !== state.workspaceRoot);
    const items: MenuItemSpec[] = otherWorkspaces.map((path) => ({
      kind: "item",
      id: "workspace.switch:" + path,
      text: basename(path),
      action: () => {
        void actions.openWorkspace(path);
      },
    }));

    if (items.length > 0) items.push({ kind: "separator" });
    items.push({
      kind: "item",
      id: "workspace.open",
      text: "Open Folder\u2026",
      action: () => {
        void actions.chooseFolder();
      },
    });
    if (state.workspaceRoot) {
      items.push({
        kind: "item",
        id: "workspace.close",
        text: "Close Workspace",
        action: actions.closeWorkspace,
      });
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const itemRowHeight = 22;
    const separatorHeight = 12;
    const verticalPadding = 8;
    const itemCount = items.filter((item) => item.kind !== "separator").length;
    const separatorCount = items.length - itemCount;
    const estimatedMenuHeight =
      itemCount * itemRowHeight + separatorCount * separatorHeight + verticalPadding;
    const position = rect
      ? { x: Math.round(rect.left), y: Math.round(rect.top - estimatedMenuHeight) }
      : undefined;

    await showNativeContextMenu(items, position);
  }

  return (
    <button
      ref={buttonRef}
      className="workspace-switcher"
      onClick={() => void showWorkspaceMenu()}
      aria-label="Switch workspace"
    >
      <span aria-hidden="true" className="workspace-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="workspace-name">{workspaceLabel(state.workspaceRoot)}</span>
    </button>
  );
}
