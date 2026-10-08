import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import "./tooltip.atlas.css"

function TooltipProvider({
  delayDuration = 150,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 5,
  compact = false,
  clickable = false,
  gutterSize = "md",
  maxWidth = 300,
  style,
  children,
  showArrow = false,
  container: portalContainer,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  compact?: boolean
  clickable?: boolean
  gutterSize?: "sm" | "md" | "lg"
  maxWidth?: number
  showArrow?: boolean
  container?: HTMLElement | null
}) {
  // Theme tokens live on .app-shell, so portal there instead of document.body
  // (same as dialog.tsx) or the content renders with unresolved colors.
  const container = useAppShellPortalContainer()
  return (
    <TooltipPrimitive.Portal container={portalContainer ?? container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        data-compact={compact}
        data-clickable={clickable}
        data-gutter-size={gutterSize}
        style={{ "--tooltip-max-width": `${maxWidth}px`, ...style } as React.CSSProperties}
        className={cn(
          "atlas-tooltip z-50 max-w-[min(var(--tooltip-max-width,300px),var(--radix-tooltip-content-available-width,100vw),calc(100vw-16px))] wrap-anywhere",
          className
        )}
        {...props}
      >
        {children}
        {showArrow ? (
          <TooltipPrimitive.Arrow className={compact ? "fill-(--tooltip-compact-background-color)" : "fill-(--tooltip-background-color)"} />
        ) : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
