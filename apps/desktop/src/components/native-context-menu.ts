import { isTauriRuntime } from "../lib/tauri";
import type { MenuItemSpec } from "./menu-types";
import { showRadixContextMenu } from "./radix-menu";

export async function showNativeContextMenu(
  spec: MenuItemSpec[],
  at?: { x: number; y: number },
  options: { forceWeb?: boolean } = {},
): Promise<boolean> {
  if (options.forceWeb || !isTauriRuntime()) {
    showRadixContextMenu(spec, at);
    return true;
  }

  const [{ LogicalPosition }, { Menu }, { MenuItem }, { PredefinedMenuItem }] = await Promise.all([
    import("@tauri-apps/api/dpi"),
    import("@tauri-apps/api/menu/menu"),
    import("@tauri-apps/api/menu/menuItem"),
    import("@tauri-apps/api/menu/predefinedMenuItem"),
  ]);

  const items = await Promise.all(
    spec.map((entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      return MenuItem.new({
        id: entry.id,
        text: entry.text,
        enabled: !entry.disabled,
        ...(entry.disabled || !entry.action ? {} : { action: entry.action }),
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      });
    }),
  );

  const menu = await Menu.new({ items });
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
  return true;
}
