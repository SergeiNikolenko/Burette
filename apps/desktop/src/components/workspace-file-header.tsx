import { RadixDropdownMenu } from "./radix-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { ChevronDown, ChevronRight } from "./ui/app-icons";
import type { ShellActions } from "./types";
import type { MenuItemSpec } from "./menu-types";
import "./workspace-file-header.css";

export function WorkspaceFileHeader({ activeFile, defaultApplicationIconUrl, items, actions }: {
  activeFile: { path: string; label: string };
  defaultApplicationIconUrl: string | null;
  items: MenuItemSpec[];
  actions: Pick<ShellActions, "openPathWithDefaultApp">;
}) {
  const segments = activeFile.path.split("/").filter(Boolean);
  const name = segments.at(-1) || activeFile.label;
  return (
    <header className="workspace-file-header" aria-label="Current file">
      <div className="workspace-file-breadcrumb" title={activeFile.path}>
        <span className="workspace-file-parent">{segments.at(-2)}</span>
        <ChevronRight size={14} aria-hidden />
        <span className="workspace-file-name">{name}</span>
      </div>
      <div className="workspace-file-open">
        <button type="button" className="workspace-file-open-primary" aria-label="Open with default app"
          onClick={() => void actions.openPathWithDefaultApp(activeFile.path)}>
          {defaultApplicationIconUrl ? <img src={defaultApplicationIconUrl} alt="" /> : null}
          Open
          <ShortcutTooltip label="Open with default app" />
        </button>
        <RadixDropdownMenu align="end" sideOffset={6} contentClassName="open-editor-menu-content workspace-file-menu"
          items={items} trigger={(
            <button type="button" className="workspace-file-open-menu" aria-label="Open in another application">
              <ChevronDown size={16} aria-hidden />
              <ShortcutTooltip label="Open in another application" />
            </button>
          )} />
      </div>
    </header>
  );
}
