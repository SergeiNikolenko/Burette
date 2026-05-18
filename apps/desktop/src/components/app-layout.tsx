import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { Sidebar } from "./sidebar";
import type { ShellActions, ShellViewState } from "./types";
import { isTauriRuntime } from "../lib/tauri";

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

const collapsedChromeLeft = 132;

export function AppLayout({
  state,
  actions,
  searchRef,
  onToggleSidebar,
  onResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  state: ShellViewState;
  actions: ShellActions;
  searchRef: React.Ref<HTMLButtonElement>;
  onToggleSidebar: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const layoutState = sidebarWidth === state.sidebarWidth ? state : { ...state, sidebarWidth };
  const tabChromeLeft = state.sidebarOpen ? Math.max(sidebarWidth + 12, collapsedChromeLeft) : collapsedChromeLeft;
  return (
    <main
      className="app-shell"
      data-theme={state.preferences.theme}
      data-runtime={isTauriRuntime() ? "tauri" : "browser"}
      data-drop-active={state.dropActive || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="drag-region" data-tauri-drag-region />
      <button className="chrome-button sidebar-toggle-root" onClick={onToggleSidebar} title={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
      </button>
      <header
        className="topbar"
        style={{ left: tabChromeLeft, transition: state.sidebarDragging ? "none" : undefined }}
      >
        <EditorTabs state={layoutState} actions={actions} />
      </header>
      <section className="workspace">
        {state.sidebarOpen && <Sidebar ref={searchRef} state={layoutState} actions={actions} />}
        {state.sidebarOpen && <div className="splitter" onPointerDown={onResizeStart} data-dragging={state.sidebarDragging || undefined} />}
        <section className="main-stage">
          <ViewerArea state={layoutState} actions={actions} />
        </section>
      </section>
      {state.dropActive && (
        <div className="drop-overlay">
          <div>Drop structures to open</div>
        </div>
      )}
    </main>
  );
}
