import type { ShellActions, ShellViewState } from "../types";
import { FileBrowser } from "./file-browser";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function Sidebar({ state, actions }: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  return (
    <aside className="sidebar" style={{ width: state.sidebarWidth }}>
      <div
        className="sidebar-spacer"
        data-tauri-drag-region
      />
      <FileBrowser state={state} actions={actions} />
      <div className="sidebar-footer">
        <WorkspaceSwitcher state={state} actions={actions} />
      </div>
    </aside>
  );
}
