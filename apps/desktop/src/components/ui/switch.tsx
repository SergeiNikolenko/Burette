import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  tone = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
  tone?: "default" | "neutral"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      data-tone={tone}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-colors duration-(--transition-duration-basic) ease-out outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-7 data-unchecked:bg-(--color-text)/10 data-disabled:cursor-not-allowed data-disabled:opacity-60 motion-reduce:transition-none",
        tone === "neutral" ? "data-checked:bg-(--color-text)" : "data-checked:bg-(--color-chart-blue)",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn("pointer-events-none block rounded-full border border-(--color-control-thumb-on-accent) bg-(--color-control-thumb-on-accent) shadow-sm transition-transform duration-(--transition-duration-basic) ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-unchecked:translate-x-0.5 data-checked:translate-x-3.5 rtl:data-unchecked:-translate-x-0.5 rtl:data-checked:-translate-x-3.5 motion-reduce:transition-none",
          tone === "neutral" && "data-checked:border-transparent data-checked:bg-(--color-token-main-surface-primary)",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
