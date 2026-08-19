"use client";

import * as React from "react";
import { PanelLeft, PanelRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Spinner } from "./spinner";
import {
  isAriaDisabled,
  useViewerSidebarState,
  useViewerSidebarRegistrationContext,
} from "./viewer-internals";
import type { ViewerFrameProps, ViewerHeaderProps } from "./viewer-types";

// Stock Button no longer exports ButtonProps or a `loading` prop. ViewerSidebarTrigger
// keeps its own `loading` API, so we define ButtonProps locally as the stock Button's
// props plus the retab `loading` flag (translated to disabled + Spinner at the leaf).
type ButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
};

export type ViewerSidebarTriggerProps = ButtonProps;

export function ViewerFrame({ className, ...props }: ViewerFrameProps) {
  return (
    <div
      data-slot="viewer-frame"
      className={cn(
        "bg-background relative min-h-0 overflow-hidden rounded-xl border",
        className,
      )}
      {...props}
    />
  );
}

export function ViewerHeader({ className, ...props }: ViewerHeaderProps) {
  return (
    <div
      data-slot="viewer-header"
      className={cn("bg-card flex-shrink-0 border-b", className)}
      {...props}
    />
  );
}

export function ViewerSidebarTrigger({
  className,
  disabled,
  loading,
  onClick,
  onPointerDown,
  children,
  size = "icon",
  variant = "ghost",
  "aria-label": ariaLabel = "Toggle sidebar",
  "aria-disabled": ariaDisabled,
  ...props
}: ViewerSidebarTriggerProps) {
  const {
    hasSidebar,
    rootId,
    sidebarId,
    sidebarSide,
    setLastTriggerElement,
  } = useViewerSidebarRegistrationContext("ViewerSidebarTrigger");
  const sidebarState = useViewerSidebarState("ViewerSidebarTrigger");
  const { canToggleSidebar, open, state, toggleSidebar } = sidebarState;
  const isDisabled = Boolean(
    disabled || loading || isAriaDisabled(ariaDisabled) || !canToggleSidebar,
  );
  const Icon = sidebarSide === "right" ? PanelRight : PanelLeft;

  return (
    <Button
      aria-controls={hasSidebar ? sidebarId : undefined}
      aria-disabled={isDisabled ? true : ariaDisabled}
      aria-expanded={hasSidebar ? open : undefined}
      aria-label={ariaLabel}
      className={cn("size-8", className)}
      data-side={sidebarSide}
      data-slot="viewer-sidebar-trigger"
      data-state={state}
      data-viewer-root-id={rootId}
      data-viewer-sidebar-trigger=""
      disabled={isDisabled}
      onClick={(event) => {
        setLastTriggerElement(event.currentTarget);
        if (isDisabled) {
          event.preventDefault();
          return;
        }

        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      onPointerDown={(event) => {
        setLastTriggerElement(event.currentTarget);
        onPointerDown?.(event);
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
