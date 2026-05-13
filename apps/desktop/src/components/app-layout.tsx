import { CommandPalette } from "./command-palette";
import { EditorArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar/sidebar-toggle-button";
import { WelcomeScreen } from "./welcome";
import type { ShellActions, ShellViewState } from "./types";
import { themeStyle } from "../lib/theme";

export function AppLayout({
  state,
  actions,
  onToggleSidebar,
  onResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  state: ShellViewState;
  actions: ShellActions;
  onToggleSidebar: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const isWelcome =
    !state.workspaceRoot && state.page === "viewer" && state.documents.length === 0;
  const sidebarVisible = state.sidebarOpen || isWelcome;
  const tabChromeLeft = sidebarVisible ? state.sidebarWidth + 12 : 132;
  const shellStyle = themeStyle(state.preferences);

  return (
    <main
      className="app-shell"
      data-theme={state.preferences.theme}
      data-drop-active={state.dropActive || undefined}
      style={shellStyle}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="drag-region"
        data-tauri-drag-region
      />
      {state.instanceLabel && <div className="dev-instance-badge">{state.instanceLabel}</div>}
      <div
        className="sidebar-toggle-rail"
        data-tauri-drag-region
      >
        <SidebarToggleButton
          isSidebarOpen={state.sidebarOpen}
          onToggleSidebar={onToggleSidebar}
        />
      </div>
      <header
        className="topbar"
        data-tauri-drag-region
        style={{
          left: tabChromeLeft,
          transition: state.sidebarDragging ? "none" : "left 140ms ease-out",
        }}
      >
        <EditorTabs state={state} actions={actions} />
      </header>
      <section className="workspace">
        <div
          className="sidebar-shell"
          aria-hidden={!sidebarVisible}
          style={{
            width: sidebarVisible ? state.sidebarWidth : 0,
            transition: state.sidebarDragging ? "none" : "width 140ms ease-out",
          }}
        >
          <Sidebar state={state} actions={actions} />
        </div>
        {sidebarVisible && !isWelcome && <div className="splitter" onPointerDown={onResizeStart} data-dragging={state.sidebarDragging || undefined} />}
        <section className="main-stage">
          {isWelcome ? <WelcomeScreen actions={actions} /> : <EditorArea state={state} actions={actions} />}
        </section>
      </section>
      <div className="status-announcer" aria-live="polite">
        {state.status}
      </div>
      {state.dropActive && (
        <div className="drop-overlay">
          <div>Drop structures to open</div>
        </div>
      )}
      <CommandPalette state={state} actions={actions} />
    </main>
  );
}
