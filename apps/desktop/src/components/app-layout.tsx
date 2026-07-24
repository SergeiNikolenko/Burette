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
import { activeViewerIframeForDocument, postMessageToViewerSource } from "../lib/viewer-bridge";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed } from "../lib/web-demo-workspace";

// Smallest the viewer/content column may become before the right dock stops
// squeezing it (the point where an overlay dock takes over).
const MAIN_MIN_WIDTH = 420;

// How much further the right dock may be dragged once the viewer has hit
// MAIN_MIN_WIDTH, as a share of the workbench. Past that point the dock keeps
// taking layout width while the viewer's content stays at its floor, so the
// dock floats over the content instead of squeezing it further.
const RIGHT_DOCK_OVERLAY_RATIO = 0.2;

// Sanity cap on a non-overlapping dock, kept from the pre-overlay clamp.
const RIGHT_DOCK_MAX_WIDTH = 960;

// react-resizable-panels writes `overflow: auto` inline on every panel, which
// beats the `overflow: hidden` in our panel classes — content with its own
// min-size would scroll inside the panel instead of being clipped by it. The
// caller's `style` is merged after the library's, so this restores clipping.
const CLIPPED_PANEL_STYLE: CSSProperties = { overflow: "hidden" };

// The one panel that must not clip: once the right dock overlaps it, its
// content keeps MAIN_MIN_WIDTH and spills past the panel's right edge, where
// the dock — painted after it — covers the overflow.
const SPILLING_PANEL_STYLE: CSSProperties = { overflow: "visible" };

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

function rightDockOverlap(workbenchWidth: number) {
  return Math.round(Math.max(0, workbenchWidth) * RIGHT_DOCK_OVERLAY_RATIO);
}

// Widest the right dock may get: the room left beside a floored viewer, plus
// the overlap it is allowed to float over that viewer.
function rightDockMaxWidth(workbenchWidth: number) {
  const overlap = rightDockOverlap(workbenchWidth);
  return Math.max(0, Math.min(RIGHT_DOCK_MAX_WIDTH + overlap, workbenchWidth - MAIN_MIN_WIDTH + overlap));
}

function clampRightDockWidth(width: number, workbenchWidth: number) {
  const maxWidth = rightDockMaxWidth(workbenchWidth);
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
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    const timer = window.setTimeout(() => setAnimating(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);
  return animating;
}

// Whether a collapsible panel reads as open. Collapsed is the library's own
// state, which a user drag past the snap threshold sets; the pixel size is only
// a fallback for the mount pass, before the imperative handle is attached.
function isPanelOpen(panel: PanelImperativeHandle | null, sizePx: number) {
  return panel ? !panel.isCollapsed() : sizePx > 1;
}

// Publishes the panels' measured edges as CSS variables on the shell. The tab
// strip is positioned absolutely over the panel grid, so its edges have to
// follow what the panels actually occupy: sizing it from the stored sizes
// desynced whenever a group could not honour one (a right dock squeezed to
// 118px still reported its wanted 260px, leaving the strip's right edge ~140px
// off the dock), and it lagged behind every drag because the stored width only
// reaches the DOM through a React render. ResizeObserver fires between layout
// and paint, and writing the variables straight to the node keeps drag frames
// out of React entirely. React only ever writes the seed variables these
// override (`--sidebar-layout-width`, `--right-dock-width`), so the two never
// fight over the same property.
function usePanelEdgeVariables(entries: { elementRef: React.RefObject<HTMLDivElement | null>; property: string }[]) {
  const shellRef = useRef<HTMLElement | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const publish = (element: Element, width: number) => {
      const entry = entriesRef.current.find((candidate) => candidate.elementRef.current === element);
      if (entry) shell.style.setProperty(entry.property, `${width}px`);
    };
    const observer = new ResizeObserver((records) => {
      for (const record of records) {
        publish(record.target, record.borderBoxSize?.[0]?.inlineSize ?? record.contentRect.width);
      }
    });
    // No eager measurement: the observer delivers an initial observation for
    // every element it starts watching, and a value published from here would
    // be the panel's pre-collapse size on mount. Until that first delivery the
    // CSS falls back to the stored layout widths.
    for (const { elementRef } of entriesRef.current) {
      if (elementRef.current) observer.observe(elementRef.current);
    }
    return () => observer.disconnect();
  }, []);
  return shellRef;
}

