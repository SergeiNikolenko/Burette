import { X } from "lucide-react";

export function CloseIcon({ size = 14 }: { size?: number }) {
  return <X size={size} strokeWidth={2} className="close-glyph" aria-hidden />;
}
