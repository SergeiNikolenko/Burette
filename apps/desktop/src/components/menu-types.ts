export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; action?: () => void; accelerator?: string; disabled?: boolean }
  | { kind: "separator" };