// The window width as state. Every layout bound below is derived from it — how
// wide the sidebar may get, how wide the right dock may get, how far the viewer
// may be squeezed before the dock starts covering it — and read straight from
// `window` those bounds only refreshed when something else happened to
// re-render, so they kept the width from whichever render ran last. Resize
// events already arrive at most once a frame; nothing here defers to rAF, which
// would stall the bounds whenever the window is not painting.
function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  useEffect(() => {
    const sync = () => setWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return width;
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
        if (!panel || !openRef.current) continue;
        // A panel the group collapsed under pressure is restored here once the
        // room is back: the open flag stays true through a squeeze, so this is
        // the other half of not persisting a forced collapse.
        if (panel.isCollapsed()) panel.expand();
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
  const viewportWidth = useViewportWidth();
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
  const workbenchWidth = viewportWidth - sidebarLayoutWidth;
  // The viewer column may be squeezed this far below its floor; the dock covers
  // the difference rather than the content shrinking into it.
  const mainMinLayoutWidth = Math.max(0, MAIN_MIN_WIDTH - rightDockOverlap(workbenchWidth));
  const rightDockWidth = clampRightDockWidth(state.rightDockWidth, workbenchWidth);
  const activeGridId = state.activeDocument?.renderer === "grid2d" ? state.activeDocument.id : null;
  const layoutState = sidebarWidth === state.sidebarWidth && rightDockWidth === state.rightDockWidth ? state : { ...state, sidebarWidth, rightDockWidth };
  const compactLeadingChrome = !tauriRuntime || windowFullscreen;
  // How far the leading window controls reach: the tab strip starts past them
  // when the sidebar is narrower than they are (or closed). The sidebar's own
  // edge comes from `--sidebar-edge`, measured rather than stored.
  const chromeLeadingInset = compactLeadingChrome ? 112 : 192;
  const rightDockOpen = !settingsMode && !hostedMcpWidget && state.rightDockOpen;
  const bottomDockOpen = !settingsMode && !hostedMcpWidget && state.bottomDockOpen;
  // Toggle-animation hooks must come before the collapse/expand sync hooks:
  // layout effects run in hook order, so registering them the other way round
  // would collapse the panel before the group is marked as animating and the
  // toggle would jump instead of sliding.
  const sidebarAnimating = usePanelToggleAnimation(sidebarVisible);
  const rightDockAnimating = usePanelToggleAnimation(rightDockOpen);
  const bottomDockAnimating = usePanelToggleAnimation(bottomDockOpen);
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
  const sidebarElementRef = useRef<HTMLDivElement | null>(null);
  const rightDockElementRef = useRef<HTMLDivElement | null>(null);
  const shellRef = usePanelEdgeVariables([
    { elementRef: sidebarElementRef, property: "--sidebar-edge" },
    { elementRef: rightDockElementRef, property: "--right-dock-edge" },
  ]);
  // A spilling grid keeps its full width and fires no resize when the dock
  // floats over it, so how far the dock covers it is measured from the two rects
  // and pushed to the grid runtime. The measurement is driven by a ResizeObserver
  // on the dock element rather than React state: the panel library resizes the
  // layout directly, and its widths do not always flow back through state in time.
  useEffect(() => {
    if (!activeGridId) return;
    const post = () => {
      const iframe = activeViewerIframeForDocument(activeGridId, "grid2d");
      const win = iframe?.contentWindow ?? null;
      if (!iframe || !win) return;
      const dockEl = rightDockOpen ? rightDockElementRef.current : null;
      const dockLeft = dockEl?.getBoundingClientRect().left;
      const cover = dockLeft === undefined ? 0 : Math.max(0, Math.round(iframe.getBoundingClientRect().right - dockLeft));
      postMessageToViewerSource(win, { source: "burrete-grid-host", body: { type: "gridViewportCover", cover } });
    };
    post();
    const dockEl = rightDockElementRef.current;
    const observer = dockEl ? new ResizeObserver(() => post()) : null;
    if (dockEl && observer) observer.observe(dockEl);
    // The iframe may not be mounted yet right after a load; retry once shortly.
    const timer = window.setTimeout(post, 400);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [activeGridId, viewportWidth, rightDockOpen]);
  const systemThemeMode = useSystemThemeMode();
  // The layout widths seed the chrome before the edge observer's first pass;
  // `--sidebar-edge` / `--right-dock-edge` take over from there.
  const shellStyle = {
    ...buildThemeStyle(state.preferences, systemThemeMode),
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
    "--right-dock-width": `${rightDockOpen ? rightDockWidth : 0}px`,
    "--chrome-leading-inset": `${chromeLeadingInset}px`,
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
      ref={shellRef}
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
          <header className="topbar">
            <EditorTabs state={layoutState} actions={actions} readOnly={hostedMcpWidget} />
          </header>
        </>
      )}
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
            if (px > 1) onSidebarWidthChange(px);
            if (!settingsMode) setSidebarOpen(isPanelOpen(panel, px));
          }}
        >
          <ResizablePanel
            id="sidebar"
            className="workspace-sidebar-panel"
            style={CLIPPED_PANEL_STYLE}
            elementRef={sidebarElementRef}
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize="0px"
            defaultSize={`${initialSidebarSize}px`}
            minSize="220px"
            maxSize={`${maxSidebarWidth}px`}
            groupResizeBehavior="preserve-pixel-size"
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
                data-panels-animating={rightDockAnimating || undefined}
                onLayoutChanged={(_layout, meta) => {
                  if (!meta.isUserInteraction) return;
                  const panel = rightDockPanelRef.current;
                  const px = Math.round(panel?.getSize().inPixels ?? 0);
                  if (px > 1) actions.setDockSize("right", px);
                  const open = isPanelOpen(panel, px);
                  if (open !== rightDockOpenRef.current) actions.setDockOpen("right", open);
                }}
              >
                <ResizablePanel
                  id="workbench-main"
                  className="workbench-main-panel"
                  minSize={`${mainMinLayoutWidth}px`}
                  style={SPILLING_PANEL_STYLE}
                >
                  <ResizablePanelGroup
                    orientation="vertical"
                    className="workbench-main-panels"
                    style={{ minWidth: MAIN_MIN_WIDTH }}
                    elementRef={workbenchMainGroupRef}
                    data-panels-animating={bottomDockAnimating || undefined}
                    onLayoutChanged={(_layout, meta) => {
                      if (!meta.isUserInteraction) return;
                      const panel = bottomDockPanelRef.current;
                      const px = Math.round(panel?.getSize().inPixels ?? 0);
                      if (px > 1) actions.setDockSize("bottom", px);
                      const open = isPanelOpen(panel, px);
                      if (open !== bottomDockOpenRef.current) actions.setDockOpen("bottom", open);
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
                  elementRef={rightDockElementRef}
                  panelRef={rightDockPanelRef}
                  collapsible
                  collapsedSize="0px"
                  defaultSize={`${initialRightDockSize}px`}
                  minSize="260px"
                  maxSize={`${rightDockMaxWidth(workbenchWidth)}px`}
                  groupResizeBehavior="preserve-pixel-size"
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
