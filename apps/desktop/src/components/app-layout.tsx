import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { NotificationPopup } from "./notification-popup";
import { Sidebar } from "./sidebar";
import type { ShellActions, ShellViewState } from "./types";
import { isTauriRuntime } from "../lib/tauri";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

export function AppLayout({
  state,
  actions,
  onDismissStatus,
  onToggleSidebar,
  onResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  state: ShellViewState;
  actions: ShellActions;
  onDismissStatus: () => void;
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
  const sidebarLayoutWidth = state.sidebarOpen ? sidebarWidth : 0;
  const layoutState = sidebarWidth === state.sidebarWidth ? state : { ...state, sidebarWidth };
  const tabChromeLeft = state.sidebarOpen ? sidebarLayoutWidth + 12 : 132;
  const chromeTransition = state.sidebarDragging ? "none" : undefined;
  const systemThemeMode = useSystemThemeMode();
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
  } as CSSProperties;
  const effectiveTheme = resolveThemeMode(state.preferences.theme, systemThemeMode);
  const activePageKind = state.activeTab?.location.kind ?? null;
  return (
    <main
      className="app-shell"
      data-theme={state.preferences.theme}
      data-effective-theme={effectiveTheme}
      data-active-page-kind={activePageKind ?? undefined}
      data-runtime={isTauriRuntime() ? "tauri" : "browser"}
      data-drop-active={state.dropActive || undefined}
      data-structure-drag-active={state.structureDragActive ? "true" : undefined}
      data-sidebar-open={state.sidebarOpen ? "true" : "false"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={shellStyle}
    >
      <div className="drag-region" data-tauri-drag-region />
      <div className="chrome-leading-controls">
        <button
          type="button"
          className="chrome-button sidebar-toggle-root"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleSidebar}
          title={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
        </button>
      </div>
      <header
        className="topbar"
        style={{ left: tabChromeLeft, transition: chromeTransition }}
      >
        <EditorTabs state={layoutState} actions={actions} />
      </header>
      <section className="workspace">
        <div className="sidebar-shell" data-open={state.sidebarOpen ? "true" : "false"} style={{ transition: chromeTransition }}>
          <Sidebar state={layoutState} actions={actions} open={state.sidebarOpen} />
        </div>
        <div
          className="splitter"
          onPointerDown={state.sidebarOpen ? onResizeStart : undefined}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={maxSidebarWidth}
          aria-valuenow={sidebarWidth}
          aria-label="Resize sidebar"
          data-open={state.sidebarOpen ? "true" : "false"}
          data-dragging={state.sidebarDragging || undefined}
        />
        <section className="main-stage">
          <ViewerArea state={layoutState} actions={actions} />
        </section>
      </section>
      {state.dropActive && (
        <div className="drop-overlay">
          <div>Drop structures to open</div>
        </div>
      )}
      {state.status && (
        <NotificationPopup notice={state.status} onDismiss={onDismissStatus} />
      )}
    </main>
  );
}
