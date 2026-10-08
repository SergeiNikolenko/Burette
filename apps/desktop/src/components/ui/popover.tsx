import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "./portal-container"
import "./popover.css"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  container,
  variant = "default",
  size = "default",
  opaque = true,
  disablePadding = false,
  animation = "none",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: React.ComponentProps<typeof PopoverPrimitive.Portal>["container"]
  variant?: "default" | "menu" | "comment"
  size?: "default" | "large" | "workspace" | "content"
  opaque?: boolean
  disablePadding?: boolean
  animation?: "none" | "slide-from-left"
}) {
  const appShellContainer = useAppShellPortalContainer()
  return (
    <PopoverPrimitive.Portal container={container ?? appShellContainer}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        data-animation={animation}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "atlas-popover z-50 flex origin-(--radix-popover-content-transform-origin) flex-col overflow-y-auto text-[16px] leading-6 text-(--color-text) outline-hidden",
          variant === "menu" ? "rounded-2xl shadow-(--shadow-dropdown-overlay)" : variant === "comment"
            ? "rounded-2xl ring-1 ring-(--color-border-subtle) shadow-(--shadow-lg-stronger)"
            : "rounded-xl ring-(length:--popover-overlay-ring-width) ring-(--color-border-overlay) shadow-(--shadow-popover-overlay)",
          !disablePadding && (variant === "menu" ? "p-[var(--app-menu-gutter,var(--spacing))]" : "p-1"),
          opaque ? "bg-(--color-surface-elevated-secondary)" : "bg-(--color-surface-elevated-secondary)/90",
          { default: "w-72", large: "w-96", workspace: "w-65", content: "w-max" }[size],
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
