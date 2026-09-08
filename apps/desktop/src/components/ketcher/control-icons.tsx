import { Children, isValidElement, type ReactNode } from "react";
import { FileBlank, FolderOpen, Download, Copy, Clipboard, Scissor, Undo, ArrowRotateCw, SettingsCog, Expand, Collapse, InfoCircle, ChevronDown, type AppIconType } from "@/components/ui/app-icons";

const controls: Record<string, AppIconType> = {
  new: FileBlank, clear: FileBlank, open: FolderOpen, "open-1": FolderOpen,
  save: Download, "save-1": Download, copy: Copy, paste: Clipboard, cut: Scissor,
  undo: Undo, redo: ArrowRotateCw, settings: SettingsCog, fullscreen: Expand,
  "fullscreen-exit": Collapse, about: InfoCircle, dropdown: ChevronDown,
};

// Keep chemistry glyphs and non-icon children (including shortcut labels) intact.
export function controlIcons(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<{ name?: string }>(child)) return child;
    const Icon = child.props.name ? controls[child.props.name] : undefined;
    return Icon ? <Icon className="ketcher-control-icon" size={20} aria-hidden="true" /> : child;
  });
}
