import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { ViewerDocument, ViewerPreferences } from "../../types";
import type { ShellActions } from "../types";
import { positionMesoscaleControls, requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleGraphicsMode } from "../../lib/mesoscale-contract";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { MesoscaleViewportRail } from "./mesoscale-viewport-rail";

const GRAPHICS: Array<{ value: MesoscaleGraphicsMode; label: string }> = [
  { value: "ultra", label: "Ultra" },
  { value: "quality", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Performance" },
];

type ToolbarPosition = { left: number; top: number };
type ToolbarDrag = { pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean };

const TOOLBAR_POSITION_KEY = "burette.mesoscale.toolbar.position.v1";
const TOOLBAR_COLLAPSED_KEY = "burette.mesoscale.toolbar.collapsed.v1";
const TOOLBAR_MARGIN = 12;

function readToolbarPosition(): ToolbarPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOOLBAR_POSITION_KEY) || "null") as Partial<ToolbarPosition> | null;
    return parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)
      ? { left: Number(parsed.left), top: Number(parsed.top) }
      : null;
  } catch {
    return null;
  }
}

function readToolbarCollapsed() {
  try {
    return window.localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function toolbarBounds(toolbar: HTMLElement) {
  const stage = toolbar.closest<HTMLElement>(".molecule-stage");
  if (!stage) return null;
  const stageRect = stage.getBoundingClientRect();
  const toolbarRect = toolbar.getBoundingClientRect();
  const railRect = toolbar.querySelector<HTMLElement>(".mesoscale-viewport-rail:not(.hidden)")?.getBoundingClientRect();
  const railFootprint = (railRect?.height ?? 0) + 6;
  const styles = getComputedStyle(stage);
  const canvasLeft = Number.parseFloat(styles.getPropertyValue("--mesoscale-canvas-left")) || 0;
  const canvasRight = Number.parseFloat(styles.getPropertyValue("--mesoscale-canvas-right")) || 0;
  return {
    stage,
    stageRect,
    toolbarRect,
    minLeft: canvasLeft + TOOLBAR_MARGIN,
    maxLeft: Math.max(canvasLeft + TOOLBAR_MARGIN, stageRect.width - canvasRight - toolbarRect.width - TOOLBAR_MARGIN),
    minTop: TOOLBAR_MARGIN,
    maxTop: Math.max(TOOLBAR_MARGIN, stageRect.height - toolbarRect.height - railFootprint - TOOLBAR_MARGIN),
  };
}

function clampToolbarPosition(toolbar: HTMLElement, position: ToolbarPosition) {
  const bounds = toolbarBounds(toolbar);
  if (!bounds) return position;
  return {
    left: Math.min(bounds.maxLeft, Math.max(bounds.minLeft, position.left)),
    top: Math.min(bounds.maxTop, Math.max(bounds.minTop, position.top)),
  };
}

export function MesoscaleToolbar({ document, actions, preferences }: { document: ViewerDocument; actions: ShellActions; preferences: ViewerPreferences }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ToolbarDrag | null>(null);
  const positionRef = useRef<ToolbarPosition | null>(null);
  const suppressClickRef = useRef(false);
  const [collapsed, setCollapsed] = useState(readToolbarCollapsed);
  const [position, setPosition] = useState<ToolbarPosition | null>(readToolbarPosition);
  const systemTheme = useSystemThemeMode();
  const effectiveTheme = resolveThemeMode(preferences.theme, systemTheme);
  const nextTheme = effectiveTheme === "dark" ? "light" : "dark";
  const disabled = !session || session.status === "loading" || session.status === "disposed";
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const toggleRegion = (region: "left" | "right") => run({
    type: "setLayoutRegion",
    region,
    visible: !(session?.summary?.layout[region] ?? false),
  });

  const syncNativeControls = () => {
    const toolbar = toolbarRef.current;
    const stage = toolbar?.closest<HTMLElement>(".molecule-stage");
    if (!toolbar || !stage) return;
    const toolbarRect = toolbar.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    positionMesoscaleControls(document.id, {
      left: toolbarRect.left - stageRect.left,
      top: toolbarRect.top - stageRect.top,
      width: toolbarRect.width,
      height: toolbarRect.height,
      visible: !collapsed,
    });
  };

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const stage = toolbar?.closest<HTMLElement>(".molecule-stage");
    if (!toolbar || !stage) return;
    const update = () => {
      if (position) {
        const next = clampToolbarPosition(toolbar, position);
        if (next.left !== position.left || next.top !== position.top) {
          setPosition(next);
          try { window.localStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify(next)); } catch { /* best-effort UI state */ }
          return;
        }
      }
      syncNativeControls();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    observer.observe(toolbar);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [collapsed, document.id, position, session?.status, session?.summary?.layout.left, session?.summary?.layout.right, session?.summary?.selectedCount]);

  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const toolbar = toolbarRef.current;
    const bounds = toolbar ? toolbarBounds(toolbar) : null;
    if (!toolbar || !bounds) return;
    const current = position ?? {
      left: bounds.toolbarRect.left - bounds.stageRect.left,
      top: bounds.toolbarRect.top - bounds.stageRect.top,
    };
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: current.left, top: current.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    toolbar.classList.add("dragging");
    event.preventDefault();
  };

  const onGripPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const toolbar = toolbarRef.current;
    if (!drag || !toolbar || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) drag.moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
    if (!drag.moved) return;
    const next = clampToolbarPosition(toolbar, {
      left: drag.left + event.clientX - drag.startX,
      top: drag.top + event.clientY - drag.startY,
    });
    positionRef.current = next;
    setPosition(next);
  };

  const finishGripDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    dragRef.current = null;
    toolbarRef.current?.classList.remove("dragging");
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const finalPosition = positionRef.current;
    positionRef.current = null;
    if (!moved || !finalPosition) return;
    suppressClickRef.current = true;
    try { window.localStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify(finalPosition)); } catch { /* best-effort UI state */ }
  };

  const cancelGripDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    positionRef.current = null;
    toolbarRef.current?.classList.remove("dragging");
    setPosition({ left: drag.left, top: drag.top });
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  const toggleCollapsed = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(TOOLBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch { /* best-effort UI state */ }
  };

  const toolbarStyle = position ? { left: position.left, top: position.top, right: "auto" } satisfies CSSProperties : undefined;

  return (
    <div ref={toolbarRef} style={toolbarStyle} className={`mesoscale-toolbar${collapsed ? " collapsed" : ""}`} role="toolbar" aria-label="Mesoscale preview controls">
      <div className="mesoscale-toolbar-content">
        <button
          type="button"
          className={`mesoscale-toolbar-letter${session?.summary?.layout.left ? " active" : ""}`}
          disabled={disabled}
          aria-pressed={session?.summary?.layout.left ?? false}
          onClick={() => toggleRegion("left")}
          title="Toggle Mol* left object tree"
          aria-label="Toggle Mol* left object tree"
        >L</button>
        <button
          type="button"
          className={`mesoscale-toolbar-letter${session?.summary?.layout.right ? " active" : ""}`}
          disabled={disabled}
          aria-pressed={session?.summary?.layout.right ?? false}
          onClick={() => toggleRegion("right")}
          title="Toggle Mol* right properties panel"
          aria-label="Toggle Mol* right properties panel"
        >R</button>
        <label className="mesoscale-toolbar-select">
          <span className="sr-only">Graphics quality</span>
          <select
            value={session?.summary?.graphics ?? "balanced"}
            disabled={disabled}
            onChange={(event) => run({ type: "setGraphics", graphics: event.target.value as MesoscaleGraphicsMode })}
          >
            {GRAPHICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <button
          type="button"
          className="mesoscale-toolbar-theme"
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
          onClick={() => actions.setPreference("theme", nextTheme)}
        >{nextTheme[0].toUpperCase() + nextTheme.slice(1)}</button>
      </div>
      <button
        type="button"
        className="mesoscale-toolbar-grip"
        aria-label={collapsed ? "Expand viewer toolbar" : "Collapse viewer toolbar"}
        title={`${collapsed ? "Expand controls" : "Collapse controls"} · drag to move`}
        aria-expanded={!collapsed}
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={finishGripDrag}
        onPointerCancel={cancelGripDrag}
        onClick={toggleCollapsed}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h2v2H8V5Zm6 0h2v2h-2V5ZM8 11h2v2H8v-2Zm6 0h2v2h-2v-2ZM8 17h2v2H8v-2Zm6 0h2v2h-2v-2Z" fill="currentColor" /></svg>
      </button>
      <MesoscaleViewportRail document={document} hidden={collapsed} />
    </div>
  );
}
