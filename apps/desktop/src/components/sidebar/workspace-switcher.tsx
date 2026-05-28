import { useRef } from "react";
import { appInstanceLabel } from "../../lib/instance";
import { showNativeContextMenu } from "../native-context-menu";
import type { ShellActions } from "../types";

export function WorkspaceSwitcher({ actions }: { actions: ShellActions }) {
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);

  async function showWorkspaceMenu() {
    const rect = workspaceButtonRef.current?.getBoundingClientRect();
    const estimatedMenuHeight = 52;
    const position = rect
      ? { x: Math.round(rect.left), y: Math.round(rect.top - estimatedMenuHeight) }
      : undefined;

    await showNativeContextMenu(
      [
        {
          kind: "item",
          id: "add-project-folder",
          text: "Add Project Folder...",
          action: () => {
            void actions.chooseWorkspace();
          },
        },
        {
          kind: "item",
          id: "open-active-project-folder",
          text: "Open Active Project Folder",
          action: () => {
            void actions.openWorkspaceFolder();
          },
        },
      ],
      position,
    );
  }

  return (
    <div className="sidebar-footer">
      <button
        ref={workspaceButtonRef}
        type="button"
        className="sidebar-product"
        onClick={() => void showWorkspaceMenu()}
        aria-label={"Open workspace menu for " + appInstanceLabel}
        title={appInstanceLabel}
      >
        <span className="sidebar-product-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="sidebar-product-label">{appInstanceLabel}</span>
      </button>
    </div>
  );
}
