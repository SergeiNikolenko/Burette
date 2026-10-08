import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import "./button.atlas.css";
import "./button.css";

// Atlas Dialog.Footer uses the app button (Bundle.bE, size="medium"),
// not the SDK's pill button (Bundle.Mon). Explicit compact/icon sizes keep
// their own appearance; the footer supplies the default for action buttons.
const ButtonStyleContext = React.createContext<"sdk" | "dialog">("sdk");
const dialogVariants = {
  default: "border-(--color-border) bg-(--color-background-primary-solid) not-disabled:not-aria-disabled:hover:bg-(--color-text)/80 data-[state=open]:bg-(--color-text)/80 text-(--color-text-primary-solid)",
  secondary: "text-(--color-text) bg-(--color-text)/5 not-disabled:not-aria-disabled:hover:bg-(--color-text)/10 data-[state=open]:bg-(--color-text)/10 border-transparent",
  outline: "border-(--color-border) bg-(--color-background-primary-soft-alpha) not-disabled:not-aria-disabled:hover:bg-(--color-background-primary-ghost-hover) data-[state=open]:bg-(--color-background-primary-ghost-hover)",
  ghost: "text-(--color-text-tertiary) not-disabled:not-aria-disabled:hover:bg-(--color-background-primary-ghost-hover) data-[state=open]:bg-(--color-background-primary-ghost-hover) border-transparent",
  destructive: "bg-(--color-chart-red)/10 not-disabled:not-aria-disabled:hover:bg-(--color-chart-red)/20 text-(--color-chart-red) border-transparent",
  link: "border-transparent text-(--color-text-info) underline-offset-4 hover:underline",
} as const;

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
  const dialogAction = React.useContext(ButtonStyleContext) === "dialog" && size === "default";
  const Comp = asChild ? Slot.Root : "button";
  const child = asChild ? React.Children.only(children) : null;
  const childContent = React.isValidElement<{ children?: React.ReactNode }>(child) ? child.props.children : children;
  const content = dialogAction ? childContent : <span className="atlas-button-inner">{childContent}</span>;

  return (
    <Comp
      type={type ?? (asChild ? undefined : "button")}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-atlas-variant={dialogAction ? undefined : variants[variant]}
      data-atlas-size={dialogAction ? undefined : sizes[size]}
      data-color={variant === "destructive" ? "danger" : variant === "link" ? "info" : "primary"}
      data-pill={size.startsWith("icon") ? undefined : ""}
      data-uniform={size.startsWith("icon") ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        "group/button inline-flex items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        dialogAction
          ? "no-drag cursor-(--cursor-interaction) select-none disabled:cursor-default aria-disabled:cursor-default focus:outline-hidden disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-0 whitespace-nowrap border gap-1 rounded-(--radius-button-action) px-4 py-1.5 text-base leading-[18px]"
          : "atlas-button",
        dialogAction && dialogVariants[variant],
        variant === "link" && "underline-offset-4 hover:underline", className,
      )}
      onPointerEnter={(event) => {
        // Original Atlas press scale, based on the actual rendered width.
        if (!dialogAction) {
          const width = event.currentTarget.offsetWidth;
          const scale = width <= 80 ? .96 : width <= 150 ? .97 : width <= 220 ? .98 : width > 600 ? .995 : .985;
          event.currentTarget.style.setProperty("--scale", String(scale));
        }
        onPointerEnter?.(event);
      }}
      {...props}
    >
      {React.isValidElement(child) ? React.cloneElement(child, undefined, content) : content}
    </Comp>
  );
}

export { Button, ButtonStyleContext };
