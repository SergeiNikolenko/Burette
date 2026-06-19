import { SystemIcon } from "./system-icon";

export function CloseIcon({ size = 14 }: { size?: number }) {
  return <SystemIcon name="xmark" className="close-glyph" size={size} strokeWidth={2.4} />;
}
