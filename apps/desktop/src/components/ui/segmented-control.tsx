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
    className={cn("atlas-segmented-control", className)}
    onWheel={event => { event.currentTarget.scrollLeft += event.deltaX || event.deltaY; props.onWheel?.(event); }}
  >{children}</ToggleGroupPrimitive.Root>;
}

function SegmentedControlItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item {...props} data-slot="segmented-control-item" className={cn("atlas-segmented-control-item", className)} />;
}

export { SegmentedControl, SegmentedControlItem };
