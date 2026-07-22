import { ArrowLeft, Search, Settings } from "lucide-react";

// Lucide icons with lightweight CSS micro-animations (see the .anim-icon rules in
// styles.css), in the spirit of the Animate UI icon set but dependency-free. They
// animate on hover of the icon / its button.

type AnimatedIconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function cx(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function AnimatedSettingsIcon({ size = 18, className, strokeWidth = 1.75 }: AnimatedIconProps) {
  return <Settings size={size} strokeWidth={strokeWidth} className={cx("anim-icon anim-icon-spin", className)} aria-hidden />;
}

export function AnimatedBackIcon({ size = 16, className, strokeWidth = 2 }: AnimatedIconProps) {
  return <ArrowLeft size={size} strokeWidth={strokeWidth} className={cx("anim-icon anim-icon-nudge-left", className)} aria-hidden />;
}

export function AnimatedSearchIcon({ size = 16, className, strokeWidth = 2 }: AnimatedIconProps) {
  return <Search size={size} strokeWidth={strokeWidth} className={cx("anim-icon anim-icon-pop", className)} aria-hidden />;
}
