import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu/menu";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as tauri from "../lib/tauri";
import { getRelativePath } from "../lib/paths";
import { detectPlatform, revealLabelForPlatform } from "./sidebar/context-menu-utils";

export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; action: () => void; accelerator?: string }
  | { kind: "separator" }
  | { kind: "submenu"; text: string; items: MenuItemSpec[] };

export function revealLabel() {
  return revealLabelForPlatform(detectPlatform());
}

export function relativePath(path: string, root: string | null) {
  return root ? getRelativePath(path, root) : path;
}

export async function copyText(text: string) {
  await writeText(text);
}

export async function revealPath(path: string) {
  await tauri.revealPath(path);
}

async function buildMenuItems(
  spec: MenuItemSpec[],
): Promise<Array<MenuItem | PredefinedMenuItem | Submenu>> {
  return Promise.all(
    spec.map(async (entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      if (entry.kind === "submenu") {
        const items = await buildMenuItems(entry.items);
        return Submenu.new({ text: entry.text, items });
      }
      return MenuItem.new({
        id: entry.id,
        text: entry.text,
        action: entry.action,
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      });
    }),
  );
}

export async function showNativeContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }) {
  const items = await buildMenuItems(spec);
  const menu = await Menu.new({ items });
  if (at) {
    await menu.popup(new LogicalPosition(at.x, at.y));
  } else {
    await menu.popup();
  }
}
