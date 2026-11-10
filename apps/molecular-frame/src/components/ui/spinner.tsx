import type * as React from "react"

import { cn } from "@/lib/utils"

const RAY_OPACITY = [1, 0.88, 0.76, 0.64, 0.52, 0.4, 0.28, 0.16]

function Spinner({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"svg"> & { variant?: "default" | "rays" }) {
  const spin = "size-4 shrink-0 motion-safe:animate-[spin_2s_steps(60)_infinite]"
  if (variant === "rays") {
    return (
      <svg
        data-slot="spinner"
        data-variant="rays"
        role="status"
        aria-label="Loading"
        viewBox="0 0 20 20"
        fill="none"
        className={cn(spin, className)}
        {...props}
      >
        {RAY_OPACITY.map((opacity, index) => (
          <line
            key={index}
            x1="10"
            y1="2.7"
            x2="10"
            y2="5.6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            opacity={opacity}
            transform={`rotate(${index * 45} 10 10)`}
          />
        ))}
      </svg>
    )
  }
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      className={cn(spin, className)}
      {...props}
    >
      <path
        opacity="0.3"
        fill="currentColor"
        d="M18 12a6 6 0 1 0-12 0 6 6 0 0 0 12 0Zm2 0a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
      />
      <path
        fill="currentColor"
        d="M12 4a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6V4Z"
      />
    </svg>
  )
}

function LoadingIndicator({
  size = 16,
  strokeWidth = 2,
  className,
  style,
  ...props
}: React.ComponentProps<"span"> & { size?: number; strokeWidth?: number }) {
  return (
    <span
      data-slot="loading-indicator"
      aria-hidden="true"
      className={cn(
        "relative inline-block shrink-0 animate-[spin_0.8s_linear_infinite] motion-reduce:animate-none",
        "before:absolute before:inset-0 before:rounded-full before:border-(length:--indicator-stroke) before:border-current before:content-[''] before:[mask-image:conic-gradient(#0000,#000)]",
        "after:absolute after:top-0 after:left-1/2 after:size-(--indicator-stroke) after:-translate-x-1/2 after:rounded-full after:bg-current after:content-['']",
        className
      )}
      style={
        {
          width: size,
          height: size,
          "--indicator-stroke": `${strokeWidth}px`,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { LoadingIndicator, Spinner }
