import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { SelectControlIcon } from "./select";

export type NativeSelectControlProps = Omit<ComponentProps<"select">, "size"> & { size?: "sm" | "default" };

// Shared presentation for a real select. Popup ownership stays with the host:
// native in macOS, GridSelectMenu in the standalone browser viewer.
export function NativeSelectControl({ className, size = "default", ...props }: NativeSelectControlProps) {
  return <div data-slot="native-select-wrapper" data-size={size}
    className={cn("atlas-select", className)} data-atlas-size={size === "sm" ? "sm" : "md"} data-variant="outline"
    data-disabled={props.disabled ? "" : undefined}
    data-invalid={props["aria-invalid"] === true || props["aria-invalid"] === "true" ? "" : undefined}>
    <select {...props} data-slot="native-select" data-size={size} data-native-selectcontrol="" className="atlas-select-text" />
    <span className="atlas-select-indicator"><SelectControlIcon /></span>
  </div>;
}
