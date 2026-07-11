import { useCallback, useEffect, useRef, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { DropTargetContext } from "../../lib/drop-actions";
import { describeDropTargetElement, type DropTargetDescriptor } from "../../lib/drop-target";
import {
  structureDragMovementExceedsThreshold,
  writeStructureDragPayload,
  type StructureDragPayload,
  type StructureDragPoint,
} from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import type { ShellActions, ShellViewState } from "../types";

type SidebarMouseDrag = {
  start: StructureDragPoint;
  active: boolean;
  nativeDragStarted: boolean;
};

type SidebarStructureDragOptions = {
  actions: ShellActions;
  disabled?: boolean;
  getPayload: () => StructureDragPayload | null;
  state: ShellViewState;
};

type SidebarDropTarget = DropTargetContext | Extract<DropTargetDescriptor, { kind: "dock" }>;

export function useSidebarStructureDrag({
  actions,
  disabled = false,
  getPayload,
  state,
}: SidebarStructureDragOptions) {
  const setStructureDragActive = actions.setStructureDragActive;
  const mouseDragRef = useRef<SidebarMouseDrag | null>(null);
  const removeMouseListenersRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  const finishDrag = useCallback(() => {
    removeMouseListenersRef.current?.();
    removeMouseListenersRef.current = null;
    mouseDragRef.current = null;
    setStructureDragActive(false);
  }, [setStructureDragActive]);

  useEffect(() => finishDrag, [finishDrag]);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (disabled || event.defaultPrevented || event.button !== 0) return;
    const interactiveTarget = event.target instanceof Element
      ? event.target.closest("button, input, select, textarea, [contenteditable='true']")
      : null;
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;

    finishDrag();
    suppressClickRef.current = false;
    mouseDragRef.current = {
      start: { x: event.clientX, y: event.clientY },
      active: false,
      nativeDragStarted: false,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (!drag || drag.nativeDragStarted) return;
      if ((moveEvent.buttons & 1) !== 1) {
        finishDrag();
        return;
      }
      if (!drag.active && structureDragMovementExceedsThreshold(drag.start, {
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      })) {
        drag.active = true;
        setStructureDragActive(true);
      }
      if (drag.active) moveEvent.preventDefault();
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (drag?.active && !drag.nativeDragStarted) {
        const payload = getPayload();
        if (payload) {
          suppressClickRef.current = true;
          runSidebarDropAtPoint(payload, upEvent.clientX, upEvent.clientY, state, actions);
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }
      }
      finishDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    removeMouseListenersRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [actions, disabled, finishDrag, getPayload, setStructureDragActive, state]);

  const onDragStart = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const payload = getPayload();
    if (!payload || !writeStructureDragPayload(event.dataTransfer, payload)) {
      event.preventDefault();
      finishDrag();
      return;
    }
    if (mouseDragRef.current) mouseDragRef.current.nativeDragStarted = true;
    setStructureDragActive(true);
  }, [finishDrag, getPayload, setStructureDragActive]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  return {
    onClickCapture,
    onDragEnd: finishDrag,
    onDragStart,
    onMouseDown,
  };
}

function runSidebarDropAtPoint(
  payload: StructureDragPayload,
  clientX: number,
  clientY: number,
  state: ShellViewState,
  actions: ShellActions,
) {
  if (typeof document === "undefined" || (clientX <= 0 && clientY <= 0)) return false;
  const target = sidebarDropTarget(document.elementFromPoint(clientX, clientY), state);
  if (target.kind === "dock") {
    void actions.openDockPayload({ area: target.area, tabKind: target.tabKind, payload });
    return true;
  }
  const choices = shellDropActionChoices(payload, target, { kind: "sidebar" });
  return runShellDropActionChoices(actions, payload, choices, { x: clientX, y: clientY });
}

function sidebarDropTarget(element: Element | null, state: ShellViewState): SidebarDropTarget {
  const descriptor = describeDropTargetElement(element);
  if (descriptor?.kind === "dock") return descriptor;
  if (descriptor?.kind === "document") {
    const targetDocument = state.documents.find((candidate) => (
      (descriptor.documentId !== null && candidate.id === descriptor.documentId)
      || candidate.path === descriptor.documentPath
    ));
    return {
      kind: "active-viewer",
      documentId: targetDocument?.id ?? descriptor.documentId,
      documentPath: targetDocument?.path ?? descriptor.documentPath,
      renderer: descriptor.renderer ?? targetDocument?.renderer ?? null,
      dockingRequest: targetDocument?.dockingRequest ?? null,
    };
  }
  if (descriptor) return descriptor;
  if (element?.closest(".molecule-stage, .main-stage")) {
    if (state.activeTab?.location.kind === "ketcher") return { kind: "ketcher" };
    if (state.activeDocument) {
      return {
        kind: "active-viewer",
        documentId: state.activeDocument.id,
        documentPath: state.activeDocument.path,
        renderer: state.activeDocument.renderer,
        dockingRequest: state.activeDocument.dockingRequest ?? null,
      };
    }
  }
  return { kind: "workspace" };
}
