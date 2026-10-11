import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import "./radio-group.atlas.css"
import "./radio-group.css"

const DisabledContext = React.createContext(false)

function RadioGroup({
  className,
  orientation = "horizontal",
  disabled = false,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <DisabledContext value={disabled}>
      <RadioGroupPrimitive.Root
        data-slot="radio-group"
        orientation={orientation}
        disabled={disabled}
        className={cn("atlas-radio-group text-(--color-text)", className)}
        {...props}
      />
    </DisabledContext>
  )
}

function RadioGroupItem({
  className,
  children,
  block = false,
  disabled = false,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & { block?: boolean }) {
  const groupDisabled = React.useContext(DisabledContext)
  const isDisabled = groupDisabled || disabled
  return (
    <label
      data-slot="radio-group-label"
      data-block={block || undefined}
      data-disabled={isDisabled ? "" : undefined}
      className="atlas-radio-label"
    >
      <span className="atlas-radio-wrapper">
        <RadioGroupPrimitive.Item
          data-slot="radio-group-item"
          disabled={isDisabled}
          className={cn("peer atlas-radio-item", className)}
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
