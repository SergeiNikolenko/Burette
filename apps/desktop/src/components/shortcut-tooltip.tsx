import type { ComponentProps, ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Kbd } from "./ui/kbd";

type ShortcutTooltipProps = Omit<ComponentProps<typeof TooltipTrigger>, "children" | "asChild"> & {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom";
  children: ReactElement;
};

export function ShortcutTooltip({ label, shortcut, side = "bottom", children, ...triggerProps }: ShortcutTooltipProps) {
  return (
    <TooltipProvider><Tooltip>
      <TooltipTrigger asChild {...triggerProps}>{children}</TooltipTrigger>
      <TooltipContent variant="floating" side={side} maxWidth={320} collisionPadding={8}>
        <span className="flex items-center gap-2">
          <span className="min-w-0">{label}</span>
          {shortcut ? <Kbd className="shrink-0 -me-1.75!">{shortcut}</Kbd> : null}
        </span>
      </TooltipContent>
    </Tooltip></TooltipProvider>
  );
}
