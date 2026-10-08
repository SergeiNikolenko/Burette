"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import "./slider.atlas.css"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  tone = "default",
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  tone?: "default" | "neutral"
}) {
  const values = value ?? defaultValue ?? [min, max]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      data-tone={tone}
      className={cn(
        "atlas-slider data-disabled:opacity-40 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col data-vertical:pb-0",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="atlas-slider-track data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="atlas-slider-range data-vertical:w-full data-vertical:h-auto"
        />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          data-slot="slider-thumb"
          key={index}
          className="atlas-slider-thumb shrink-0 after:absolute after:-inset-2"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
