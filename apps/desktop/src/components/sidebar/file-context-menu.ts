import type { MenuItemSpec } from "../context-menu";
import { showNativeContextMenu } from "../context-menu";
import { detectPlatform, revealLabelForPlatform, type Platform } from "./context-menu-utils";

export { detectPlatform, revealLabelForPlatform, type Platform } from "./context-menu-utils";

export type FileMenuActionId =
  | "open"
  | "open-in-new-tab"
  | "duplicate"
  | "copy-relative-path"
  | "copy-absolute-path"
  | "reveal"
  | "delete";

export type FileContextMenuHandlers = {
  onOpen: () => void;
  onOpenInNewTab: () => void;
  onDuplicate: () => void;
  onCopyRelativePath: () => void;
  onCopyAbsolutePath: () => void;
  onReveal: () => void;
  onDelete: () => void;
};

export function buildFileMenuItemsSpec(
  handlers: FileContextMenuHandlers,
  platform: Platform = detectPlatform(),
): MenuItemSpec[] {
  return [
    { kind: "item", id: "open", text: "Open", action: handlers.onOpen },
    { kind: "item", id: "open-in-new-tab", text: "Open in new tab", action: handlers.onOpenInNewTab },
    { kind: "separator" },
    { kind: "item", id: "duplicate", text: "Duplicate", action: handlers.onDuplicate },
    { kind: "separator" },
    { kind: "item", id: "copy-relative-path", text: "Copy relative path", action: handlers.onCopyRelativePath },
    { kind: "item", id: "copy-absolute-path", text: "Copy absolute path", action: handlers.onCopyAbsolutePath },
    { kind: "separator" },
    { kind: "item", id: "reveal", text: revealLabelForPlatform(platform), action: handlers.onReveal },
    { kind: "separator" },
    { kind: "item", id: "delete", text: "Delete", action: handlers.onDelete },
  ];
}

export async function showFileContextMenu(handlers: FileContextMenuHandlers): Promise<void> {
  await showNativeContextMenu(buildFileMenuItemsSpec(handlers));
}
