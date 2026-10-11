import type { ComponentProps, CSSProperties } from "react";

import { cn } from "@/lib/utils";
import "./loading-indicator.atlas.css";

const sizes = { sm: 16, default: 20, lg: 28 };

function LoadingIndicator({
  className,
  size = "default",
  strokeWidth,
  style,
  ...props
}: ComponentProps<"span"> & { size?: keyof typeof sizes | number; strokeWidth?: number }) {
  return (
    <span
      data-slot="loading-indicator"
      role="status"
      aria-label="Loading"
      className={cn("atlas-loading-indicator inline-block shrink-0 motion-reduce:animate-none motion-reduce:transition-none", className)}
      style={{
        "--indicator-size": `${typeof size === "number" ? size : sizes[size]}px`,
        ...(strokeWidth !== undefined && { "--indicator-stroke": `${strokeWidth}px` }),
        ...style,
      } as CSSProperties}
      {...props}
    />
  );
}

export { LoadingIndicator };
