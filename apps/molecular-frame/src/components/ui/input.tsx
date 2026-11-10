import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

// Codex input: 36px field, 10px radius, hairline border; focus only darkens the border.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[10px] border border-[rgb(26_28_31/11.8%)] bg-[rgb(255_255_255/96%)] px-2.5 py-1 text-base text-foreground transition-[border-color,box-shadow] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-normal file:text-foreground placeholder:text-[rgb(26_28_31/49%)] focus-visible:border-foreground/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-[13px] dark:border-[rgb(255_255_255/15.7%)] dark:bg-[rgb(45_45_45/96%)] dark:placeholder:text-[rgb(255_255_255/50%)] dark:focus-visible:border-foreground/50 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
