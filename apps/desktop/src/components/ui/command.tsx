import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search as SearchIcon, Check as Tick02Icon } from "@/components/ui/app-icon-data";
import { X } from "@/components/ui/app-icons"
import "./command.atlas.css"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "text-base leading-normal [--padding-row-y:5px]",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  onCloseAutoFocus?: React.ComponentProps<typeof DialogPrimitive.Content>["onCloseAutoFocus"]
}) {
  return (
    <Dialog {...props}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onCloseAutoFocus={onCloseAutoFocus}
          data-slot="command-dialog"
          className={cn(
            "atlas-command-dialog atlas-command-dialog-global fixed left-1/2 z-50 -translate-x-1/2 outline-none",
            className
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close command palette"
              className="absolute top-2 right-2 rounded p-1 hover:bg-(--color-background-primary-ghost-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring)"
            >
              <X size={16} aria-hidden />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

function CommandInput({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { variant?: "default" | "plain" }) {
  if (variant === "plain") {
    return (
      <div data-slot="command-input-wrapper">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn("block w-full bg-transparent text-base/[21px] outline-none placeholder:text-(--color-codex-description) disabled:opacity-50", className)}
          {...props}
        />
      </div>
    )
  }
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! rounded-(--radius-xl)! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("text-base", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "flex flex-col gap-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:text-sm **:[[cmdk-group-heading]]:text-(--color-codex-description)",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("mx-2 my-1 h-px bg-(--color-border)", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative gap-2 outline-hidden data-[disabled=true]:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto pl-2 text-xs leading-4 text-current",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
