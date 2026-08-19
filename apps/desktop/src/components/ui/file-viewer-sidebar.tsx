"use client";

import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

import {
  DEFAULT_FILE_VIEWER_SIDEBAR_WIDTH,
  type FileViewerSidebarCollapsible,
  type FileViewerSidebarSide,
  useFileViewerShell,
} from "./file-viewer-context";
import { useFileViewerSidebarController } from "./file-viewer-sidebar-controller";
import { Separator } from "./separator";

export type FileViewerSidebarProps = React.ComponentProps<"aside"> & {
  collapsible?: FileViewerSidebarCollapsible;
  innerClassName?: string;
  side?: FileViewerSidebarSide;
  width?: string;
};
export type FileViewerSidebarContentProps = React.ComponentProps<"div">;
export type FileViewerSidebarFooterProps = React.ComponentProps<"div">;
export type FileViewerSidebarHeaderProps = React.ComponentProps<"div">;
export type FileViewerSidebarRailProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
};
export type FileViewerSidebarSectionProps = React.ComponentProps<"section">;
export type FileViewerSidebarSectionActionProps =
  React.ComponentProps<"button"> & {
    asChild?: boolean;
  };
export type FileViewerSidebarSectionContentProps = React.ComponentProps<"div">;
export type FileViewerSidebarSectionHeaderProps = React.ComponentProps<"div">;
export type FileViewerSidebarSectionTitleProps = React.ComponentProps<"h3">;
export type FileViewerSidebarSeparatorProps = React.ComponentProps<
  typeof Separator
>;

export function FileViewerSidebar({
  children,
  className,
  collapsible,
  id,
  innerClassName,
  side,
  style,
  width = DEFAULT_FILE_VIEWER_SIDEBAR_WIDTH,
  ...props
}: FileViewerSidebarProps) {
  const sidebar = useFileViewerSidebarController({
    collapsible,
    id,
    side,
    style,
    width,
  });

  return (
    <div
      ref={sidebar.setSidebarGapElement}
      data-file-viewer-sidebar-collapsible={sidebar.resolvedCollapsible}
      data-file-viewer-sidebar-mode={sidebar.mode}
      data-file-viewer-sidebar-open={sidebar.isSidebarOpen ? "true" : "false"}
      data-file-viewer-sidebar-side={sidebar.resolvedSide}
      data-file-viewer-sidebar-state={sidebar.sidebarState}
      data-slot="file-viewer-sidebar-gap"
      className={cn(
        "group/file-viewer-sidebar z-30 min-h-0 min-w-0 shrink-0 overflow-hidden",
        sidebar.isInline
          ? "relative h-full"
          : "absolute inset-y-0 w-0 overflow-visible",
        sidebar.resolvedSide === "left" ? "order-first" : "order-last",
        !sidebar.isInline && sidebar.resolvedSide === "left" && "left-0",
        !sidebar.isInline && sidebar.resolvedSide === "right" && "right-0",
      )}
      style={
        {
          ...sidebar.customProperties,
        } as React.CSSProperties
      }
    >
      <aside
        ref={sidebar.setSidebarPanelElement}
        id={sidebar.sidebarId}
        data-file-viewer-sidebar-collapsible={sidebar.resolvedCollapsible}
        data-file-viewer-sidebar-mode={sidebar.mode}
        data-file-viewer-sidebar-open={sidebar.isSidebarOpen ? "true" : "false"}
        data-file-viewer-sidebar-side={sidebar.resolvedSide}
        data-file-viewer-sidebar-state={sidebar.sidebarState}
        data-slot="file-viewer-sidebar"
        className={cn(
          "bg-background absolute inset-y-0 flex min-w-0 flex-col overflow-hidden",
          sidebar.resolvedSide === "left"
            ? "right-0 border-r"
            : "left-0 border-l",
          !sidebar.isInline && "shadow-lg transition-transform ease-out",
          !sidebar.isInline &&
            !sidebar.isSidebarOpen &&
            sidebar.resolvedSide === "left" &&
            "-translate-x-full",
          !sidebar.isInline &&
            !sidebar.isSidebarOpen &&
            sidebar.resolvedSide === "right" &&
            "translate-x-full",
          className,
        )}
        style={sidebar.panelStyle}
        {...props}
        {...sidebar.accessibilityProps}
      >
        <FileViewerSidebarInner className={innerClassName}>
          {children}
        </FileViewerSidebarInner>
      </aside>
    </div>
  );
}

