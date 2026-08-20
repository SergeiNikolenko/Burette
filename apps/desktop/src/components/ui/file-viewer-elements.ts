"use client";

import type {
  FileViewerDocumentSurface,
  FileViewerMotionKernel,
} from "./file-viewer-motion-kernel";
import type { FileViewerMotionFrame } from "./file-viewer-motion-plan";

export const FILE_VIEWER_BEFORE_LAYOUT_MOTION_EVENT =
  "file-viewer:before-layout-motion";

// The kernel dispatches the before-layout-motion event as a CustomEvent whose
// detail is its LIVE interactive frame, so renderers can capture pre-commit
// anchors against what is actually on screen (a mid-flight retarget sees the
// settled layout plus the in-flight transform).
export function readFileViewerBeforeLayoutMotionFrame(
  event: Event,
): FileViewerMotionFrame | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  return detail != null && typeof detail === "object"
    ? (detail as FileViewerMotionFrame)
    : null;
}

export type FileViewerElements = {
  documentSurfaceElement: HTMLElement | null;
  getDocumentSurfaceMotionProbeElement: (() => HTMLElement | null) | null;
  sidebarElement: HTMLElement | null;
  sidebarGapElement: HTMLDivElement | null;
  sidebarTriggerElement: HTMLElement | null;
  viewerShellElement: HTMLDivElement | null;
};

export type FileViewerElementRegistry = {
  getElements: () => FileViewerElements;
  registerDocumentSurface: (surface: FileViewerDocumentSurface) => () => void;
  registerSidebarElement: (element: HTMLElement | null) => void;
  registerSidebarGapElement: (element: HTMLDivElement | null) => void;
  registerSidebarTriggerElement: (element: HTMLElement | null) => void;
  registerViewerShellElement: (element: HTMLDivElement | null) => void;
};

export function createFileViewerElementRegistry({
  motionKernel,
  onViewerShellElementChange,
}: {
  motionKernel: FileViewerMotionKernel;
  onViewerShellElementChange: (element: HTMLDivElement | null) => void;
}): FileViewerElementRegistry {
  const elements: FileViewerElements = {
    documentSurfaceElement: null,
    getDocumentSurfaceMotionProbeElement: null,
    sidebarElement: null,
    sidebarGapElement: null,
    sidebarTriggerElement: null,
    viewerShellElement: null,
  };
  let documentSurfaceRegistration = 0;

  return {
    getElements: () => elements,
    registerDocumentSurface: (surface) => {
      documentSurfaceRegistration += 1;
      const registration = documentSurfaceRegistration;
      elements.documentSurfaceElement = surface.element;
      elements.getDocumentSurfaceMotionProbeElement =
        surface.getMotionProbeElement ?? null;
      motionKernel.setDocumentSurface(surface);
      return () => {
        if (documentSurfaceRegistration !== registration) return;
        elements.documentSurfaceElement = null;
        elements.getDocumentSurfaceMotionProbeElement = null;
        motionKernel.setDocumentSurface(null);
      };
    },
    registerSidebarElement: (element) => {
      if (elements.sidebarElement === element) return;
      elements.sidebarElement = element;
    },
    registerSidebarGapElement: (element) => {
      if (elements.sidebarGapElement === element) return;
      elements.sidebarGapElement = element;
      motionKernel.setSidebarGapElement(element);
    },
    registerSidebarTriggerElement: (element) => {
      elements.sidebarTriggerElement = element;
    },
    registerViewerShellElement: (element) => {
      if (elements.viewerShellElement === element) return;
      elements.viewerShellElement = element;
      onViewerShellElementChange(element);
    },
  };
}
