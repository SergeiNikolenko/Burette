import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-colors duration-(--duration-basic,150ms) ease-out outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-(--color-ring) data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-6.5 data-checked:bg-(--color-chart-blue) data-unchecked:bg-(--color-text)/10 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full border border-(--color-control-thumb-on-accent) bg-(--color-control-thumb-on-accent) shadow-sm transition-transform duration-(--duration-basic,150ms) ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-unchecked:translate-x-0.5 group-data-[size=default]/switch:data-checked:translate-x-3.5 group-data-[size=sm]/switch:data-checked:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
