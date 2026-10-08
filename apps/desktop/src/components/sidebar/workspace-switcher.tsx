import { SidebarTooltip } from "./sidebar-tooltip";
import { appInstanceLabel } from "../../lib/instance";
import { NativeDropdownMenu } from "../native-dropdown-menu";
import { ChevronUpDown } from "../ui/app-icons";
import { AnimatedSettingsIcon } from "../ui/animated-icons";
import type { ShellActions } from "../types";
import { WhatsNew } from "./whats-new";

export function WorkspaceSwitcher({ actions }: { actions: ShellActions }) {
  return (
    <div className="sidebar-footer">
      <NativeDropdownMenu
        side="top"
        align="start"
        items={[
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
        ]}
        trigger={(
          <SidebarTooltip label="Workspace menu">
            <button
              type="button"
              className="sidebar-product"
              aria-label={"Open workspace menu for " + appInstanceLabel}
            >
              <span className="sidebar-product-icon" aria-hidden="true">
                <ChevronUpDown size={16} />
              </span>
              <span className="sidebar-product-label">{appInstanceLabel}</span>
            </button>
          </SidebarTooltip>
        )}
      />
      <WhatsNew />
      <SidebarTooltip label="Settings (⌘,)">
        <button
          type="button"
          className="sidebar-settings-button"
          onClick={actions.openSettings}
          aria-label="Open settings"
        >
          <span className="sidebar-settings-icon" aria-hidden="true">
            <AnimatedSettingsIcon size={18} />
          </span>
          <span className="sidebar-settings-label">Settings</span>
        </button>
      </SidebarTooltip>
    </div>
  );
}
