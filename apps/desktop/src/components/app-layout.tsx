import { useWorkspacePanesStore } from "../stores/workspace-panes-store";
import { NativePreviewLayout } from "./workspace-panes/native-preview-layout";
import { isNativePreviewWindow } from "../lib/window-scope";
import { UsageStatistics } from "./usage-statistics";
import { Spinner } from "@/components/ui/spinner";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { NativeWorkspaceMenu, NativeWorkspaceSidebar } from "./native-workspace-navigation";
import { useNativeWorkspacePlacement } from "../hooks/use-native-workspace-placement";
import { MobileWebDemoLayout } from "./mobile-web-demo-layout";
import { XyzrenderAnimationDialog } from "./xyzrender-animation-dialog";
import { useWindowResizeSession } from "./ui/use-window-resize-session";
import { usePanelEdgeVariables } from "./ui/use-panel-edge-variables";
import { SidebarFileOperations } from "./sidebar/file-operations";
import { WorkspaceMenus } from "./workspace-menus";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, SidebarLeft, SidebarLeftHidden } from "@/components/ui/app-icons";
import { RightDockToggle } from "./workspace-panes/right-dock-toggle";
import { FullViewExitButton } from "./workspace-panes/full-view-exit";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DockPanel } from "./dock-panel";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { beginViewerLayoutGesture } from "./editor-area/viewer-frame";
import { ActivityIndicator } from "./activity-indicator";
import { OpenInEditorMenu } from "./open-in-editor-menu";
import { QuickLookPreview } from "./quick-look-preview";
import { Sidebar } from "./sidebar";
import { useSidebarPeek } from "./sidebar/use-sidebar-peek";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { FileDropFeedback } from "./file-drop-feedback";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, type PanelImperativeHandle } from "./ui/resizable";
import type { ShellActions, ShellViewState } from "./types";
import type { FileDropPreview } from "../lib/drop-preview";
import { createDragCommit, type DragCommit } from "../lib/drag-commit";
import { isTauriRuntime } from "../lib/tauri";
import { desktopPlatform } from "../lib/platform";
import { defaultShortcutLabel } from "../lib/keyboard-shortcuts";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import { isHostedKetcherWidget, isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { HostedKetcherViewSwitch } from "./hosted-ketcher-view-switch";
import { isWebDemoHeroEmbed } from "../lib/web-demo-workspace";
import { AnnotateToggle, AnnotationLayer } from "./annotation-layer";
import { isAgentPluginSurface } from "../lib/native-mcp-workspace";
import { OnboardingHost } from "./onboarding";

// The editor tab strip is absolutely positioned over the first band of the
// viewer column, so that band is the one part of it the bottom dock may not
// climb into: the dock's own tabs would land under the document tabs. Mirrors
// `--chrome-height` in styles.css, and test-ui-shell-contract keeps them equal.
const CHROME_HEIGHT = 44;

// react-resizable-panels writes `overflow: auto` inline on every panel, which
// beats the `overflow: hidden` in our panel classes — content with its own
// min-size would scroll inside the panel instead of being clipped by it. The
// caller's `style` is merged after the library's, so this restores clipping.
const CLIPPED_PANEL_STYLE: CSSProperties = { overflow: "hidden" };
// A peeking sidebar overlays the content from inside its collapsed panel.
const PEEK_PANEL_STYLE: CSSProperties = { overflow: "visible" };

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(240, Math.min(maxSidebarWidth, Math.round(width)));
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
// window resizes, and a standing transition would rubber-band both. Viewer
// frames follow the panels while their WebGL canvases hold their pixels until
// the transition and final panel corrections have finished.
function usePanelToggleAnimation(open: boolean, shellRef: React.RefObject<HTMLElement | null>) {
  const [animating, setAnimating] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    const release = shellRef.current ? beginViewerLayoutGesture(shellRef.current) : null;
    let cancelled = false;
    // A busy first paint can start the CSS transition after a wall-clock timer
    // has already expired. Wait for the actual panel transitions instead.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const transitions = Array.from(shellRef.current?.querySelectorAll("[data-panel]") ?? [])
          .flatMap((panel) => panel.getAnimations())
          .filter((animation) => "transitionProperty" in animation && animation.transitionProperty === "flex-grow");
        void Promise.allSettled(transitions.map((animation) => animation.finished)).then(() => {
          if (cancelled) return;
          setAnimating(false);
          // Nested groups correct their pixel sizes in ResizeObserver + rAF.
          // Keep the canvas held until those final corrections have painted.
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => release?.());
          });
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      release?.();
    };
  }, [open, shellRef]);
  return animating;
}

