import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current [animation-duration:900ms] motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
