import type { MenuItemSpec } from "../context-menu";
import { showNativeContextMenu } from "../context-menu";

export type BulkMenuActionId = "delete" | "copy-relative-paths" | "copy-absolute-paths";

export type BulkContextMenuHandlers = {
  onCopyRelativePaths: () => void;
  onCopyAbsolutePaths: () => void;
  onDelete: () => void;
};

export function buildBulkMenuItemsSpec(
  handlers: BulkContextMenuHandlers,
  count: number,
): MenuItemSpec[] {
  return [
    { kind: "item", id: "copy-relative-paths", text: `Copy ${count} relative paths`, action: handlers.onCopyRelativePaths },
    { kind: "item", id: "copy-absolute-paths", text: `Copy ${count} absolute paths`, action: handlers.onCopyAbsolutePaths },
    { kind: "separator" },
    { kind: "item", id: "delete", text: `Delete ${count} items`, action: handlers.onDelete },
  ];
}

export async function showBulkContextMenu(
  handlers: BulkContextMenuHandlers,
  count: number,
): Promise<void> {
  await showNativeContextMenu(buildBulkMenuItemsSpec(handlers, count));
}
