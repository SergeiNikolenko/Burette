import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Codex-style buttons: pill shape, 13px label, neutral fills and subtle gray hover and press shifts.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-[13px] leading-[18px] font-[450] whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-foreground/10 bg-foreground text-background hover:bg-foreground/80 active:bg-foreground/75 aria-expanded:bg-foreground/80",
        secondary:
          "bg-foreground/5 text-foreground hover:bg-foreground/10 active:bg-foreground/12 aria-expanded:bg-foreground/10 aria-pressed:bg-foreground/10 dark:bg-foreground/10 dark:hover:bg-foreground/15 dark:active:bg-foreground/18 dark:aria-expanded:bg-foreground/15 dark:aria-pressed:bg-foreground/15",
        outline:
          "border-border bg-transparent text-foreground hover:bg-foreground/5 active:bg-foreground/8 aria-expanded:bg-foreground/5 aria-pressed:bg-foreground/8 dark:border-foreground/15 dark:hover:bg-foreground/10 dark:aria-expanded:bg-foreground/10 dark:aria-pressed:bg-foreground/12",
        ghost:
          "text-muted-foreground hover:bg-foreground/5 hover:text-foreground active:bg-foreground/8 aria-expanded:bg-foreground/5 aria-expanded:text-foreground aria-pressed:bg-foreground/8 aria-pressed:text-foreground dark:hover:bg-foreground/10 dark:aria-expanded:bg-foreground/10 dark:aria-pressed:bg-foreground/12",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/15 active:bg-destructive/20 aria-expanded:bg-destructive/15 focus-visible:ring-destructive/30 dark:bg-destructive/20 dark:hover:bg-destructive/25 dark:active:bg-destructive/30",
        link: "text-foreground underline-offset-4 decoration-foreground/40 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs leading-4 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4 text-sm leading-5 font-medium has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
