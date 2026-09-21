"use client";

import * as React from "react";

import type { FileCategory } from "@/lib/viewer-source";
import type { FileViewerElementRegistry } from "./file-viewer-elements";
import type { FileViewerMotionKernel } from "./file-viewer-motion-kernel";

export type FileViewerSidebarMode = "inline" | "overlay";
export type FileViewerSidebarRequestedMode = "auto" | FileViewerSidebarMode;
export type FileViewerSidebarState = "expanded" | "collapsed";
export type FileViewerSidebarSide = "left" | "right";
export type FileViewerSidebarCollapsible = "offcanvas" | "none";

export type FileViewerHeaderMode = "inline" | "outlets";

export const DEFAULT_FILE_VIEWER_SIDEBAR_WIDTH = "10rem";

export type FileViewerSetSidebarOpen = (
  value: boolean | ((isSidebarOpen: boolean) => boolean),
) => void;

export type FileViewerSidebarOpenProps = {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export type FileViewerContextValue = {
  headerMode: FileViewerHeaderMode;
  hasHeaderOutlets: boolean;
  isInsideFileViewer: boolean;
  resourceCategory: FileCategory;
  sidebarOpenProps: FileViewerSidebarOpenProps;
};

export type FileViewerSidebarRegistration = {
  collapsible: FileViewerSidebarCollapsible;
  id: string;
  side: FileViewerSidebarSide;
  width: string;
  widthPixels: number;
};

export type FileViewerSidebarValue = {
  canToggleSidebar: boolean;
  isSidebarInteractive: boolean;
  isSidebarOpen: boolean;
  mode: FileViewerSidebarMode;
  side: FileViewerSidebarSide;
  sidebarId: string;
  sidebarState: FileViewerSidebarState;
  setSidebarOpen: FileViewerSetSidebarOpen;
  toggleSidebar: () => void;
};

export type FileViewerShellStaticContextValue = {
  canToggleSidebar: boolean;
  collapsible: FileViewerSidebarCollapsible;
  elementRegistry: FileViewerElementRegistry;
  mode: FileViewerSidebarMode;
  motionDurationMs: number;
  motionKernel: FileViewerMotionKernel;
  registerSidebar: (registration: FileViewerSidebarRegistration) => () => void;
  rootId: string;
  setSidebarOpen: FileViewerSetSidebarOpen;
  side: FileViewerSidebarSide;
  sidebarId: string;
  sidebarWidth: string;
  toggleSidebar: () => void;
};

export type FileViewerSidebarDynamicContextValue = {
  isSidebarInteractive: boolean;
  isSidebarOpen: boolean;
  isSidebarTransitioning: boolean;
  sidebarState: FileViewerSidebarState;
};

export const FileViewerContext = React.createContext<FileViewerContextValue>({
  headerMode: "inline",
  hasHeaderOutlets: false,
  isInsideFileViewer: false,
  resourceCategory: "unsupported",
  sidebarOpenProps: {},
});

export const FileViewerShellStaticContext =
  React.createContext<FileViewerShellStaticContextValue | null>(null);

export const FileViewerSidebarDynamicContext =
  React.createContext<FileViewerSidebarDynamicContextValue | null>(null);

export function useFileViewerContext() {
  return React.useContext(FileViewerContext);
}

export function useOptionalFileViewerShellStatic() {
  return React.useContext(FileViewerShellStaticContext);
}

export function useFileViewerShellStatic(consumer: string) {
  const context = React.useContext(FileViewerShellStaticContext);
  if (!context) {
    throw new Error(`${consumer} must be rendered inside FileViewer.`);
  }
  return context;
}

export function useOptionalFileViewerShell() {
  const staticContext = React.useContext(FileViewerShellStaticContext);
  const sidebarContext = React.useContext(FileViewerSidebarDynamicContext);

  return React.useMemo(
    () =>
      staticContext && sidebarContext
        ? { ...staticContext, ...sidebarContext }
        : null,
    [sidebarContext, staticContext],
  );
}

export function useFileViewerShell(consumer: string) {
  const context = useOptionalFileViewerShell();
  if (!context) {
    throw new Error(`${consumer} must be rendered inside FileViewer.`);
  }
  return context;
}

export function useFileViewerSidebar(): FileViewerSidebarValue {
  const fileViewerContext = React.useContext(FileViewerContext);
  const shellContext = useOptionalFileViewerShell();

  if (!fileViewerContext.isInsideFileViewer || !shellContext) {
    throw new Error("useFileViewerSidebar must be used within FileViewer.");
  }

  return shellContext;
}
