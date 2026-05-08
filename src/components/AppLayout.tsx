import { Sidebar } from "./Sidebar";
import { EditorTabs } from "./EditorTabs";
import { ViewerArea } from "./ViewerArea";
import type { ShellActions, ShellViewState } from "./types";

export function AppLayout({
  state,
  actions,
  searchRef,
  onQueryChange,
  onToggleSidebar,
  onResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  state: ShellViewState;
  actions: ShellActions;
  searchRef: React.Ref<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onToggleSidebar: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const tabChromeLeft = state.sidebarOpen ? state.sidebarWidth + 12 : 132;
  return (
    <main
      className="app-shell"
      data-theme={state.preferences.theme}
      data-drop-active={state.dropActive || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="drag-region" data-tauri-drag-region />
      <button className="chrome-button sidebar-toggle-root" onClick={onToggleSidebar} title={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        {state.sidebarOpen ? "◧" : "◨"}
      </button>
      <header className="topbar" data-tauri-drag-region style={{ left: tabChromeLeft }}>
        <EditorTabs state={state} actions={actions} />
        <button className="chrome-text-button" onClick={actions.chooseFiles}>Open</button>
      </header>
      <section className="workspace">
        {state.sidebarOpen && <Sidebar ref={searchRef} state={state} actions={actions} onQueryChange={onQueryChange} />}
        {state.sidebarOpen && <div className="splitter" onPointerDown={onResizeStart} data-dragging={state.sidebarDragging || undefined} />}
        <section className="main-stage">
          <ViewerArea state={state} actions={actions} />
        </section>
      </section>
      {state.dropActive && (
        <div className="drop-overlay">
          <div>Drop structures to open</div>
        </div>
      )}
      <footer className="statusbar"><span>{state.status}</span><span>{state.documents.length} open</span></footer>
    </main>
  );
}
