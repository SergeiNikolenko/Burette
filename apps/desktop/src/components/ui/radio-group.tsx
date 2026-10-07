import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn(
        "flex data-[orientation=horizontal]:gap-(--radio-group-row-gap) data-[orientation=vertical]:flex-col data-[orientation=vertical]:gap-(--radio-group-col-gap)",
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <label
      data-slot="radio-group-label"
      className="flex items-center gap-(--radio-group-item-gap) text-(length:--radio-group-item-font-size) leading-(--radio-group-item-line-height) text-(--color-text) has-disabled:opacity-40"
    >
      <RadioGroupPrimitive.Item
        data-slot="radio-group-item"
        className={cn(
          "peer flex size-(--radio-group-indicator-size) shrink-0 items-center justify-center rounded-full inset-ring inset-ring-(--radio-group-indicator-border-color) outline-none hover:inset-ring-(--radio-group-indicator-border-color-hover) focus-visible:ring-2 focus-visible:ring-(--color-ring) data-[state=checked]:bg-(--radio-group-indicator-background-color) data-[state=checked]:inset-ring-0",
          className
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="size-(--radio-group-indicator-hole-size) rounded-full bg-(--radio-group-indicator-hole-background-color)"
        />
      </RadioGroupPrimitive.Item>
      {children}
    </label>
  )
}

export { RadioGroup, RadioGroupItem }
