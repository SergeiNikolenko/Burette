import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import { HugeiconsIcon } from "@hugeicons/react"
import "./select.atlas.css"
import "./select.css"
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
  position = "item-aligned",
  align = "center",
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
        data-align-trigger={position === "item-aligned"}
        className={cn("relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[20px] bg-popover text-popover-foreground shadow-[0_8px_16px_-4px_rgb(0_0_0/0.12)] ring-[0.5px] ring-(--color-border) duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", position ==="popper"&&"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1", className )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "p-1 data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            position === "popper" && ""
          )}
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
      className={cn("px-2 py-1 text-[13px] leading-[18.5px] text-(--color-text-tertiary)", className)}
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
        "relative flex w-full cursor-default items-center gap-1.5 rounded-(--radius-xl) py-[5px] pr-8 pl-2 text-[13px] leading-[18.5px] outline-hidden select-none focus:bg-(--color-background-primary-ghost-hover) data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
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
