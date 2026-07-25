// A menu here is not just a list of commands. An engine menu carries the
// parameters the run will use, a scope menu carries what is currently chosen,
// and a component menu carries the colour it is drawn in - so the menu models
// headings, state and small controls rather than pushing all of that into a
// separate settings panel.
export type MenuItemSpec =
  // `detail` prints a second line and widens the menu; `tooltip` keeps the same
  // sentence one hover away without turning a command list into prose.
  | { kind: "item"; id: string; text: string; detail?: string; tooltip?: string; iconText?: string; iconUrl?: string; action?: () => void; accelerator?: string; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "label"; id: string; text: string }
  | { kind: "checkbox"; id: string; text: string; checked: boolean; detail?: string; accelerator?: string; disabled?: boolean; action?: (checked: boolean) => void }
  | { kind: "swatches"; id: string; colors: string[]; activeColor?: string; label?: string; action?: (color: string) => void }
  | { kind: "select"; id: string; label: string; value: string; options: readonly string[]; optionLabels?: Record<string, string>; disabled?: boolean; action?: (value: string) => void }
  | { kind: "number"; id: string; label: string; value: number; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean; action?: (value: number) => void };
