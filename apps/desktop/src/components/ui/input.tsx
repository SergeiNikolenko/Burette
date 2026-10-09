import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import "./input.atlas.css"

// InterfaceAtlas Input variants; keep native input props/ref and form behavior.
const inputVariants = cva(
  "w-full min-w-0 border text-(--color-text) outline-none placeholder:text-(--color-text-tertiary) aria-invalid:border-(--color-text-danger) aria-invalid:ring-2 aria-invalid:ring-(--color-text-danger)/20 disabled:cursor-not-allowed disabled:text-(--color-text-secondary) file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:text-(--color-text)",
  {
    variants: {
      variant: {
        default: "h-9 rounded-md border-(--color-border-primary-outline) bg-(--color-background-primary-soft) px-2.5 text-sm focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        compact: "h-7 rounded-md border-(--color-border-primary-outline) bg-(--color-background-primary-soft) px-2 text-sm focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        field: "h-8 rounded-md border-(--color-border) bg-(--color-background-primary-soft) px-2 text-sm focus:border-(--color-ring) disabled:border-transparent disabled:bg-(--color-text)/5",
        code: "h-9 rounded-md border-(--color-border-primary-outline) bg-(--color-background-primary-soft) px-2.5 font-mono text-sm focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        ghost: "h-(--spacing-token-button-composer) rounded-md border-transparent bg-transparent px-2 text-sm enabled:hover:bg-(--color-background-primary-ghost-hover) focus:bg-(--color-background-primary-ghost-hover)",
        transparent: "h-(--spacing-token-button-composer) rounded-md border-transparent bg-transparent px-2 text-sm focus:ring-1 focus:ring-(--color-ring) focus:border-(--color-ring)",
        rounded: "h-12 rounded-2xl border-(--color-border-subtle) bg-(--color-surface) px-4 text-base dark:bg-(--color-surface-secondary)/92 focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        settings: "rounded-2xl border-(--color-border) bg-transparent px-4 py-2 text-base focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        form: "h-12 rounded-2xl border-(--color-border) bg-transparent px-5 text-(length:--text-form-body) leading-(--text-form-body--line-height) tracking-(--text-form-body--letter-spacing) font-normal focus:bg-(--color-background-primary-ghost-hover) focus:border-(--color-ring) disabled:bg-(--color-text)/5 forced-colors:focus:bg-[Highlight] forced-colors:focus:text-[HighlightText] forced-colors:focus:forced-color-adjust-none forced-colors:focus:placeholder:text-[HighlightText]",
        segmented: "h-10 overflow-hidden rounded-xl border-(--color-border) bg-(--color-background-primary-soft) px-3 text-sm focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        heading: "h-9 rounded-sm border-(--color-border-primary-outline) bg-(--color-surface) px-2 text-lg font-medium focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        inline: "h-11 rounded-xl border-(--color-border-primary-outline) bg-(--color-surface) px-3 py-2 text-(length:--text-heading-lg) leading-7 font-medium focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        amount: "h-10 rounded-lg border-(--color-border-primary-outline) bg-(--color-surface) px-3 text-sm font-normal tabular-nums focus:border-(--color-ring) disabled:bg-(--color-text)/5",
        auth: "h-14 rounded-full border-(--color-border-primary-outline) bg-transparent px-5 text-base focus:ring-1 focus:ring-(--color-ring) focus:border-(--color-ring) disabled:bg-(--color-text)/5",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Input({ className, variant, type, ...props }: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ variant }),
    type === "number" && (variant === "field" || variant === "compact") && "tabular-nums",
    type === "number" && variant === "field" && "atlas-input-number", className)} {...props} />
}

export { Input, inputVariants }
