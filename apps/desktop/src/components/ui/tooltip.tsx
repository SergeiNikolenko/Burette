import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"

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
  gutterSize = "md",
  maxWidth = 300,
  style,
  children,
  showArrow = false,
  container: portalContainer,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  compact?: boolean
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
        data-gutter-size={gutterSize}
        style={{ "--tooltip-max-width": `${maxWidth}px`, ...style } as React.CSSProperties}
        className={cn(
          "z-50 max-w-[min(var(--tooltip-max-width,300px),var(--radix-tooltip-content-available-width,100vw),calc(100vw-16px))] rounded-(--tooltip-border-radius) shadow-(--tooltip-box-shadow) text-(length:--tooltip-font-size) leading-(--tooltip-line-height) wrap-anywhere",
          compact
            ? "p-(--tooltip-compact-padding) bg-(--tooltip-compact-background-color) text-(--tooltip-compact-text-color) text-(length:--tooltip-compact-font-size) font-(weight:--tooltip-compact-font-weight)"
            : "bg-(--tooltip-background-color) text-(--tooltip-text-color) font-(weight:--tooltip-font-weight)",
          !compact && { sm: "p-(--tooltip-padding-sm)", md: "p-(--tooltip-padding-md)", lg: "p-(--tooltip-padding-lg)" }[gutterSize],
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
