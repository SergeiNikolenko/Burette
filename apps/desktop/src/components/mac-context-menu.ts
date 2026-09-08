import { nativeMenuImage } from "./menu-icons";
import { invoke } from "@tauri-apps/api/core";
import type { MenuItemSpec } from "./menu-types";

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
  "close-tab": "xmark",
  "close-other-tabs": "rectangle.stack.badge.minus",
  "close-tabs-right": "rectangle.trailinghalf.inset.filled",
  "close-all-tabs": "xmark.rectangle",
  "save-as": "square.and.arrow.down",
  "save-collection-as": "square.and.arrow.down",
  "open-files": "arrow.up.forward",
  "add-project": "plus",
  "new-molecule": "pencil",
  "recent-files": "clock",
};

type NativeEntry =
  | { kind: "separator" }
  | { kind: "item"; id: string; text: string; enabled: boolean; symbol?: string; image?: string; accelerator?: string; checked?: boolean }
  | { kind: "submenu"; id: string; text: string; enabled: boolean; symbol?: string; image?: string; items: NativeEntry[] };
type PopupResult = { kind: "shown"; selection: string | null } | { kind: "unsupported" };

export async function showMacContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }): Promise<boolean> {
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
  const serialize = (entries: MenuItemSpec[]): NativeEntry[] => entries.flatMap((entry): NativeEntry[] => {
    if (entry.kind === "separator") return [{ kind: "separator" }];
    if (entry.kind === "label") return [{ kind: "item", id: entry.id, text: entry.text, enabled: false }];
    if (entry.kind !== "item" && entry.kind !== "submenu" && entry.kind !== "checkbox") return [];
    const symbol = ("nativeSymbol" in entry ? entry.nativeSymbol : undefined) ?? symbols[entry.id];
    const common = { id: entry.id, text: entry.text, enabled: !entry.disabled, ...(images.has(entry.id) ? { image: images.get(entry.id) } : symbol ? { symbol } : {}) };
    if (entry.kind === "submenu") return [{ kind: "submenu", ...common, items: serialize(entry.items) }];
    if (!entry.disabled && entry.action) {
      actions.set(entry.id, entry.kind === "checkbox" ? () => entry.action?.(!entry.checked) : entry.action);
    }
    return [{ kind: "item", ...common,
      ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      ...(entry.kind === "checkbox" ? { checked: entry.checked } : {}),
    }];
  });
  const result = await invoke<PopupResult>("popup_macos_context_menu", { items: serialize(spec), at });
  if (result.kind === "unsupported") return false;
  if (result.selection) await actions.get(result.selection)?.();
  return true;
}
