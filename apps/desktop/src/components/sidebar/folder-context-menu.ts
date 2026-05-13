import type { MenuItemSpec } from "../context-menu";
import { showNativeContextMenu } from "../context-menu";
import { detectPlatform, revealLabelForPlatform, type Platform } from "./context-menu-utils";

export type FolderMenuActionId =
  | "new-file"
  | "new-folder"
  | "copy-relative-path"
  | "copy-absolute-path"
  | "reveal"
  | "rename"
  | "delete";

export type FolderContextMenuHandlers = {
  onNewFile: () => void;
  onNewFolder: () => void;
  onCopyRelativePath: () => void;
  onCopyAbsolutePath: () => void;
  onReveal: () => void;
  onRename: () => void;
  onDelete: () => void;
};

export function buildFolderMenuItemsSpec(
  handlers: FolderContextMenuHandlers,
  platform: Platform = detectPlatform(),
): MenuItemSpec[] {
  return [
    { kind: "item", id: "new-file", text: "New File", action: handlers.onNewFile },
    { kind: "item", id: "new-folder", text: "New Folder", action: handlers.onNewFolder },
    { kind: "separator" },
    { kind: "item", id: "copy-relative-path", text: "Copy relative path", action: handlers.onCopyRelativePath },
    { kind: "item", id: "copy-absolute-path", text: "Copy absolute path", action: handlers.onCopyAbsolutePath },
    { kind: "separator" },
    { kind: "item", id: "reveal", text: revealLabelForPlatform(platform), action: handlers.onReveal },
    { kind: "separator" },
    { kind: "item", id: "rename", text: "Rename...", action: handlers.onRename },
    { kind: "item", id: "delete", text: "Delete", action: handlers.onDelete },
  ];
}

export async function showFolderContextMenu(handlers: FolderContextMenuHandlers): Promise<void> {
  await showNativeContextMenu(buildFolderMenuItemsSpec(handlers));
}
