import type { MenuItemSpec } from "../context-menu";
import { showNativeContextMenu } from "../context-menu";

export type TabMenuActionId =
  | "close"
  | "close-others"
  | "close-all"
  | "reveal-in-sidebar"
  | "copy-path";

export interface TabMenuHandlers {
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onRevealInSidebar: () => void;
  onCopyPath: () => void;
}

export function buildTabMenuItemsSpec(handlers: TabMenuHandlers): MenuItemSpec[] {
  return [
    { kind: "item", id: "close", text: "Close", action: handlers.onClose },
    { kind: "item", id: "close-others", text: "Close others", action: handlers.onCloseOthers },
    { kind: "item", id: "close-all", text: "Close all", action: handlers.onCloseAll },
    { kind: "separator" },
    {
      kind: "item",
      id: "reveal-in-sidebar",
      text: "Reveal in sidebar",
      action: handlers.onRevealInSidebar,
    },
    { kind: "item", id: "copy-path", text: "Copy path", action: handlers.onCopyPath },
  ];
}

export { showNativeContextMenu };
