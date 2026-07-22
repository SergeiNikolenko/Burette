import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DockPanel } from "./dock-panel";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { NotificationPopup } from "./notification-popup";
import { OpenInEditorMenu } from "./open-in-editor-menu";
import { QuickLookPreview } from "./quick-look-preview";
import { Sidebar } from "./sidebar";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { FileDropFeedback } from "./file-drop-feedback";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./ui/resizable";
import type { ShellActions, ShellViewState } from "./types";
import type { FileDropPreview } from "../lib/drop-preview";
import { isTauriRuntime } from "../lib/tauri";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed } from "../lib/web-demo-workspace";

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
  onSidebarWidthChange,
  onRightDockResizeStart,
  onBottomDockResizeStart,
  dropPreview,
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
  onSidebarWidthChange: (width: number) => void;
  onRightDockResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBottomDockResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  dropPreview: FileDropPreview | null;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
}) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const tauriRuntime = isTauriRuntime();
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  useEffect(() => {
    if (!tauriRuntime) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let stopResizeListener: (() => void) | null = null;
    const syncFullscreen = async () => {
      const fullscreen = await appWindow.isFullscreen();
      if (!disposed) setWindowFullscreen(fullscreen);
    };
    void syncFullscreen();
    void appWindow.onResized(() => void syncFullscreen()).then((stop) => {
      if (disposed) stop();
      else stopResizeListener = stop;
    });
    return () => {
      disposed = true;
      stopResizeListener?.();
    };
  }, [tauriRuntime]);
  const hostedMcpWidget = isHostedMcpWidget();
  const heroEmbed = isWebDemoHeroEmbed();
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  const settingsMode = state.page === "settings";
  const chromeVisible = !settingsMode && !hostedMcpWidget;
  const sidebarVisible = settingsMode || (!hostedMcpWidget && state.sidebarOpen);
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const sidebarLayoutWidth = sidebarVisible ? sidebarWidth : 0;
  const rightDockWidth = clampRightDockWidth(state.rightDockWidth, viewportWidth, sidebarLayoutWidth);
  const layoutState = sidebarWidth === state.sidebarWidth && rightDockWidth === state.rightDockWidth ? state : { ...state, sidebarWidth, rightDockWidth };
  const compactLeadingChrome = !tauriRuntime || windowFullscreen;
  const tabChromeLeft = hostedMcpWidget
    ? 12
    : state.sidebarOpen
      ? sidebarLayoutWidth + 12
      : compactLeadingChrome ? 112 : 192;
  const rightDockOpen = !settingsMode && !hostedMcpWidget && state.rightDockOpen;
  const bottomDockOpen = !settingsMode && !hostedMcpWidget && state.bottomDockOpen;
  const dockDragging = state.sidebarDragging || state.rightDockDragging || state.bottomDockDragging;
  const chromeTransition = dockDragging ? "none" : undefined;
  const systemThemeMode = useSystemThemeMode();
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--right-dock-width": `${rightDockOpen ? rightDockWidth : 0}px`,
    "--bottom-dock-height": `${bottomDockOpen ? state.bottomDockHeight : 0}px`,
    "--chrome-height": hostedMcpWidget ? "0px" : undefined,
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
      data-runtime={tauriRuntime ? "tauri" : "browser"}
      data-window-fullscreen={windowFullscreen ? "true" : undefined}
      data-hosted-mcp-widget={hostedMcpWidget ? "true" : undefined}
      data-hero-embed={heroEmbed ? "true" : undefined}
      data-settings-mode={settingsMode ? "true" : undefined}
      data-drop-active={state.dropActive || undefined}
      data-structure-drag-active={state.structureDragActive ? "true" : undefined}
      data-sidebar-open={sidebarVisible ? "true" : "false"}
      onDragEnterCapture={hostedMcpWidget || heroEmbed ? undefined : onDragEnter}
      onDragOverCapture={hostedMcpWidget || heroEmbed ? undefined : onDragOver}
      onDragLeave={hostedMcpWidget || heroEmbed ? undefined : onDragLeave}
      onDrop={hostedMcpWidget || heroEmbed ? undefined : onDrop}
      onPaste={hostedMcpWidget || heroEmbed ? undefined : onPaste}
      onClickCapture={heroEmbed ? (event) => {
        event.preventDefault();
        event.stopPropagation();
      } : undefined}
      onContextMenu={heroEmbed ? (event) => event.preventDefault() : undefined}
      style={shellStyle}
    >
      {!hostedMcpWidget && <div className="drag-region" data-tauri-drag-region />}
      {chromeVisible && (
        <>
          {!hostedMcpWidget ? (
            <div className="chrome-leading-controls" data-tauri-drag-region>
              <button
                type="button"
                className="chrome-button sidebar-toggle-root"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onToggleSidebar}
                aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              >
                <DockToggleIcon />
              </button>
              <div className="tab-history-controls" aria-label="Navigation history">
                <button
                  type="button"
                  className="tab-history-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={actions.navigateBack}
                  disabled={!actions.canNavigateBack}
                  title="Back"
                  aria-label="Back"
                >
                  <ArrowLeft size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="tab-history-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={actions.navigateForward}
                  disabled={!actions.canNavigateForward}
                  title="Forward"
                  aria-label="Forward"
                >
                  <ArrowRight size={16} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}
          <div className="chrome-trailing-controls" data-tauri-drag-region>
            {!hostedMcpWidget ? <OpenInEditorMenu state={layoutState} actions={actions} /> : null}
            {!hostedMcpWidget ? (
              <button
                type="button"
                className="chrome-button dock-toggle-button"
                data-active={state.bottomDockOpen || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => actions.toggleDock("bottom")}
                aria-label={state.bottomDockOpen ? "Hide bottom dock" : "Show bottom dock"}
              >
                <DockToggleIcon className="dock-toggle-icon-bottom" />
                <ShortcutTooltip label={state.bottomDockOpen ? "Hide bottom dock" : "Show bottom dock"} shortcut="⌘J" />
              </button>
            ) : null}
            <button
              type="button"
              className="chrome-button dock-toggle-button"
              data-active={state.rightDockOpen || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => actions.toggleDock("right")}
              aria-label={state.rightDockOpen ? "Hide right dock" : "Show right dock"}
            >
              <DockToggleIcon className="dock-toggle-icon-right" />
              <ShortcutTooltip label={state.rightDockOpen ? "Hide right dock" : "Show right dock"} shortcut="⌥⌘B" />
            </button>
          </div>
          <header
            className="topbar"
            style={{ left: tabChromeLeft, transition: chromeTransition }}
          >
            <EditorTabs state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
          </header>
        </>
      )}
      <section className="workspace">
        <ResizablePanelGroup orientation="horizontal" className="workspace-panels">
          {(settingsMode || (!hostedMcpWidget && state.sidebarOpen)) ? (
            <ResizablePanel
              id="sidebar"
              className="workspace-sidebar-panel"
              defaultSize={`${sidebarWidth}px`}
              minSize="220px"
              maxSize={`${maxSidebarWidth}px`}
              onResize={(size) => {
                const px = Math.round(size.inPixels);
                if (px > 1) onSidebarWidthChange(px);
              }}
            >
              <div className="sidebar-shell-inner">
                <Sidebar state={layoutState} actions={actions} open={sidebarVisible} />
              </div>
            </ResizablePanel>
          ) : null}
          {(!settingsMode && !hostedMcpWidget && state.sidebarOpen) ? (
            <ResizableHandle withHandle aria-label="Resize sidebar" />
          ) : null}
          <ResizablePanel id="center" className="workspace-center-panel">
            <section className="workbench">
              <ResizablePanelGroup orientation="horizontal" className="workbench-panels">
                <ResizablePanel id="workbench-main" className="workbench-main-panel">
                  <ResizablePanelGroup orientation="vertical" className="workbench-main-panels">
                    <ResizablePanel id="main" className="main-panel">
                      <section className="main-stage">
                        <ViewerArea state={layoutState} actions={actions} />
                      </section>
                    </ResizablePanel>
                    {(!settingsMode && !hostedMcpWidget && state.bottomDockOpen) ? (
                      <ResizableHandle withHandle className="resizable-handle-horizontal" aria-label="Resize bottom dock" />
                    ) : null}
                    {(!settingsMode && !hostedMcpWidget && state.bottomDockOpen) ? (
                      <ResizablePanel
                        id="bottom-dock"
                        className="dock-panel-shell"
                        defaultSize={`${state.bottomDockHeight}px`}
                        minSize="120px"
                        maxSize="70%"
                        onResize={(size) => {
                          const px = Math.round(size.inPixels);
                          if (px > 1) actions.setDockSize("bottom", px);
                        }}
                      >
                        <DockPanel area="bottom" state={layoutState} actions={actions} />
                      </ResizablePanel>
                    ) : null}
                  </ResizablePanelGroup>
                </ResizablePanel>
                {(!settingsMode && !hostedMcpWidget && state.rightDockOpen) ? (
                  <ResizableHandle withHandle aria-label="Resize right dock" />
                ) : null}
                {(!settingsMode && !hostedMcpWidget && state.rightDockOpen) ? (
                  <ResizablePanel
                    id="right-dock"
                    className="dock-panel-shell"
                    defaultSize={`${state.rightDockWidth}px`}
                    minSize="180px"
                    maxSize="70%"
                    onResize={(size) => {
                      const px = Math.round(size.inPixels);
                      if (px > 1) actions.setDockSize("right", px);
                    }}
                  >
                    <DockPanel area="right" state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
                  </ResizablePanel>
                ) : null}
              </ResizablePanelGroup>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </section>
      <FileDropFeedback preview={dropPreview} />
      {state.status && (
        <NotificationPopup notice={state.status} onDismiss={onDismissStatus} />
      )}
    </main>
  );
}

function DockToggleIcon({ className }: { className?: string }) {
  return <PanelLeft className={className} size={18} strokeWidth={1.8} aria-hidden />;
}
