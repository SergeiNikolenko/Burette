import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { buttonPressScale } from "./button-press-scale";
// Styles enter through the shell stylesheet or Grid's embedded Atlas source.

// Atlas dialogs and toasts use the app button (Bundle.bE, medium/compact),
// not the SDK's pill button (Bundle.Mon). Their action rows supply this scope.
const ButtonStyleContext = React.createContext<"sdk" | "app">("sdk");
const appVariants = {
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
  settings: "xl",
  "icon-2xs": "3xs", "icon-xs": "xs", "icon-sm": "md", "icon-lg": "xl",
  toolbar: "md", "icon-toolbar": "md",
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
  const appearance = React.useContext(ButtonStyleContext);
  const toolbar = size === "toolbar" || size === "icon-toolbar";
  const appAction = toolbar || size === "settings" || (appearance === "app" && (size === "default" || size === "xs"));
  const Comp = asChild ? Slot.Root : "button";
  const child = asChild ? React.Children.only(children) : null;
  const childContent = React.isValidElement<{ children?: React.ReactNode }>(child) ? child.props.children : children;
  const content = appAction ? childContent : <span className="atlas-button-inner">{childContent}</span>;

  return (
    <Comp
      type={type ?? (asChild ? undefined : "button")}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-atlas-variant={appAction ? undefined : variants[variant]}
      data-atlas-size={appAction ? undefined : sizes[size]}
      data-color={variant === "destructive" ? "danger" : variant === "link" ? "info" : "primary"}
      data-pill={size.startsWith("icon") ? undefined : ""}
      data-uniform={size.startsWith("icon") ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        "group/button inline-flex items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        appAction
          ? "no-drag cursor-(--cursor-interaction) select-none disabled:cursor-default aria-disabled:cursor-default focus:outline-hidden disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-0 whitespace-nowrap border gap-1"
          : "atlas-button",
        appAction && (toolbar ? "h-(--spacing-token-button-composer) rounded-(--radius-button-toolbar) px-(--spacing-button-toolbar-inline) py-0 text-sm leading-[18px] [&_svg]:size-4"
          : size === "settings" ? "h-9 rounded-md px-2 py-1 text-sm leading-none"
          : size === "xs" ? "h-6 rounded-(--radius-button-action) px-2 py-0 text-xs leading-4"
          : "rounded-(--radius-button-action) px-4 py-1.5 text-base leading-[18px]"),
        size === "icon-toolbar" && "aspect-square shrink-0 px-0",
        appAction && appVariants[variant],
        variant === "link" && "underline-offset-4 hover:underline", className,
      )}
      onPointerEnter={(event) => {
        // Original Atlas press scale, based on the actual rendered width.
        if (!appAction) {
          const width = event.currentTarget.offsetWidth;
          const scale = buttonPressScale(width);
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
