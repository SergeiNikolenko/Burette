import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-(--color-border-primary-outline) bg-(--color-background-primary-soft) px-2.5 text-sm text-(--color-text) transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-ring) disabled:cursor-not-allowed disabled:bg-(--color-text)/5 disabled:text-(--color-text-secondary) aria-invalid:border-(--color-text-danger) aria-invalid:ring-2 aria-invalid:ring-(--color-text-danger)/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