const FileViewerSidebarInner = React.memo(function FileViewerSidebarInner({
  children,
  className,
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="file-viewer-sidebar-inner"
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
});

export function FileViewerSidebarContent({
  className,
  ...props
}: FileViewerSidebarContentProps) {
  return (
    <div
      data-slot="file-viewer-sidebar-content"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-auto",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarHeader({
  className,
  ...props
}: FileViewerSidebarHeaderProps) {
  return (
    <div
      data-slot="file-viewer-sidebar-header"
      className={cn(
        "flex min-h-10 min-w-0 shrink-0 items-center gap-2 border-b px-3",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarFooter({
  className,
  ...props
}: FileViewerSidebarFooterProps) {
  return (
    <div
      data-slot="file-viewer-sidebar-footer"
      className={cn(
        "flex min-h-10 min-w-0 shrink-0 items-center gap-2 border-t px-3",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarRail({
  asChild = false,
  className,
  onClick,
  type = "button",
  ...props
}: FileViewerSidebarRailProps) {
  const Comp = asChild ? Slot.Root : "button";
  const sidebar = useFileViewerShell("FileViewerSidebarRail");

  return (
    <Comp
      aria-disabled={sidebar.canToggleSidebar ? undefined : true}
      aria-label="Toggle sidebar"
      data-file-viewer-sidebar-mode={sidebar.mode}
      data-file-viewer-sidebar-side={sidebar.side}
      data-file-viewer-sidebar-state={sidebar.sidebarState}
      data-side={sidebar.side}
      data-slot="file-viewer-sidebar-rail"
      type={asChild ? undefined : type}
      onClick={(event) => {
        if (!sidebar.canToggleSidebar) {
          event.preventDefault();
          return;
        }

        onClick?.(event as React.MouseEvent<HTMLButtonElement>);
        if (!event.defaultPrevented) {
          sidebar.toggleSidebar();
        }
      }}
      className={cn(
        "hover:bg-muted absolute inset-y-0 z-40 hidden w-2 transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2 md:block",
        sidebar.side === "left" ? "right-0" : "left-0",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarSection({
  className,
  ...props
}: FileViewerSidebarSectionProps) {
  return (
    <section
      data-slot="file-viewer-sidebar-section"
      className={cn("relative flex w-full min-w-0 flex-col p-3", className)}
      {...props}
    />
  );
}

export function FileViewerSidebarSectionHeader({
  className,
  ...props
}: FileViewerSidebarSectionHeaderProps) {
  return (
    <div
      data-slot="file-viewer-sidebar-section-header"
      className={cn(
        "flex min-h-8 min-w-0 shrink-0 items-center gap-2",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarSectionTitle({
  className,
  ...props
}: FileViewerSidebarSectionTitleProps) {
  return (
    <h3
      data-slot="file-viewer-sidebar-section-title"
      className={cn(
        "text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarSectionAction({
  asChild = false,
  className,
  type = "button",
  ...props
}: FileViewerSidebarSectionActionProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="file-viewer-sidebar-section-action"
      type={asChild ? undefined : type}
      className={cn(
        "ring-ring text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-md outline-hidden transition-[background-color,color,box-shadow] focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function FileViewerSidebarSectionContent({
  className,
  ...props
}: FileViewerSidebarSectionContentProps) {
  return (
    <div
      data-slot="file-viewer-sidebar-section-content"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

export function FileViewerSidebarSeparator({
  className,
  ...props
}: FileViewerSidebarSeparatorProps) {
  return (
    <Separator
      data-slot="file-viewer-sidebar-separator"
      className={cn("mx-3 w-auto", className)}
      {...props}
    />
  );
}
