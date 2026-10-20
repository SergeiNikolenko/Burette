import { useRef, useState } from "react";

export type FileSelectionModifiers = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; currentTarget: HTMLElement };

// Keep the range anchor independent of selection insertion order, including
// when a Shift range shrinks or Cmd+Shift extends the current selection.
export function selectFileRange(selected: Set<string>, anchor: string | null, path: string,
  visible: string[], modifiers: Pick<FileSelectionModifiers, "metaKey" | "ctrlKey" | "shiftKey">) {
  const additive = modifiers.metaKey || modifiers.ctrlKey;
  if (modifiers.shiftKey) {
    const start = anchor ? visible.indexOf(anchor) : -1;
    const end = visible.indexOf(path);
    const range = start >= 0 && end >= 0 ? visible.slice(Math.min(start, end), Math.max(start, end) + 1) : [path];
    return { selected: new Set([...(additive ? selected : []), ...range]), anchor: start >= 0 ? anchor : path };
  }
  const next = additive ? new Set(selected) : new Set<string>();
  if (additive && next.has(path)) next.delete(path); else next.add(path);
  return { selected: next, anchor: path };
}

export function useFileSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const current = useRef(selected);
  current.current = selected;
  const select = (path: string, event: FileSelectionModifiers) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    const visible = [...new Set(Array.from(tree?.querySelectorAll<HTMLElement>('[data-sidebar-structure-path]') ?? [])
      .filter(row => !row.closest('[data-expanded="false"]'))
      .map(row => row.dataset.sidebarStructurePath!))];
    const next = selectFileRange(current.current, anchor.current, path, visible, event);
    anchor.current = next.anchor;
    current.current = next.selected;
    setSelected(next.selected);
    return event.metaKey || event.ctrlKey || event.shiftKey;
  };
  return { selected, select };
}
