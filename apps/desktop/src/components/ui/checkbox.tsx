import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Check, Minus } from "@/components/ui/app-icons";
import "./checkbox.css";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn("peer atlas-checkbox", className)} {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <Check size={14} className="checkbox-check" aria-hidden />
        <Minus size={14} className="checkbox-mixed" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
