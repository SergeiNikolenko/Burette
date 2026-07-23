import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, type PanelImperativeHandle } from "./ui/resizable";
import type { ShellActions, ShellViewState } from "./types";
import type { FileDropPreview } from "../lib/drop-preview";
import { isTauriRuntime } from "../lib/tauri";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed } from "../lib/web-demo-workspace";

// Smallest the viewer/content column may become before the right dock stops
// squeezing it (the point where an overlay dock would take over).
const MAIN_MIN_WIDTH = 420;

// react-resizable-panels writes `overflow: auto` inline on every panel, which
// beats the `overflow: hidden` in our panel classes — content with its own
// min-size would scroll inside the panel instead of being clipped by it. The
// caller's `style` is merged after the library's, so this restores clipping.
const CLIPPED_PANEL_STYLE: CSSProperties = { overflow: "hidden" };

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

function clampRightDockWidth(width: number, viewportWidth: number, sidebarLayoutWidth: number) {
  const maxWidth = Math.max(0, Math.min(960, viewportWidth - sidebarLayoutWidth - 280));
  const minWidth = Math.min(180, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

// Keeps an always-mounted collapsible Panel in sync with an external open/closed
// flag. Panels are never unmounted (changing a group's panel count throws
// "Invalid N panel layout" in react-resizable-panels); instead they are
// collapsed/expanded imperatively. useLayoutEffect applies the initial collapsed
// state before paint, so closed panels don't flash open on mount.
function useCollapsiblePanelSync(open: boolean, expandedSizePx: number) {
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  // The expanded size is read through a ref so that persisting a size while the
  // user drags (which updates it every frame) never re-runs this effect. Doing so
  // used to re-enter expand()/resize() mid-gesture, which reset the library's
  // drag origin and froze the divider until the pointer was released.
  const expandedSizeRef = useRef(expandedSizePx);
  expandedSizeRef.current = expandedSizePx;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) {
      if (panel.isCollapsed()) {
        panel.expand();
        const px = expandedSizeRef.current;
        if (px > 1) panel.resize(`${px}px`);
      }
    } else if (!panel.isCollapsed()) {
      panel.collapse();
    }
  }, [open]);
  return panelRef;
}

// `defaultSize` is only meant to seed a panel on mount. Feeding the live stored
// size back into it re-seeds the panel mid-drag, so capture it once.
function useInitialSize(sizePx: number) {
  return useRef(sizePx).current;
}