// A pointer drag on a separator, from pointerdown on the handle to the pointer
// being released anywhere. While it lasts the viewer canvases stay held and
// the per-frame sizes reported by onLayoutChanged are parked in the panel's
// DragCommit instead of hitting the store: setDockSize clones the workspace
// and the persist middleware serialises every workspace to localStorage, which
// used to happen once per frame of the gesture. The library's own pointerup
// listener sits on the document, so a capture listener on the window runs
// first; `blur` covers a release the window never sees, and unmounting ends
// the session so the last size is still committed.
function useResizeDragSession(shellRef: React.RefObject<HTMLElement | null>) {
  const endRef = useRef<(() => void) | null>(null);
  const begin = useCallback((controller: DragCommit<number>) => {
    endRef.current?.();
    controller.begin();
    const release = shellRef.current ? beginViewerLayoutGesture(shellRef.current) : null;
    const end = () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
      endRef.current = null;
      release?.();
      controller.end();
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    endRef.current = end;
  }, [shellRef]);
  useEffect(() => () => endRef.current?.(), []);
  return begin;
}

// One DragCommit per resizable panel, committing through the latest callback.
function useDragCommittedSize(commit: (px: number) => void) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const [controller] = useState(() => createDragCommit<number>((px) => commitRef.current(px)));
  return controller;
}

// Whether a collapsible panel reads as open. Collapsed is the library's own
// state, which a user drag past the snap threshold sets; the pixel size is only
// a fallback for the mount pass, before the imperative handle is attached.
function isPanelOpen(panel: PanelImperativeHandle | null, sizePx: number) {
  return panel ? !panel.isCollapsed() : sizePx > 1;
}

// The window width as state. Every layout bound below is derived from it — how
// wide the sidebar may get, how wide the right dock may get, how far the viewer
// may be squeezed before the dock starts covering it — and read straight from
// `window` those bounds only refreshed when something else happened to
// re-render, so they kept the width from whichever render ran last.
//
// The width is quantised because the bounds do not need pixel resolution: the
// widest the sidebar may get is 35% of it, so a step here moves that bound by a
// third of a step. Storing the raw width re-rendered the entire shell for every
// resize event of a window drag — every panel, both docks and the sidebar tree —
// and react-resizable-panels rebuilt its own ResizeObservers each time. Repeating
// the same quantised value is a no-op for React, so a drag now re-renders once
// per step instead of once per pixel.
const VIEWPORT_WIDTH_STEP = 16;

function quantisedViewportWidth() {
  if (typeof window === "undefined") return 1200;
  return Math.floor(window.innerWidth / VIEWPORT_WIDTH_STEP) * VIEWPORT_WIDTH_STEP;
}

function useViewportWidth(shellRef: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(quantisedViewportWidth);
  useWindowResizeSession(shellRef, () => setWidth(quantisedViewportWidth()));
  return width;
}

export function AppLayout(props: Parameters<typeof WorkspaceAppLayout>[0]) {
  return isNativePreviewWindow()
    ? <NativePreviewLayout state={props.state} actions={props.actions} />
    : <WorkspaceAppLayout {...props} />;
}

