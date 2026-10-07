import * as React from "react"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { ChevronUpDown as UnfoldMoreIcon } from "@/components/ui/app-icon-data";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-[var(--shadcn-disabled-opacity)]",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 appearance-none py-0 pr-7 pl-2 rounded-full border border-(--color-border) bg-(--color-surface) text-xs/4 text-(--color-text) transition-colors outline-none select-none hover:bg-(--color-background-primary-ghost-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring) disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-(--color-text-danger) data-[size=sm]:h-7"
        {...props}
      />
      <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-(--color-text-tertiary) select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
