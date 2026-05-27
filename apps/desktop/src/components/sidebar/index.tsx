import type { ShellActions, ShellViewState } from "../types";
import { FileBrowser } from "./file-browser";
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
  return (
    <aside
      className="sidebar"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      inert={!open}
      style={{ width: state.sidebarWidth }}
    >
      <div className="sidebar-spacer" data-tauri-drag-region />
      <FileBrowser state={state} actions={actions} />
      <WorkspaceSwitcher actions={actions} />
    </aside>
  );
}
