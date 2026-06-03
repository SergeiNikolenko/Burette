import { isTauriRuntime } from "../lib/tauri";

export type MenuItemSpec =
  | { kind: "item"; id: string; text: string; action?: () => void; accelerator?: string; disabled?: boolean }
  | { kind: "separator" };

export async function showNativeContextMenu(
  spec: MenuItemSpec[],
  at?: { x: number; y: number },
  options: { forceWeb?: boolean } = {},
): Promise<boolean> {
  if (options.forceWeb || !isTauriRuntime()) {
    showWebContextMenu(spec, at);
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

function showWebContextMenu(spec: MenuItemSpec[], at?: { x: number; y: number }) {
  const existing = document.querySelector(".native-context-menu");
  existing?.remove();

  const menu = document.createElement("div");
  menu.className = "native-context-menu";
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;

  for (const entry of spec) {
    if (entry.kind === "separator") {
      const separator = document.createElement("div");
      separator.className = "native-context-menu-separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "native-context-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = entry.text;
    item.disabled = Boolean(entry.disabled);
    if (entry.disabled) {
      item.setAttribute("aria-disabled", "true");
    } else if (entry.action) {
      item.addEventListener("click", () => {
        cleanup();
        entry.action?.();
      });
    }
    menu.append(item);
  }

  const cleanup = () => {
    document.removeEventListener("pointerdown", onOutsidePointerDown);
    document.removeEventListener("keydown", onKeyDown);
    menu.remove();
  };
  const menuItems = () => Array.from(menu.querySelectorAll<HTMLButtonElement>(".native-context-menu-item:not(:disabled)"));
  const focusMenuItem = (index: number) => {
    const items = menuItems();
    if (items.length === 0) {
      menu.focus();
      return;
    }
    items[(index + items.length) % items.length]?.focus();
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node | null)) cleanup();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cleanup();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const items = menuItems();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Home") {
      focusMenuItem(0);
    } else if (event.key === "End") {
      focusMenuItem(items.length - 1);
    } else {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusMenuItem(activeIndex === -1 ? (direction === 1 ? 0 : items.length - 1) : activeIndex + direction);
    }
  };

  const themeHost = document.querySelector(".app-shell") ?? document.body;
  themeHost.append(menu);
  const x = Math.max(8, Math.min(at?.x ?? 8, window.innerWidth - menu.offsetWidth - 8));
  const y = Math.max(8, Math.min(at?.y ?? 8, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.addEventListener("pointerdown", onOutsidePointerDown);
  document.addEventListener("keydown", onKeyDown);
  focusMenuItem(0);
}
