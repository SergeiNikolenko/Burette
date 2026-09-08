import { withMenuIcons } from "./menu-icons";
import { isTauriRuntime } from "../lib/tauri";
import type { MenuItemSpec } from "./menu-types";
import { showRadixContextMenu } from "./radix-menu";

export async function showNativeContextMenu(
  spec: MenuItemSpec[],
  at?: { x: number; y: number },
  options: { forceWeb?: boolean } = {},
): Promise<boolean> {
  if (!options.forceWeb) spec = withMenuIcons(spec);
  if (options.forceWeb || !isTauriRuntime()) {
    showRadixContextMenu(spec, at);
    return true;
  }

  const { showMacContextMenu } = await import("./mac-context-menu");
  if (await showMacContextMenu(spec, at)) return true;

  const [{ LogicalPosition }, { Menu }, { MenuItem }, { CheckMenuItem }, { PredefinedMenuItem }, { Submenu }, { IconMenuItem }] = await Promise.all([
    import("@tauri-apps/api/dpi"),
    import("@tauri-apps/api/menu/menu"),
    import("@tauri-apps/api/menu/menuItem"),
    import("@tauri-apps/api/menu/checkMenuItem"),
    import("@tauri-apps/api/menu/predefinedMenuItem"),
    import("@tauri-apps/api/menu/submenu"),
    import("@tauri-apps/api/menu/iconMenuItem"),
  ]);

  // A native menu holds commands, so the richer kinds map down to what AppKit
  // can draw: a heading becomes a disabled caption, a checkbox its own item
  // type. Swatches and parameter fields have no native form at all - the menus
  // that carry them are opened with forceWeb, and dropping them here keeps a
  // native fallback usable instead of failing to build.
  const items = await Promise.all(
    spec.flatMap((entry) => {
      if (entry.kind === "separator") {
        return [PredefinedMenuItem.new({ item: "Separator" })];
      }
      if (entry.kind === "label") {
        return [MenuItem.new({ id: entry.id, text: entry.text, enabled: false })];
      }
      if (entry.kind === "checkbox") {
        return [CheckMenuItem.new({
          id: entry.id,
          text: entry.text,
          checked: entry.checked,
          enabled: !entry.disabled,
          ...(entry.disabled || !entry.action ? {} : { action: () => entry.action?.(!entry.checked) }),
          ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
        })];
      }
      if (entry.kind === "submenu") {
        return [Promise.all(entry.items.flatMap((child) => child.kind === "item"
          ? [(child.nativeIcon ? IconMenuItem : MenuItem).new({
              ...(child.nativeIcon ? { icon: child.nativeIcon } : {}),
              id: child.id,
              text: child.text,
              enabled: !child.disabled,
              ...(child.disabled || !child.action ? {} : { action: child.action }),
              ...(child.accelerator ? { accelerator: child.accelerator } : {}),
            })]
          : child.kind === "separator" ? [PredefinedMenuItem.new({ item: "Separator" })] : []))
          .then((items) => Submenu.new({ id: entry.id, text: entry.text, enabled: !entry.disabled, items, ...(entry.nativeIcon ? { icon: entry.nativeIcon } : {}) }))];
      }
      if (entry.kind !== "item") return [];
      return [(entry.nativeIcon ? IconMenuItem : MenuItem).new({
        ...(entry.nativeIcon ? { icon: entry.nativeIcon } : {}),
        id: entry.id,
        text: entry.text,
        enabled: !entry.disabled,
        ...(entry.disabled || !entry.action ? {} : { action: entry.action }),
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      })];
    }),
  );

  const menu = await Menu.new({ items });
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
  return true;
}
