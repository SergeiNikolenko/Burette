import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { DockArea } from "../lib/dock";

const SIDEBAR_DRAG_CLOSE_WIDTH = 180;
const RIGHT_DOCK_CLOSE_THRESHOLD = 180;
const BOTTOM_DOCK_CLOSE_THRESHOLD = 120;

type UseAppResizeArgs = {
  bottomDockHeight: number;
  closeSidebar: () => void;
  rightDockWidth: number;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setDockSize: (area: DockArea, size: number) => void;
  setSidebarWidth: (width: number) => void;
  sidebarWidth: number;
};

export function useAppResize({
  bottomDockHeight,
  closeSidebar,
  rightDockWidth,
  setDockOpen,
  setDockSize,
  setSidebarWidth,
  sidebarWidth,
}: UseAppResizeArgs) {
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [rightDockDragging, setRightDockDragging] = useState(false);
  const [bottomDockDragging, setBottomDockDragging] = useState(false);

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSidebarDragging(true);
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      let didCloseSidebar = false;
      let didStop = false;
      const stop = () => {
        if (didStop) return;
        didStop = true;
        setSidebarDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        try {
          if (resizeTarget.hasPointerCapture(pointerId)) {
            resizeTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // The pointer may already be gone if the native window lost focus.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeTarget.removeEventListener("lostpointercapture", stop);
      };
      const onVisibilityChange = () => {
        if (document.hidden) stop();
      };
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
        const nextWidth = startWidth + move.clientX - startX;
        if (nextWidth < SIDEBAR_DRAG_CLOSE_WIDTH) {
          if (!didCloseSidebar) {
            didCloseSidebar = true;
            closeSidebar();
          }
          stop();
          return;
        }
        setSidebarWidth(nextWidth);
      };
      try {
        resizeTarget.setPointerCapture(pointerId);
      } catch {
        // Keep the window-level fallback listeners active if capture is unavailable.
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      document.addEventListener("visibilitychange", onVisibilityChange);
      resizeTarget.addEventListener("lostpointercapture", stop);
    },
    [closeSidebar, setSidebarWidth, sidebarWidth],
  );

  const startRightDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setRightDockDragging(true);
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = rightDockWidth;
      let closedByDrag = false;
      let didStop = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
        const nextWidth = startWidth + startX - move.clientX;
        if (nextWidth <= RIGHT_DOCK_CLOSE_THRESHOLD) {
          if (!closedByDrag) {
            closedByDrag = true;
            setDockOpen("right", false);
          }
          return;
        }
        if (closedByDrag) {
          closedByDrag = false;
          setDockOpen("right", true);
        }
        setDockSize("right", nextWidth);
      };
      const stop = () => {
        if (didStop) return;
        didStop = true;
        setRightDockDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        try {
          if (resizeTarget.hasPointerCapture(pointerId)) {
            resizeTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // The pointer may already be gone if the native window lost focus.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeTarget.removeEventListener("lostpointercapture", stop);
      };
      const onVisibilityChange = () => {
        if (document.hidden) stop();
      };
      try {
        resizeTarget.setPointerCapture(pointerId);
      } catch {
        // Keep the window-level fallback listeners active if capture is unavailable.
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      document.addEventListener("visibilitychange", onVisibilityChange);
      resizeTarget.addEventListener("lostpointercapture", stop);
    },
    [rightDockWidth, setDockOpen, setDockSize],
  );

  const startBottomDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setBottomDockDragging(true);
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = bottomDockHeight;
      let closedByDrag = false;
      let didStop = false;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.documentElement.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        if (move.buttons === 0) {
          stop();
          return;
        }
        const nextHeight = startHeight + startY - move.clientY;
        if (nextHeight <= BOTTOM_DOCK_CLOSE_THRESHOLD) {
          if (!closedByDrag) {
            closedByDrag = true;
            setDockOpen("bottom", false);
          }
          return;
        }
        if (closedByDrag) {
          closedByDrag = false;
          setDockOpen("bottom", true);
        }
        setDockSize("bottom", nextHeight);
      };
      const stop = () => {
        if (didStop) return;
        didStop = true;
        setBottomDockDragging(false);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        try {
          if (resizeTarget.hasPointerCapture(pointerId)) {
            resizeTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // The pointer may already be gone if the native window lost focus.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeTarget.removeEventListener("lostpointercapture", stop);
      };
      const onVisibilityChange = () => {
        if (document.hidden) stop();
      };
      try {
        resizeTarget.setPointerCapture(pointerId);
      } catch {
        // Keep the window-level fallback listeners active if capture is unavailable.
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      document.addEventListener("visibilitychange", onVisibilityChange);
      resizeTarget.addEventListener("lostpointercapture", stop);
    },
    [bottomDockHeight, setDockOpen, setDockSize],
  );

  return {
    bottomDockDragging,
    rightDockDragging,
    sidebarDragging,
    startBottomDockResize,
    startRightDockResize,
    startSidebarResize,
  };
}
