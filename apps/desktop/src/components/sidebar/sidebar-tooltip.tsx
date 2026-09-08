import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Forward trigger props and ref so dropdown menus keep their existing button.
export const SidebarTooltip = forwardRef<
  ElementRef<typeof TooltipTrigger>,
  ComponentPropsWithoutRef<typeof TooltipTrigger> & { label: string }
>(function SidebarTooltip({ label, children, ...props }, ref) {
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger {...props} asChild ref={ref}>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} showArrow={false}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
});
