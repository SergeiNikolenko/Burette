import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import { HugeiconsIcon } from "@hugeicons/react"
import "./select.atlas.css"
import "./select-menu.atlas.css"
import "./select.css"
import { SelectOptionContent } from "./select-option-content"
import { ChevronUpDown as UnfoldMoreIcon, Check as Tick02Icon, ChevronUp as ArrowUp01Icon, ChevronDown as ArrowDown01Icon } from "@/components/ui/app-icon-data";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  onPointerEnter,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      data-atlas-size={size === "sm" ? "sm" : "md"}
      data-variant="outline"
      data-invalid={props["aria-invalid"] === true || props["aria-invalid"] === "true" ? "" : undefined}
      className={cn(
        "atlas-select w-fit text-(--color-text) data-placeholder:text-(--input-placeholder-text-color)",
        className
      )}
      onPointerEnter={event => {
        const width = event.currentTarget.offsetWidth;
        const scale = width <= 80 ? .96 : width <= 150 ? .97 : width <= 220 ? .98 : width > 600 ? .995 : .985;
        event.currentTarget.style.setProperty("--scale", String(scale));
        onPointerEnter?.(event);
      }}
      {...props}
    >
      <span className="atlas-select-text">{children}</span>
      <SelectPrimitive.Icon asChild>
        <span className="atlas-select-indicator"><SelectControlIcon /></span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

// Reframe the reviewed shared glyph to the original Select's 10 × 16 viewbox.
function SelectControlIcon() {
  return <HugeiconsIcon icon={UnfoldMoreIcon} viewBox="7 4 10 16" className="atlas-select-icon pointer-events-none shrink-0" aria-hidden="true" />
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  sideOffset = 5,
  container,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  container?: React.ComponentProps<typeof SelectPrimitive.Portal>["container"]
}) {
  const appShellContainer = useAppShellPortalContainer()

  return (
    <SelectPrimitive.Portal container={container ?? appShellContainer}>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-position={position}
        className={cn("atlas-select-menu relative z-50 overflow-hidden text-(--color-text)", className)}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className="atlas-select-options"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("atlas-select-group-heading normal-case", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "atlas-select-option outline-hidden",
        className
      )}
      {...props}
    >
      <SelectOptionContent indicator={<SelectPrimitive.ItemIndicator>
        <HugeiconsIcon icon={Tick02Icon} className="atlas-select-check" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>}>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      </SelectOptionContent>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none mx-2 my-1 h-px bg-(--color-border)", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectControlIcon,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
