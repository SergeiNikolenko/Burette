import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-(--color-border-primary-outline) bg-(--color-background-primary-soft) px-2.5 py-2 text-sm text-(--color-text) transition-colors outline-none placeholder:text-(--color-text-tertiary) focus:border-(--color-ring) disabled:cursor-not-allowed disabled:bg-(--color-text)/5 disabled:text-(--color-text-secondary) aria-invalid:border-(--color-text-danger) aria-invalid:ring-2 aria-invalid:ring-(--color-text-danger)/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
