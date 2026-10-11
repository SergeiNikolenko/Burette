import { useRef } from "react";
import { TooltipProvider } from "../ui/tooltip";
import type { ShellActions, ShellViewState } from "../types";
import { FileBrowser } from "./file-browser";
import { SettingsSidebar } from "./settings-sidebar";
import { SidebarHoverCard } from "./sidebar-hover-card";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function Sidebar({
  state,
  actions,
  open,
}: {
  state: ShellViewState;
  actions: ShellActions;
  open: boolean;
}) {
  const settingsMode = state.page === "settings";
  const sidebarRef = useRef<HTMLElement | null>(null);
  return (
    <TooltipProvider delayDuration={350}>
      <aside
        ref={sidebarRef}
        className="sidebar"
        data-file-drop-zone="sidebar"
        data-mode={settingsMode ? "settings" : "workspace"}
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
        inert={!open}
        style={{ width: state.sidebarWidth }}
      >
        {settingsMode ? (
          <SettingsSidebar state={state} actions={actions} />
        ) : (
          <>
            <div className="sidebar-spacer" data-tauri-drag-region />
            <FileBrowser state={state} actions={actions} />
            <WorkspaceSwitcher actions={actions} />
          </>
        )}
      </aside>
      <SidebarHoverCard rootRef={sidebarRef} />
    </TooltipProvider>
  );
}
