import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import "./button.atlas.css";
import "./button.css";

// Burette names map onto the original Atlas variants. Keep the existing public
// sizes so callers don't change layout when adopting the original component.
const variants = {
  default: "solid", secondary: "soft", outline: "surface", ghost: "ghost",
  destructive: "soft", link: "transparent",
} as const;
const sizes = {
  default: "lg", xs: "xs", sm: "md", lg: "xl", icon: "lg",
  "icon-2xs": "3xs", "icon-xs": "xs", "icon-sm": "md", "icon-lg": "xl",
} as const;

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
};

function Button({
  className, variant = "default", size = "default", asChild = false,
  children, disabled, type, onPointerEnter, ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const child = asChild ? React.Children.only(children) : null;
  const content = <span className="atlas-button-inner">{
    React.isValidElement<{ children?: React.ReactNode }>(child) ? child.props.children : children
  }</span>;

  return (
    <Comp
      type={type ?? (asChild ? undefined : "button")}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-atlas-variant={variants[variant]}
      data-atlas-size={sizes[size]}
      data-color={variant === "destructive" ? "danger" : variant === "link" ? "info" : "primary"}
      data-pill={size.startsWith("icon") ? undefined : ""}
      data-uniform={size.startsWith("icon") ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn("atlas-button group/button inline-flex items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0", variant === "link" && "underline-offset-4 hover:underline", className)}
      onPointerEnter={(event) => {
        // Original Atlas press scale, based on the actual rendered width.
        const width = event.currentTarget.offsetWidth;
        const scale = width <= 80 ? .96 : width <= 150 ? .97 : width <= 220 ? .98 : width > 600 ? .995 : .985;
        event.currentTarget.style.setProperty("--scale", String(scale));
        onPointerEnter?.(event);
      }}
      {...props}
    >
      {React.isValidElement(child) ? React.cloneElement(child, undefined, content) : content}
    </Comp>
  );
}

export { Button };
