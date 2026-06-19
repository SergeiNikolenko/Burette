import type { CSSProperties } from "react";
import { DockPanel } from "./dock-panel";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { NotificationPopup } from "./notification-popup";
import { OpenInEditorMenu } from "./open-in-editor-menu";
import { QuickLookPreview } from "./quick-look-preview";
import { Sidebar } from "./sidebar";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { SystemIcon } from "./system-icon";
import type { ShellActions, ShellViewState } from "./types";
import { isTauriRuntime } from "../lib/tauri";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

function clampRightDockWidth(width: number, viewportWidth: number, sidebarLayoutWidth: number) {
  const maxWidth = Math.max(0, Math.min(960, viewportWidth - sidebarLayoutWidth - 280));
  const minWidth = Math.min(180, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
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
  const sidebarVisible = settingsMode || state.sidebarOpen;
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const sidebarLayoutWidth = sidebarVisible ? sidebarWidth : 0;
  const rightDockWidth = clampRightDockWidth(state.rightDockWidth, viewportWidth, sidebarLayoutWidth);
  const layoutState = sidebarWidth === state.sidebarWidth && rightDockWidth === state.rightDockWidth ? state : { ...state, sidebarWidth, rightDockWidth };
  const tabChromeLeft = state.sidebarOpen ? sidebarLayoutWidth + 12 : 132;
  const rightDockOpen = !settingsMode && state.rightDockOpen;
  const bottomDockOpen = !settingsMode && state.bottomDockOpen;
  const dockDragging = state.sidebarDragging || state.rightDockDragging || state.bottomDockDragging;
  const chromeTransition = dockDragging ? "none" : undefined;
  const systemThemeMode = useSystemThemeMode();
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--right-dock-width": `${rightDockOpen ? rightDockWidth : 0}px`,
    "--bottom-dock-height": `${bottomDockOpen ? state.bottomDockHeight : 0}px`,
  } as CSSProperties;
  const effectiveTheme = resolveThemeMode(state.preferences.theme, systemThemeMode);
  const activePageKind = state.activeTab?.location.kind ?? null;
  if (state.quickLookStandalone) {
    return (
      <main
        className="app-shell"
        data-theme={state.preferences.theme}
        data-effective-theme={effectiveTheme}
        data-runtime={isTauriRuntime() ? "tauri" : "browser"}
        data-quicklook-debug="true"
        style={shellStyle}
      >
        {state.quickLookDocument ? (
          <QuickLookPreview document={state.quickLookDocument} onClose={actions.closeQuickLookPreview} standalone />
        ) : state.quickLookError ? (
          <div className="web-quicklook-debug-loading" role="alert">{state.quickLookError}</div>
        ) : (
          <div className="web-quicklook-debug-loading" role="status">Loading Quick Look preview...</div>
        )}
      </main>
    );
  }

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
      data-sidebar-open={sidebarVisible ? "true" : "false"}
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
              <SystemIcon name="sidebar.left" size={18} />
            </button>
          </div>
          <div className="chrome-trailing-controls" data-tauri-drag-region>
            <OpenInEditorMenu state={layoutState} actions={actions} />
            <button
              type="button"
              className="chrome-button dock-toggle-button"
              data-active={state.bottomDockOpen || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => actions.toggleDock("bottom")}
              aria-label={state.bottomDockOpen ? "Hide bottom dock" : "Show bottom dock"}
            >
              <SystemIcon name="rectangle.bottomthird.inset.filled" size={18} />
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
              <SystemIcon name="sidebar.right" size={18} />
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
            <Sidebar state={layoutState} actions={actions} open={sidebarVisible} />
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
            {!settingsMode && (
              <DockPanel
                area="bottom"
                state={layoutState}
                actions={actions}
                onResizeStart={onBottomDockResizeStart}
              />
            )}
          </section>
          {!settingsMode && (
            <DockPanel
              area="right"
              state={layoutState}
              actions={actions}
              onResizeStart={onRightDockResizeStart}
            />
          )}
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
      {state.quickLookDocument ? (
        <QuickLookPreview document={state.quickLookDocument} onClose={actions.closeQuickLookPreview} />
      ) : null}
    </main>
  );
}
