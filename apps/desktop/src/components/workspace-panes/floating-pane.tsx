import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ShellActions, ShellViewState } from "../types";
import type { MoleculeTab } from "../../stores/molecule-store";
import {
  FLOATING_PANE_MIN_HEIGHT,
  FLOATING_PANE_MIN_WIDTH,
  placeFloatingRect,
  useWorkspacePanesStore,
  type FloatingPaneRect,
} from "../../stores/workspace-panes-store";
import { pinViewerFrames } from "../editor-area/viewer-frame";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { ToolbarButton } from "../ui/toolbar-button";
import { Expand, Minus } from "../ui/app-icons";
import { PaneSwitcher } from "./pane-switcher";
import { placeScreen } from "./pane-actions";
import "./workspace-panes.css";

const HEADER_HEIGHT = 36;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function applyRect(surface: HTMLElement, rect: FloatingPaneRect, minimized: boolean) {
  surface.style.left = `${rect.x}px`;
  surface.style.top = `${rect.y}px`;
  surface.style.width = `${rect.width}px`;
  surface.style.height = `${minimized ? HEADER_HEIGHT : rect.height}px`;
}

// The header of the floating window, rendered as the first child of the
// screen's own page surface. The surface is laid out here (position: fixed,
// see workspace-panes.css) instead of being moved into another container, so
// a viewer iframe inside it keeps running while the screen pops out.
export function FloatingPaneHeader({ tab, state, actions, minimized }: {
  tab: MoleculeTab;
  state: ShellViewState;
  actions: ShellActions;
  minimized: boolean;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const stored = useWorkspacePanesStore((store) => store.floating);
  const setFloatingRect = useWorkspacePanesStore((store) => store.setFloatingRect);
  const setFloatingMinimized = useWorkspacePanesStore((store) => store.setFloatingMinimized);
  const rectRef = useRef<FloatingPaneRect>(stored);

  useLayoutEffect(() => {
    const surface = headerRef.current?.parentElement;
    if (!surface) return;
    const layout = () => {
      rectRef.current = placeFloatingRect(stored, viewport());
      applyRect(surface, rectRef.current, minimized);
    };
    layout();
    window.addEventListener("resize", layout);
    return () => {
      window.removeEventListener("resize", layout);
      for (const property of ["left", "top", "width", "height"]) surface.style.removeProperty(property);
    };
  }, [minimized, stored]);

  // Moves (or, from the corner grip, resizes) the window with the pointer.
  // Viewer frames are pinned for the gesture so Mol* does not redraw per frame.
  const track = (event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") => {
    if (event.button !== 0) return;
    const surface = headerRef.current?.parentElement;
    const shell = surface?.closest<HTMLElement>(".app-shell") ?? surface;
    if (!surface || !shell) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, rect: rectRef.current };
    const release = pinViewerFrames(shell);
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      const next = mode === "move"
        ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
        : {
            ...start.rect,
            width: Math.max(FLOATING_PANE_MIN_WIDTH, start.rect.width + dx),
            height: Math.max(FLOATING_PANE_MIN_HEIGHT, start.rect.height + dy),
          };
      rectRef.current = placeFloatingRect(next, viewport());
      applyRect(surface, rectRef.current, minimized);
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      release();
      setFloatingRect(rectRef.current);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  };

  const fromControl = (event: ReactPointerEvent) => event.stopPropagation();
  return (
    <>
      <div ref={headerRef} className="floating-pane-header" onPointerDown={(event) => track(event, "move")}>
        <ShortcutTooltip label={minimized ? "Restore" : "Minimize"}>
          <ToolbarButton aria-label={minimized ? "Restore" : "Minimize"} onPointerDown={fromControl} onClick={() => setFloatingMinimized(!minimized)}>
            <Minus size={16} aria-hidden />
          </ToolbarButton>
        </ShortcutTooltip>
        <div className="floating-pane-title">
          <PaneSwitcher pane="floating" tab={tab} state={state} actions={actions} />
        </div>
        <ShortcutTooltip label="Open in Main Window">
          <ToolbarButton aria-label="Open in Main Window" onPointerDown={fromControl} onClick={() => placeScreen(tab.id, null)}>
            <Expand size={16} aria-hidden />
          </ToolbarButton>
        </ShortcutTooltip>
        <span className="floating-pane-grip" aria-hidden />
      </div>
      {minimized ? null : <div className="floating-pane-resize" aria-hidden onPointerDown={(event) => track(event, "resize")} />}
    </>
  );
}
