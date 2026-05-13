import type { WorkspaceEntry } from "../../types";

export type FlatFileTreeItem = {
  entry: WorkspaceEntry;
  depth: number;
};

export function flattenTree(
  directory: string,
  cache: Map<string, WorkspaceEntry[]>,
  expanded: Set<string>,
  depth = 0,
  result: FlatFileTreeItem[] = [],
): FlatFileTreeItem[] {
  for (const entry of cache.get(directory) ?? []) {
    result.push({ entry, depth });
    if (entry.isDirectory && expanded.has(entry.path)) {
      flattenTree(entry.path, cache, expanded, depth + 1, result);
    }
  }
  return result;
}
