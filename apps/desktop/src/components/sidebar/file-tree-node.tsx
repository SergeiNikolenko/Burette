import { HugeiconsIcon } from "@hugeicons/react";
import { File02Icon, Folder01Icon, Folder02Icon } from "@hugeicons/core-free-icons";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ViewerDocument } from "../../types";
import type { ShellViewState } from "../types";
import type { FlatFileTreeItem } from "../../hooks/use-file-tree";

function handleKeyboardSelect(event: KeyboardEvent<HTMLElement>, onSelect: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect();
}

function fileStem(name: string) {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

export const FileTreeNode = memo(function FileTreeNode({
  item,
  document,
  state,
  isExpanded,
  onContextMenu,
  onSelect,
  isSelected,
  isRenaming,
  onRenameSubmit,
  onRenameCancel,
}: {
  item: FlatFileTreeItem;
  document: ViewerDocument | null;
  state: ShellViewState;
  isExpanded: boolean;
  onContextMenu: (event: MouseEvent<HTMLElement>, item: FlatFileTreeItem, document: ViewerDocument | null) => void;
  onSelect: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, item: FlatFileTreeItem, document: ViewerDocument | null) => void;
  isSelected: boolean;
  isRenaming: boolean;
  onRenameSubmit: (item: FlatFileTreeItem, nextName: string) => void;
  onRenameCancel: () => void;
}) {
  const { entry } = item;
  const isActive = document ? state.page === "viewer" && document.id === state.activeDocumentId : false;
  const icon = entry.isDirectory ? (isExpanded ? Folder02Icon : Folder01Icon) : File02Icon;
  const label = entry.isDirectory ? entry.name : document?.title ?? fileStem(entry.name);
  const [draftName, setDraftName] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenaming) return;
    setDraftName(entry.name);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [entry.name, isRenaming]);

  const select = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    onSelect(event, item, document);
  };
  const submitRename = () => {
    onRenameSubmit(item, draftName);
  };

  return (
    <button
      type="button"
      role="treeitem"
      aria-label={entry.isDirectory ? entry.name + " folder" : label}
      aria-selected={isActive || undefined}
      aria-expanded={entry.isDirectory ? isExpanded : undefined}
      className={[
        isActive ? "project active file-tree-row" : "project file-tree-row",
        entry.isDirectory ? "folder" : "",
        isSelected ? "selected" : "",
        isRenaming ? "renaming" : "",
      ].filter(Boolean).join(" ")}
      style={{ paddingLeft: item.depth === 0 ? 10 : item.depth * 12 + 6 }}
      onMouseDown={(event) => {
        if (!isRenaming) event.preventDefault();
      }}
      onClick={isRenaming ? undefined : select}
      onContextMenu={(event) => onContextMenu(event, item, document)}
      onKeyDown={(event) => {
        if (isRenaming) return;
        handleKeyboardSelect(event, () => select(event));
      }}
    >
      <span className="file-tree-icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={16} color="currentColor" strokeWidth={2} />
      </span>
      {isRenaming ? (
        <input
          ref={inputRef}
          className="file-tree-rename-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={submitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
        />
      ) : (
        <span className="project-name">{label}</span>
      )}
    </button>
  );
});
