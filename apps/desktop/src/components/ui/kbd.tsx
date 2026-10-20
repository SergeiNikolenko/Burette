import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-4 w-fit min-w-4 items-center justify-center gap-1 rounded-md bg-current/10 px-1.5 font-sans text-xs leading-4 [font-weight:inherit] text-current select-none in-data-[slot=tooltip-content]:-me-1 in-data-[slot=tooltip-content]:h-4.5 in-data-[slot=tooltip-content]:rounded-lg in-data-[slot=tooltip-content]:bg-(--color-background-tooltip-shortcut) in-data-[slot=tooltip-content]:text-sm in-data-[slot=tooltip-content]:leading-4.5 in-data-[slot=tooltip-content]:text-(--color-text-tooltip-shortcut) [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
