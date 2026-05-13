import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import * as tauri from "../../lib/tauri";
import type { ViewerDocument } from "../../types";
import type { ShellActions, ShellViewState } from "../types";
import {
  copyText,
  relativePath,
  revealPath,
} from "../context-menu";
import { showBulkContextMenu } from "./bulk-context-menu";
import { duplicateFile } from "./duplicate-file";
import { showFileContextMenu } from "./file-context-menu";
import { FileTreeNode } from "./file-tree-node";
import type { FlatFileTreeItem } from "./flatten-tree";
import { showFolderContextMenu } from "./folder-context-menu";
import { useAutoRefresh } from "./use-auto-refresh";
import { useFileTree } from "../../hooks/use-file-tree";

function documentByPath(documents: ViewerDocument[]) {
  return new Map(documents.map((document) => [document.path, document]));
}

function parentDir(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

async function fileExists(path: string) {
  return tauri.fileExists(path);
}

async function uniquePath(directory: string, stem: string, extension: string) {
  const first = `${directory}/${stem}${extension}`;
  if (!(await fileExists(first))) return first;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${directory}/${stem} ${index}${extension}`;
    if (!(await fileExists(candidate))) return candidate;
  }
  throw new Error("Could not find an available file name.");
}

async function runFsAction(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

export function FileTree({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const { error, items, hasRootEntry, loading, expanded, toggleDirectory, refreshDirectory, invalidatePath } = useFileTree(state.workspaceRoot);
  const documents = useMemo(() => documentByPath(state.documents), [state.documents]);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const clearSelection = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
    };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, [selectedPaths.size]);

  useAutoRefresh(state.workspaceRoot, !hasRootEntry && loading.size === 0, refreshDirectory);

  const closeDocumentsUnder = useCallback((path: string) => {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const document of state.documents) {
      if (document.path === path || document.path.startsWith(prefix)) {
        actions.closeDocument(document.id);
      }
    }
  }, [actions, state.documents]);

  const selectItem = useCallback((
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    item: FlatFileTreeItem,
    document: ViewerDocument | null,
  ) => {
    const isModifierClick = "metaKey" in event && (event.metaKey || event.ctrlKey);
    const isShiftClick = "shiftKey" in event && event.shiftKey;
    if (isShiftClick) {
      const anchor = selectionAnchor ?? items[0]?.entry.path ?? null;
      const anchorIndex = anchor ? items.findIndex((candidate) => candidate.entry.path === anchor) : -1;
      const targetIndex = items.findIndex((candidate) => candidate.entry.path === item.entry.path);
      if (anchorIndex === -1 || targetIndex === -1) return;
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      setSelectedPaths(new Set(items.slice(start, end + 1).map((candidate) => candidate.entry.path)));
      return;
    }
    if (isModifierClick) {
      setSelectedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(item.entry.path)) next.delete(item.entry.path);
        else next.add(item.entry.path);
        return next;
      });
      setSelectionAnchor(item.entry.path);
      return;
    }
    setSelectedPaths(new Set());
    setSelectionAnchor(item.entry.path);
    if (item.entry.isDirectory) {
      toggleDirectory(item.entry.path);
      return;
    }
    if (document) actions.selectDocument(document.id);
    else void actions.openWorkspaceFile(item.entry.path);
  }, [actions, items, selectionAnchor, toggleDirectory]);

  const renameItem = useCallback((item: FlatFileTreeItem, nextName: string) => {
    setRenamingPath(null);
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === item.entry.name) return;
    const fromPath = item.entry.path;
    const toPath = `${parentDir(fromPath)}/${trimmed}`;
    void runFsAction(async () => {
      if (await fileExists(toPath)) {
        window.alert(`An item named "${trimmed}" already exists.`);
        return;
      }
      await tauri.renameEntry(fromPath, toPath);
      if (item.entry.isDirectory) {
        closeDocumentsUnder(fromPath);
        invalidatePath(fromPath);
      } else {
        const document = documents.get(fromPath);
        if (document) actions.closeDocument(document.id);
      }
      await refreshDirectory(parentDir(fromPath));
    });
  }, [actions, closeDocumentsUnder, documents, invalidatePath, refreshDirectory]);

  const openContextMenu = useCallback((
    event: MouseEvent<HTMLElement>,
    item: FlatFileTreeItem,
    document: ViewerDocument | null,
  ) => {
    event.preventDefault();
    const { entry } = item;
    if (selectedPaths.size >= 2 && selectedPaths.has(entry.path)) {
      const paths = Array.from(selectedPaths);
      void showBulkContextMenu({
        onCopyRelativePaths: () => {
          void copyText(paths.map((path) => relativePath(path, state.workspaceRoot)).join("\n"));
        },
        onCopyAbsolutePaths: () => {
          void copyText(paths.join("\n"));
        },
        onDelete: () => {
          if (!window.confirm(`Delete ${paths.length} items?`)) return;
          void runFsAction(async () => {
            const parents = new Set<string>();
            for (const path of paths) {
              await tauri.deleteEntry(path);
              closeDocumentsUnder(path);
              invalidatePath(path);
              parents.add(parentDir(path));
            }
            setSelectedPaths(new Set());
            setSelectionAnchor(null);
            for (const parent of parents) await refreshDirectory(parent);
          });
        },
      }, paths.length);
      return;
    }

    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    const pathLabel = relativePath(entry.path, state.workspaceRoot);
    const copyPath = () => {
      void copyText(pathLabel);
    };
    const copyAbsolutePath = () => {
      void copyText(entry.path);
    };
    const reveal = () => {
      void revealPath(entry.path);
    };

    if (entry.isDirectory) {
      void showFolderContextMenu({
        onNewFile: () => {
          void runFsAction(async () => {
            const path = await uniquePath(entry.path, "Untitled", ".pdb");
            await tauri.createEmptyFile(path);
            if (!expanded.has(entry.path)) toggleDirectory(entry.path);
            await refreshDirectory(entry.path);
            setRenamingPath(path);
          });
        },
        onNewFolder: () => {
          void runFsAction(async () => {
            const path = await uniquePath(entry.path, "Untitled Folder", "");
            await tauri.createDirectory(path);
            if (!expanded.has(entry.path)) toggleDirectory(entry.path);
            await refreshDirectory(entry.path);
            setRenamingPath(path);
          });
        },
        onCopyRelativePath: copyPath,
        onCopyAbsolutePath: copyAbsolutePath,
        onReveal: reveal,
        onRename: () => setRenamingPath(entry.path),
        onDelete: () => {
          if (!window.confirm(`Delete "${entry.name}"?`)) return;
          void runFsAction(async () => {
            await tauri.deleteEntry(entry.path);
            closeDocumentsUnder(entry.path);
            invalidatePath(entry.path);
            await refreshDirectory(parentDir(entry.path));
          });
        },
      });
      return;
    }

    void showFileContextMenu({
      onOpen: () => {
        if (document) actions.selectDocument(document.id);
        else void actions.openWorkspaceFile(entry.path);
      },
      onOpenInNewTab: () => {
        void actions.openWorkspaceFileInNewTab(entry.path);
      },
      onDuplicate: () => {
        void runFsAction(async () => {
          const path = await duplicateFile(entry.path);
          await refreshDirectory(parentDir(entry.path));
          await actions.openWorkspaceFileInNewTab(path);
        });
      },
      onCopyRelativePath: copyPath,
      onCopyAbsolutePath: copyAbsolutePath,
      onReveal: reveal,
      onDelete: () => {
        if (!window.confirm(`Delete "${entry.name}"?`)) return;
        void runFsAction(async () => {
          await tauri.deleteEntry(entry.path);
          if (document) actions.closeDocument(document.id);
          await refreshDirectory(parentDir(entry.path));
        });
      },
    });
  }, [actions, closeDocumentsUnder, expanded, invalidatePath, refreshDirectory, selectedPaths, state.workspaceRoot, documents, toggleDirectory]);

  if (!state.workspaceRoot) {
    return <div className="empty-sidebar">No files</div>;
  }
  if (error) {
    return <div className="empty-sidebar">{error}</div>;
  }
  if (items.length === 0 && loading.size > 0) {
    return <div className="empty-sidebar">Loading files...</div>;
  }
  if (items.length === 0) {
    return <div className="empty-sidebar">No files</div>;
  }

  return (
    <div className="project-list" role="tree" aria-label="File tree">
      {items.map((item) => (
        <FileTreeNode
          key={item.entry.path}
          item={item}
          document={documents.get(item.entry.path) ?? null}
          state={state}
          isExpanded={expanded.has(item.entry.path)}
          onContextMenu={openContextMenu}
          onSelect={selectItem}
          isSelected={selectedPaths.has(item.entry.path)}
          isRenaming={renamingPath === item.entry.path}
          onRenameSubmit={renameItem}
          onRenameCancel={() => setRenamingPath(null)}
        />
      ))}
    </div>
  );
}
