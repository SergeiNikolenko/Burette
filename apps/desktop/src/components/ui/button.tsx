import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Variants and sizes follow the Atlas Button: colours come from the shared
// theme tokens, and the three heights are its pill (24), toolbar (28) and
// action (32) buttons.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1 border border-transparent bg-clip-padding text-sm leading-[18px] whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-(--color-ring) disabled:pointer-events-none disabled:opacity-40 aria-disabled:opacity-40 aria-invalid:border-(--color-text-danger) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-(--color-border) bg-(--color-background-primary-solid) text-(--color-text-primary-solid) hover:bg-(--color-text)/80 data-[state=open]:bg-(--color-text)/80",
        outline:
          "border-(--color-border) bg-(--color-background-primary-soft-alpha) text-(--color-text) hover:bg-(--color-background-primary-ghost-hover) aria-expanded:bg-(--color-background-primary-ghost-hover)",
        secondary:
          "bg-(--color-text)/5 text-(--color-text) hover:bg-(--color-text)/10 aria-expanded:bg-(--color-text)/10",
        ghost:
          "text-(--color-text-tertiary) hover:bg-(--color-background-primary-ghost-hover) aria-expanded:bg-(--color-background-primary-ghost-hover)",
        destructive:
          "bg-(--color-text-danger)/10 text-(--color-text-danger) hover:bg-(--color-text-danger)/15",
        link: "text-(--color-text-info) underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 rounded-(--radius-button-action) px-4 text-base/[18px]",
        xs: "h-6 rounded-full px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 rounded-(--radius-button-toolbar) px-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 rounded-(--radius-button-action) px-4 text-base/[18px]",
        icon: "size-8 rounded-(--radius-button-toolbar)",
        // Dense list rows - the inspector's composition tree, and the viewer's
        // scene tree it mirrors - carry a 20px action. That size did not exist
        // here, so those rows were hand-rolled buttons that drifted from the
        // rest of the system; it lives in the variants now instead.
        "icon-2xs":
          "size-5 rounded-(--radius-xs) [&_svg:not([class*='size-'])]:size-[13px]",
        "icon-xs":
          "size-6 rounded-(--radius-xs) [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-(--radius-button-toolbar)",
        "icon-lg": "size-9 rounded-(--radius-button-toolbar)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
