import { Orbit } from "lucide-react";
import { ArrowLeft, Search, SettingsCog as Settings } from "@/components/ui/app-icons";

// Shared Apps SDK glyphs and the scientific Lucide Orbit keep the existing
// CSS micro-animations in styles.css, inspired by Animate UI.
// Hover behavior belongs to the control, not to the glyph family.

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

export function AnimatedOrbitIcon({ size = 16, className, strokeWidth = 2 }: AnimatedIconProps) {
  return <Orbit size={size} strokeWidth={strokeWidth} className={cx("anim-icon anim-icon-orbit", className)} aria-hidden />;
}
