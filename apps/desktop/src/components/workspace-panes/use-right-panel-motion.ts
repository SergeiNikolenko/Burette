import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { MoleculeTab } from "../../stores/molecule-store";
import { beginViewerLayoutGesture } from "../editor-area/viewer-frame";

// Matches the bottom dock's toggle (styles.css, .workbench-main-panels).
const DURATION_MS = 150;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

type Motion = {
  animations: Animation[];
  from: number;
  to: number;
  release: () => void;
  leavingSurface: HTMLElement | null;
  // A finished close holds its last frame until React drops the split layout.
  awaitingUnmount: boolean;
};

// Opening or closing the right group slides it instead of snapping. The main
// views shrink or grow with their WebGL canvases held, as for the sidebar; the
// right group keeps its final width and moves in from the edge, so its content
// is laid out once rather than on every frame. A closing group stays on screen
// (`leaving`) until it has slid out. Toggling mid-flight reverses from the
// current position. `fraction` reports how far the group is open, 0 to 1, for
// chrome that follows its edge.
export function useRightPanelMotion(stackRef: RefObject<HTMLDivElement | null>, right: MoleculeTab | null, visible: boolean, ratio: number, onFrame: (fraction: number) => void) {
  const [leaving, setLeaving] = useState<MoleculeTab | null>(null);
  const previous = useRef<{ right: MoleculeTab | null; visible: boolean } | null>(null);
  const motion = useRef<Motion | null>(null);
  const pending = useRef<{ from: number; to: number; leavingId: string | null } | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const fraction = useCallback(() => {
    const current = motion.current;
    if (!current) return 1;
    const progress = current.animations[0]?.effect?.getComputedTiming().progress;
    return current.from + (current.to - current.from) * (typeof progress === "number" ? progress : 1);
  }, []);

  const stop = useCallback(() => {
    const current = motion.current;
    if (!current) return;
    motion.current = null;
    for (const animation of current.animations) animation.cancel();
    current.leavingSurface?.removeAttribute("data-pane-leaving");
    current.release();
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { right, visible };
    if (!visible) {
      stop();
      setLeaving(null);
      return;
    }
    if (!last || Boolean(last.right) === Boolean(right)) return;
    const stack = stackRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!stack || !last.visible || reduced) {
      stop();
      setLeaving(null);
      return;
    }
    const from = motion.current ? fraction() : right ? 0 : 1;
    stop();
    if (right) {
      setLeaving(null);
      pending.current = { from, to: 1, leavingId: null };
      return;
    }
    // A closed tab's surface is gone; there is nothing left to slide out.
    if (!stack.querySelector(`:scope > .page-surface[data-view-id="${CSS.escape(last.right!.id)}"]`)) return;
    pending.current = { from, to: 0, leavingId: last.right!.id };
    setLeaving(last.right);
  }, [right, visible, stackRef, stop, fraction]);

  const displayed = right ?? leaving;
  useLayoutEffect(() => {
    const current = motion.current;
    if (current?.awaitingUnmount && !leaving) stop();
    const request = pending.current;
    const stack = stackRef.current;
    if (!request || !stack || !displayed || (request.to === 0) !== Boolean(leaving)) return;
    pending.current = null;
    const shell = stack.closest<HTMLElement>(".app-shell") ?? stack;
    const side = stack.clientWidth * (1 - ratio);
    const leavingSurface = request.leavingId
      ? stack.querySelector<HTMLElement>(`:scope > .page-surface[data-view-id="${CSS.escape(request.leavingId)}"]`)
      : null;
    leavingSurface?.setAttribute("data-pane-leaving", "");
    // Hidden pages keep their CSS bounds; resizing their iframes per frame
    // would only cost layout nobody sees.
    const shrinking = stack.querySelectorAll<HTMLElement>([
      ":scope > .page-surface:not([data-pane])[data-workspace-visible]",
      ":scope > .page-surface[data-pane=\"bottom\"][data-workspace-visible]",
      ":scope > .workspace-group-header[data-group=\"bottom\"]",
      ":scope > .workspace-split-bottom",
    ].join(", "));
    const sliding = stack.querySelectorAll<HTMLElement>([
      ":scope > .page-surface[data-pane=\"right\"][data-workspace-visible]",
      ":scope > .page-surface[data-pane-leaving]",
      ":scope > .workspace-group-header[data-group=\"right\"]",
      ":scope > .workspace-split-right",
    ].join(", "));
    const timing: KeyframeAnimationOptions = { duration: DURATION_MS * Math.abs(request.to - request.from), easing: EASING, fill: "forwards" };
    const at = (value: number) => `${Math.round(side * value)}px`;
    const animations = [
      ...Array.from(shrinking, element => element.animate([{ right: at(request.from) }, { right: at(request.to) }], timing)),
      ...Array.from(sliding, element => element.animate([
        { transform: `translateX(${at(1 - request.from)})` },
        { transform: `translateX(${at(1 - request.to)})` },
      ], timing)),
    ];
    const next: Motion = { animations, from: request.from, to: request.to, release: beginViewerLayoutGesture(shell), leavingSurface, awaitingUnmount: false };
    motion.current = next;
    onFrameRef.current(request.from);
    const follow = () => {
      if (motion.current !== next) return;
      onFrameRef.current(fraction());
      if (animations[0]?.playState === "running") requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (motion.current !== next) return;
      onFrameRef.current(request.to);
      // The canvases draw at their final size as soon as the panel stops.
      next.release();
      next.release = () => {};
      if (request.to === 1) stop();
      else {
        next.awaitingUnmount = true;
        setLeaving(null);
      }
    }, () => {
      if (motion.current !== next) return;
      stop();
      setLeaving(null);
    });
  });
  useLayoutEffect(() => stop, [stop]);
  return { displayed, fraction, stop, leaving: Boolean(leaving) };
}