// Marks a group as animating for the duration of an open/close toggle. The CSS
// flex transition on `[data-panels-animating] > [data-panel]` must apply only
// then: react-resizable-panels rewrites flex-grow every frame during drags and
// window resizes, and a standing transition would rubber-band both.
function usePanelToggleAnimation(open: boolean) {
  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    animatingRef.current = true;
    setAnimating(true);
    const timer = window.setTimeout(() => {
      animatingRef.current = false;
      setAnimating(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { animating, animatingRef };
}

// True while one of the group's own separators is being dragged. Nested groups
// carry their own separators, so only direct children count.
function groupHasActiveSeparator(element: HTMLElement | null) {
  return Boolean(element?.querySelector(':scope > [data-separator="active"]'));
}

type PixelGuardEntry = {
  panelRef: React.RefObject<PanelImperativeHandle | null>;
  openRef: React.RefObject<boolean>;
  sizePxRef: React.RefObject<number>;
};

// groupResizeBehavior="preserve-pixel-size" is inert in react-resizable-panels
// 4.12.2: any container resize (window resize, or the sidebar moving the
// workbench) redistributes panel sizes proportionally, so the right dock used
// to drift through the 360px tab-label container-query threshold and flicker.
// Re-assert the stored pixel size of fixed panels whenever the group's element
// resizes. The observer fires between layout and paint, so the proportional
// intermediate state is corrected before it becomes visible, and correcting the
// group's inner layout does not resize the group element again (no loop).
function useGroupPixelGuard(entries: PixelGuardEntry[]) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let frame = 0;
    const correct = () => {
      frame = 0;
      for (const { panelRef, openRef, sizePxRef } of entriesRef.current) {
        const panel = panelRef.current;
        if (!panel || !openRef.current || panel.isCollapsed()) continue;
        const want = sizePxRef.current;
        if (want <= 1) continue;
        if (Math.abs(panel.getSize().inPixels - want) > 0.75) panel.resize(`${want}px`);
      }
    };
    // Correct on the next frame, not inside the observer callback: the library
    // processes the same container resize in its own observer and converts
    // px→% through a cached group size, so a same-frame resize() races it and
    // lands on a stale conversion. By the rAF the library has settled; if the
    // container moves again the observer refires and schedules another pass.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(correct);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return elementRef;
}

export function AppLayout({
  state,
  actions,
  onDismissStatus,
  onToggleSidebar,
  onSidebarWidthChange,
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
  onSidebarWidthChange: (width: number) => void;
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
  // Toggle-animation hooks must come before the collapse/expand sync hooks:
  // layout effects run in hook order, and collapse() reports a synchronous
  // onResize that the handlers below gate on animatingRef — registered after
  // the collapse, the flag would still be false and the closing panel would
  // immediately flip its open flag (and itself) back.
  const sidebarToggle = usePanelToggleAnimation(sidebarVisible);
  const rightDockToggle = usePanelToggleAnimation(rightDockOpen);
  const bottomDockToggle = usePanelToggleAnimation(bottomDockOpen);
  const sidebarPanelRef = useCollapsiblePanelSync(sidebarVisible, sidebarWidth);
  const rightDockPanelRef = useCollapsiblePanelSync(rightDockOpen, rightDockWidth);
  const bottomDockPanelRef = useCollapsiblePanelSync(bottomDockOpen, state.bottomDockHeight);
  const initialSidebarSize = useInitialSize(sidebarWidth);
  const initialRightDockSize = useInitialSize(rightDockWidth);
  const initialBottomDockSize = useInitialSize(state.bottomDockHeight);
  // Latest open flags / stored pixel sizes, readable from observer callbacks.
  const rightDockOpenRef = useRef(rightDockOpen);
  rightDockOpenRef.current = rightDockOpen;
  const bottomDockOpenRef = useRef(bottomDockOpen);
  bottomDockOpenRef.current = bottomDockOpen;
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const rightDockWidthRef = useRef(rightDockWidth);
  rightDockWidthRef.current = rightDockWidth;
  const bottomDockHeightRef = useRef(state.bottomDockHeight);
  bottomDockHeightRef.current = state.bottomDockHeight;
  // The sidebar store only exposes a toggle; wrap it as an idempotent setter so
  // drag-to-collapse can sync the flag without double-toggling.
  const sidebarOpenRef = useRef(sidebarVisible);
  sidebarOpenRef.current = sidebarVisible;
  const setSidebarOpen = useCallback(
    (next: boolean) => {
      if (sidebarOpenRef.current === next) return;
      sidebarOpenRef.current = next;
      onToggleSidebar();
    },
    [onToggleSidebar],
  );
  const workspaceGroupRef = useGroupPixelGuard([
    { panelRef: sidebarPanelRef, openRef: sidebarOpenRef, sizePxRef: sidebarWidthRef },
  ]);
  const workbenchGroupRef = useGroupPixelGuard([
    { panelRef: rightDockPanelRef, openRef: rightDockOpenRef, sizePxRef: rightDockWidthRef },
  ]);
  const workbenchMainGroupRef = useGroupPixelGuard([
    { panelRef: bottomDockPanelRef, openRef: bottomDockOpenRef, sizePxRef: bottomDockHeightRef },
  ]);
  const systemThemeMode = useSystemThemeMode();
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--right-dock-width": `${rightDockOpen ? rightDockWidth : 0}px`,
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
            style={{ left: tabChromeLeft }}
          >
            <EditorTabs state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
          </header>
        </>
      )}
      <section className="workspace">
        {/* Sizes are persisted from onLayoutChanged, not onResize: onResize is
            driven by a ResizeObserver and also fires for window resizes,
            constraint re-clamps and imperative collapse()/expand(), so writing
            from there overwrote the user's stored size with a clamped one (a
            400px sidebar became 280px for good after shrinking the window).
            onLayoutChanged reports isUserInteraction for exactly the pointer and
            keyboard resizes we want to remember. */}
        <ResizablePanelGroup
          orientation="horizontal"
          className="workspace-panels"
          elementRef={workspaceGroupRef}
          data-panels-animating={sidebarToggle.animating || undefined}
          onLayoutChanged={(_layout, meta) => {
            if (!meta.isUserInteraction) return;
            const px = Math.round(sidebarPanelRef.current?.getSize().inPixels ?? 0);
            if (px > 1) onSidebarWidthChange(px);
          }}
        >
          <ResizablePanel
            id="sidebar"
            className="workspace-sidebar-panel"
            style={CLIPPED_PANEL_STYLE}
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize="0px"
            defaultSize={`${initialSidebarSize}px`}
            minSize="220px"
            maxSize={`${maxSidebarWidth}px`}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              if (settingsMode) return;
              // While the toggle transition animates through intermediate
              // sizes, only a real drag on this group's separator may flip the
              // open flag — otherwise closing would re-open itself mid-animation.
              if (sidebarToggle.animatingRef.current && !groupHasActiveSeparator(workspaceGroupRef.current)) return;
              setSidebarOpen(Math.round(size.inPixels) > 1);
            }}
          >
            <div className="sidebar-shell-inner">
              <Sidebar state={layoutState} actions={actions} open={sidebarVisible} />
            </div>
          </ResizablePanel>
          {chromeVisible ? (
            <ResizableHandle withHandle className="workspace-sidebar-handle" aria-label="Resize sidebar" data-collapsed={!state.sidebarOpen || undefined} />
          ) : null}
          <ResizablePanel id="center" className="workspace-center-panel" style={CLIPPED_PANEL_STYLE}>
            <section className="workbench">
              <ResizablePanelGroup
                orientation="horizontal"
                className="workbench-panels"
                elementRef={workbenchGroupRef}
                data-panels-animating={rightDockToggle.animating || undefined}
                onLayoutChanged={(_layout, meta) => {
                  if (!meta.isUserInteraction) return;
                  const px = Math.round(rightDockPanelRef.current?.getSize().inPixels ?? 0);
                  if (px > 1) actions.setDockSize("right", px);
                }}
              >
                <ResizablePanel id="workbench-main" className="workbench-main-panel" minSize={`${MAIN_MIN_WIDTH}px`} style={CLIPPED_PANEL_STYLE}>
                  <ResizablePanelGroup
                    orientation="vertical"
                    className="workbench-main-panels"
                    elementRef={workbenchMainGroupRef}
                    data-panels-animating={bottomDockToggle.animating || undefined}
                    onLayoutChanged={(_layout, meta) => {
                      if (!meta.isUserInteraction) return;
                      const px = Math.round(bottomDockPanelRef.current?.getSize().inPixels ?? 0);
                      if (px > 1) actions.setDockSize("bottom", px);
                    }}
                  >
                    <ResizablePanel id="main" className="main-panel" style={CLIPPED_PANEL_STYLE}>
                      <section className="main-stage">
                        <ViewerArea state={layoutState} actions={actions} />
                      </section>
                    </ResizablePanel>
                    {chromeVisible ? (
                      <ResizableHandle withHandle className="resizable-handle-horizontal" aria-label="Resize bottom dock" data-collapsed={!state.bottomDockOpen || undefined} />
                    ) : null}
                    <ResizablePanel
                      id="bottom-dock"
                      className="dock-panel-shell"
                      style={CLIPPED_PANEL_STYLE}
                      panelRef={bottomDockPanelRef}
                      collapsible
                      collapsedSize="0px"
                      defaultSize={`${initialBottomDockSize}px`}
                      minSize="180px"
                      maxSize="70%"
                      groupResizeBehavior="preserve-pixel-size"
                      onResize={(size) => {
                        if (bottomDockToggle.animatingRef.current && !groupHasActiveSeparator(workbenchMainGroupRef.current)) return;
                        const open = Math.round(size.inPixels) > 1;
                        if (open !== bottomDockOpenRef.current) actions.setDockOpen("bottom", open);
                      }}
                    >
                      {/* Always mounted: DockPanel renders its own closed state
                          (data-open / aria-hidden / inert) and unmounting it on
                          close would drop the dock's internal state and re-fire
                          the xyzrender auto-open on every reopen. */}
                      <DockPanel area="bottom" state={layoutState} actions={actions} />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
                {chromeVisible ? (
                  <ResizableHandle withHandle aria-label="Resize right dock" data-collapsed={!state.rightDockOpen || undefined} />
                ) : null}
                <ResizablePanel
                  id="right-dock"
                  className="dock-panel-shell"
                  style={CLIPPED_PANEL_STYLE}
                  panelRef={rightDockPanelRef}
                  collapsible
                  collapsedSize="0px"
                  defaultSize={`${initialRightDockSize}px`}
                  minSize="260px"
                  maxSize="70%"
                  groupResizeBehavior="preserve-pixel-size"
                  onResize={(size) => {
                    if (rightDockToggle.animatingRef.current && !groupHasActiveSeparator(workbenchGroupRef.current)) return;
                    const open = Math.round(size.inPixels) > 1;
                    if (open !== rightDockOpenRef.current) actions.setDockOpen("right", open);
                  }}
                >
                  <DockPanel area="right" state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
                </ResizablePanel>
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
