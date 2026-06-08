export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; detail?: string; iconText?: string; iconUrl?: string; action?: () => void; accelerator?: string; disabled?: boolean }
  | { kind: "separator" };
