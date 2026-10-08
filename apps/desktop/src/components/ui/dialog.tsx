import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button, ButtonStyleContext } from "@/components/ui/button"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"
import { X } from "@/components/ui/app-icons"
import "./dialog-overlay.atlas.css"

const DialogModalContext = React.createContext(true)

function Dialog({
  modal = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogModalContext value={modal}>
    <DialogPrimitive.Root data-slot="dialog" modal={modal} {...props} />
  </DialogModalContext>
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const appShellContainer = useAppShellPortalContainer()

  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container ?? appShellContainer}
      {...props}
    />
  )
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & { variant?: "default" | "form" }) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-variant={variant}
      className={cn(
        "fixed inset-0 isolate z-50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none!",
        variant === "form" ? "atlas-dialog-dimmed-overlay" : "bg-(--color-dialog-overlay)",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = "default",
  size = "default",
  container,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  variant?: "default" | "form"
  size?: "narrow" | "compact" | "default" | "medium" | "large" | "wide" | "xwide"
  container?: React.ComponentProps<typeof DialogPrimitive.Portal>["container"]
}) {
  const modal = React.useContext(DialogModalContext)
  const focusOrigin = React.useRef<HTMLElement | null>(null)
  return (
    <DialogPortal container={container}>
      <DialogOverlay variant={variant} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-variant={variant}
        onOpenAutoFocus={event => {
          const active = (event.currentTarget as HTMLElement).ownerDocument.activeElement
          focusOrigin.current = active instanceof HTMLElement && active !== active.ownerDocument.body ? active : null
          onOpenAutoFocus?.(event)
        }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event)
          // Programmatic forms have no Radix Trigger. Restore their opener too,
          // but leave non-modal outside interactions and explicit overrides alone.
          const origin = focusOrigin.current
          if (!event.defaultPrevented && modal && origin?.isConnected) {
            origin.focus({ preventScroll: true })
            if (origin.ownerDocument.activeElement === origin) event.preventDefault()
          }
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto p-5 text-base text-(--color-text) ring-[0.5px] ring-(--color-border) duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none!",
          variant === "form"
            ? "rounded-(--radius-form-dialog) bg-(--color-surface-elevated-secondary) shadow-[0_8px_10px_-6px_#0000001a,0_20px_25px_-5px_#0000001a]"
            : "rounded-3xl bg-(--color-surface-elevated-secondary)/90 shadow-(--shadow-lg) backdrop-blur-xl",
          { narrow: "max-w-[min(92vw,380px)]", compact: "max-w-[min(92vw,420px)]", default: "max-w-[min(92vw,520px)]", medium: "max-w-[min(92vw,448px)]", large: "max-w-[min(92vw,512px)]", wide: "max-w-[min(92vw,600px)]", xwide: "max-w-[min(92vw,680px)]" }[size],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <button
              type="button"
              className={cn("absolute top-4 inline-flex items-center justify-center text-(--color-text)/80 hover:bg-(--color-background-primary-ghost-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring) outline-none",
                variant === "form" ? "right-3.5 size-8 rounded-full text-(--color-text-tertiary) hover:text-(--color-text)" : "right-4 rounded p-1")}
              aria-label="Close dialog"
            >
              <X size={variant === "form" ? 20 : 16} aria-hidden />
            </button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pe-8", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex w-full flex-wrap items-center justify-end gap-3",
        className
      )}
      {...props}
    >
      <ButtonStyleContext value="app">
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button variant="secondary">Close</Button>
          </DialogPrimitive.Close>
        )}
      </ButtonStyleContext>
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-(length:--text-heading-md) leading-7 font-semibold",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-base leading-normal text-(--color-codex-description) *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
