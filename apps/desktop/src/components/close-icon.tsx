import { AnimatedCloseIcon } from "./ui/animated-icons";

export function CloseIcon({ size = 14 }: { size?: number }) {
  return <AnimatedCloseIcon size={size} className="close-glyph" />;
}
