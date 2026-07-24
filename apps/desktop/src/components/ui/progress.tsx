import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indeterminate?: boolean
}

function Progress({
  className,
  value,
  indeterminate = value == null,
  ...props
}: ProgressProps) {
  const resolvedValue = Math.min(100, Math.max(0, value ?? 0))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-indeterminate={indeterminate || undefined}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      value={indeterminate ? null : resolvedValue}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-primary",
          indeterminate
            ? "w-1/3 flex-none animate-[burette-progress-indeterminate_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
            : "w-full flex-1 transition-transform"
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - resolvedValue}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
