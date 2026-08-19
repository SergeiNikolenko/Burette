"use client";

import * as React from "react";
import { PanelLeft, PanelRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Spinner } from "./spinner";
import { useFileViewerControlsState } from "./file-viewer-provider";
import { useFileViewerRequiredResourceState } from "./file-viewer-resource-state";
import {
  useFileViewerContext,
  useFileViewerShell,
} from "./file-viewer-context";
import { resolveFileViewerSidebarTriggerAccessibilityProps } from "./file-viewer-accessibility";
import { ViewerControls } from "./viewer-controls";
import { ViewerHeaderOutlet } from "./viewer-header-outlet";

type ButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
};

export type FileViewerHeaderProps = React.ComponentProps<"div">;
export type FileViewerTitleProps = React.ComponentProps<"span">;
export type FileViewerMetaProps = React.ComponentProps<"span"> & {
  visibility?: "responsive" | "visible";
};
export type FileViewerControlsProps = Omit<
  React.ComponentProps<typeof ViewerControls>,
  | "downloads"
  | "loading"
  | "position"
  | "rotate"
  | "subtitle"
  | "title"
  | "zoom"
>;
export type FileViewerSidebarTriggerProps = ButtonProps;

export function FileViewerHeader({
  children,
  className,
  ...props
}: FileViewerHeaderProps) {
  const { hasHeaderOutlets, headerMode } = useFileViewerContext();
  const content = children ?? <FileViewerDefaultHeaderContent />;

  if (headerMode === "outlets" && hasHeaderOutlets) {
    return <>{content}</>;
  }

  return (
    <div
      data-slot="file-viewer-header"
      className={cn(
        "bg-card flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1 sm:flex-nowrap sm:py-0",
        className,
      )}
      {...props}
    >
      {content}
    </div>
  );
}

function FileViewerDefaultHeaderContent() {
  const { hasHeaderOutlets, headerMode } = useFileViewerContext();

  if (headerMode === "outlets" && hasHeaderOutlets) {
    return (
      <>
        <FileViewerTitle />
        <FileViewerMeta />
        <FileViewerControls />
      </>
    );
  }

  return (
    <>
      <div
        data-slot="file-viewer-header-title-group"
        className="flex min-w-0 flex-1 items-baseline gap-2"
      >
        <FileViewerTitle />
        <FileViewerMeta />
      </div>
      <FileViewerControls />
    </>
  );
}

export function FileViewerTitle({ className, ...props }: FileViewerTitleProps) {
  const { hasHeaderOutlets, headerMode } = useFileViewerContext();
  const { descriptor } = useFileViewerRequiredResourceState();
  const title = (
    <span
      data-slot="file-viewer-title"
      className={cn(
        "text-foreground min-w-0 truncate text-[13px] leading-5 font-medium",
        className,
      )}
      title={descriptor.displayName}
      {...props}
    >
      {descriptor.displayName}
    </span>
  );

  if (headerMode === "outlets" && hasHeaderOutlets) {
    return <ViewerHeaderOutlet name="titleGroup">{title}</ViewerHeaderOutlet>;
  }

  return title;
}

export function FileViewerMeta({
  className,
  visibility = "responsive",
  ...props
}: FileViewerMetaProps) {
  const { hasHeaderOutlets, headerMode } = useFileViewerContext();
  const { descriptor, resource } = useFileViewerRequiredResourceState();
  const metaText =
    resource.mimeType || descriptor.mimeType || descriptor.category;

  if (!metaText) return null;

  const meta = (
    <span
      data-slot="file-viewer-meta"
      className={cn(
        "text-muted-foreground min-w-0 shrink truncate text-xs",
        visibility === "responsive" && "hidden sm:inline",
        className,
      )}
      {...props}
    >
      {metaText}
    </span>
  );

  if (headerMode === "outlets" && hasHeaderOutlets) {
    return <ViewerHeaderOutlet name="titleGroup">{meta}</ViewerHeaderOutlet>;
  }

  return meta;
}

export function FileViewerControls({
  className,
  extra,
  ...props
}: FileViewerControlsProps) {
  const { resource } = useFileViewerRequiredResourceState();
  const controlsState = useFileViewerControlsState();
  const downloads = controlsState?.downloads ?? [resource.originalDownload];
  const { hasHeaderOutlets, headerMode } = useFileViewerContext();

  const controls = (
    <ViewerControls
      {...props}
      data-file-viewer-controls={controlsState ? "ready" : "idle"}
      data-slot="file-viewer-controls"
      className={cn(
        "ms-auto h-8 min-w-0 border-b-0 bg-transparent px-0",
        className,
      )}
      downloads={downloads}
      extra={extra ?? controlsState?.extra}
      loading={controlsState?.loading ?? false}
      position={controlsState?.position ?? null}
      rotate={controlsState?.rotate ?? null}
      zoom={controlsState?.zoom ?? null}
    />
  );

  if (headerMode === "outlets" && hasHeaderOutlets) {
    return <ViewerHeaderOutlet name="controls">{controls}</ViewerHeaderOutlet>;
  }

  return controls;
}

export function FileViewerSidebarTrigger({
  className,
  disabled,
  loading,
  onClick,
  children,
  size = "icon",
  variant = "ghost",
  "aria-label": ariaLabel = "Toggle sidebar",
  ...props
}: FileViewerSidebarTriggerProps) {
  const {
    canToggleSidebar,
    elementRegistry,
    mode,
    side,
    isSidebarInteractive,
    sidebarId,
    sidebarState,
    toggleSidebar,
  } = useFileViewerShell("FileViewerSidebarTrigger");
  const isDisabled = Boolean(disabled || loading || !canToggleSidebar);
  const Icon = side === "right" ? PanelRight : PanelLeft;
  const setTriggerElement = React.useCallback(
    (element: HTMLButtonElement | null) => {
      elementRegistry.registerSidebarTriggerElement(element);
    },
    [elementRegistry],
  );
  const accessibilityProps = resolveFileViewerSidebarTriggerAccessibilityProps({
    ariaLabel,
    canToggleSidebar,
    isDisabled,
    isSidebarInteractive,
    sidebarId,
  });

  return (
    <Button
      ref={setTriggerElement}
      {...accessibilityProps}
      className={cn("size-8", className)}
      data-file-viewer-sidebar-mode={mode}
      data-file-viewer-sidebar-side={side}
      data-file-viewer-sidebar-state={sidebarState}
      data-side={side}
      data-slot="file-viewer-sidebar-trigger"
      disabled={isDisabled}
      onClick={(event) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }

        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      size={size}
      variant={variant}
      {...props}
    >
      {loading ? <Spinner className="size-4 animate-spin" /> : null}
      {children ?? (
        <>
          {loading ? null : <Icon />}
          <span className="sr-only">Toggle sidebar</span>
        </>
      )}
    </Button>
  );
}
