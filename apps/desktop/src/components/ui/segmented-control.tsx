import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Atlas ACc (app-initial-8a7b00193cb6): inset track and compact AppButton.
// Radix preserves Burette's existing roving focus and single-selection semantics.
function SegmentedControl({ className, value, onValueChange, children, ...props }:
  Omit<React.ComponentProps<typeof ToggleGroupPrimitive.Root>, "type" | "value" | "onValueChange" | "defaultValue" | "ref"> & {
    value: string;
    onValueChange: (value: string) => void;
  }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reveal = () => {
      const selected = root.querySelector<HTMLElement>('[data-state="on"]');
      if (!selected) return;
      const start = selected.offsetLeft;
      const end = start + selected.offsetWidth;
      if (start < root.scrollLeft) root.scrollLeft = start;
      else if (end > root.scrollLeft + root.clientWidth) root.scrollLeft = end - root.clientWidth;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(root);
    root.querySelectorAll("button").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value, children]);
  return <ToggleGroupPrimitive.Root
    {...props} ref={ref} type="single" value={value}
    onValueChange={next => { if (next) onValueChange(next); }}
    data-slot="segmented-control"
    className={cn("relative inline-flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-[10px] bg-(--segmented-control-background) p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    onWheel={event => { event.currentTarget.scrollLeft += event.deltaX || event.deltaY; props.onWheel?.(event); }}
  >{children}</ToggleGroupPrimitive.Root>;
}

function SegmentedControlItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item {...props} data-slot="segmented-control-item" className={cn(
    "no-drag inline-flex h-6 shrink-0 cursor-(--cursor-interaction) select-none items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-transparent px-2 py-0 text-xs leading-4 text-(--color-text-tertiary) disabled:cursor-default disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-0",
    "not-disabled:hover:bg-(--color-background-primary-ghost-hover) data-[state=on]:bg-(--color-surface) data-[state=on]:text-(--color-text) data-[state=on]:shadow-(--shadow-sm) data-[state=on]:hover:bg-(--color-surface)",
    className,
  )} />;
}

export { SegmentedControl, SegmentedControlItem };
