import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

// Atlas chrome ToolbarButton (aKt): SDK ghost/md, not the app action button.
export function ToolbarButton({ selected, className, ...props }: Omit<ComponentProps<typeof Button>, "size" | "variant"> & { selected?: boolean }) {
  return <Button
    variant="ghost"
    size="icon-sm"
    data-slot="toolbar-button"
    data-color="secondary"
    data-squircle=""
    data-icon-size="sm"
    data-selected={selected ? "" : undefined}
    aria-pressed={selected}
    className={cn(
      "pointer-events-auto [--button-ring-offset:0px] [--button-text-color:var(--color-text-tertiary)] [--button-text-color-hover:var(--color-text-tertiary)] data-[selected]:[--button-text-color:var(--color-text-primary-ghost)] data-[selected]:[--button-text-color-hover:var(--color-text-primary-ghost)]",
      className,
    )}
    {...props}
  />;
}