function WorkspaceAppLayout({
  state,
  actions,
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
  onToggleSidebar: () => void;
  onSidebarWidthChange: (width: number) => void;
  dropPreview: FileDropPreview | null;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
}) {
  const sidebarElementRef = useRef<HTMLDivElement | null>(null);
  const shellRef = usePanelEdgeVariables([
    { elementRef: sidebarElementRef, property: "--sidebar-edge" },
  ]);
  const viewportWidth = useViewportWidth(shellRef);
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
    // Every resize event used to fire its own isFullscreen() IPC round-trip, so a
    // window drag sent a request per frame to answer a question that only changes
    // when the user enters or leaves fullscreen. Asking once the drag settles is
    // enough, and the transition itself ends in a resize too.
    let settleTimer = 0;
    void appWindow
      .onResized(() => {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => void syncFullscreen(), 150);
      })
      .then((stop) => {
        if (disposed) stop();
        else stopResizeListener = stop;
      });
    return () => {
      disposed = true;
      window.clearTimeout(settleTimer);
      stopResizeListener?.();
    };
  }, [tauriRuntime]);
  const placement = useNativeWorkspacePlacement();
  const [nativeNavigationOpen, setNativeNavigationOpen] = useState(false);
  const nativeWorkspaceChrome = placement?.mode === "fullscreen";
  const nativeExpanded = nativeWorkspaceChrome && viewportWidth >= 760;
  const hostedMcpWidget = isHostedMcpWidget();
  const heroEmbed = isWebDemoHeroEmbed();
  // Codex sidebar bounds: 240px up to 520px, always leaving 240px of content.
  const maxSidebarWidth = Math.max(240, Math.min(520, viewportWidth - 240));
  const settingsMode = state.page === "settings";
  const chromeVisible = !settingsMode && !hostedMcpWidget;
  // Hiding only the panel's content leaves react-resizable-panels' wrapper wide.
  // Expanded plugin workspaces own a navigation panel; compact cards keep the menu.
  const sidebarVisible = window.BuretteMcpWorkspace
    ? nativeExpanded && nativeNavigationOpen
    : settingsMode || (!hostedMcpWidget && state.sidebarOpen);
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const sidebarLayoutWidth = sidebarVisible ? sidebarWidth : 0;
  const layoutState = sidebarWidth === state.sidebarWidth ? state : { ...state, sidebarWidth };
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarPeek = useSidebarPeek({
    enabled: chromeVisible && !heroEmbed && !window.BuretteMcpWorkspace && !sidebarVisible,
    panelRef: sidebarShellRef,
    closeKey: state.activeTabId,
  });
  const sidebarPeeking = sidebarPeek !== "closed";
  const platform = desktopPlatform();
  // Linux windows carry native decorations, so no traffic lights sit in the page.
  const compactLeadingChrome = !tauriRuntime || windowFullscreen || platform === "linux";
  // How far the leading window controls reach: the tab strip starts past them
  // when the sidebar is narrower than they are (or closed). The sidebar's own
  // edge comes from `--sidebar-edge`, measured rather than stored.
  // The native traffic lights keep a fixed on-screen position as the page
  // zooms. At narrow widths the history buttons disappear, so the tab strip
  // only needs to clear the sidebar toggle beside those lights.
  const chromeLeadingInset = compactLeadingChrome
    ? "112px"
    : viewportWidth <= 520
      ? "calc(82px / var(--window-zoom, 1) + 40px)"
      : "calc(92px / var(--window-zoom, 1) + 100px)";
  const fullViewTabId = useWorkspacePanesStore(store => store.fullViewTabId);
  const fullViewGroup = state.tabs.find(tab => tab.id === fullViewTabId)?.pane;
  // The agent plugin surfaces (native widget and browser agent shell) have no
  // bottom dock: its Jobs/compute tabs are excluded there. Annotate mode sends
  // to the agent chat, so only these surfaces have it.
  const pluginSurface = isAgentPluginSurface(state.buildInfo.isAgentShell);
  const bottomDockOpen = !settingsMode && !hostedMcpWidget && !pluginSurface && state.bottomDockOpen;
  // The right dock's tabs share the title row with the trailing controls, so
  // the dock header reserves their measured width.
  const trailingControlsRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([record]) => {
      const width = record?.borderBoxSize?.[0]?.inlineSize ?? element.offsetWidth;
      shellRef.current?.style.setProperty("--chrome-trailing-width", `${Math.ceil(width)}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      shellRef.current?.style.removeProperty("--chrome-trailing-width");
    };
  }, [shellRef]);
  // Toggle-animation hooks must come before the collapse/expand sync hooks:
  // layout effects run in hook order, so registering them the other way round
  // would collapse the panel before the group is marked as animating and the
  // toggle would jump instead of sliding.
  const sidebarAnimating = usePanelToggleAnimation(sidebarVisible, shellRef);
  const bottomDockAnimating = usePanelToggleAnimation(bottomDockOpen, shellRef);
  const sidebarPanelRef = useCollapsiblePanelSync(sidebarVisible, sidebarWidth);
  const bottomDockPanelRef = useCollapsiblePanelSync(bottomDockOpen, state.bottomDockHeight);
  // Seed closed panels collapsed: allocating their expanded width first can
  // leave the center at 0% when a narrow host mounts before its first resize.
  const initialSidebarSize = useInitialSize(sidebarVisible ? sidebarWidth : 0);
  const initialBottomDockSize = useInitialSize(bottomDockOpen ? state.bottomDockHeight : 0);
  // Latest open flags / stored pixel sizes, readable from observer callbacks.
  const bottomDockOpenRef = useRef(bottomDockOpen);
  bottomDockOpenRef.current = bottomDockOpen;
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
  // 4.14 preserves fixed pixel sizes from the requested (unclamped) layout.
  // A second rAF correction would resize nested groups again after every move.
  const workspaceGroupRef = useRef<HTMLDivElement | null>(null);
  // Sizes reported while a separator is being dragged are committed once, on
  // release; anything else (keyboard resizes) commits as it comes. The drag
  // frames themselves need no store round-trip: the panel library lays the
  // panels out directly and the edge observer above republishes the CSS
  // variables the chrome follows.
  const beginResizeDrag = useResizeDragSession(shellRef);
  const sidebarResize = useDragCommittedSize(onSidebarWidthChange);
  const bottomDockResize = useDragCommittedSize((px) => actions.setDockSize("bottom", px));
  const systemThemeMode = useSystemThemeMode();
  // Seed the sidebar width before the edge observer’s first pass.
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--chrome-leading-inset": chromeLeadingInset,
    "--chrome-height": hostedMcpWidget ? "0px" : undefined,
  } as CSSProperties;
  const effectiveTheme = resolveThemeMode(state.preferences.theme, systemThemeMode);
  const activePageKind = state.activeTab?.location.kind ?? null;
  if (import.meta.env.VITE_BURETTE_WEB_DEMO === "1" && viewportWidth < 768 && !heroEmbed && !state.quickLookStandalone) {
    return <MobileWebDemoLayout state={state} actions={actions} style={shellStyle} theme={effectiveTheme} />;
  }
  if (state.quickLookStandalone) {
    return (
      <main
        className="app-shell"
        data-theme={window.BuretteMcpWorkspace ? effectiveTheme : state.preferences.theme}
        data-effective-theme={effectiveTheme}
        data-runtime={isTauriRuntime() ? "tauri" : "browser"}
        data-platform={platform}
        data-quicklook-debug="true"
        style={shellStyle}
      >
        {state.quickLookDocument ? (
          <QuickLookPreview document={state.quickLookDocument} onClose={actions.closeQuickLookPreview} standalone />
        ) : state.quickLookError ? (
          <div className="web-quicklook-debug-loading" role="alert">{state.quickLookError}</div>
        ) : (
          <div className="web-quicklook-debug-loading"><Spinner aria-label="Loading Quick Look preview" /></div>
        )}
      </main>
    );
  }
  return (
    <SidebarFileOperations state={state} actions={actions}><WorkspaceMenus state={state} actions={actions}><main
      ref={shellRef}
      className="app-shell"
      data-theme={window.BuretteMcpWorkspace ? effectiveTheme : state.preferences.theme}
      data-effective-theme={effectiveTheme}
      data-active-page-kind={activePageKind ?? undefined}
      data-runtime={tauriRuntime ? "tauri" : "browser"}
      data-platform={platform}
      data-window-fullscreen={windowFullscreen ? "true" : undefined}
      data-hosted-mcp-widget={hostedMcpWidget ? "true" : undefined}
      data-native-workspace-chrome={window.BuretteMcpWorkspace && nativeWorkspaceChrome ? "true" : undefined}
      data-hero-embed={heroEmbed ? "true" : undefined}
      data-settings-mode={settingsMode ? "true" : undefined}
      data-drop-active={state.dropActive || undefined}
      data-structure-drag-active={state.structureDragActive ? "true" : undefined}
      data-sidebar-open={sidebarVisible ? "true" : "false"}
      data-sidebar-peek={sidebarPeeking ? sidebarPeek : undefined}
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
      <XyzrenderAnimationDialog />
      {!hostedMcpWidget && <UsageStatistics pageKind={activePageKind ?? undefined} renderer={state.activeDocument?.renderer} />}
      {!hostedMcpWidget && <div className="drag-region" data-tauri-drag-region />}
      {chromeVisible && (!window.BuretteMcpWorkspace || nativeWorkspaceChrome) && (
        <>
          {!hostedMcpWidget ? (
            <div className="chrome-leading-controls" data-tauri-drag-region>
              <div className="tab-history-controls" aria-label="Navigation history">
                <ShortcutTooltip label="Back" shortcut={defaultShortcutLabel("view.navigate-back")}>
                  <ToolbarButton
                    type="button"
                    className="tab-history-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={actions.navigateBack}
                    disabled={!actions.canNavigateBack}
                    aria-label="Back"
                  >
                    <ArrowLeft size={16} aria-hidden />
                  </ToolbarButton>
                </ShortcutTooltip>
                <ShortcutTooltip label="Forward" shortcut={defaultShortcutLabel("view.navigate-forward")}>
                  <ToolbarButton
                    type="button"
                    className="tab-history-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={actions.navigateForward}
                    disabled={!actions.canNavigateForward}
                    aria-label="Forward"
                  >
                    <ArrowRight size={16} aria-hidden />
                  </ToolbarButton>
                </ShortcutTooltip>
              </div>
              <ShortcutTooltip label="Toggle sidebar" shortcut={defaultShortcutLabel("view.toggle-sidebar")}>
                <ToolbarButton
                  type="button"
                  className="sidebar-toggle-root"
                  data-sidebar-peek-area={window.BuretteMcpWorkspace ? undefined : "sidebar"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={window.BuretteMcpWorkspace ? () => setNativeNavigationOpen(open => !open) : onToggleSidebar}
                  disabled={Boolean(window.BuretteMcpWorkspace && !nativeExpanded)}
                  aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                  aria-expanded={sidebarVisible}
                >
                  {sidebarVisible ? <SidebarLeft size={16} aria-hidden /> : <SidebarLeftHidden size={16} aria-hidden />}
                </ToolbarButton>
              </ShortcutTooltip>
            </div>
          ) : null}
          <div className="chrome-trailing-controls" ref={trailingControlsRef} data-tauri-drag-region>
            {!hostedMcpWidget ? <ActivityIndicator state={layoutState} actions={actions} /> : null}
            {!hostedMcpWidget && pluginSurface ? <AnnotateToggle className="chrome-button dock-toggle-button" /> : null}
            <FullViewExitButton />
            <RightDockToggle open={state.rightDockOpen} toggle={() => actions.toggleDock("right")} />
          </div>
          <header className="topbar">
            <EditorTabs group={fullViewGroup ?? "main"} state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
            {/* Codex keeps "Open in" at the end of the thread header, left of the right dock. */}
            {!hostedMcpWidget ? <div className="topbar-actions"><OpenInEditorMenu state={layoutState} actions={actions} /></div> : null}
          </header>
        </>
      )}
      {isHostedKetcherWidget() ? <HostedKetcherViewSwitch state={state} actions={actions} /> : null}
      <section className="workspace">
        {/* Sizes AND open flags are persisted from onLayoutChanged, not
            onResize: onResize is driven by a ResizeObserver and also fires for
            window resizes, constraint re-clamps and imperative
            collapse()/expand(), so writing from there overwrote the user's
            stored size with a clamped one (a 400px sidebar became 280px for
            good after shrinking the window) and, worse, persisted a collapse
            the group had forced for lack of room — the dock then stayed closed
            once the room came back, which is why docks seemed to randomly
            disappear while resizing. onLayoutChanged reports isUserInteraction
            for exactly the pointer and keyboard resizes we want to remember;
            the separator's own state cannot stand in for it, since
            `data-separator="focus"` outlives the keystrokes that caused it. */}
        <ResizablePanelGroup
          orientation="horizontal"
          className="workspace-panels"
          elementRef={workspaceGroupRef}
          data-panels-animating={sidebarAnimating || undefined}
          onLayoutChanged={(_layout, meta) => {
            if (!meta.isUserInteraction) return;
            const panel = sidebarPanelRef.current;
            const px = Math.round(panel?.getSize().inPixels ?? 0);
            if (px > 1) sidebarResize.report(px);
            if (!settingsMode) {
              const open = isPanelOpen(panel, px);
              if (window.BuretteMcpWorkspace) setNativeNavigationOpen(open);
              else setSidebarOpen(open);
            }
          }}
        >
          <ResizablePanel
            id="sidebar"
            className="workspace-sidebar-panel"
            style={sidebarPeeking ? PEEK_PANEL_STYLE : CLIPPED_PANEL_STYLE}
            elementRef={sidebarElementRef}
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize="0px"
            defaultSize={`${initialSidebarSize}px`}
            minSize="240px"
            maxSize={`${maxSidebarWidth}px`}
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="sidebar-shell-inner" ref={sidebarShellRef}>
              {window.BuretteMcpWorkspace ? <NativeWorkspaceSidebar state={layoutState} actions={actions} onToggleSidebar={() => setNativeNavigationOpen(false)} /> : <Sidebar state={layoutState} actions={actions} open={sidebarVisible || sidebarPeek === "open"} />}
            </div>
          </ResizablePanel>
          {chromeVisible && (!window.BuretteMcpWorkspace || nativeExpanded) ? (
            <ResizableHandle
              withHandle
              className="workspace-sidebar-handle"
              aria-label="Resize sidebar"
              data-collapsed={!sidebarVisible || undefined}
              onPointerDown={(event) => { if (event.button === 0) beginResizeDrag(sidebarResize); }}
            />
          ) : null}
          <ResizablePanel id="center" className="workspace-center-panel" style={CLIPPED_PANEL_STYLE}>
            <section className="workbench">
              {/* The plugin's file header leads the content column, so an open
                  sidebar never sits under it. */}
              {window.BuretteMcpWorkspace && !nativeWorkspaceChrome ? <OpenInEditorMenu state={layoutState} actions={actions} presentation="file-header"
                navigation={sidebarVisible ? undefined : items => <NativeWorkspaceMenu fileItems={items} state={layoutState} actions={actions}
                  onShowSidebar={nativeExpanded ? () => setNativeNavigationOpen(true) : undefined} />} /> : null}
              <ResizablePanelGroup
                orientation="vertical"
                className="workbench-main-panels"
                data-panels-animating={bottomDockAnimating || undefined}
                onLayoutChanged={(_layout, meta) => {
                  if (!meta.isUserInteraction) return;
                  const panel = bottomDockPanelRef.current;
                  const px = Math.round(panel?.getSize().inPixels ?? 0);
                  if (px > 1) bottomDockResize.report(px);
                  const open = isPanelOpen(panel, px);
                  if (open !== bottomDockOpenRef.current) actions.setDockOpen("bottom", open);
                }}
              >
                <ResizablePanel id="main" className="main-panel" style={CLIPPED_PANEL_STYLE} minSize={`${CHROME_HEIGHT}px`}>
                  <section className="main-stage">
                    <ViewerArea state={layoutState} actions={actions} />
                  </section>
                </ResizablePanel>
                {chromeVisible && !pluginSurface ? (
                  <ResizableHandle
                    withHandle
                    className="resizable-handle-horizontal"
                    aria-label="Resize bottom dock"
                    data-collapsed={!state.bottomDockOpen || undefined}
                    onPointerDown={(event) => { if (event.button === 0) beginResizeDrag(bottomDockResize); }}
                  />
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
                  maxSize="100%"
                  groupResizeBehavior="preserve-pixel-size"
                >
                  <DockPanel area="bottom" state={layoutState} actions={actions} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
        {!hostedMcpWidget && pluginSurface && state.activeTab && state.activeTab.location.kind !== "launcher" ? <AnnotationLayer key={`${state.activeTabId}:${state.activeDocument?.id ?? JSON.stringify(state.activeTab.location)}`} documentTitle={state.activeDocument?.title ?? "Burette"} picksResidues={state.activeDocument?.renderer === "molstar"} /> : null}
      </section>
      <OnboardingHost state={layoutState} actions={actions} />
      <FileDropFeedback preview={dropPreview} />
    </main></WorkspaceMenus></SidebarFileOperations>
  );
}
