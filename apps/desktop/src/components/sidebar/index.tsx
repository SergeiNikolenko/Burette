import type { ShellActions, ShellViewState } from "../types";
import { FileBrowser } from "./file-browser";
import { SettingsSidebar } from "./settings-sidebar";
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
  return (
    <aside
      className="sidebar"
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
          {!state.buildInfo.isAgentShell ? <WorkspaceSwitcher state={state} actions={actions} /> : null}
        </>
      )}
    </aside>
  );
}
