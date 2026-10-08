import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import { HugeiconsIcon } from "@hugeicons/react"
import { ChevronRight as ArrowRight01Icon, Check as Tick02Icon } from "@/components/ui/app-icon-data";

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  container,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  const appShellContainer = useAppShellPortalContainer()
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" container={container ?? appShellContainer} {...props} />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  container,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  // The theme lives on .app-shell, so a menu portalled to document.body would render
  // outside it and lose its colours. Same escape hatch as DropdownMenuContent.
  container?: React.ComponentProps<typeof ContextMenuPrimitive.Portal>["container"]
}) {
  const appShellContainer = useAppShellPortalContainer()

  return (
    <ContextMenuPrimitive.Portal container={container ?? appShellContainer}>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn("z-50 max-h-[min(var(--radix-context-menu-content-available-height,100dvh),calc(100dvh-16px))] max-w-[min(var(--radix-context-menu-content-available-width,100vw),calc(100vw-16px))] min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-(--radius-2xl) bg-(--color-surface-elevated-secondary)/90 p-[var(--app-menu-gutter,var(--menu-gutter))] text-(--color-text) backdrop-blur-sm shadow-(--shadow-dropdown-overlay) ring-(length:--dropdown-overlay-ring-width) ring-(--color-border-overlay)", className )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-(--radius-xl) px-2 py-[5px] text-(length:--menu-font-size) leading-(--menu-line-height) outline-hidden select-none focus:bg-(--color-background-primary-ghost-hover) data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-(--radius-xl) px-2 py-[5px] text-(length:--menu-font-size) leading-(--menu-line-height) outline-hidden select-none focus:bg-(--color-background-primary-ghost-hover) data-inset:pl-7 data-open:bg-(--color-background-primary-ghost-hover) data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto text-(--color-text-tertiary)" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn("z-50 max-h-[min(var(--radix-context-menu-content-available-height,100dvh),calc(100dvh-16px))] max-w-[min(var(--radix-context-menu-content-available-width,100vw),calc(100vw-16px))] min-w-[180px] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-(--radius-2xl) bg-(--color-surface-elevated-secondary)/90 p-[var(--app-menu-gutter,var(--menu-gutter))] text-(--color-text) backdrop-blur-sm shadow-(--shadow-dropdown-overlay) ring-(length:--dropdown-overlay-ring-width) ring-(--color-border-overlay) outline-none", className )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-(--radius-xl) py-[5px] pr-8 pl-2 text-(length:--menu-font-size) leading-(--menu-line-height) outline-hidden select-none focus:bg-(--color-background-primary-ghost-hover) data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-(--radius-xl) py-[5px] pr-8 pl-2 text-(length:--menu-font-size) leading-(--menu-line-height) outline-hidden select-none focus:bg-(--color-background-primary-ghost-hover) data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1 text-(length:--menu-font-size) leading-(--menu-line-height) text-(--color-text-tertiary) data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("mx-2 my-1 h-px bg-(--color-border)", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto pl-2 text-xs leading-4 text-(--color-text-tertiary)",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
