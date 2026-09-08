import { X } from "@/components/ui/app-icons";

export function CloseIcon({ size = 14 }: { size?: number }) {
  return <X size={size} strokeWidth={2} className="close-glyph" aria-hidden />;
}
