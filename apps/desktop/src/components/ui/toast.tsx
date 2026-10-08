import type { CSSProperties, ReactNode } from "react"
import { createPortal } from "react-dom"
import { Toaster as Sonner, toast as sonner } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Spinner } from "@/components/ui/spinner";
import { Warning as Alert02Icon, X as Cancel01Icon, CheckCircle as CheckmarkCircle02Icon, InfoCircle as InformationCircleIcon, XCircleCrossedClose as MultiplicationSignCircleIcon } from "@/components/ui/app-icon-data";

import { Button } from "@/components/ui/button"
import { useAppShellPortalContainer } from "@/components/ui/portal-container"

type ToastType = "info" | "success" | "warning" | "error" | "loading"
type ToastId = string | number

type ToastOptions = {
  title: ReactNode
  description?: ReactNode
  type?: ToastType
  /** Milliseconds before dismissal; zero keeps the notice until closed. */
  timeout?: number
  /** High-priority toasts interrupt assistive technology. */
  priority?: "low" | "high"
  actionProps?: { children: ReactNode; onClick: () => void }
  actionPlacement?: "inline" | "footer"
}

const DEFAULT_TIMEOUT_MS = 5000

function ToastIcon({ type }: { type: ToastType | undefined }) {
  let icon: ReactNode = null

  if (type === "success") {
    icon = <HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" />
  }

  if (type === "info") {
    icon = <HugeiconsIcon icon={InformationCircleIcon} aria-hidden="true" />
  }

  if (type === "warning") {
    icon = <HugeiconsIcon icon={Alert02Icon} aria-hidden="true" />
  }

  if (type === "error") {
    icon = (
      <HugeiconsIcon
        icon={MultiplicationSignCircleIcon}
        className="text-(--color-text-danger)"
        aria-hidden="true"
      />
    )
  }

  if (type === "loading") {
    icon = <Spinner />
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="flex size-6 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  )
}

function ToastCard({ id, title, description, type, priority, actionProps, actionPlacement = "footer" }: ToastOptions & { id: ToastId }) {
  const action = actionProps ? <Button data-slot="toast-action" variant="secondary" size="xs"
    className="rounded-(--radius-button-action) text-xs leading-4" onClick={actionProps.onClick}>
    {actionProps.children}
  </Button> : null
  return (
    <div
      data-slot="toast"
      role={priority === "high" ? "alert" : "status"}
      className="pointer-events-auto flex w-[min(var(--width),calc(100vw-32px))] flex-col gap-2 rounded-xl border border-(--color-border) bg-(--color-surface-elevated-secondary) px-3 py-2 text-base text-(--color-text) shadow-[0_4px_12px_0_rgb(0_0_0/0.1)] select-none"
    >
      <div className="flex min-w-0 items-start gap-1">
        <ToastIcon type={type} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div data-slot="toast-title" className="flex min-h-6 items-center text-base leading-normal font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">
            {title}
          </div>
          {description ? (
            <div data-slot="toast-description" className="text-base leading-normal text-(--color-text-secondary) [overflow-wrap:anywhere]">
              {description}
            </div>
          ) : null}
        </div>
        {action && actionPlacement === "inline" ? <div className="ml-2 flex shrink-0 items-center">{action}</div> : null}
        <Button
          data-slot="toast-close"
          aria-label="Close toast"
          variant="ghost"
          size="icon-xs"
          className="relative shrink-0 rounded-full text-(--color-text) after:absolute after:-inset-2 after:content-['']"
          onClick={() => sonner.dismiss(id)}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {action && actionPlacement === "footer" ? <div className="flex items-center justify-end gap-2">{action}</div> : null}
    </div>
  )
}

// The app raises notices through this object rather than through sonner, so
// every toast is the same card and no call site picks its own markup.
const toast = {
  add(options: ToastOptions): ToastId {
    return sonner.custom((id) => <ToastCard id={id} {...options} />, {
      duration: options.timeout === 0 ? Infinity : options.timeout ?? DEFAULT_TIMEOUT_MS,
    })
  },
  close(id: ToastId) {
    sonner.dismiss(id)
  },
}

// Toasts must render inside .app-shell: theme variables and the dark variant
// only apply there, and sonner would otherwise mount where it is declared.
function Toaster() {
  const portalContainer = useAppShellPortalContainer()
  if (!portalContainer) return null

  return createPortal(
    <Sonner
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      gap={8}
      visibleToasts={3}
      style={{ "--width": "320px" } as CSSProperties}
    />,
    portalContainer,
  )
}

export { Toaster, toast }
export type { ToastOptions }
