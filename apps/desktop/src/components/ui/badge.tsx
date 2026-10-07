import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-(--badge-radius-md) px-[5px] text-xs/[18px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-(--color-background-primary-solid) text-(--color-text-primary-solid)",
        secondary: "bg-(--color-text)/5 text-(--color-text)",
        destructive: "bg-(--color-text-danger)/15 text-(--color-text-danger)",
        outline:
          "text-(--color-text-secondary) inset-ring inset-ring-(--color-border-strong)",
        ghost: "text-(--color-text-secondary) hover:bg-(--color-background-primary-ghost-hover)",
        link: "text-(--color-text-info) underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
