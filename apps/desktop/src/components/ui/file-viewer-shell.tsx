"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import {
  FileViewerShellStaticContext,
  FileViewerSidebarDynamicContext,
  type FileViewerSidebarRequestedMode,
} from "./file-viewer-context";
import {
  FILE_VIEWER_INLINE_BREAKPOINT,
  useFileViewerShellController,
} from "./file-viewer-shell-controller";

export type FileViewerLayout = "fill" | "intrinsic";

export type FileViewerProps = React.ComponentProps<"div"> & {
  inlineBreakpoint?: number;
  layout?: FileViewerLayout;
  sidebarMode?: FileViewerSidebarRequestedMode;
};

export function FileViewer({
  children,
  className,
  inlineBreakpoint = FILE_VIEWER_INLINE_BREAKPOINT,
  layout = "fill",
  sidebarMode = "auto",
  style,
  ...props
}: FileViewerProps) {
  const controller = useFileViewerShellController({
    inlineBreakpoint,
    sidebarMode,
  });

  return (
    <FileViewerShellStaticContext.Provider
      value={controller.shellStaticContext}
    >
      <FileViewerSidebarDynamicContext.Provider
        value={controller.sidebarDynamicContext}
      >
        <div
          ref={controller.setRootElement}
          data-file-viewer="root"
          data-file-viewer-header-mode={controller.headerMode}
          data-file-viewer-layout={layout}
          data-file-viewer-resource-category={controller.resourceCategory}
          data-file-viewer-sidebar-collapsible={controller.effectiveCollapsible}
          data-file-viewer-sidebar-mode={controller.mode}
          data-file-viewer-sidebar-open={
            controller.isSidebarOpen ? "true" : "false"
          }
          data-file-viewer-sidebar-side={controller.side}
          data-file-viewer-sidebar-state={controller.sidebarState}
          data-slot="file-viewer-root"
          id={controller.rootId}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
            layout === "fill" && "h-full w-full flex-1",
            className,
          )}
          style={
            {
              overflowAnchor: "none",
              ...style,
            } as React.CSSProperties
          }
          {...props}
        >
          {children}
        </div>
      </FileViewerSidebarDynamicContext.Provider>
    </FileViewerShellStaticContext.Provider>
  );
}
