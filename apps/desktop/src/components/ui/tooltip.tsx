import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import "./tooltip.atlas.css"
import "./tooltip.css"

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
  onFocus,
  onPointerMove,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props}
    onFocus={event => {
      // React bubbles portal events through the trigger's logical children.
      // Focusing a Select option must not reopen its parent field's tooltip.
      if (!event.currentTarget.contains(event.target as Node)) event.preventDefault()
      onFocus?.(event)
    }}
    onPointerMove={event => {
      if (!event.currentTarget.contains(event.target as Node)) event.preventDefault()
      onPointerMove?.(event)
    }}
  />
}

function TooltipContent({
  className,
  variant = "sdk",
  sideOffset = variant === "floating" ? 2 : 5,
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
  variant?: "sdk" | "floating"
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
          "z-50 max-w-[min(var(--tooltip-max-width,300px),var(--radix-tooltip-content-available-width,100vw),calc(100vw-16px))] wrap-anywhere",
          // Atlas FloatingTooltip (RT) is the app-chrome variant, distinct from
          // the SDK's Tooltip compact surface. Keep its original utility tokens.
          variant === "floating"
            ? "w-fit text-sm whitespace-normal min-h-min select-none text-center rounded-2xl border border-(color:--color-border-tooltip) bg-(--color-background-tooltip) text-(color:--color-text-tooltip) leading-4.5 font-(weight:--tooltip-compact-font-weight) tracking-(--tracking-tooltip) shadow-(--shadow-tooltip) px-3 py-1.25 pointer-events-none"
            : "atlas-tooltip",
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
