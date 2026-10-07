import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Check as Tick02Icon } from "@/components/ui/app-icon-data";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-(--checkbox-border-color,var(--color-border-strong)) transition-colors outline-none group-has-disabled/field:opacity-40 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-(--color-ring) disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-(--color-text-danger) data-checked:border-(--color-background-primary-solid) data-checked:bg-(--color-background-primary-solid) data-checked:text-(--color-text-primary-solid)",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
