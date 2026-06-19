import type { SystemIconName } from "./system-icon";

export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; detail?: string; iconSymbol?: SystemIconName; iconText?: string; iconUrl?: string; action?: () => void; accelerator?: string; disabled?: boolean }
  | { kind: "separator" };
