import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button, ButtonStyleContext } from "@/components/ui/button"
import { X } from "@/components/ui/app-icons"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import "./dialog-overlay.atlas.css"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const appShellContainer = useAppShellPortalContainer()

  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      container={container ?? appShellContainer}
      {...props}
    />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "atlas-dialog-dimmed-overlay fixed inset-0 isolate z-50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none!",
        className
      )}
      {...props}
    />
  )
}

// Atlas ConfirmationDialog: the codex-dialog surface at 380px, a left-aligned
// heading and the corner close button, which here dismisses as Cancel.
function AlertDialogContent({
  className,
  size = "default",
  children,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        onOpenAutoFocus={event => {
          onOpenAutoFocus?.(event)
          // The corner close is also a Cancel; start on the footer's, as Atlas does.
          const cancel = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-slot="alert-dialog-cancel"]')
          if (!event.defaultPrevented && cancel) {
            event.preventDefault()
            cancel.focus({ preventScroll: true })
          }
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-full max-w-[min(92vw,380px)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-3xl bg-(--color-surface-elevated-secondary)/90 p-5 text-base leading-normal tracking-normal text-(--color-text) shadow-(--shadow-lg) ring-[0.5px] ring-(--color-border) backdrop-blur-xl outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none!",
          className
        )}
        {...props}
      >
        {children}
        <AlertDialogPrimitive.Cancel asChild>
          <button
            type="button"
            data-slot="alert-dialog-close"
            className="absolute top-4 right-4 inline-flex items-center justify-center rounded p-1 text-(--color-text)/80 outline-none hover:bg-(--color-background-primary-ghost-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring)"
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </AlertDialogPrimitive.Cancel>
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "flex flex-col items-start gap-1 self-stretch pe-8",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex w-full flex-wrap items-center justify-end gap-3",
        className
      )}
      {...props}
    >
      <ButtonStyleContext value="app">{children}</ButtonStyleContext>
    </div>
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-xl bg-(--color-background-primary-soft-alpha) [&_svg]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "min-w-0 text-(length:--text-heading-md) leading-7 font-semibold",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-base leading-normal text-(--color-codex-description) [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={className}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "ghost",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
