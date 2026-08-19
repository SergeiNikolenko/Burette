"use client";

import type { FileViewerSidebarCollapsible } from "./file-viewer-context";
import type { FileViewerElements } from "./file-viewer-elements";

export type FileViewerSidebarAccessibilityProps = {
  "aria-hidden"?: true;
  inert?: true;
};

export type FileViewerSidebarTriggerAccessibilityProps = {
  "aria-controls"?: string;
  "aria-disabled"?: true;
  "aria-expanded"?: boolean;
  "aria-label": string;
};

const visibleSidebarAccessibilityProps = {};
const hiddenSidebarAccessibilityProps = {
  "aria-hidden": true,
  inert: true,
} as const;

export function resolveFileViewerSidebarAccessibilityProps({
  collapsible,
  deferInert,
  isSidebarInteractive,
}: {
  collapsible: FileViewerSidebarCollapsible;
  deferInert?: boolean;
  isSidebarInteractive: boolean;
}): FileViewerSidebarAccessibilityProps {
  if (collapsible === "none" || isSidebarInteractive) {
    return visibleSidebarAccessibilityProps;
  }

  if (deferInert) {
    return {
      "aria-hidden": true,
    };
  }

  return hiddenSidebarAccessibilityProps;
}

export function resolveFileViewerSidebarTriggerAccessibilityProps({
  ariaLabel,
  canToggleSidebar,
  isDisabled,
  isSidebarInteractive,
  sidebarId,
}: {
  ariaLabel: string;
  canToggleSidebar: boolean;
  isDisabled: boolean;
  isSidebarInteractive: boolean;
  sidebarId: string;
}): FileViewerSidebarTriggerAccessibilityProps {
  return {
    "aria-controls": canToggleSidebar ? sidebarId : undefined,
    "aria-disabled": isDisabled ? true : undefined,
    // Deliberately tracks interactivity, not the requested state: while the
    // panel slides open it is still inert, and announcing "expanded" would
    // point assistive tech at a region that cannot yet be used.
    "aria-expanded": canToggleSidebar ? isSidebarInteractive : undefined,
    "aria-label": ariaLabel,
  };
}

export function restoreFileViewerSidebarFocusOnClose({
  elements,
  isSidebarInteractive,
  previousIsSidebarInteractive,
}: {
  elements: FileViewerElements;
  isSidebarInteractive: boolean;
  previousIsSidebarInteractive: boolean;
}) {
  if (isSidebarInteractive || !previousIsSidebarInteractive) return;
  if (!elements.sidebarElement || !elements.sidebarTriggerElement) return;

  const ownerWindow = elements.sidebarElement.ownerDocument.defaultView;
  const activeElement = elements.sidebarElement.ownerDocument.activeElement;
  if (
    ownerWindow &&
    activeElement instanceof ownerWindow.HTMLElement &&
    elements.sidebarElement.contains(activeElement)
  ) {
    elements.sidebarTriggerElement.focus({ preventScroll: true });
  }
}
