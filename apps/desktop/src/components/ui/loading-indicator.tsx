import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// A fading ring with a round leading cap: the ring is a bordered circle masked
// by a conic gradient, the cap is a dot at twelve o'clock, and the whole box
// turns. The spinner next door is the stroked-arc variant for inline icons.
const loadingIndicatorVariants = cva(
  "relative block shrink-0 animate-spin [animation-duration:0.8s] [animation-timing-function:linear] motion-reduce:animate-none before:absolute before:inset-0 before:rounded-full before:border-2 before:border-current before:[mask-image:conic-gradient(transparent,black)] after:absolute after:top-0 after:left-1/2 after:size-0.5 after:-translate-x-1/2 after:rounded-full after:bg-current",
  {
    variants: {
      size: {
        sm: "size-4",
        default: "size-5",
        lg: "size-7",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function LoadingIndicator({
  className,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof loadingIndicatorVariants>) {
  return (
    <span
      data-slot="loading-indicator"
      role="status"
      aria-label="Loading"
      className={cn(loadingIndicatorVariants({ size }), className)}
      {...props}
    />
  );
}

export { LoadingIndicator };
