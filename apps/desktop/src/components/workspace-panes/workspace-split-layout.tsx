import { useLayoutEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore, type WorkspaceGroup } from "../../stores/workspace-panes-store";
import type { ShellActions, ShellViewState } from "../types";
import { EditorTabs } from "../editor-area/editor-tabs";
import { beginViewerLayoutGesture } from "../editor-area/viewer-frame";
import { ToolbarButton } from "../ui/toolbar-button";
import { Expand } from "../ui/app-icons";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { selectedGroupTab } from "./use-pane-tabs";
import "./workspace-panes.css";

function WorkspaceGroupHeader({ group, state, actions, tab }: {
  group: WorkspaceGroup; state: ShellViewState; actions: ShellActions; tab: MoleculeTab;
}) {
  return <div className="workspace-group-header" data-group={group}>
    <EditorTabs group={group} state={state} actions={actions} />
    <ShortcutTooltip label="Enter Full View"><ToolbarButton aria-label="Enter Full View" onClick={() => {
      actions.selectTab(tab.id);
      useWorkspacePanesStore.getState().setFullView(tab.id);
    }}><Expand size={16} aria-hidden /></ToolbarButton></ShortcutTooltip>
  </div>;
}

function publishWorkspaceSideWidth(shell: HTMLElement, width: number) {
  const value = `${width}px`;
  for (const chrome of shell.querySelectorAll<HTMLElement>(".topbar, .drag-region")) {
    if (chrome.style.getPropertyValue("--workspace-side-width") !== value) {
      chrome.style.setProperty("--workspace-side-width", value);
    }
  }
}

export function WorkspaceSplitLayout({ tabs, state, actions, children }: {
  tabs: MoleculeTab[]; state: ShellViewState; actions: ShellActions; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const endResize = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => endResize.current?.(), []);
  const closedGroups = useWorkspacePanesStore(store => store.closedGroups);
  const split = useWorkspacePanesStore(store => store.split);
  const fullViewTabId = useWorkspacePanesStore(store => store.fullViewTabId);
  const selectedTabs = useWorkspacePanesStore(store => store.selectedTabs);
  const visible = !fullViewTabId && state.page !== "settings";
  const right = visible && !closedGroups.right ? selectedGroupTab(tabs, state.activeTabId, selectedTabs, "right") : null;
  const bottom = visible && !closedGroups.bottom ? selectedGroupTab(tabs, state.activeTabId, selectedTabs, "bottom") : null;
  const sideGeometry = useRef({ width: 0, ratio: split.right });
  useLayoutEffect(() => {
    const shell = ref.current?.closest<HTMLElement>(".app-shell");
    if (!right || !shell) return;
    const geometry = sideGeometry.current;
    if (!endResize.current) geometry.ratio = split.right;
    publishWorkspaceSideWidth(shell, geometry.width * (1 - geometry.ratio));
  });
  useLayoutEffect(() => {
    const stack = ref.current;
    const shell = stack?.closest<HTMLElement>(".app-shell");
    if (!right || !stack || !shell) return;
    const observer = new ResizeObserver(([record]) => {
      const geometry = sideGeometry.current;
      geometry.width = record.contentRect.width;
      publishWorkspaceSideWidth(shell, geometry.width * (1 - geometry.ratio));
    });
    observer.observe(stack);
    return () => {
      observer.disconnect();
      for (const chrome of shell.querySelectorAll<HTMLElement>(".topbar, .drag-region")) {
        chrome.style.removeProperty("--workspace-side-width");
      }
    };
  }, [Boolean(right)]);
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
    const shell = stack.closest<HTMLElement>(".app-shell");
    handle.setPointerCapture(event.pointerId);
    const release = beginViewerLayoutGesture(shell ?? stack);
    const geometry = sideGeometry.current;
    geometry.width = bounds.width;
    let ratio = split[axis];
    let appliedRatio = ratio;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (appliedRatio === ratio) return;
      appliedRatio = ratio;
      stack.style.setProperty(`--split-${axis}`, `${ratio * 100}%`);
      if (axis === "right" && shell) {
        geometry.ratio = ratio;
        publishWorkspaceSideWidth(shell, geometry.width * (1 - ratio));
      }
    };
    const move = (pointer: globalThis.PointerEvent) => {
      ratio = Math.max(0.2, Math.min(0.8, axis === "right" ? (pointer.clientX - bounds.left) / bounds.width : (pointer.clientY - bounds.top) / bounds.height));
      if (!frame && ratio !== appliedRatio) frame = window.requestAnimationFrame(apply);
    };
    const end = () => {
      endResize.current = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      if (frame) window.cancelAnimationFrame(frame);
      apply();
      release();
      useWorkspacePanesStore.getState().setSplit(axis, ratio);
    };
    endResize.current = end;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end, { once: true });
    handle.addEventListener("pointercancel", end, { once: true });
    handle.addEventListener("lostpointercapture", end, { once: true });
  };
  return <div ref={ref} className="page-stack" data-split-right={Boolean(right) || undefined} data-split-bottom={Boolean(bottom) || undefined}
    style={{ "--split-right": `${split.right * 100}%`, "--split-bottom": `${split.bottom * 100}%` } as CSSProperties}>
    {children}
    {right && <WorkspaceGroupHeader group="right" state={state} actions={actions} tab={right} />}
    {bottom && <WorkspaceGroupHeader group="bottom" state={state} actions={actions} tab={bottom} />}
    {(["right", "bottom"] as const).filter(axis => axis === "right" ? right : bottom).map(axis => <div key={axis}
      className={`workspace-split-handle workspace-split-${axis}`} role="separator" tabIndex={0} aria-label={`Resize ${axis} split`}
      aria-orientation={axis === "right" ? "vertical" : "horizontal"} aria-valuenow={Math.round(split[axis] * 100)} aria-valuemin={20} aria-valuemax={80}
      onPointerDown={event => resize(event, axis)} onKeyDown={event => {
        const keys = axis === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        useWorkspacePanesStore.getState().setSplit(axis, split[axis] + (event.key === keys[0] ? -0.05 : 0.05));
      }} />)}
  </div>;
}
