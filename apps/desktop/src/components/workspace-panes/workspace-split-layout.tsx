import { useLayoutEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore, type WorkspaceGroup } from "../../stores/workspace-panes-store";
import type { ShellActions, ShellViewState } from "../types";
import { EditorTabs } from "../editor-area/editor-tabs";
import { beginViewerLayoutGesture } from "../editor-area/viewer-frame";
import { ToolbarButton } from "../ui/toolbar-button";
import { Expand, Collapse } from "../ui/app-icons";
import { ShortcutTooltip } from "../shortcut-tooltip";
import "./workspace-panes.css";

export function WorkspaceGroupHeader({ group, state, actions, tab }: {
  group: WorkspaceGroup; state: ShellViewState; actions: ShellActions; tab: MoleculeTab;
}) {
  return <div className="workspace-group-header">
    <EditorTabs group={group} state={state} actions={actions} />
    <ShortcutTooltip label="Enter Full View"><ToolbarButton aria-label="Enter Full View" onClick={() => {
      actions.selectTab(tab.id);
      useWorkspacePanesStore.getState().setFullView(tab.id);
    }}><Expand size={16} aria-hidden /></ToolbarButton></ShortcutTooltip>
  </div>;
}

export function WorkspaceSplitLayout({ tabs, state, actions, children }: {
  tabs: MoleculeTab[]; state: ShellViewState; actions: ShellActions; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const endResize = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => endResize.current?.(), []);
  const split = useWorkspacePanesStore(store => store.split);
  const fullViewTabId = useWorkspacePanesStore(store => store.fullViewTabId);
  const right = !fullViewTabId && tabs.some(tab => tab.pane === "right") && state.page !== "settings";
  const bottom = !fullViewTabId && tabs.some(tab => tab.pane === "bottom") && state.page !== "settings";
  useLayoutEffect(() => {
    const stack = ref.current;
    const shell = stack?.closest<HTMLElement>(".app-shell");
    if (!stack || !shell) return;
    const update = () => shell.style.setProperty("--workspace-side-width", right ? `${stack.clientWidth * (1 - split.right)}px` : "0px");
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stack);
    return () => { observer.disconnect(); shell.style.removeProperty("--workspace-side-width"); };
  }, [right, split.right]);
  useLayoutEffect(() => {
    if (!fullViewTabId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) useWorkspacePanesStore.getState().setFullView(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullViewTabId]);
  // A pointer entering an iframe does not bubble through React. Focus still
  // identifies that exact view, including multiple views of the same source.
  useLayoutEffect(() => {
    const focus = () => {
      requestAnimationFrame(() => {
        const frame = document.activeElement;
        const surface = frame?.closest<HTMLElement>(".page-surface[data-workspace-visible]");
        const id = surface?.dataset.viewId;
        if (id && id !== state.activeTabId) actions.selectTab(id);
      });
    };
    window.addEventListener("blur", focus);
    return () => window.removeEventListener("blur", focus);
  }, [actions, state.activeTabId]);

  const resize = (event: PointerEvent<HTMLDivElement>, axis: "right" | "bottom") => {
    if (event.button !== 0 || !ref.current) return;
    event.preventDefault();
    endResize.current?.();
    const handle = event.currentTarget;
    const stack = ref.current;
    const bounds = stack.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    const release = beginViewerLayoutGesture(stack.closest<HTMLElement>(".app-shell") ?? stack);
    let ratio = split[axis];
    const move = (pointer: globalThis.PointerEvent) => {
      ratio = Math.max(0.2, Math.min(0.8, axis === "right" ? (pointer.clientX - bounds.left) / bounds.width : (pointer.clientY - bounds.top) / bounds.height));
      stack.style.setProperty(`--split-${axis}`, `${ratio * 100}%`);
      if (axis === "right") stack.closest<HTMLElement>(".app-shell")?.style.setProperty("--workspace-side-width", `${bounds.width * (1 - ratio)}px`);
    };
    const end = () => {
      endResize.current = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("lostpointercapture", end);
      release();
      useWorkspacePanesStore.getState().setSplit(axis, ratio);
    };
    endResize.current = end;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", end, { once: true });
  };
  return <div ref={ref} className="page-stack" data-split-right={right || undefined} data-split-bottom={bottom || undefined}
    style={{ "--split-right": `${split.right * 100}%`, "--split-bottom": `${split.bottom * 100}%` } as CSSProperties}>
    {children}
    {(["right", "bottom"] as const).filter(axis => axis === "right" ? right : bottom).map(axis => <div key={axis}
      className={`workspace-split-handle workspace-split-${axis}`} role="separator" tabIndex={0} aria-label={`Resize ${axis} split`}
      aria-orientation={axis === "right" ? "vertical" : "horizontal"} aria-valuenow={Math.round(split[axis] * 100)} aria-valuemin={20} aria-valuemax={80}
      onPointerDown={event => resize(event, axis)} onKeyDown={event => {
        const keys = axis === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        useWorkspacePanesStore.getState().setSplit(axis, split[axis] + (event.key === keys[0] ? -0.05 : 0.05));
      }} />)}
    {fullViewTabId ? <div className="workspace-exit-full"><ShortcutTooltip label="Exit Full View"><ToolbarButton aria-label="Exit Full View" onClick={() => useWorkspacePanesStore.getState().setFullView(null)}><Collapse size={16} aria-hidden /></ToolbarButton></ShortcutTooltip></div> : null}
  </div>;
}
