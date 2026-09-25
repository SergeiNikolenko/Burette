import { nativeMenuImage } from "./menu-icons";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MenuItemSpec, MenuPresentation } from "./menu-types";

// SDK icons become AppKit template images. Older menu surfaces may still name
// an SF Symbol; explicit SDK images take precedence.
const symbols: Record<string, string> = {
  "open-structure": "arrow.up.forward",
  "open-structure-as": "doc.text",
  "open-structure-viewer": "cube.transparent",
  "open-structure-as-text": "doc.text",
  "open-file-beside": "rectangle.righthalf.inset.filled",
  "open-tab-right-panel": "rectangle.righthalf.inset.filled",
  "add-file-to-scene": "square.stack.3d.up",
  "edit-file-ketcher": "pencil",
  "open-file-default-app": "arrow.up.forward.app",
  "reveal-structure": "arrow.up.forward",
  "copy-structure-path": "link",
  "pin-structure": "pin",
  "unpin-structure": "pin.slash",
  "rename-file": "pencil",
  "duplicate-file": "plus.square.on.square",
  "save-file-copy": "square.and.arrow.down",
  "trash-file": "trash",
  "open-project-molstar-scene": "square.stack.3d.up",
  "open-folder-documents": "rectangle.on.rectangle",
  "open-folder-molstar-scene": "square.stack.3d.up",
  "copy-folder-path": "link",
  "rename-folder": "pencil",
  "add-project-folder": "plus",
  "open-active-project-folder": "arrow.up.forward",
  "open-project-tabs": "rectangle.on.rectangle",
  "open-project-folder-molstar-scene": "square.stack.3d.up",
  "open-project-folder": "arrow.up.forward",
  "pin-project": "pin",
  "unpin-project": "pin.slash",
  "rename-project": "pencil",
  "rename-project-folder": "pencil",
  "copy-project-path": "link",
  "remove-project": "minus.circle",
  "pin-tab": "pin",
  "unpin-tab": "pin.slash",
  "show-tab-in-sidebar": "sidebar.left",
  "open-tab-document-as-text": "doc.text",
  "reveal-tab-document": "arrow.up.forward",
  "reveal-tab-text-file": "arrow.up.forward",
  "copy-tab-document-path": "link",
  "copy-tab-text-file-path": "link",
  "open-tab-folder-molstar-scene": "square.stack.3d.up",
  "select-all-tabs": "checkmark.rectangle.stack",
  "clear-tab-selection": "rectangle.stack",
  "save-as": "square.and.arrow.down",
  "save-collection-as": "square.and.arrow.down",
  "open-files": "arrow.up.forward",
  "add-project": "plus",
  "new-molecule": "pencil",
  "recent-files": "clock",
};

type NativeEntry =
  | { kind: "separator" }
  | { kind: "item"; id: string; text: string; enabled: boolean; symbol?: string; image?: string; subtitle?: string; accelerator?: string; checked?: boolean }
  | { kind: "submenu"; id: string; text: string; enabled: boolean; symbol?: string; image?: string; subtitle?: string; items: NativeEntry[] }
  | { kind: "slider"; id: string; text: string; symbol?: string; value: number; min: number; max: number; step: number; unit?: string }
  | { kind: "colours"; id: string; colors: string[]; active?: string };
type PopupResult = { kind: "shown"; selection: string | null } | { kind: "unsupported" };
type MenuValue = { session: string; id: string; value: number | string };

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export async function showMacContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }, presentation: MenuPresentation = "context"): Promise<boolean> {
  const images = new Map<string, string>();
  const prepare = async (entries: MenuItemSpec[]): Promise<void> => {
    await Promise.all(entries.map(async entry => {
      if (entry.kind !== "item" && entry.kind !== "submenu") return;
      if (entry.iconUrl?.startsWith("data:image/svg+xml")) images.set(entry.id, await nativeMenuImage(entry.iconUrl));
      if (entry.kind === "submenu") await prepare(entry.items);
    }));
  };
  await prepare(spec);
  const actions = new Map<string, () => unknown>();
  // Sliders and swatches apply while the menu is still open, not on close.
  const live = new Map<string, (value: number | string) => unknown>();
  const serialize = (entries: MenuItemSpec[]): NativeEntry[] => entries.flatMap((entry): NativeEntry[] => {
    if (entry.kind === "separator") return [{ kind: "separator" }];
    if (entry.kind === "label") return [{ kind: "item", id: entry.id, text: entry.text, enabled: false }];
    if (entry.kind === "number") {
      if (entry.action && !entry.disabled) live.set(entry.id, (value) => entry.action?.(Number(value)));
      const min = entry.min ?? 0;
      return [{ kind: "slider", id: entry.id, text: entry.label, value: entry.value, min, max: entry.max ?? Math.max(min + 1, entry.value),
        step: entry.step ?? 0, ...(entry.unit ? { unit: entry.unit } : {}), ...(entry.nativeSymbol ? { symbol: entry.nativeSymbol } : {}) }];
    }
    if (entry.kind === "swatches") {
      if (entry.action) live.set(entry.id, (value) => entry.action?.(String(value)));
      const colors = entry.colors.filter((colour) => HEX_COLOUR.test(colour));
      return [{ kind: "colours", id: entry.id, colors,
        ...(entry.activeColor && HEX_COLOUR.test(entry.activeColor) ? { active: entry.activeColor } : {}) }];
    }
    if (entry.kind === "select") {
      // A choice is a submenu whose current option carries the checkmark.
      return [{ kind: "submenu", id: entry.id, text: entry.label, enabled: !entry.disabled && entry.options.length > 0,
        items: entry.options.map((option) => {
          const id = `${entry.id}:${option}`;
          if (entry.action) actions.set(id, () => entry.action?.(option));
          return { kind: "item", id, text: entry.optionLabels?.[option] ?? option, enabled: true, checked: option === entry.value };
        }) }];
    }
    const symbol = ("nativeSymbol" in entry ? entry.nativeSymbol : undefined) ?? symbols[entry.id];
    const common = { id: entry.id, text: entry.text, enabled: !entry.disabled,
      ...(entry.detail ? { subtitle: entry.detail } : {}),
      ...(images.has(entry.id) ? { image: images.get(entry.id) } : symbol ? { symbol } : {}) };
    if (entry.kind === "submenu") return [{ kind: "submenu", ...common, items: serialize(entry.items) }];
    if (!entry.disabled && entry.action) {
      actions.set(entry.id, entry.kind === "checkbox" ? () => entry.action?.(!entry.checked) : entry.action);
    }
    return [{ kind: "item", ...common,
      ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      ...(entry.kind === "checkbox" ? { checked: entry.checked } : {}),
    }];
  });
  const items = serialize(spec);
  const session = crypto.randomUUID();
  const unlisten = live.size
    ? await listen<MenuValue>("native-context-menu-value", ({ payload }) => {
        if (payload.session === session) void live.get(payload.id)?.(payload.value);
      })
    : undefined;
  let result: PopupResult;
  try {
    result = await invoke<PopupResult>("popup_macos_context_menu", { items, at, session, presentation });
  } finally {
    unlisten?.();
  }
  if (result.kind === "unsupported") return false;
  if (result.selection) await actions.get(result.selection)?.();
  return true;
}
