import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import "./radio-group.css"

function RadioGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      orientation={orientation}
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
  block = false,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & { block?: boolean }) {
  return (
    <label
      data-slot="radio-group-label"
      data-block={block || undefined}
      className="inline-flex cursor-pointer items-start gap-(--radio-group-item-gap) text-(length:--radio-group-item-font-size) leading-(--radio-group-item-line-height) text-(--color-text) has-disabled:cursor-not-allowed has-disabled:opacity-50 data-[block]:w-full"
    >
      <span className="flex h-[1lh] shrink-0 items-center justify-center">
        <RadioGroupPrimitive.Item
          data-slot="radio-group-item"
          className={cn(
            "peer flex size-(--radio-group-indicator-size) shrink-0 items-center justify-center rounded-full inset-ring inset-ring-(--radio-group-indicator-border-color) cursor-pointer outline-none transition-shadow duration-(--transition-duration-basic) disabled:cursor-not-allowed enabled:hover:inset-ring-(--radio-group-indicator-border-color-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring) motion-reduce:transition-none",
            className
          )}
          {...props}
        >
          <RadioGroupPrimitive.Indicator
            data-slot="radio-group-indicator"
            className="atlas-radio-indicator"
          />
        </RadioGroupPrimitive.Item>
      </span>
      {children}
    </label>
  )
}

export { RadioGroup, RadioGroupItem }
