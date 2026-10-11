import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "./portal-container"
import "./popover.css"
import "./popover-surface.css"

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
  align = "start",
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
        data-variant={variant}
        data-opaque={opaque}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={6}
        className={cn(
          "atlas-popover atlas-popover-surface z-50 flex origin-(--radix-popover-content-transform-origin) flex-col overflow-y-auto text-[16px] leading-6 outline-hidden",
          !disablePadding && (variant === "menu" ? "p-2" : "p-1"),
          { default: "w-72", large: "w-96", workspace: "w-65", content: "w-fit" }[size],
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
