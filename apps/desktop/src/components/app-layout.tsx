import type { CSSProperties } from "react";
import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DockPanel } from "./dock-panel";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { NotificationPopup } from "./notification-popup";
import { Sidebar } from "./sidebar";
import { ShortcutTooltip } from "./shortcut-tooltip";
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
  onRightDockResizeStart,
  onBottomDockResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
}: {
  state: ShellViewState;
  actions: ShellActions;
  onDismissStatus: () => void;
  onToggleSidebar: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onRightDockResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBottomDockResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
}) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  const settingsMode = state.page === "settings";
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const sidebarLayoutWidth = state.sidebarOpen ? sidebarWidth : 0;
  const layoutState = sidebarWidth === state.sidebarWidth ? state : { ...state, sidebarWidth };
  const tabChromeLeft = state.sidebarOpen ? sidebarLayoutWidth + 12 : 132;
  const dockDragging = state.sidebarDragging || state.rightDockDragging || state.bottomDockDragging;
  const chromeTransition = dockDragging ? "none" : undefined;
  const systemThemeMode = useSystemThemeMode();
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--right-dock-width": `${state.rightDockOpen ? state.rightDockWidth : 0}px`,
    "--bottom-dock-height": `${state.bottomDockOpen ? state.bottomDockHeight : 0}px`,
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
      data-settings-mode={settingsMode ? "true" : undefined}
      data-drop-active={state.dropActive || undefined}
      data-structure-drag-active={state.structureDragActive ? "true" : undefined}
      data-sidebar-open={state.sidebarOpen ? "true" : "false"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
      style={shellStyle}
    >
      <div className="drag-region" data-tauri-drag-region />
      {!settingsMode && (
        <>
          <div className="chrome-leading-controls" data-tauri-drag-region>
            <button
              type="button"
              className="chrome-button sidebar-toggle-root"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onToggleSidebar}
              aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
              <ShortcutTooltip label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut={"⌘\\"} />
            </button>
          </div>
          <div className="chrome-trailing-controls" data-tauri-drag-region>
            <button
              type="button"
              className="chrome-button dock-toggle-button"
              data-active={state.bottomDockOpen || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => actions.toggleDock("bottom")}
              aria-label={state.bottomDockOpen ? "Hide bottom dock" : "Show bottom dock"}
            >
              <HugeiconsIcon className="dock-toggle-icon-bottom" icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
              <ShortcutTooltip label={state.bottomDockOpen ? "Hide bottom dock" : "Show bottom dock"} shortcut="⌘J" />
            </button>
            <button
              type="button"
              className="chrome-button dock-toggle-button"
              data-active={state.rightDockOpen || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => actions.toggleDock("right")}
              aria-label={state.rightDockOpen ? "Hide right dock" : "Show right dock"}
            >
              <HugeiconsIcon className="dock-toggle-icon-right" icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
              <ShortcutTooltip label={state.rightDockOpen ? "Hide right dock" : "Show right dock"} shortcut="⌥⌘B" />
            </button>
          </div>
          <header
            className="topbar"
            style={{ left: tabChromeLeft, transition: chromeTransition }}
          >
            <EditorTabs state={layoutState} actions={actions} />
          </header>
        </>
      )}
      <section className="workspace">
        <div className="sidebar-shell" style={{ transition: chromeTransition }}>
          <div className="sidebar-shell-inner" style={{ width: sidebarWidth }}>
            <Sidebar state={layoutState} actions={actions} open={state.sidebarOpen} />
          </div>
        </div>
        {state.sidebarOpen && !settingsMode && (
          <div
            className="splitter"
            onPointerDown={onResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={220}
            aria-valuemax={maxSidebarWidth}
            aria-valuenow={sidebarWidth}
            aria-label="Resize sidebar"
            data-dragging={state.sidebarDragging || undefined}
          />
        )}
        <section className="workbench">
          <section className="workbench-main">
            <section className="main-stage">
              <ViewerArea state={layoutState} actions={actions} />
            </section>
            <DockPanel
              area="bottom"
              state={layoutState}
              actions={actions}
              onResizeStart={onBottomDockResizeStart}
            />
          </section>
          <DockPanel
            area="right"
            state={layoutState}
            actions={actions}
            onResizeStart={onRightDockResizeStart}
          />
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
