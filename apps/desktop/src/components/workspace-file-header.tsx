import { useRef, type ReactNode } from "react";
import { AnnotateToggle } from "./annotation-layer";
import { useWorkspaceHeaderBand } from "../hooks/use-workspace-header-band";
import { RadixDropdownMenu } from "./radix-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { FileKindIcon, fileKindForPath } from "./sidebar/file-kind-icon";
import { ChevronDown, SidebarRight } from "./ui/app-icons";
import type { ShellActions } from "./types";
import type { MenuItemSpec } from "./menu-types";
import "./workspace-file-header.css";

export function WorkspaceFileHeader({ activeFile, bandDocumentId = null, rightDockOpen, defaultApplicationIconUrl, items, actions, fileActionsAvailable = true, onOpen, openLabel = "Open with default app", navigation, fileAction }: {
  navigation?: ReactNode;
  fileAction?: ReactNode;
  activeFile: { path: string; label: string };
  /** A viewer document whose own controls share this row. */
  bandDocumentId?: string | null;
  fileActionsAvailable?: boolean;
  rightDockOpen: boolean;
  defaultApplicationIconUrl: string | null;
  items: MenuItemSpec[];
  onOpen?: () => void;
  openLabel?: string;
  actions: Pick<ShellActions, "openPathWithDefaultApp" | "copyPath" | "toggleDock">;
}) {
  const name = fileActionsAvailable ? activeFile.path.split("/").filter(Boolean).at(-1) || activeFile.label : activeFile.label;
  const headerRef = useRef<HTMLElement>(null);
  useWorkspaceHeaderBand(headerRef, bandDocumentId);
  // Laid out like a Codex file viewer: the file and annotation capsules lead,
  // viewer controls and Open trail, and the panel toggle closes the row.
  return (
    <header ref={headerRef} className="workspace-file-header" aria-label="Current file" data-band={bandDocumentId ? "" : undefined}>
      {navigation ? <div className="workspace-file-navigation">{navigation}</div> : null}
      <div className="workspace-file-title workspace-file-control" title={fileActionsAvailable ? activeFile.path : undefined}>
        <FileKindIcon kind={fileKindForPath(activeFile.path)} />
        <span className="workspace-file-name">{name}</span>
        {fileActionsAvailable ? null : <span className="workspace-file-unsaved">Unsaved</span>}
      </div>
      <AnnotateToggle className="workspace-file-control" />
      {bandDocumentId ? <div className="workspace-file-band-slot" aria-hidden /> : <span className="workspace-file-spacer" />}
      {fileActionsAvailable ? <div className="workspace-file-open workspace-file-control">
        <ShortcutTooltip label={openLabel}>
          <button type="button" className="workspace-file-open-primary" aria-label={openLabel}
            onClick={onOpen ?? (() => void actions.openPathWithDefaultApp(activeFile.path))}>
            {defaultApplicationIconUrl ? <img src={defaultApplicationIconUrl} alt="" width={18} height={18} /> : null}
            <span>Open</span>
          </button>
        </ShortcutTooltip>
        <RadixDropdownMenu align="end" sideOffset={6} contentClassName="open-editor-menu-content workspace-file-menu"
          items={[...items, { kind: "item", id: "copy-path", text: "Copy path", action: () => void actions.copyPath(activeFile.path, "file") }]}
          trigger={(
            <ShortcutTooltip label="Open in another application">
              <button type="button" className="workspace-file-open-menu" aria-label="Open in another application">
                <ChevronDown size={14} aria-hidden />
              </button>
            </ShortcutTooltip>
          )} />
      </div> : null}
      {fileAction}
      <ShortcutTooltip label={rightDockOpen ? "Hide right panel" : "Show right panel"}>
        <button type="button" className="chrome-button" aria-label="Toggle right panel" aria-pressed={rightDockOpen}
          onClick={() => actions.toggleDock("right")}>
          <SidebarRight size={18} aria-hidden />
        </button>
      </ShortcutTooltip>
    </header>
  );
}
