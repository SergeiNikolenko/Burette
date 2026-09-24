import { RadixDropdownMenu } from "./radix-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { ChevronDown, ChevronRight, Copy, SidebarLeft, SidebarRight } from "./ui/app-icons";
import type { ShellActions } from "./types";
import type { MenuItemSpec } from "./menu-types";
import "./workspace-file-header.css";

export function WorkspaceFileHeader({ activeFile, rootPath, rightDockOpen, bottomDockOpen, defaultApplicationIconUrl, items, actions, fileActionsAvailable = true, onOpen, openLabel = "Open with default app" }: {
  activeFile: { path: string; label: string };
  rootPath?: string | null;
  fileActionsAvailable?: boolean;
  rightDockOpen: boolean;
  bottomDockOpen: boolean;
  defaultApplicationIconUrl: string | null;
  items: MenuItemSpec[];
  onOpen?: () => void;
  openLabel?: string;
  actions: Pick<ShellActions, "openPathWithDefaultApp" | "copyPath" | "toggleDock">;
}) {
  const displayPath = rootPath && activeFile.path.startsWith(`${rootPath}/`)
    ? `${rootPath.split("/").filter(Boolean).at(-1)}/${activeFile.path.slice(rootPath.length + 1)}`
    : activeFile.path;
  const segments = fileActionsAvailable ? displayPath.split("/").filter(Boolean) : [activeFile.label];
  return (
    <header className="workspace-file-header" aria-label="Current file">
      <div className="workspace-file-path">
        <div className="workspace-file-breadcrumb" aria-label={fileActionsAvailable ? activeFile.path : activeFile.label} title={fileActionsAvailable ? activeFile.path : "Unsaved structure"}>
          <span className="workspace-file-ancestors">
          {segments.slice(0, -1).map((segment, index) => (
            <span className="workspace-file-parent" key={index}>
              {index > 0 ? <ChevronRight size={14} aria-hidden /> : null}
              <span>{segment}</span>
            </span>
          ))}
          </span>
          <span className="workspace-file-name" aria-current="page">
            {segments.length > 1 ? <ChevronRight size={14} aria-hidden /> : null}
            <span>{segments.at(-1) || activeFile.label}</span>
          </span>
        </div>
        {fileActionsAvailable ? <button type="button" className="workspace-file-icon-button" aria-label="Copy file path"
          onClick={() => void actions.copyPath(activeFile.path, "file")}>
          <Copy size={16} aria-hidden />
          <ShortcutTooltip label="Copy file path" />
        </button> : <span className="workspace-file-unsaved">Unsaved</span>}
      </div>
      {fileActionsAvailable ? <div className="workspace-file-open">
        <button type="button" className="workspace-file-open-primary" aria-label={openLabel}
          onClick={onOpen ?? (() => void actions.openPathWithDefaultApp(activeFile.path))}>
          {defaultApplicationIconUrl ? <img src={defaultApplicationIconUrl} alt="" /> : null}
          Open
          <ShortcutTooltip label={openLabel} />
        </button>
        <RadixDropdownMenu align="end" sideOffset={6} contentClassName="open-editor-menu-content workspace-file-menu"
          items={items} trigger={(
            <button type="button" className="workspace-file-open-menu" aria-label="Open in another application">
              <ChevronDown size={16} aria-hidden />
              <ShortcutTooltip label="Open in another application" />
            </button>
          )} />
      </div> : null}
      <div className="workspace-file-panels" role="group" aria-label="Workspace panels">
        <button type="button" className="workspace-file-icon-button" aria-label="Toggle bottom panel" aria-pressed={bottomDockOpen}
          onClick={() => actions.toggleDock("bottom")}>
          <SidebarLeft className="workspace-file-bottom-icon" size={18} aria-hidden />
          <ShortcutTooltip label={bottomDockOpen ? "Hide bottom panel" : "Show bottom panel"} />
        </button>
        <button type="button" className="workspace-file-icon-button" aria-label="Toggle right panel" aria-pressed={rightDockOpen}
          onClick={() => actions.toggleDock("right")}>
          <SidebarRight size={18} aria-hidden />
          <ShortcutTooltip label={rightDockOpen ? "Hide right panel" : "Show right panel"} />
        </button>
      </div>
    </header>
  );
}
