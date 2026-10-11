import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Spinner({ className, onAnimationStart, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-[18px] shrink-0 animate-spin items-center justify-center leading-none [contain:content] [animation-duration:2s] [animation-timing-function:steps(60)] motion-reduce:animate-none", className)}
      onAnimationStart={event => {
        // Atlas Spinner uses the document timeline so later arrivals stay in phase.
        for (const animation of event.currentTarget.getAnimations()) animation.startTime = 0;
        onAnimationStart?.(event);
      }}
      {...props}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-full">
        <path opacity="0.3" d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z" fill="currentColor" />
        <path d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z" fill="currentColor" />
      </svg>
    </span>
  );
}

export { Spinner };
