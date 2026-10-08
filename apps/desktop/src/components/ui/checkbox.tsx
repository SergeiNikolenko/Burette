import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import "./checkbox.atlas.css";
import "./checkbox.css";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn("peer atlas-checkbox", className)} {...props}>
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="atlas-checkbox-mark"
        data-disabled={props.disabled ? "" : undefined}
        aria-hidden
      />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
