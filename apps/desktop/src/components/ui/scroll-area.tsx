import type React from "react";

import { cn } from "@/lib/utils";

// Codex scrolls natively: every element gets a thin scrollbar tinted with the
// Atlas --scrollbar-color token (see the app shell rule in styles.css). The
// root/viewport split stays so callers can size the frame and own the scroller.
export function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportProps,
  viewportRef,
  ...props
}: React.ComponentProps<"div"> & {
  viewportClassName?: string;
  viewportProps?: React.ComponentProps<"div">;
  viewportRef?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
  const { className: viewportPropsClassName, ref: viewportPropsRef, ...viewportHtmlProps } = viewportProps ?? {};
  return (
    <div className={cn("size-full min-h-0", className)} {...props}>
      <div
        {...viewportHtmlProps}
        ref={composeRefs(viewportPropsRef, viewportRef)}
        className={cn(
          "h-full overflow-auto rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          viewportPropsClassName,
          viewportClassName,
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </div>
    </div>
  );
}

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}
