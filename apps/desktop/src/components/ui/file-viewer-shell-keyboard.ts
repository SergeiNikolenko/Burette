"use client";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

import type { FileViewerElementRegistry } from "./file-viewer-elements";

export function shouldCloseFileViewerSidebarOnEscape({
  canToggleSidebar,
  event,
  isSidebarInteractive,
}: {
  canToggleSidebar: boolean;
  event: KeyboardEvent;
  isSidebarInteractive: boolean;
}) {
  return (
    canToggleSidebar &&
    isSidebarInteractive &&
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !event.repeat
  );
}

export function isFileViewerActiveElementInsideShell({
  activeElement,
  viewerShellElement,
}: {
  activeElement: Element | null;
  viewerShellElement: HTMLElement | null;
}) {
  return Boolean(
    activeElement &&
      viewerShellElement &&
      viewerShellElement.contains(activeElement),
  );
}

export function useFileViewerShellKeyboard({
  canToggleSidebar,
  closeSidebar,
  elementRegistry,
  isSidebarInteractive,
  isSidebarOverlayDismissible,
  viewerShellElement,
}: {
  canToggleSidebar: boolean;
  closeSidebar: () => void;
  elementRegistry: FileViewerElementRegistry;
  isSidebarInteractive: boolean;
  isSidebarOverlayDismissible: boolean;
  viewerShellElement: HTMLDivElement | null;
}) {
  useKeyedLayoutEffect(
    joinEffectKey([
      "file-viewer-escape-close",
      canToggleSidebar,
      closeSidebar,
      elementRegistry,
      isSidebarInteractive,
      viewerShellElement,
    ]),
    () => {
      const ownerDocument = viewerShellElement?.ownerDocument;
      if (!ownerDocument) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          !shouldCloseFileViewerSidebarOnEscape({
            canToggleSidebar,
            event,
            isSidebarInteractive,
          })
        ) {
          return;
        }

        if (
          !isFileViewerActiveElementInsideShell({
            activeElement: ownerDocument.activeElement,
            viewerShellElement:
              elementRegistry.getElements().viewerShellElement,
          })
        ) {
          return;
        }

        event.preventDefault();
        closeSidebar();
      };

      ownerDocument.addEventListener("keydown", handleKeyDown);
      return () => ownerDocument.removeEventListener("keydown", handleKeyDown);
    },
  );

  // An overlay sidebar floats above the document, so a pointer press anywhere
  // outside the panel (and its trigger, whose own click handles the toggle)
  // dismisses it — the same light-dismiss contract as a popover.
  useKeyedLayoutEffect(
    joinEffectKey([
      "file-viewer-overlay-dismiss",
      closeSidebar,
      elementRegistry,
      isSidebarOverlayDismissible,
      viewerShellElement,
    ]),
    () => {
      const ownerDocument = viewerShellElement?.ownerDocument;
      if (!ownerDocument || !isSidebarOverlayDismissible) return;

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const elements = elementRegistry.getElements();
        if (elements.sidebarElement?.contains(target)) return;
        if (elements.sidebarTriggerElement?.contains(target)) return;
        closeSidebar();
      };

      ownerDocument.addEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
      return () =>
        ownerDocument.removeEventListener("pointerdown", handlePointerDown, {
          capture: true,
        });
    },
  );
}
