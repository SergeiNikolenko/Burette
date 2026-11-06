import { withMenuIcons } from "./menu-icons";
import { isMacPlatform } from "../lib/platform";
import { isTauriRuntime } from "../lib/tauri";
import type { MenuItemSpec, MenuPresentation } from "./menu-types";
import { showRadixContextMenu } from "./radix-menu";

export async function showNativeContextMenu(
  spec: MenuItemSpec[],
  at?: { x: number; y: number },
  options: { forceWeb?: boolean; presentation?: MenuPresentation; contentClassName?: string } = {},
): Promise<boolean> {
  if (!options.forceWeb) spec = withMenuIcons(spec);
  if (options.forceWeb || !isTauriRuntime()) {
    await showRadixContextMenu(spec, at, options.contentClassName);
    return true;
  }

  // The AppKit popup exists only on macOS; Linux and Windows go straight to the fallbacks.
  if (isMacPlatform()) {
    const { showMacContextMenu } = await import("./mac-context-menu");
    if (await showMacContextMenu(spec, at, options.presentation)) return true;
  }
  // Live controls and text fields exist only in the macOS popup; elsewhere the web menu keeps them.
  const hasControls = (entries: MenuItemSpec[]): boolean => entries.some((entry) =>
    entry.kind === "swatches" || entry.kind === "number" || entry.kind === "select" || entry.kind === "text"
    || (entry.kind === "submenu" && hasControls(entry.items)));
  if (hasControls(spec)) {
    await showRadixContextMenu(spec, at, options.contentClassName);
    return true;
  }

  const [{ LogicalPosition }, { Menu }, { MenuItem }, { CheckMenuItem }, { PredefinedMenuItem }, { Submenu }, { IconMenuItem }] = await Promise.all([
    import("@tauri-apps/api/dpi"),
    import("@tauri-apps/api/menu/menu"),
    import("@tauri-apps/api/menu/menuItem"),
    import("@tauri-apps/api/menu/checkMenuItem"),
    import("@tauri-apps/api/menu/predefinedMenuItem"),
    import("@tauri-apps/api/menu/submenu"),
    import("@tauri-apps/api/menu/iconMenuItem"),
  ]);
  type NativeMenuEntry = Awaited<ReturnType<typeof MenuItem.new | typeof CheckMenuItem.new | typeof PredefinedMenuItem.new
    | typeof Submenu.new | typeof IconMenuItem.new>>;

  // The Tauri menu API holds commands only: a heading becomes a disabled
  // caption and a checkbox its own item type, at any submenu depth.
  const build = (entries: MenuItemSpec[]): Promise<NativeMenuEntry>[] => entries.flatMap((entry): Promise<NativeMenuEntry>[] => {
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
      return [Promise.all(build(entry.items))
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
  });
  const items = await Promise.all(build(spec));

  const menu = await Menu.new({ items });
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
  return true;
}
